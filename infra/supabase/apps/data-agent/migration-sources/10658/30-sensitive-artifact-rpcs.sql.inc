create function app_data_agent.commit_sensitive_execution_artifact(
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
    or requested_command ->> 'schema_version' <> 'sensitive-execution-artifact-commit@1.0.0'
    or requested_command ->> 'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{7,127}$'
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  receipt := requested_command -> 'receipt';
  reference := receipt -> 'artifact_ref';
  lifecycle := receipt -> 'lifecycle';
  if not app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','artifact_ref','task_id','context_epoch_id','content_kind',
      'plaintext_hash','ciphertext_hash','storage_key_hash','encryption','lifecycle',
      'committed_at','receipt_hash'
    ])
    or receipt ->> 'schema_version' <> 'sensitive-execution-artifact@1.0.0'
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
  if not exists (
    select 1 from app_data_agent.agent_team_tasks task
    where task.app_id=(authority ->> 'app_id')::uuid
      and task.tenant_id=(authority ->> 'tenant_id')::uuid
      and task.environment=authority ->> 'environment'
      and task.run_id=(authority ->> 'run_id')::uuid
      and task.task_id=(receipt ->> 'task_id')::uuid
      and task.authority_attempt_id=(authority ->> 'attempt_id')::uuid
      and task.worker_fence=(authority ->> 'worker_fence')::bigint
  ) or (
    receipt -> 'context_epoch_id' <> 'null'::jsonb
    and not exists (
      select 1 from app_data_agent.agent_team_context_epochs epoch
      where epoch.app_id=(authority ->> 'app_id')::uuid
        and epoch.tenant_id=(authority ->> 'tenant_id')::uuid
        and epoch.environment=authority ->> 'environment'
        and epoch.task_id=(receipt ->> 'task_id')::uuid
        and epoch.epoch_id=(receipt ->> 'context_epoch_id')::uuid
    )
  ) then
    raise exception using errcode='40001',message='SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH';
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
      'schema_version','sensitive-execution-artifact-commit-result@1.0.0',
      'disposition','REPLAYED','receipt',existing.receipt_json
    );
  end if;

  insert into app_data_agent.sensitive_execution_artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,artifact_revision,task_id,
    context_epoch_id,plaintext_hash,ciphertext_hash,storage_key_hash,key_id,
    lifecycle_status,expires_at,legal_hold,ref_count,tombstoned_at,backup_expires_at,
    receipt_hash,idempotency_key,receipt_json,committed_at
  ) values (
    (authority ->> 'app_id')::uuid,(authority ->> 'tenant_id')::uuid,authority ->> 'environment',
    (authority ->> 'run_id')::uuid,(reference ->> 'artifact_id')::uuid,
    (reference ->> 'revision')::integer,(receipt ->> 'task_id')::uuid,
    case when receipt -> 'context_epoch_id'='null'::jsonb then null
      else (receipt ->> 'context_epoch_id')::uuid end,
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
    'schema_version','sensitive-execution-artifact-commit-result@1.0.0',
    'disposition','CREATED','receipt',receipt
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.load_sensitive_execution_artifact(requested_command jsonb)
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
      'schema_version','artifact_ref','task_id','context_epoch_id','ciphertext_hash',
      'capability_id','capability_hash'
    ]) or requested_command ->> 'schema_version' <> 'sensitive-execution-artifact-load@1.0.0'
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
    and stored.environment=authority.environment
    and stored.run_id=(reference ->> 'run_id')::uuid
    and stored.artifact_id=(reference ->> 'artifact_id')::uuid
    and stored.artifact_revision=(reference ->> 'revision')::integer
    and stored.plaintext_hash=reference ->> 'content_hash'
    and stored.task_id=(requested_command ->> 'task_id')::uuid
    and stored.context_epoch_id is not distinct from
      case when requested_command -> 'context_epoch_id'='null'::jsonb then null
        else (requested_command ->> 'context_epoch_id')::uuid end
    and stored.ciphertext_hash=requested_command ->> 'ciphertext_hash';
  if not found then
    return pg_catalog.jsonb_build_object(
      'schema_version','sensitive-execution-artifact-load-result@1.0.0','receipt',null
    );
  end if;
  if not exists (
    select 1 from app_data_agent.agent_team_task_capabilities capability
    where capability.app_id=artifact.app_id and capability.tenant_id=artifact.tenant_id
      and capability.environment=artifact.environment and capability.run_id=artifact.run_id
      and capability.task_id=artifact.task_id
      and capability.capability_id=(requested_command ->> 'capability_id')::uuid
      and capability.capability_hash=requested_command ->> 'capability_hash'
      and capability.expires_at>pg_catalog.clock_timestamp()
      and capability.capability_json -> 'operation_audiences' @> '["TOOL_INVOKE"]'::jsonb
  ) then
    raise exception using errcode='42501',message='SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH';
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
    'schema_version','sensitive-execution-artifact-load-result@1.0.0',
    'receipt',artifact.receipt_json
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
end
$function$;

alter function app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.load_sensitive_execution_artifact(jsonb)
  owner to data_agent_u19_team_owner;
