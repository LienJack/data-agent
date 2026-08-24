-- run_scoped_sensitive_analysis_input_migration_checksum: sha256:a06fc2ae46a7697e1ca43b3ce2a6355b53d8c519a09dc3661efa9949406f31a6
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RUN_SCOPED_SENSITIVE_ANALYSIS_INPUT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RUN_SCOPED_SENSITIVE_ANALYSIS_INPUT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010737_app_data_agent_research_commit_wire_projection')
  then raise exception using errcode='P0001',message='RUN_SCOPED_SENSITIVE_ANALYSIS_INPUT_BASELINE_10737_MISSING'; end if;
  if exists(select 1 from app_data_agent.sensitive_execution_artifacts) then
    raise exception using errcode='P0001',message='LEGACY_TEAM_SCOPED_SENSITIVE_ARTIFACTS_REQUIRE_EXPLICIT_RETIREMENT';
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

alter table app_data_agent.sensitive_execution_artifacts
  drop constraint sensitive_execution_artifacts_app_id_tenant_id_environment_fkey,
  drop column task_id,
  drop column context_epoch_id,
  add column principal_id uuid not null,
  add foreign key (app_id,tenant_id,environment,run_id,principal_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id,principal_id);

create or replace function app_data_agent.commit_sensitive_execution_artifact(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  authority jsonb;
  receipt jsonb;
  reference jsonb;
  lifecycle jsonb;
  existing app_data_agent.sensitive_execution_artifacts%rowtype;
begin
  authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  if not app_data_agent.provider_json_object_has_exact_keys(
      requested_command,array['schema_version','receipt','idempotency_key']
    )
    or requested_command ->> 'schema_version' <> 'sensitive-execution-artifact-commit@2.0.0'
    or requested_command ->> 'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{7,127}$'
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  receipt := requested_command -> 'receipt';
  reference := receipt -> 'artifact_ref';
  lifecycle := receipt -> 'lifecycle';
  if not app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','artifact_ref','content_kind','plaintext_hash','ciphertext_hash',
      'storage_key_hash','encryption','lifecycle','committed_at','receipt_hash'
    ])
    or receipt ->> 'schema_version' <> 'sensitive-execution-artifact@2.0.0'
    or receipt ->> 'content_kind' <> 'ANALYSIS_INPUT'
    or not app_data_agent.provider_json_object_has_exact_keys(reference,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ])
    or reference ->> 'artifact_type' <> 'SensitiveExecutionArtifact'
    or reference ->> 'content_hash' <> receipt ->> 'plaintext_hash'
    or not app_data_agent.provider_json_object_has_exact_keys(
      receipt -> 'encryption',array['algorithm','key_id']
    )
    or receipt #>> '{encryption,algorithm}' <> 'AES-256-GCM'
    or not app_data_agent.provider_json_object_has_exact_keys(lifecycle,array[
      'status','expires_at','legal_hold','ref_count','tombstoned_at','backup_expires_at'
    ])
    or lifecycle ->> 'status' not in ('ACTIVE','TOMBSTONED')
    or (lifecycle ->> 'ref_count')::integer<0
    or (lifecycle ->> 'backup_expires_at')::timestamptz<(lifecycle ->> 'expires_at')::timestamptz
    or (lifecycle ->> 'status'='ACTIVE' and lifecycle -> 'tombstoned_at'<>'null'::jsonb)
    or (lifecycle ->> 'status'='TOMBSTONED' and lifecycle -> 'tombstoned_at'='null'::jsonb)
    or receipt ->> 'receipt_hash' <> app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  if reference ->> 'app_id' <> authority ->> 'app_id'
    or reference ->> 'tenant_id' <> authority ->> 'tenant_id'
    or reference ->> 'environment' <> authority ->> 'environment'
    or reference ->> 'run_id' <> authority ->> 'run_id'
  then
    raise exception using errcode='42501',message='SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH';
  end if;

  select * into existing
  from app_data_agent.sensitive_execution_artifacts artifact
  where artifact.app_id=(authority ->> 'app_id')::uuid
    and artifact.tenant_id=(authority ->> 'tenant_id')::uuid
    and artifact.environment=authority ->> 'environment'
    and artifact.idempotency_key=requested_command ->> 'idempotency_key';
  if found then
    if existing.receipt_json <> receipt then
      raise exception using errcode='23505',message='SENSITIVE_EXECUTION_ARTIFACT_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','sensitive-execution-artifact-commit-result@2.0.0',
      'disposition','REPLAYED','receipt',existing.receipt_json
    );
  end if;

  insert into app_data_agent.sensitive_execution_artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,artifact_revision,principal_id,
    plaintext_hash,ciphertext_hash,storage_key_hash,key_id,lifecycle_status,expires_at,
    legal_hold,ref_count,tombstoned_at,backup_expires_at,receipt_hash,idempotency_key,
    receipt_json,committed_at
  ) values (
    (authority ->> 'app_id')::uuid,(authority ->> 'tenant_id')::uuid,authority ->> 'environment',
    (authority ->> 'run_id')::uuid,(reference ->> 'artifact_id')::uuid,
    (reference ->> 'revision')::integer,(authority ->> 'principal_id')::uuid,
    receipt ->> 'plaintext_hash',receipt ->> 'ciphertext_hash',receipt ->> 'storage_key_hash',
    receipt #>> '{encryption,key_id}',lifecycle ->> 'status',
    (lifecycle ->> 'expires_at')::timestamptz,(lifecycle ->> 'legal_hold')::boolean,
    (lifecycle ->> 'ref_count')::integer,
    case when lifecycle -> 'tombstoned_at'='null'::jsonb then null
      else (lifecycle ->> 'tombstoned_at')::timestamptz end,
    (lifecycle ->> 'backup_expires_at')::timestamptz,receipt ->> 'receipt_hash',
    requested_command ->> 'idempotency_key',receipt,(receipt ->> 'committed_at')::timestamptz
  );
  insert into app_data_agent.sensitive_execution_artifact_access_audit(
    app_id,tenant_id,environment,artifact_id,artifact_revision,principal_id,action
  ) values (
    (authority ->> 'app_id')::uuid,(authority ->> 'tenant_id')::uuid,authority ->> 'environment',
    (reference ->> 'artifact_id')::uuid,(reference ->> 'revision')::integer,
    (authority ->> 'principal_id')::uuid,'COMMIT'
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','sensitive-execution-artifact-commit-result@2.0.0',
    'disposition','CREATED','receipt',receipt
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
end
$function$;

create or replace function app_data_agent.load_sensitive_execution_artifact(requested_command jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  authority record;
  reference jsonb;
  artifact app_data_agent.sensitive_execution_artifacts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','artifact_ref','ciphertext_hash'
    ]) or requested_command ->> 'schema_version' <> 'sensitive-execution-artifact-load@2.0.0'
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  reference := requested_command -> 'artifact_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]) or reference ->> 'artifact_type' <> 'SensitiveExecutionArtifact'
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  if reference ->> 'app_id' <> authority.app_id::text
    or reference ->> 'tenant_id' <> authority.tenant_id::text
    or reference ->> 'environment' <> authority.environment
  then
    raise exception using errcode='42501',message='SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH';
  end if;
  select * into artifact from app_data_agent.sensitive_execution_artifacts stored
  where stored.app_id=authority.app_id and stored.tenant_id=authority.tenant_id
    and stored.environment=authority.environment and stored.principal_id=authority.principal_id
    and stored.run_id=(reference ->> 'run_id')::uuid
    and stored.artifact_id=(reference ->> 'artifact_id')::uuid
    and stored.artifact_revision=(reference ->> 'revision')::integer
    and stored.plaintext_hash=reference ->> 'content_hash'
    and stored.ciphertext_hash=requested_command ->> 'ciphertext_hash';
  if not found then
    return pg_catalog.jsonb_build_object(
      'schema_version','sensitive-execution-artifact-load-result@2.0.0','receipt',null
    );
  end if;
  if artifact.lifecycle_status='TOMBSTONED' or artifact.expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='55000',message='SENSITIVE_EXECUTION_ARTIFACT_TOMBSTONED';
  end if;
  insert into app_data_agent.sensitive_execution_artifact_access_audit(
    app_id,tenant_id,environment,artifact_id,artifact_revision,principal_id,action
  ) values (
    artifact.app_id,artifact.tenant_id,artifact.environment,artifact.artifact_id,
    artifact.artifact_revision,authority.principal_id,'LOAD'
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','sensitive-execution-artifact-load-result@2.0.0',
    'receipt',artifact.receipt_json
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
end
$function$;

do $postconditions$
declare
  commit_definition text;
  load_definition text;
begin
  if exists(select 1 from information_schema.columns
    where table_schema='app_data_agent' and table_name='sensitive_execution_artifacts'
      and column_name in ('task_id','context_epoch_id'))
    or not exists(select 1 from information_schema.columns
      where table_schema='app_data_agent' and table_name='sensitive_execution_artifacts'
        and column_name='principal_id' and is_nullable='NO')
  then raise exception using errcode='P0001',message='RUN_SCOPED_SENSITIVE_ANALYSIS_INPUT_SHAPE_INVALID'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb)'::pg_catalog.regprocedure
  ) into strict commit_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.load_sensitive_execution_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict load_definition;
  if pg_catalog.strpos(commit_definition,'sensitive-execution-artifact-commit@2.0.0')=0
    or pg_catalog.strpos(commit_definition,'agent_team_tasks')<>0
    or pg_catalog.strpos(load_definition,'sensitive-execution-artifact-load@2.0.0')=0
    or pg_catalog.strpos(load_definition,'agent_team_task_capabilities')<>0
  then raise exception using errcode='P0001',message='RUN_SCOPED_SENSITIVE_ANALYSIS_INPUT_AUTHORITY_INVALID'; end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010738_app_data_agent_run_scoped_sensitive_analysis_input',
  'sha256:a06fc2ae46a7697e1ca43b3ce2a6355b53d8c519a09dc3661efa9949406f31a6');
commit;
