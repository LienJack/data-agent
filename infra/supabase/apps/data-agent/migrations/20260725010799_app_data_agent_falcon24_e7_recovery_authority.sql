-- falcon24_e7_recovery_authority_migration_checksum: sha256:5d7c0d29d355665fa7c283ccc33f209a40ad49c9e697b4b21bfbeed3c17a37a3
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010798_app_data_agent_falcon24_e5_retained_authority')
    or pg_catalog.to_regprocedure('app_data_agent.activate_falcon24_authority(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.complete_falcon24_diagnostic(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.list_provider_execution_profiles()') is null
    or pg_catalog.to_regprocedure('app_data_agent.lock_owned_run_fence(uuid)') is null
    or pg_catalog.to_regprocedure('semantic.lock_semantic_authority_fence(uuid,uuid,text,text)') is null
    or pg_catalog.to_regclass('app_data_agent.artifacts') is null
    or pg_catalog.to_regclass('app_data_agent.run_events') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_diagnostic_attempts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_diagnostic_receipts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_llm_execution_certification_stage') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.stage_falcon24_llm_execution_certification(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='FALCON24_E7_RECOVERY_AUTHORITY_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10799_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text;schema_name text;table_name text;before_count bigint;before_digest text;
begin
  foreach relation_name in array array[
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection','semantic.semantic_runtime_restriction_projection',
    'semantic.semantic_graph_projection','semantic.semantic_source_release_graph_projection',
    'semantic.semantic_active_pointer','semantic.semantic_runtime_activation',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions',
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_diagnostic_attempts','app_data_agent.falcon24_diagnostic_receipts',
    'app_data_agent.falcon24_qualifications','app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.runs','app_data_agent.run_events','app_data_agent.artifacts'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10799_history_snapshot values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create table app_data_agent.falcon24_llm_execution_certification_stage(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,principal_id uuid not null,
  target_authority_epoch text not null check(
    app_data_agent.falcon24_authority_epoch_is_canonical(target_authority_epoch)
    and pg_catalog.substr(target_authority_epoch,2)::numeric>=7),
  staging_id uuid not null,stage_id uuid not null,idempotency_key text not null
    check(pg_catalog.length(idempotency_key) between 1 and 256),
  staging_command_hash text not null check(staging_command_hash~'^sha256:[0-9a-f]{64}$'),
  model_profile_id uuid not null,model_config_version bigint not null
    check(model_config_version between 1 and 9007199254740991),
  model_resource_hash text not null check(model_resource_hash~'^sha256:[0-9a-f]{64}$'),
  provider text not null check(provider='deepseek'),
  model_id text not null check(model_id='deepseek-v4-flash'),
  certification_run_id uuid not null,certification_artifact_id uuid not null,
  certification_revision integer not null check(certification_revision=1),
  certification_content_hash text not null
    check(certification_content_hash~'^sha256:[0-9a-f]{64}$'),
  execution_profile_hash text not null check(execution_profile_hash~'^sha256:[0-9a-f]{64}$'),
  deployment_id uuid not null,deployment_hash text not null
    check(deployment_hash~'^sha256:[0-9a-f]{64}$'),
  recovery_capabilities jsonb not null check(
    recovery_capabilities='["AT_LEAST_ONCE_ONLY"]'::jsonb),
  worker_build_id text not null check(worker_build_id~'^sha256:[0-9a-f]{64}$'),
  worker_generation_id text not null check(worker_generation_id~'^sha256:[0-9a-f]{64}$'),
  proof_hash text not null check(proof_hash~'^sha256:[0-9a-f]{64}$'),
  proof_document jsonb not null check(pg_catalog.jsonb_typeof(proof_document)='object'),
  status text not null check(status in('STAGED','PROMOTED','REJECTED')),
  activation_attempt_id uuid,
  rejection_reason_code text check(
    rejection_reason_code is null or rejection_reason_code~'^[A-Z][A-Z0-9_]{2,127}$'),
  rejection_command_hash text check(
    rejection_command_hash is null or rejection_command_hash~'^sha256:[0-9a-f]{64}$'),
  promoted_at timestamptz,created_at timestamptz not null
    default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,stage_id),
  unique(app_id,tenant_id,environment,idempotency_key),
  unique(app_id,tenant_id,environment,proof_hash),
  unique(app_id,tenant_id,environment,certification_run_id,certification_artifact_id,
    certification_content_hash),
  foreign key(app_id,tenant_id,environment,certification_run_id,
    certification_artifact_id,certification_revision,certification_content_hash)
    references app_data_agent.artifacts(
      app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash) on delete restrict,
  check(proof_document->>'proof_hash'=proof_hash),
  check((status='STAGED' and activation_attempt_id is null and promoted_at is null
      and rejection_reason_code is null and rejection_command_hash is null)
    or (status='PROMOTED' and activation_attempt_id is not null and promoted_at is not null
      and rejection_reason_code is null and rejection_command_hash is null)
    or (status='REJECTED' and activation_attempt_id is null and promoted_at is not null
      and rejection_reason_code is not null and rejection_command_hash is not null))
);

create unique index falcon24_llm_execution_one_live_stage
on app_data_agent.falcon24_llm_execution_certification_stage(
  app_id,tenant_id,environment,target_authority_epoch) where status='STAGED';

create function app_data_agent.falcon24_llm_execution_stage_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if tg_op='DELETE'
    or (pg_catalog.to_jsonb(new)-array['status','activation_attempt_id','rejection_reason_code',
      'rejection_command_hash','promoted_at'])
      is distinct from
      (pg_catalog.to_jsonb(old)-array['status','activation_attempt_id','rejection_reason_code',
        'rejection_command_hash','promoted_at'])
    or old.status<>'STAGED' or new.status not in('PROMOTED','REJECTED')
  then raise exception using errcode='55000',
    message='FALCON24_LLM_EXECUTION_STAGE_IMMUTABLE'; end if;
  return new;
end
$function$;

create trigger falcon24_llm_execution_stage_state_fence
before update or delete on app_data_agent.falcon24_llm_execution_certification_stage
for each row execute function app_data_agent.falcon24_llm_execution_stage_state_fence();

alter table app_data_agent.falcon24_llm_execution_certification_stage enable row level security;
alter table app_data_agent.falcon24_llm_execution_certification_stage force row level security;
create function app_data_agent.stage_falcon24_llm_execution_certification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  existing app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  proof jsonb;certification jsonb;reference jsonb;snapshot jsonb;worker_build jsonb;
  catalog app_data_agent.model_catalog_entries%rowtype;
  revision app_data_agent.model_config_versions%rowtype;
  deployment platform.deployment_mappings%rowtype;
  active_fence bigint;expected_resource_hash text;expected_deployment_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','target_authority_epoch','staging_id','stage_id','idempotency_key',
      'proof_document','certification_claims','worker_fence','command_hash']::text[])
      is distinct from true
    or command->>'schema_version'<>'falcon24-llm-execution-stage-command@1.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'target_authority_epoch')
      is distinct from true
    or pg_catalog.substr(command->>'target_authority_epoch',2)::numeric<7
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'stage_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or pg_catalog.jsonb_typeof(command->'worker_fence') is distinct from 'number'
    or command->>'worker_fence'!~'^(0|[1-9][0-9]*)$'
    or (command->>'worker_fence')::numeric>9007199254740991
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_STAGE_COMMAND_INVALID'; end if;
  proof:=command->'proof_document';certification:=command->'certification_claims';
  reference:=certification->'receipt_ref';snapshot:=certification->'execution_profile_snapshot';
  worker_build:=proof->'worker_build';
  if pg_catalog.jsonb_typeof(proof) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(proof,array[
      'schema_version','scope','target_authority_epoch','staging_id','stage_id','model_profile_id',
      'model_config_version','model_resource_hash','provider','model_id','certification_receipt_ref',
      'execution_profile_hash','deployment_id','deployment_hash','recovery_capabilities',
      'worker_build','proof_hash']::text[]) is distinct from true
    or proof->>'schema_version'<>'falcon24-llm-execution-authority-proof@1.0.0'
    or proof->>'target_authority_epoch'<>command->>'target_authority_epoch'
    or proof->>'staging_id'<>command->>'staging_id' or proof->>'stage_id'<>command->>'stage_id'
    or proof->>'provider'<>'deepseek' or proof->>'model_id'<>'deepseek-v4-flash'
    or proof->'recovery_capabilities'<>'["AT_LEAST_ONCE_ONLY"]'::jsonb
    or proof->>'proof_hash' is distinct from app_data_agent.u2_canonical_sha256(
      pg_catalog.jsonb_build_object('hash_domain',
        'falcon24-llm-execution-authority-proof@1.0.0','proof',proof-'proof_hash'))
    or not app_data_agent.provider_json_object_has_exact_keys(proof->'scope',array[
      'app_id','tenant_id','environment','semantic_domain']::text[])
    or proof#>>'{scope,semantic_domain}'<>'falcon24'
    or not app_data_agent.provider_json_object_has_exact_keys(worker_build,array[
      'build_id','generation_id']::text[])
    or worker_build->>'build_id'!~'^sha256:[0-9a-f]{64}$'
    or worker_build->>'generation_id'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_PROOF_INVALID'; end if;
  if pg_catalog.jsonb_typeof(certification) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(certification,array[
      'schema_version','receipt_ref','profile_id','model_config_version','provider','model_id',
      'profile_version','adapter_version','execution_profile_hash','execution_profile_snapshot',
      'recovery_capabilities','connection','certification_basis','verdict']::text[])
      is distinct from true
    or certification->>'schema_version'<>'model-execution-certification@1.0.0'
    or certification->>'provider'<>'deepseek' or certification->>'model_id'<>'deepseek-v4-flash'
    or certification->>'verdict'<>'PASS'
    or certification->'recovery_capabilities'<>'["AT_LEAST_ONCE_ONLY"]'::jsonb
    or certification#>>'{certification_basis,kind}'<>'CREDENTIAL_SMOKE'
    or certification#>>'{certification_basis,probe_hash}'!~'^sha256:[0-9a-f]{64}$'
    or certification->>'execution_profile_hash' is distinct from
      app_data_agent.u2_canonical_sha256(certification->'execution_profile_snapshot')
    or reference->>'content_hash' is distinct from
      app_data_agent.u2_canonical_sha256(certification#-'{receipt_ref,content_hash}')
    or certification->'connection' is distinct from snapshot->'connection'
    or certification->'recovery_capabilities' is distinct from snapshot->'recovery_capabilities'
    or certification->>'profile_id' is distinct from snapshot->>'profile_id'
    or certification->>'model_config_version' is distinct from snapshot->>'model_config_version'
    or certification->>'provider' is distinct from snapshot->>'provider'
    or certification->>'model_id' is distinct from snapshot->>'model_id'
    or certification->>'profile_version' is distinct from snapshot->>'profile_version'
    or certification->>'adapter_version' is distinct from snapshot->>'adapter_version'
    or snapshot#>>'{context_window,verification_status}'<>'VERIFIED'
    or certification#>>'{connection,kind}'<>'SYSTEM_DEPLOYMENT'
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_CERTIFICATION_INVALID'; end if;
  if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
      'content_hash']::text[])
    or reference->>'artifact_type'<>'ModelCertificationReceipt' or reference->>'revision'<>'1'
    or app_data_agent.canonical_uuid_json_string_is_valid(reference->'artifact_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(reference->'run_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(certification->'profile_id') is distinct from true
    or certification->>'model_config_version'!~'^[1-9][0-9]*$'
    or (certification->>'model_config_version')::numeric>9007199254740991
    or not app_data_agent.provider_json_object_has_exact_keys(certification->'connection',array[
      'kind','deployment_id','deployment_revision','deployment_hash']::text[])
    or certification#>>'{connection,deployment_revision}'<>'1'
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_CERTIFICATION_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  if proof#>>'{scope,app_id}' is distinct from authority.app_id::text
    or proof#>>'{scope,tenant_id}' is distinct from authority.tenant_id::text
    or proof#>>'{scope,environment}' is distinct from authority.environment
    or reference->>'app_id' is distinct from authority.app_id::text
    or reference->>'tenant_id' is distinct from authority.tenant_id::text
    or reference->>'environment' is distinct from authority.environment
    or snapshot#>>'{scope,app_id}' is distinct from authority.app_id::text
    or snapshot#>>'{scope,tenant_id}' is distinct from authority.tenant_id::text
    or snapshot#>>'{scope,environment}' is distinct from authority.environment
  then raise exception using errcode='42501',
    message='FALCON24_LLM_EXECUTION_STAGE_SCOPE_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-llm-execution-stage:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  select * into existing from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and (row.stage_id=(command->>'stage_id')::uuid
        or row.idempotency_key=command->>'idempotency_key') for update;
  if found then
    if existing.staging_command_hash=command->>'command_hash'
      and existing.proof_hash=proof->>'proof_hash'
    then return existing.proof_document; end if;
    raise exception using errcode='23505',message='FALCON24_LLM_EXECUTION_STAGE_CONFLICT';
  end if;
  if pg_catalog.substr(command->>'target_authority_epoch',2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
  then raise exception using errcode='55000',
    message='FALCON24_LLM_EXECUTION_STAGE_NOT_SUCCESSOR'; end if;

  select * into catalog from app_data_agent.model_catalog_entries row
    where row.app_id=authority.app_id and row.environment=authority.environment
      and row.model_profile_id=(certification->>'profile_id')::uuid
      and row.config_version=(certification->>'model_config_version')::bigint
      and row.provider='deepseek' and row.model_id='deepseek-v4-flash'
      and row.status='ACTIVE' and row.is_system_default for share;
  select * into revision from app_data_agent.model_config_versions row
    where row.app_id=catalog.app_id and row.environment=catalog.environment
      and row.model_profile_id=catalog.model_profile_id
      and row.config_version=catalog.config_version for share;
  select * into deployment from platform.deployment_mappings row
    where row.deployment_id=authority.deployment_id and row.app_id=authority.app_id
      and row.environment=authority.environment and row.is_active for share;
  expected_resource_hash:=platform.canonical_sha256(revision.snapshot);
  expected_deployment_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'deployment_id',deployment.deployment_id,'app_id',deployment.app_id,
    'environment',deployment.environment,'deployment_key_hash',deployment.deployment_key_hash));
  if catalog.model_profile_id is null or revision.model_profile_id is null or deployment.deployment_id is null
    or proof->>'model_profile_id'<>catalog.model_profile_id::text
    or proof->>'model_config_version'<>catalog.config_version::text
    or proof->>'model_resource_hash' is distinct from expected_resource_hash
    or proof->>'execution_profile_hash' is distinct from certification->>'execution_profile_hash'
    or proof->>'deployment_id'<>deployment.deployment_id::text
    or proof->>'deployment_hash' is distinct from expected_deployment_hash
    or certification#>>'{connection,deployment_id}'<>deployment.deployment_id::text
    or certification#>>'{connection,deployment_hash}' is distinct from expected_deployment_hash
    or proof->'certification_receipt_ref' is distinct from reference
  then raise exception using errcode='55000',
    message='FALCON24_LLM_EXECUTION_CATALOG_MISMATCH'; end if;

  select app_data_agent.lock_owned_run_fence((reference->>'run_id')::uuid)
    into strict active_fence;
  if active_fence is distinct from (command->>'worker_fence')::bigint
  then raise exception using errcode='55000',message='WORKER_FENCE_STALE'; end if;
  insert into app_data_agent.artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
    document_json,worker_fence,is_active,parent_revision,parent_content_hash)
  values(authority.app_id,authority.tenant_id,authority.environment,
    (reference->>'run_id')::uuid,(reference->>'artifact_id')::uuid,
    'ModelCertificationReceipt',1,reference->>'content_hash',certification,active_fence,
    false,null,null);
  insert into app_data_agent.falcon24_llm_execution_certification_stage(
    app_id,tenant_id,environment,principal_id,target_authority_epoch,staging_id,stage_id,
    idempotency_key,staging_command_hash,model_profile_id,model_config_version,
    model_resource_hash,provider,model_id,certification_run_id,certification_artifact_id,
    certification_revision,certification_content_hash,execution_profile_hash,deployment_id,
    deployment_hash,recovery_capabilities,worker_build_id,worker_generation_id,
    proof_hash,proof_document,status)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    command->>'target_authority_epoch',(command->>'staging_id')::uuid,
    (command->>'stage_id')::uuid,command->>'idempotency_key',command->>'command_hash',
    (proof->>'model_profile_id')::uuid,(proof->>'model_config_version')::bigint,
    proof->>'model_resource_hash','deepseek','deepseek-v4-flash',
    (reference->>'run_id')::uuid,(reference->>'artifact_id')::uuid,1,
    reference->>'content_hash',proof->>'execution_profile_hash',
    (proof->>'deployment_id')::uuid,proof->>'deployment_hash',proof->'recovery_capabilities',
    worker_build->>'build_id',worker_build->>'generation_id',proof->>'proof_hash',proof,'STAGED');
  return proof;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_LLM_EXECUTION_STAGE_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_llm_execution_certification_stage(requested_stage_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  certification app_data_agent.artifacts%rowtype;
begin
  if requested_stage_id is null then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_STAGE_ID_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.stage_id=requested_stage_id;
  if not found or stage.principal_id<>authority.principal_id
  then raise exception using errcode='02000',message='FALCON24_LLM_EXECUTION_STAGE_NOT_FOUND'; end if;
  select * into certification from app_data_agent.artifacts row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.run_id=stage.certification_run_id
      and row.artifact_id=stage.certification_artifact_id
      and row.revision=stage.certification_revision
      and row.content_hash=stage.certification_content_hash;
  if certification.artifact_id is null
  then raise exception using errcode='55000',message='FALCON24_LLM_EXECUTION_STAGE_CORRUPT'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-llm-execution-stage@1.0.0',
    'status',stage.status,'proof_document',stage.proof_document,
    'certification_claims',certification.document_json,
    'certification_is_active',certification.is_active,
    'staging_command_hash',stage.staging_command_hash,
    'activation_attempt_id',stage.activation_attempt_id,
    'rejection_reason_code',stage.rejection_reason_code,
    'rejection_command_hash',stage.rejection_command_hash);
end
$function$;

create function app_data_agent.reject_falcon24_llm_execution_certification_stage(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','stage_id','proof_hash','reason_code','command_hash']::text[])
      is distinct from true
    or command->>'schema_version'<>'falcon24-llm-execution-stage-reject@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'stage_id') is distinct from true
    or command->>'proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'reason_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_STAGE_REJECT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.stage_id=(command->>'stage_id')::uuid for update;
  if stage.stage_id is null or stage.proof_hash<>command->>'proof_hash'
  then raise exception using errcode='02000',
    message='FALCON24_LLM_EXECUTION_STAGE_NOT_FOUND'; end if;
  if stage.status='REJECTED'
  then return app_data_agent.load_falcon24_llm_execution_certification_stage(stage.stage_id); end if;
  if stage.status<>'STAGED'
    or pg_catalog.substr(stage.target_authority_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
    or exists(select 1 from app_data_agent.falcon24_authority_baselines baseline
      join app_data_agent.falcon24_authority_activation_attempts attempt
        on attempt.app_id=baseline.app_id and attempt.tenant_id=baseline.tenant_id
       and attempt.environment=baseline.environment and attempt.baseline_id=baseline.baseline_id
       and attempt.expected_baseline_hash=baseline.baseline_hash
      where baseline.app_id=stage.app_id and baseline.tenant_id=stage.tenant_id
        and baseline.environment=stage.environment and baseline.staging_id=stage.staging_id
        and attempt.status='ACTIVATED')
  then raise exception using errcode='55000',
    message='FALCON24_LLM_EXECUTION_STAGE_REJECT_FORBIDDEN'; end if;
  update app_data_agent.falcon24_llm_execution_certification_stage set
    status='REJECTED',rejection_reason_code=command->>'reason_code',
    rejection_command_hash=command->>'command_hash',promoted_at=pg_catalog.clock_timestamp()
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and stage_id=stage.stage_id and status='STAGED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_LLM_EXECUTION_STAGE_REJECT_RACE'; end if;
  return app_data_agent.load_falcon24_llm_execution_certification_stage(stage.stage_id);
end
$function$;

create function app_data_agent.load_falcon24_e7_recovery_context(requested_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  attempt app_data_agent.falcon24_diagnostic_attempts%rowtype;
  run_row app_data_agent.runs%rowtype;
begin
  if requested_attempt_id is null then raise exception using errcode='22023',
    message='FALCON24_E7_RECOVERY_CONTEXT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  select * into attempt from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=requested_attempt_id;
  select * into run_row from app_data_agent.runs row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.run_id=attempt.run_id
      and row.principal_id=attempt.principal_id;
  if attempt.attempt_id is null or attempt.status<>'ACTIVE'
    or attempt.authority_epoch<>current_epoch.authority_epoch
    or attempt.authority_baseline_id<>current_epoch.baseline_id
    or attempt.authority_baseline_hash<>current_epoch.baseline_hash
    or attempt.authority_activation_attempt_id<>current_epoch.activation_attempt_id
    or run_row.status<>'FAILED'
    or not exists(select 1 from app_data_agent.run_events event
      where event.app_id=attempt.app_id and event.tenant_id=attempt.tenant_id
        and event.environment=attempt.environment and event.run_id=attempt.run_id
        and event.event_type='run.failed'
        and event.payload_json->>'error_code'='PROVIDER_PROFILE_NOT_AVAILABLE'
        and event.payload_json->>'retryable'='false')
  then raise exception using errcode='55000',
    message='FALCON24_E7_RECOVERY_CONTEXT_NOT_ELIGIBLE'; end if;
  return pg_catalog.jsonb_build_object(
    'attempt_id',attempt.attempt_id,'run_id',attempt.run_id,'manifest_hash',attempt.manifest_hash,
    'failure_class','FROZEN_CLOSURE_CHANGE_REQUIRED',
    'failure_code','PROVIDER_PROFILE_NOT_AVAILABLE');
end
$function$;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  rename to activate_falcon24_authority_pre_e7;

create function app_data_agent.activate_falcon24_authority(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;scope_json jsonb;expected_authority jsonb;failure jsonb;stage_ref jsonb;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  diagnostic app_data_agent.falcon24_diagnostic_attempts%rowtype;
  diagnostic_receipt app_data_agent.falcon24_diagnostic_receipts%rowtype;
  failed_run app_data_agent.runs%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  certification app_data_agent.artifacts%rowtype;
  catalog app_data_agent.model_catalog_entries%rowtype;
  revision app_data_agent.model_config_versions%rowtype;
  deployment platform.deployment_mappings%rowtype;
  target_baseline app_data_agent.falcon24_authority_baselines%rowtype;
  llm_receipt app_data_agent.falcon24_authority_staging_receipts%rowtype;
  diagnostic_command jsonb;diagnostic_document jsonb;v3_command jsonb;authority_document jsonb;
  is_replay boolean:=false;now_at timestamptz;
begin
  if command->>'schema_version' in(
      'falcon24-activation-request@2.0.0','falcon24-activation-request@3.0.0')
  then return app_data_agent.activate_falcon24_authority_pre_e7(command); end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','scope','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'expected_current_authority','expected_semantic_release','expected_versions',
      'retained_semantic_proof_hash','predecessor_diagnostic_failure',
      'llm_execution_stage_ref','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-activation-request@4.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric<7
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'retained_semantic_proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',message='FALCON24_RECOVERY_ACTIVATION_INVALID'; end if;
  scope_json:=command->'scope';expected_authority:=command->'expected_current_authority';
  failure:=command->'predecessor_diagnostic_failure';stage_ref:=command->'llm_execution_stage_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
    or expected_authority->>'schema_version'<>'falcon24-authority-binding@2.0.0'
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric
      <>pg_catalog.substr(expected_authority->>'authority_epoch',2)::numeric+1
    or not app_data_agent.provider_json_object_has_exact_keys(failure,array[
      'attempt_id','run_id','manifest_hash','failure_class','failure_code']::text[])
    or failure->>'failure_class'<>'FROZEN_CLOSURE_CHANGE_REQUIRED'
    or failure->>'failure_code'<>'PROVIDER_PROFILE_NOT_AVAILABLE'
    or failure->>'manifest_hash'!~'^sha256:[0-9a-f]{64}$'
    or not app_data_agent.provider_json_object_has_exact_keys(stage_ref,array[
      'stage_id','proof_hash']::text[])
    or stage_ref->>'proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(failure->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(failure->'run_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
  then raise exception using errcode='22023',message='FALCON24_RECOVERY_ACTIVATION_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',
    message='FALCON24_RECOVERY_ACTIVATION_SCOPE_FORBIDDEN'; end if;

  -- Global E7 lock order: semantic fence -> Falcon activation advisory -> diagnostic advisory
  -- -> current -> semantic pointer/runtime -> workspace defaults -> predecessor diagnostic
  -- -> LLM candidate -> target authority (inside the retained activation helper).
  perform semantic.lock_semantic_authority_fence(
    authority.app_id,authority.tenant_id,authority.environment,scope_json->>'semantic_domain');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-diagnostic:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
    for update;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
    for update;
  select * into defaults_pointer from app_data_agent.workspace_run_defaults row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  select * into defaults_revision from app_data_agent.workspace_run_default_revisions row
    where row.app_id=defaults_pointer.app_id and row.tenant_id=defaults_pointer.tenant_id
      and row.environment=defaults_pointer.environment and row.defaults_id=defaults_pointer.defaults_id
      and row.defaults_revision=defaults_pointer.defaults_revision
      and row.revision_id=defaults_pointer.revision_id and row.defaults_hash=defaults_pointer.defaults_hash
    for update;
  select * into diagnostic from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(failure->>'attempt_id')::uuid for update;
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.stage_id=(stage_ref->>'stage_id')::uuid for update;
  select * into certification from app_data_agent.artifacts row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.run_id=stage.certification_run_id
      and row.artifact_id=stage.certification_artifact_id
      and row.revision=stage.certification_revision
      and row.content_hash=stage.certification_content_hash for update;
  select * into catalog from app_data_agent.model_catalog_entries row
    where row.app_id=stage.app_id and row.environment=stage.environment
      and row.model_profile_id=stage.model_profile_id
      and row.config_version=stage.model_config_version
      and row.provider=stage.provider and row.model_id=stage.model_id for share;
  select * into revision from app_data_agent.model_config_versions row
    where row.app_id=stage.app_id and row.environment=stage.environment
      and row.model_profile_id=stage.model_profile_id
      and row.config_version=stage.model_config_version for share;
  select * into deployment from platform.deployment_mappings row
    where row.deployment_id=stage.deployment_id and row.app_id=stage.app_id
      and row.environment=stage.environment for share;
  select * into target_baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.baseline_id=(command->>'baseline_id')::uuid
      and row.authority_epoch=command->>'authority_epoch' for update;
  select * into llm_receipt from app_data_agent.falcon24_authority_staging_receipts row
    where row.app_id=target_baseline.app_id and row.tenant_id=target_baseline.tenant_id
      and row.environment=target_baseline.environment
      and row.staging_id=target_baseline.staging_id
      and row.authority_epoch=target_baseline.authority_epoch
      and row.component='LLM_CONFIGURATION' for share;

  is_replay:=current_epoch.authority_epoch=command->>'authority_epoch'
    and current_epoch.baseline_id=(command->>'baseline_id')::uuid
    and current_epoch.baseline_hash=command->>'expected_baseline_hash'
    and current_epoch.activation_attempt_id=(command->>'attempt_id')::uuid;
  if not is_replay and (
      current_epoch.authority_epoch is distinct from expected_authority->>'authority_epoch'
      or current_epoch.baseline_id is distinct from (expected_authority->>'baseline_id')::uuid
      or current_epoch.baseline_hash is distinct from expected_authority->>'baseline_hash'
      or current_epoch.activation_attempt_id is distinct from
        (expected_authority->>'activation_attempt_id')::uuid)
  then raise exception using errcode='40001',
    message='FALCON24_RECOVERY_ACTIVATION_PREDECESSOR_MISMATCH'; end if;
  if diagnostic.attempt_id is null or diagnostic.run_id<>(failure->>'run_id')::uuid
    or diagnostic.manifest_hash<>failure->>'manifest_hash'
    or diagnostic.authority_epoch<>expected_authority->>'authority_epoch'
    or diagnostic.authority_baseline_id<>(expected_authority->>'baseline_id')::uuid
    or diagnostic.authority_baseline_hash<>expected_authority->>'baseline_hash'
    or diagnostic.authority_activation_attempt_id<>
      (expected_authority->>'activation_attempt_id')::uuid
    or (not is_replay and diagnostic.status<>'ACTIVE')
    or (is_replay and (diagnostic.status<>'FAILED'
      or diagnostic.failure_class<>'FROZEN_CLOSURE_CHANGE_REQUIRED'
      or diagnostic.failure_code<>'PROVIDER_PROFILE_NOT_AVAILABLE'))
  then raise exception using errcode='55000',
    message='FALCON24_RECOVERY_DIAGNOSTIC_MISMATCH'; end if;
  select * into failed_run from app_data_agent.runs row
    where row.app_id=diagnostic.app_id and row.tenant_id=diagnostic.tenant_id
      and row.environment=diagnostic.environment and row.run_id=diagnostic.run_id
      and row.principal_id=diagnostic.principal_id and row.status='FAILED' for share;
  if failed_run.run_id is null or not exists(
    select 1 from app_data_agent.run_events event
    where event.app_id=diagnostic.app_id and event.tenant_id=diagnostic.tenant_id
      and event.environment=diagnostic.environment and event.run_id=diagnostic.run_id
      and event.event_type='run.failed'
      and event.payload_json->>'error_code'='PROVIDER_PROFILE_NOT_AVAILABLE'
      and event.payload_json->>'retryable'='false')
  then raise exception using errcode='55000',
    message='FALCON24_RECOVERY_DURABLE_FAILURE_MISSING'; end if;
  if stage.stage_id is null or stage.target_authority_epoch<>command->>'authority_epoch'
    or target_baseline.baseline_id is null or stage.staging_id<>target_baseline.staging_id
    or stage.proof_hash<>stage_ref->>'proof_hash'
    or stage.proof_document->>'proof_hash'<>stage.proof_hash
    or llm_receipt.evidence_hash<>stage.proof_hash
    or llm_receipt.subject_hash<>stage.model_resource_hash
    or (not is_replay and (stage.status<>'STAGED' or certification.is_active))
    or (is_replay and (stage.status<>'PROMOTED' or not certification.is_active
      or stage.activation_attempt_id<>(command->>'attempt_id')::uuid))
  then raise exception using errcode='55000',
    message='FALCON24_RECOVERY_LLM_STAGE_MISMATCH'; end if;
  if catalog.model_profile_id is null or catalog.status<>'ACTIVE' or not catalog.is_system_default
    or revision.model_profile_id is null
    or platform.canonical_sha256(revision.snapshot)<>stage.model_resource_hash
    or deployment.deployment_id is null or not deployment.is_active
    or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'deployment_id',deployment.deployment_id,'app_id',deployment.app_id,
      'environment',deployment.environment,'deployment_key_hash',deployment.deployment_key_hash))
      <>stage.deployment_hash
  then raise exception using errcode='55000',
    message='FALCON24_RECOVERY_LLM_CATALOG_DRIFT'; end if;

  diagnostic_command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-complete@1.0.0',
    'attempt_id',diagnostic.attempt_id,'outcome','FAIL',
    'failure_class','FROZEN_CLOSURE_CHANGE_REQUIRED',
    'failure_code','PROVIDER_PROFILE_NOT_AVAILABLE');
  diagnostic_command:=diagnostic_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(diagnostic_command));
  diagnostic_document:=app_data_agent.complete_falcon24_diagnostic(diagnostic_command);
  select * into strict diagnostic_receipt from app_data_agent.falcon24_diagnostic_receipts row
    where row.app_id=diagnostic.app_id and row.tenant_id=diagnostic.tenant_id
      and row.environment=diagnostic.environment and row.attempt_id=diagnostic.attempt_id;

  if not is_replay then
    update app_data_agent.artifacts set is_active=true
      where app_id=certification.app_id and tenant_id=certification.tenant_id
        and environment=certification.environment and run_id=certification.run_id
        and artifact_id=certification.artifact_id and revision=certification.revision
        and content_hash=certification.content_hash and not is_active;
    if not found then raise exception using errcode='40001',
      message='FALCON24_RECOVERY_CERTIFICATION_PROMOTION_RACE'; end if;
    now_at:=pg_catalog.clock_timestamp();
    update app_data_agent.falcon24_llm_execution_certification_stage set
      status='PROMOTED',activation_attempt_id=(command->>'attempt_id')::uuid,promoted_at=now_at
      where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
        and stage_id=stage.stage_id and status='STAGED';
    if not found then raise exception using errcode='40001',
      message='FALCON24_RECOVERY_LLM_STAGE_PROMOTION_RACE'; end if;
  end if;

  v3_command:=(command-array[
    'predecessor_diagnostic_failure','llm_execution_stage_ref','command_hash'])
    ||pg_catalog.jsonb_build_object('schema_version','falcon24-activation-request@3.0.0');
  v3_command:=v3_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(v3_command));
  authority_document:=app_data_agent.activate_falcon24_authority_pre_e7(v3_command);
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-retained-activation-result@4.0.0',
    'activation_command_hash',command->>'command_hash','authority',authority_document,
    'predecessor_diagnostic_receipt',pg_catalog.jsonb_build_object(
      'attempt_id',diagnostic.attempt_id,'run_id',diagnostic.run_id,
      'receipt_hash',diagnostic_receipt.receipt_hash),
    'llm_execution_certification',pg_catalog.jsonb_build_object(
      'stage_id',stage.stage_id,'proof_hash',stage.proof_hash,
      'certification_receipt_ref',stage.proof_document->'certification_receipt_ref',
      'execution_profile_hash',stage.execution_profile_hash));
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',message='FALCON24_RECOVERY_ACTIVATION_INVALID';
end
$function$;
alter function app_data_agent.list_provider_execution_profiles()
  rename to list_provider_execution_profiles_pre_e7;

create function app_data_agent.list_provider_execution_profiles()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  document jsonb;profile jsonb;profiles jsonb:='[]'::jsonb;matches_stage boolean;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
  then raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  document:=app_data_agent.list_provider_execution_profiles_pre_e7();
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  if current_epoch.authority_epoch is null
    or pg_catalog.substr(current_epoch.authority_epoch,2)::numeric<7
  then return document; end if;
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.target_authority_epoch=current_epoch.authority_epoch
      and current_epoch.activation_attempt_id=stage.activation_attempt_id
      and stage.status='PROMOTED';
  for profile in select item from pg_catalog.jsonb_array_elements(document->'profiles') item loop
    matches_stage:=stage.stage_id is not null
      and profile->>'model_profile_id'=stage.model_profile_id::text
      and profile->>'model_config_version'=stage.model_config_version::text
      and profile->>'execution_profile_hash'=stage.execution_profile_hash
      and profile#>>'{certification_receipt_ref,run_id}'=stage.certification_run_id::text
      and profile#>>'{certification_receipt_ref,artifact_id}'=stage.certification_artifact_id::text
      and profile#>>'{certification_receipt_ref,revision}'=stage.certification_revision::text
      and profile#>>'{certification_receipt_ref,content_hash}'=stage.certification_content_hash;
    if profile->>'readiness'='AVAILABLE' and not matches_stage then
      profile:=(profile-array['adapter_version','certification_receipt_ref',
        'execution_profile_hash','recovery_capabilities','connection',
        'effective_context_ceiling_tokens','effective_output_ceiling_tokens'])
        ||pg_catalog.jsonb_build_object(
          'readiness','STALE','selectable',false,'unavailable_reason','MODEL_PROFILE_STALE');
    end if;
    profiles:=profiles||pg_catalog.jsonb_build_array(profile);
  end loop;
  return pg_catalog.jsonb_set(document,'{profiles}',profiles,false);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='P0001',message='PROVIDER_EXECUTION_PROFILE_LIST_INVALID';
end
$function$;
alter table app_data_agent.falcon24_llm_execution_certification_stage
  owner to data_agent_u6_data_owner;
alter function app_data_agent.falcon24_llm_execution_stage_state_fence()
  owner to data_agent_u6_data_owner;
alter function app_data_agent.stage_falcon24_llm_execution_certification(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_llm_execution_certification_stage(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.reject_falcon24_llm_execution_certification_stage(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_e7_recovery_context(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority_pre_e7(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.list_provider_execution_profiles_pre_e7()
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.list_provider_execution_profiles()
  owner to data_agent_provider_invocation_rpc_owner;

create policy falcon24_llm_execution_stage_rpc
on app_data_agent.falcon24_llm_execution_certification_stage for all
to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));
create policy falcon24_llm_execution_stage_provider_select
on app_data_agent.falcon24_llm_execution_certification_stage for select
to data_agent_provider_invocation_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_e7_certification_artifact_insert_rpc
on app_data_agent.artifacts for insert to data_agent_u6_rpc_owner
with check(artifact_type='ModelCertificationReceipt' and not is_active
  and platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e7_certification_artifact_update_rpc
on app_data_agent.artifacts for update to data_agent_u6_rpc_owner
using(artifact_type='ModelCertificationReceipt' and not is_active
  and platform.backend_context_matches(app_id,tenant_id,environment,true))
with check(artifact_type='ModelCertificationReceipt' and is_active
  and platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e7_current_authority_provider_select
on app_data_agent.falcon24_current_authority_epoch for select
to data_agent_provider_invocation_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_e7_model_catalog_stage_select
on app_data_agent.model_catalog_entries for select to data_agent_u6_rpc_owner
using(app_id=(select app_id from platform.current_backend_authority(false))
  and environment=(select environment from platform.current_backend_authority(false)));
create policy falcon24_e7_model_catalog_stage_lock
on app_data_agent.model_catalog_entries for update to data_agent_u6_rpc_owner
using(app_id=(select app_id from platform.current_backend_authority(false))
  and environment=(select environment from platform.current_backend_authority(false)))
with check(app_id=(select app_id from platform.current_backend_authority(true))
  and environment=(select environment from platform.current_backend_authority(true)));
create policy falcon24_e7_model_config_stage_select
on app_data_agent.model_config_versions for select to data_agent_u6_rpc_owner
using(app_id=(select app_id from platform.current_backend_authority(false))
  and environment=(select environment from platform.current_backend_authority(false)));
create policy falcon24_e7_model_config_stage_lock
on app_data_agent.model_config_versions for update to data_agent_u6_rpc_owner
using(app_id=(select app_id from platform.current_backend_authority(false))
  and environment=(select environment from platform.current_backend_authority(false)))
with check(app_id=(select app_id from platform.current_backend_authority(true))
  and environment=(select environment from platform.current_backend_authority(true)));

grant select,insert,update on table
  app_data_agent.falcon24_llm_execution_certification_stage to data_agent_u6_rpc_owner;
grant select on table app_data_agent.falcon24_llm_execution_certification_stage,
  app_data_agent.falcon24_current_authority_epoch to data_agent_provider_invocation_rpc_owner;
grant insert on table app_data_agent.artifacts to data_agent_u6_rpc_owner;
grant update(is_active) on table app_data_agent.artifacts to data_agent_u6_rpc_owner;
grant select on table app_data_agent.model_catalog_entries,
  app_data_agent.model_config_versions,platform.deployment_mappings,
  app_data_agent.runs,app_data_agent.run_events to data_agent_u6_rpc_owner;
grant update on table app_data_agent.model_catalog_entries,
  app_data_agent.model_config_versions to data_agent_u6_rpc_owner;
grant update on table platform.deployment_mappings to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.lock_owned_run_fence(uuid)
  to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.activate_falcon24_authority_pre_e7(jsonb),
  app_data_agent.list_provider_execution_profiles_pre_e7()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.stage_falcon24_llm_execution_certification(jsonb),
  app_data_agent.load_falcon24_llm_execution_certification_stage(uuid),
  app_data_agent.reject_falcon24_llm_execution_certification_stage(jsonb),
  app_data_agent.load_falcon24_e7_recovery_context(uuid),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.list_provider_execution_profiles()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function app_data_agent.stage_falcon24_llm_execution_certification(jsonb),
  app_data_agent.load_falcon24_llm_execution_certification_stage(uuid),
  app_data_agent.reject_falcon24_llm_execution_certification_stage(jsonb),
  app_data_agent.load_falcon24_e7_recovery_context(uuid),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.list_provider_execution_profiles() to data_agent_backend;
do $postconditions$
declare snapshot record;schema_name text;table_name text;after_count bigint;after_digest text;
  routine_name text;routine record;definition text;
begin
  for snapshot in select * from falcon24_10799_history_snapshot loop
    schema_name:=pg_catalog.split_part(snapshot.relation_name,'.',1);
    table_name:=pg_catalog.split_part(snapshot.relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if snapshot.row_count is distinct from after_count or snapshot.row_digest is distinct from after_digest
    then raise exception using errcode='P0001',message='FALCON24_E7_RECOVERY_HISTORY_DRIFT'; end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_llm_execution_certification_stage'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner)='data_agent_u6_data_owner')
    or not exists(select 1 from pg_catalog.pg_trigger trigger
      where trigger.tgrelid=
        'app_data_agent.falcon24_llm_execution_certification_stage'::regclass
        and trigger.tgname='falcon24_llm_execution_stage_state_fence'
        and not trigger.tgisinternal)
  then raise exception using errcode='P0001',
    message='FALCON24_E7_STAGE_STORAGE_POSTCONDITION_FAILED'; end if;
  foreach routine_name in array array[
    'app_data_agent.stage_falcon24_llm_execution_certification(jsonb)',
    'app_data_agent.load_falcon24_llm_execution_certification_stage(uuid)',
    'app_data_agent.reject_falcon24_llm_execution_certification_stage(jsonb)',
    'app_data_agent.load_falcon24_e7_recovery_context(uuid)',
    'app_data_agent.activate_falcon24_authority(jsonb)']::text[] loop
    select procedure.prosecdef,procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) owner_name into strict routine
      from pg_catalog.pg_proc procedure where procedure.oid=routine_name::regprocedure;
    if routine.prosecdef is distinct from true
      or routine.owner_name is distinct from 'data_agent_u6_rpc_owner'
      or not (routine.proconfig @> array['search_path=""']::text[])
      or pg_catalog.has_function_privilege('public',routine_name,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',routine_name,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E7_RPC_POSTCONDITION_FAILED',detail=routine_name; end if;
  end loop;
  foreach routine_name in array array[
    'app_data_agent.list_provider_execution_profiles()']::text[] loop
    select procedure.prosecdef,procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) owner_name into strict routine
      from pg_catalog.pg_proc procedure where procedure.oid=routine_name::regprocedure;
    if routine.prosecdef is distinct from true
      or routine.owner_name is distinct from 'data_agent_provider_invocation_rpc_owner'
      or not (routine.proconfig @> array['search_path=""']::text[])
      or pg_catalog.has_function_privilege('public',routine_name,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',routine_name,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E7_PROFILE_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'falcon24-activation-request@4.0.0')=0
    or pg_catalog.strpos(definition,'app_data_agent.complete_falcon24_diagnostic')=0
    or pg_catalog.strpos(definition,'app_data_agent.activate_falcon24_authority_pre_e7')=0
    or pg_catalog.strpos(definition,'FROZEN_CLOSURE_CHANGE_REQUIRED')=0
    or pg_catalog.strpos(definition,'PROVIDER_PROFILE_NOT_AVAILABLE')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E7_ACTIVATION_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010799_app_data_agent_falcon24_e7_recovery_authority',
  'sha256:5d7c0d29d355665fa7c283ccc33f209a40ad49c9e697b4b21bfbeed3c17a37a3');

commit;
