-- analysis_python_source_authority_migration_checksum: sha256:bff7853c88047afb2b12eb67c8e7b7c516845c2965f476b60af1b1f766bb09ee
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_PYTHON_SOURCE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_PYTHON_SOURCE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010708_app_data_agent_semantic_context_cutover')
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_BASELINE_10708_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.analysis_python_sources (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  artifact_id uuid not null,
  revision integer not null check (revision=1),
  plaintext_hash text not null check (plaintext_hash ~ '^sha256:[0-9a-f]{64}$'),
  analysis_program_id uuid not null,
  analysis_program_revision integer not null check (analysis_program_revision=1),
  analysis_program_hash text not null check (analysis_program_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text not null check (node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  generation_attempt integer not null check (generation_attempt in (0,1)),
  source_kind text not null check (source_kind in ('STANDARD_PROGRAM','DEEPSEEK_GENERATED')),
  provider_invocation_id uuid,
  provider_invocation_hash text check (
    provider_invocation_hash is null or provider_invocation_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ciphertext_hash text not null check (ciphertext_hash ~ '^sha256:[0-9a-f]{64}$'),
  key_id text not null check (key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  iv_base64 text not null check (pg_catalog.length(iv_base64) between 16 and 64),
  auth_tag_base64 text not null check (pg_catalog.length(auth_tag_base64) between 16 and 64),
  ciphertext_bytes bytea not null check (pg_catalog.octet_length(ciphertext_bytes) between 1 and 131072),
  principal_id uuid not null,
  attempt_id uuid not null,
  worker_fence bigint not null check (worker_fence>=1),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,run_id,artifact_id,revision),
  unique (app_id,tenant_id,environment,run_id,principal_id,idempotency_key),
  unique (app_id,tenant_id,environment,run_id,artifact_id,revision,plaintext_hash),
  foreign key (app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,attempt_id)
    references app_data_agent.run_attempts(app_id,tenant_id,environment,attempt_id) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,run_id,
    analysis_program_id,analysis_program_revision,analysis_program_hash
  ) references app_data_agent.artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash
  ) on delete restrict,
  check (
    (source_kind='STANDARD_PROGRAM' and generation_attempt=0
      and provider_invocation_id is null and provider_invocation_hash is null)
    or
    (source_kind='DEEPSEEK_GENERATED'
      and provider_invocation_id is not null and provider_invocation_hash is not null)
  )
);

create function app_data_agent.reject_analysis_python_source_mutation()
returns trigger language plpgsql volatile set search_path='' as $function$
begin
  raise exception using errcode='55000',message='ANALYSIS_PYTHON_SOURCE_IMMUTABLE';
end
$function$;

create trigger analysis_python_sources_immutable
before update or delete on app_data_agent.analysis_python_sources
for each row execute function app_data_agent.reject_analysis_python_source_mutation();

alter table app_data_agent.analysis_python_sources enable row level security;
alter table app_data_agent.analysis_python_sources force row level security;

create policy analysis_python_sources_rpc_select on app_data_agent.analysis_python_sources
for select to data_agent_u6_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_python_sources_rpc_insert on app_data_agent.analysis_python_sources
for insert to data_agent_u6_rpc_owner
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create function app_data_agent.commit_analysis_python_source(
  envelope_json jsonb,
  ciphertext_bytes bytea
)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  receipt_json jsonb;
  source_ref jsonb;
  program_ref jsonb;
  provider_ref jsonb;
  encryption_json jsonb;
  target_run record;
  target_attempt record;
  target_outbox record;
  existing app_data_agent.analysis_python_sources%rowtype;
  observed_ciphertext_hash text;
  expected_receipt_hash text;
  input_hash text;
  inserted_count bigint;
  db_now timestamptz;
begin
  command_json:=envelope_json->'command';
  scope_json:=command_json->'scope';
  receipt_json:=command_json->'receipt';
  source_ref:=receipt_json->'artifact_ref';
  program_ref:=receipt_json->'analysis_program_ref';
  provider_ref:=receipt_json->'provider_invocation_ref';
  encryption_json:=receipt_json->'encryption';

  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      envelope_json,array['protocol_version','authority_capability_id','command'])
    or not app_data_agent.provider_json_object_has_exact_keys(command_json,array[
      'schema_version','scope','run_id','principal_id','attempt_id','worker_fence',
      'idempotency_key','receipt'])
    or command_json->>'schema_version'<>'analysis-python-source-commit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      scope_json,array['app_id','tenant_id','environment'])
    or not app_data_agent.provider_json_object_has_exact_keys(receipt_json,array[
      'schema_version','artifact_ref','analysis_program_ref','node_id','generation_attempt',
      'source_kind','provider_invocation_ref','plaintext_hash','ciphertext_hash','encryption',
      'storage','committed_at','receipt_hash'])
    or receipt_json->>'schema_version'<>'analysis-python-source-receipt@1.0.0'
    or receipt_json->>'storage'<>'POSTGRES_ENCRYPTED_BYTEA'
    or not app_data_agent.provider_json_object_has_exact_keys(source_ref,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'])
    or source_ref->>'artifact_type'<>'SensitiveExecutionArtifact'
    or (source_ref->>'revision')::integer<>1
    or not app_data_agent.provider_json_object_has_exact_keys(program_ref,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'])
    or program_ref->>'artifact_type'<>'AnalysisProgram'
    or (program_ref->>'revision')::integer<>1
    or not app_data_agent.provider_json_object_has_exact_keys(encryption_json,array[
      'algorithm','key_id','iv_base64','auth_tag_base64'])
    or encryption_json->>'algorithm'<>'AES-256-GCM'
    or receipt_json->>'plaintext_hash'<>source_ref->>'content_hash'
    or source_ref->>'app_id'<>scope_json->>'app_id'
    or source_ref->>'tenant_id'<>scope_json->>'tenant_id'
    or source_ref->>'environment'<>scope_json->>'environment'
    or source_ref->>'run_id'<>command_json->>'run_id'
    or program_ref->>'app_id'<>scope_json->>'app_id'
    or program_ref->>'tenant_id'<>scope_json->>'tenant_id'
    or program_ref->>'environment'<>scope_json->>'environment'
    or program_ref->>'run_id'<>command_json->>'run_id'
    or (receipt_json->>'generation_attempt')::integer not in (0,1)
    or receipt_json->>'source_kind' not in ('STANDARD_PROGRAM','DEEPSEEK_GENERATED')
    or (receipt_json->>'source_kind'='STANDARD_PROGRAM' and (
      (receipt_json->>'generation_attempt')::integer<>0 or provider_ref<>'null'::jsonb))
    or (receipt_json->>'source_kind'='DEEPSEEK_GENERATED' and (
      provider_ref='null'::jsonb
      or not app_data_agent.provider_json_object_has_exact_keys(
        provider_ref,array['resource_id','resource_revision','resource_hash'])
      or (provider_ref->>'resource_revision')::integer<>1))
    or pg_catalog.octet_length(ciphertext_bytes) not between 1 and 131072
    or app_data_agent.contains_potential_plaintext_secret(receipt_json)
  then
    return pg_catalog.jsonb_build_object(
      'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_CONTRACT_INVALID');
  end if;

  expected_receipt_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'hash_domain','analysis-python-source-receipt@1.0.0',
    'value',receipt_json-'receipt_hash'));
  if receipt_json->>'receipt_hash'<>expected_receipt_hash then
    return pg_catalog.jsonb_build_object(
      'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_CONTRACT_INVALID');
  end if;
  observed_ciphertext_hash:='sha256:'||pg_catalog.encode(
    extensions.digest(ciphertext_bytes,'sha256'),'hex');
  if observed_ciphertext_hash<>receipt_json->>'ciphertext_hash' then
    return pg_catalog.jsonb_build_object(
      'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_CIPHERTEXT_MISMATCH');
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','PLANNING',null,null,true);

  select source.* into target_run from app_data_agent.runs source
  where source.app_id=(scope_json->>'app_id')::uuid
    and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment'
    and source.run_id=(command_json->>'run_id')::uuid
    and source.principal_id=(command_json->>'principal_id')::uuid
  for update of source nowait;
  select source.* into target_attempt from app_data_agent.run_attempts source
  where source.app_id=target_run.app_id and source.tenant_id=target_run.tenant_id
    and source.environment=target_run.environment and source.run_id=target_run.run_id
    and source.attempt_id=(command_json->>'attempt_id')::uuid;
  select source.* into target_outbox from app_data_agent.outbox source
  where source.app_id=target_attempt.app_id and source.tenant_id=target_attempt.tenant_id
    and source.environment=target_attempt.environment
    and source.outbox_id=target_attempt.outbox_id and source.run_id=target_attempt.run_id
  for update of source nowait;
  select source.* into target_attempt from app_data_agent.run_attempts source
  where source.app_id=target_attempt.app_id and source.tenant_id=target_attempt.tenant_id
    and source.environment=target_attempt.environment
    and source.attempt_id=target_attempt.attempt_id
  for update of source nowait;
  db_now:=pg_catalog.clock_timestamp();
  if target_run.run_id is null or target_attempt.attempt_id is null or target_outbox.outbox_id is null
    or target_attempt.status<>'ACTIVE'
    or target_attempt.worker_fence<>(command_json->>'worker_fence')::bigint
    or target_attempt.lease_expires_at<=db_now
    or target_outbox.active_attempt_id<>target_attempt.attempt_id
    or target_outbox.run_fence<>target_attempt.worker_fence
  then return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','RESEARCH_AUTHORITY_FENCE_MISMATCH'); end if;

  if not exists(select 1 from app_data_agent.artifacts artifact
    where artifact.app_id=target_run.app_id and artifact.tenant_id=target_run.tenant_id
      and artifact.environment=target_run.environment and artifact.run_id=target_run.run_id
      and artifact.artifact_id=(program_ref->>'artifact_id')::uuid
      and artifact.artifact_type='AnalysisProgram'
      and artifact.revision=(program_ref->>'revision')::integer
      and artifact.content_hash=program_ref->>'content_hash')
  then return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_SCOPE_MISMATCH'); end if;

  input_hash:=app_data_agent.u6_domain_sha256(
    'analysis-python-source-input@1.0.0',
    pg_catalog.jsonb_build_object('command',command_json,'ciphertext_hash',observed_ciphertext_hash));
  select source.* into existing from app_data_agent.analysis_python_sources source
  where source.app_id=target_run.app_id and source.tenant_id=target_run.tenant_id
    and source.environment=target_run.environment and source.run_id=target_run.run_id
    and source.principal_id=target_run.principal_id
    and source.idempotency_key=command_json->>'idempotency_key';
  if found then
    if existing.input_hash<>input_hash or existing.receipt_json<>receipt_json then
      return pg_catalog.jsonb_build_object(
        'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_IDEMPOTENCY_CONFLICT');
    end if;
    return pg_catalog.jsonb_build_object(
      'ok',true,'created',false,'receipt',existing.receipt_json);
  end if;

  insert into app_data_agent.analysis_python_sources(
    app_id,tenant_id,environment,run_id,artifact_id,revision,plaintext_hash,
    analysis_program_id,analysis_program_revision,analysis_program_hash,node_id,
    generation_attempt,source_kind,provider_invocation_id,provider_invocation_hash,
    ciphertext_hash,key_id,iv_base64,auth_tag_base64,ciphertext_bytes,
    principal_id,attempt_id,worker_fence,idempotency_key,input_hash,
    receipt_hash,receipt_json,committed_at
  ) values (
    target_run.app_id,target_run.tenant_id,target_run.environment,target_run.run_id,
    (source_ref->>'artifact_id')::uuid,1,receipt_json->>'plaintext_hash',
    (program_ref->>'artifact_id')::uuid,1,program_ref->>'content_hash',receipt_json->>'node_id',
    (receipt_json->>'generation_attempt')::integer,receipt_json->>'source_kind',
    case when provider_ref='null'::jsonb then null else (provider_ref->>'resource_id')::uuid end,
    case when provider_ref='null'::jsonb then null else provider_ref->>'resource_hash' end,
    observed_ciphertext_hash,encryption_json->>'key_id',encryption_json->>'iv_base64',
    encryption_json->>'auth_tag_base64',ciphertext_bytes,target_run.principal_id,
    target_attempt.attempt_id,target_attempt.worker_fence,command_json->>'idempotency_key',
    input_hash,receipt_json->>'receipt_hash',receipt_json,
    (receipt_json->>'committed_at')::timestamptz
  ) on conflict do nothing;
  get diagnostics inserted_count=row_count;
  if inserted_count<>1 then return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_IDEMPOTENCY_CONFLICT'); end if;
  return pg_catalog.jsonb_build_object('ok',true,'created',true,'receipt',receipt_json);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  return pg_catalog.jsonb_build_object(
    'ok',false,'error_code','ANALYSIS_PYTHON_SOURCE_CONTRACT_INVALID');
end
$function$;
alter table app_data_agent.analysis_python_sources owner to data_agent_u6_rpc_owner;
alter function app_data_agent.reject_analysis_python_source_mutation()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_analysis_python_source(jsonb,bytea)
  owner to data_agent_u6_rpc_owner;

revoke all on app_data_agent.analysis_python_sources
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.reject_analysis_python_source_mutation(),
  app_data_agent.commit_analysis_python_source(jsonb,bytea)
  from public,anon,authenticated,service_role,data_agent_backend;
grant select,insert on app_data_agent.analysis_python_sources to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.commit_analysis_python_source(jsonb,bytea)
  to data_agent_backend;

do $postconditions$
declare definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname='analysis_python_sources'
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.analysis_python_sources','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_analysis_python_source(jsonb,bytea)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_GRANT_UNSAFE'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_python_source(jsonb,bytea)'::pg_catalog.regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'analysis-python-source-receipt@1.0.0')=0
    or pg_catalog.strpos(definition,'AnalysisProgram')=0
    or pg_catalog.strpos(definition,'DEEPSEEK_GENERATED')=0
    or pg_catalog.strpos(definition,'RESEARCH_AUTHORITY_FENCE_MISMATCH')=0
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_CONTRACT_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010709_app_data_agent_analysis_python_source_authority',
  'sha256:bff7853c88047afb2b12eb67c8e7b7c516845c2965f476b60af1b1f766bb09ee');
commit;
