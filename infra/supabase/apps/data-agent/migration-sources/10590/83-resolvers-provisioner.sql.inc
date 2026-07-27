create function app_data_agent.resolve_invocation_terminal_preparation_recovery_metadata(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_run_id uuid;
  requested_principal_id uuid;
  requested_reservation_id uuid;
  requested_reservation_seq bigint;
  requested_resource_lease_id uuid;
  requested_invocation_id uuid;
  requested_request_id uuid;
  requested_attempt_id uuid;
  requested_worker_fence bigint;
  requested_resource_kind text;
  requested_terminal_stage text;
  expected_authority_kind text;
  preparation record;
begin
  command_json := envelope_json -> 'command';
  scope_json := command_json -> 'scope';
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 13
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or command_json ->> 'resource_kind' not in ('MODEL', 'SQL', 'TOOL')
    or command_json ->> 'terminal_stage' not in ('TERMINAL_INITIAL', 'TERMINAL_LATE')
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  begin
    requested_app_id := (scope_json ->> 'app_id')::uuid;
    requested_tenant_id := (scope_json ->> 'tenant_id')::uuid;
    requested_environment := scope_json ->> 'environment';
    requested_run_id := (command_json ->> 'run_id')::uuid;
    requested_principal_id := (command_json ->> 'principal_id')::uuid;
    requested_reservation_id := (command_json ->> 'reservation_id')::uuid;
    requested_reservation_seq := (command_json ->> 'reservation_seq')::bigint;
    requested_resource_lease_id := (command_json ->> 'resource_lease_id')::uuid;
    requested_invocation_id := (command_json ->> 'invocation_id')::uuid;
    requested_request_id := (command_json ->> 'request_id')::uuid;
    requested_attempt_id := (command_json ->> 'attempt_id')::uuid;
    requested_worker_fence := (command_json ->> 'worker_fence')::bigint;
    requested_resource_kind := command_json ->> 'resource_kind';
    requested_terminal_stage := command_json ->> 'terminal_stage';
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end;
  expected_authority_kind :=
    case requested_resource_kind
      when 'MODEL' then 'MODEL_INVOCATION_AUTHORITY'
      when 'SQL' then 'SQL_INVOCATION_AUTHORITY'
      when 'TOOL' then 'TOOL_INVOCATION_AUTHORITY'
    end;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    expected_authority_kind,
    null,
    null,
    requested_resource_kind,
    false
  );
  select source.*
  into preparation
  from app_data_agent.research_invocation_terminal_preparations as source
  join app_data_agent.research_invocation_commits as invocation
    on invocation.app_id = source.app_id
   and invocation.tenant_id = source.tenant_id
   and invocation.environment = source.environment
   and invocation.invocation_id = source.invocation_id
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.run_id = requested_run_id
    and source.principal_id = requested_principal_id
    and source.invocation_id = requested_invocation_id
    and source.resource_kind = requested_resource_kind
    and source.state in ('PREPARING', 'ABORTED')
    and invocation.reservation_id = requested_reservation_id
    and invocation.reservation_seq = requested_reservation_seq
    and invocation.resource_lease_id = requested_resource_lease_id
    and invocation.request_id = requested_request_id
    and invocation.attempt_id = requested_attempt_id
    and invocation.worker_fence = requested_worker_fence
    and (
      (requested_terminal_stage = 'TERMINAL_INITIAL' and invocation.state = 'STARTED')
      or (requested_terminal_stage = 'TERMINAL_LATE' and invocation.state = 'OUTCOME_UNKNOWN')
    )
  order by source.expires_at desc
  limit 1;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'RESEARCH_INVOCATION_PREPARATION_NOT_FOUND';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'invocation-terminal-preparation-recovery@1.0.0',
      'scope', scope_json,
      'run_id', preparation.run_id,
      'principal_id', preparation.principal_id,
      'invocation_id', preparation.invocation_id,
      'resource_kind', preparation.resource_kind,
      'reservation_id', requested_reservation_id,
      'reservation_seq', requested_reservation_seq,
      'resource_lease_id', requested_resource_lease_id,
      'request_id', requested_request_id,
      'attempt_id', requested_attempt_id,
      'worker_fence', requested_worker_fence,
      'terminal_stage', requested_terminal_stage,
      'preparation_id', preparation.preparation_id,
      'preparation_version', 1,
      'preparation_state',
        case preparation.state when 'PREPARING' then 'CLAIMED' else 'ABORTED' end,
      'claim_expires_at',
        case when preparation.state = 'PREPARING' then preparation.expires_at else null end
    )
  );
end
$function$;

create function app_data_agent.read_historical_l2_research_artifact(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  ref_json jsonb;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_run_id uuid;
  requested_artifact_id uuid;
  requested_revision integer;
  artifact_document jsonb;
begin
  command_json := envelope_json -> 'command';
  scope_json := command_json -> 'scope';
  ref_json := command_json -> 'ref';
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  begin
    requested_app_id := (scope_json ->> 'app_id')::uuid;
    requested_tenant_id := (scope_json ->> 'tenant_id')::uuid;
    requested_environment := scope_json ->> 'environment';
    requested_run_id := (command_json ->> 'run_id')::uuid;
    perform (command_json ->> 'principal_id')::uuid;
    requested_artifact_id := (ref_json ->> 'artifact_id')::uuid;
    requested_revision := (ref_json ->> 'revision')::integer;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'REPORT_READ_AUTHORITY',
    null,
    null,
    null,
    false
  );
  select artifact.document_json
  into artifact_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = requested_app_id
    and artifact.tenant_id = requested_tenant_id
    and artifact.environment = requested_environment
    and artifact.run_id = requested_run_id
    and artifact.artifact_id = requested_artifact_id
    and artifact.revision = requested_revision
    and artifact.artifact_type = ref_json ->> 'artifact_type'
    and artifact.content_hash = ref_json ->> 'content_hash'
    and artifact.document_json #>> '{envelope,artifact_type}' = artifact.artifact_type
    and artifact.document_json #>> '{payload,artifact_type}' = artifact.artifact_type
    and (
      (
        artifact.artifact_type in (
          'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'QueryEvidence',
          'AtomicClaim', 'EvidenceRelation', 'AnalysisReport',
          'ReportReadyCertificate'
        )
        and artifact.document_json #>> '{envelope,schema_version}' = '1.0.0'
        and not ((artifact.document_json -> 'payload') ? 'protocol_version')
      )
      or (
        (
          artifact.artifact_type,
          artifact.document_json #>> '{envelope,schema_version}',
          artifact.document_json #>> '{payload,protocol_version}'
        ) in (
          values
            ('ReportManifest', '1.0.0', 'report-manifest@1.0.0'),
            ('ReportReadyCertificate', '2.0.0', 'report-ready@2.0.0')
        )
      )
    );
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', null
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'authority', 'HISTORICAL_READ_ONLY',
      'can_authorize_current', false,
      'document', artifact_document
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_adapter_termination_receipt(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_record_id uuid;
  payload jsonb;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'ADAPTER_TERMINATION_RECEIPT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  begin
    requested_app_id := (scope_json ->> 'app_id')::uuid;
    requested_tenant_id := (scope_json ->> 'tenant_id')::uuid;
    requested_record_id := (ref_json ->> 'record_id')::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'RESOURCE_AUTHORITY', null, null, ref_json ->> 'adapter_kind', false
  );
  select receipt.payload_json
  into payload
  from app_data_agent.research_adapter_termination_receipts as receipt
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = receipt.app_id
   and identity.tenant_id = receipt.tenant_id
   and identity.environment = receipt.environment
   and identity.record_kind = receipt.record_kind
   and identity.record_id = receipt.record_id
   and identity.record_version = receipt.record_version
  where receipt.app_id = requested_app_id
    and receipt.tenant_id = requested_tenant_id
    and receipt.environment = scope_json ->> 'environment'
    and receipt.run_id = (command_json ->> 'run_id')::uuid
    and receipt.principal_id = (command_json ->> 'principal_id')::uuid
    and receipt.record_id = requested_record_id
    and receipt.resource_kind = ref_json ->> 'adapter_kind'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUTHORITY_EVIDENCE_NOT_COMMITTED';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', payload
  );
end
$function$;

create function app_data_agent.resolve_committed_invocation_outcome_usage(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  usage_row record;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'INVOCATION_OUTCOME_USAGE'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'RESOURCE_AUTHORITY', null, null, ref_json ->> 'adapter_kind', false
  );
  select usage.*
  into usage_row
  from app_data_agent.research_invocation_outcome_usage as usage
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = usage.app_id
   and identity.tenant_id = usage.tenant_id
   and identity.environment = usage.environment
   and identity.record_kind = usage.record_kind
   and identity.record_id = usage.record_id
   and identity.record_version = usage.record_version
  where usage.app_id = (scope_json ->> 'app_id')::uuid
    and usage.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and usage.environment = scope_json ->> 'environment'
    and usage.run_id = (command_json ->> 'run_id')::uuid
    and usage.principal_id = (command_json ->> 'principal_id')::uuid
    and usage.record_id = (ref_json ->> 'record_id')::uuid
    and usage.resource_kind = ref_json ->> 'adapter_kind'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUTHORITY_EVIDENCE_NOT_COMMITTED';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'invocation-outcome-usage@1.0.0',
      'scope', scope_json,
      'run_id', usage_row.run_id,
      'principal_id', usage_row.principal_id,
      'invocation_id', usage_row.invocation_id,
      'reservation_id', usage_row.reservation_id,
      'resource_lease_id', usage_row.resource_lease_id,
      'resource_kind', usage_row.resource_kind,
      'outcome', usage_row.outcome,
      'actual', usage_row.actual_json,
      'completion_binding', usage_row.completion_binding,
      'error_code', usage_row.error_code,
      'outcome_hash', usage_row.outcome_hash,
      'observed_at', usage_row.observed_at
    )
  );
end
$function$;

create function app_data_agent.resolve_current_tool_invocation_permit(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  capability_kind text;
  capability_resource_kind text;
  permit record;
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'TOOL_INVOCATION_PERMIT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  select capability.authority_kind, capability.resource_kind
  into capability_kind, capability_resource_kind
  from app_data_agent.research_authority_capabilities as capability
  where capability.app_id = (scope_json ->> 'app_id')::uuid
    and capability.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and capability.environment = scope_json ->> 'environment'
    and capability.capability_id = (envelope_json ->> 'authority_capability_id')::uuid;
  if capability_kind not in ('RESOURCE_AUTHORITY', 'TOOL_INVOCATION_AUTHORITY')
    or capability_resource_kind is distinct from 'TOOL'
  then
    raise exception using errcode = '42501', message = 'DA_U6_CAPABILITY_REQUIRED';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, capability_kind, null, null, 'TOOL', false
  );
  db_now := pg_catalog.clock_timestamp();
  select source.*
  into permit
  from app_data_agent.research_tool_invocation_permits as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid
    and source.status = 'ACTIVE'
    and source.expires_at > db_now;
  if not found then
    raise exception using errcode = '42501', message = 'TOOL_INVOCATION_PERMIT_NOT_ACTIVE';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'tool-invocation-permit@1.0.0',
      'scope', scope_json,
      'run_id', permit.run_id,
      'principal_id', permit.principal_id,
      'tool_name', permit.tool_name,
      'tool_version', permit.tool_version,
      'arguments_schema_hash', permit.arguments_schema_hash,
      'arguments_hash', permit.arguments_hash,
      'policy_receipt_ref', permit.policy_receipt_ref,
      'tool_policy_version', permit.tool_policy_version,
      'tool_permit_policy_limit_hash', permit.tool_permit_policy_limit_hash,
      'status', permit.status,
      'authority_epoch', permit.authority_epoch,
      'expires_at', permit.expires_at,
      'revocation_seq', permit.revocation_seq
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_model_invocation_result(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  result_row record;
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'MODEL_INVOCATION_RESULT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'MODEL_INVOCATION_AUTHORITY', null, null, 'MODEL', false
  );
  db_now := pg_catalog.clock_timestamp();
  select source.*, blob.ciphertext_hash as blob_hash
  into result_row
  from app_data_agent.research_invocation_results as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  join app_data_agent.research_invocation_result_blobs as blob
    on blob.app_id = source.app_id
   and blob.tenant_id = source.tenant_id
   and blob.environment = source.environment
   and blob.blob_id = source.blob_id
   and blob.result_record_kind = source.record_kind
   and blob.result_record_id = source.record_id
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and source.record_kind = 'MODEL_INVOCATION_RESULT'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid
    and source.state = 'AVAILABLE'
    and source.deletion_due_at > db_now;
  if not found then
    raise exception using errcode = 'P0001', message = 'REPLAY_SNAPSHOT_UNAVAILABLE';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'model-invocation-result@1.0.0',
      'scope', scope_json,
      'run_id', result_row.run_id,
      'principal_id', result_row.principal_id,
      'invocation_id', result_row.invocation_id,
      'reservation_id', result_row.reservation_id,
      'preparation_id', result_row.preparation_id,
      'output_binding', result_row.metadata_json,
      'digest', result_row.digest,
      'byte_length', result_row.byte_length,
      'blob_hash', result_row.blob_hash,
      'deletion_due_at', result_row.deletion_due_at
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_sql_invocation_result(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  result_row record;
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'SQL_INVOCATION_RESULT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'SQL_INVOCATION_AUTHORITY', null, null, 'SQL', false
  );
  db_now := pg_catalog.clock_timestamp();
  select source.*, blob.ciphertext_hash as blob_hash
  into result_row
  from app_data_agent.research_invocation_results as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  join app_data_agent.research_invocation_result_blobs as blob
    on blob.app_id = source.app_id
   and blob.tenant_id = source.tenant_id
   and blob.environment = source.environment
   and blob.blob_id = source.blob_id
   and blob.result_record_kind = source.record_kind
   and blob.result_record_id = source.record_id
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and source.record_kind = 'SQL_INVOCATION_RESULT'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid
    and source.state = 'AVAILABLE'
    and source.deletion_due_at > db_now;
  if not found then
    raise exception using errcode = 'P0001', message = 'REPLAY_SNAPSHOT_UNAVAILABLE';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'sql-invocation-result@1.0.0',
      'scope', scope_json,
      'run_id', result_row.run_id,
      'principal_id', result_row.principal_id,
      'invocation_id', result_row.invocation_id,
      'reservation_id', result_row.reservation_id,
      'preparation_id', result_row.preparation_id,
      'output_binding', result_row.metadata_json,
      'digest', result_row.digest,
      'byte_length', result_row.byte_length,
      'blob_hash', result_row.blob_hash,
      'deletion_due_at', result_row.deletion_due_at
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_secure_sql_execution_receipt(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  receipt record;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'SECURE_SQL_EXECUTION_RECEIPT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'SQL_INVOCATION_AUTHORITY', null, null, 'SQL', false
  );
  select source.*
  into receipt
  from app_data_agent.research_secure_sql_execution_receipts as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUTHORITY_EVIDENCE_NOT_COMMITTED';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'secure-sql-execution-receipt@1.0.0',
      'scope', scope_json,
      'run_id', receipt.run_id,
      'principal_id', receipt.principal_id,
      'invocation_id', receipt.invocation_id,
      'result_record_id', receipt.result_record_id,
      'query_hash', receipt.query_hash,
      'snapshot_hash', receipt.snapshot_hash,
      'row_count', receipt.row_count,
      'column_count', receipt.column_count,
      'result_digest', receipt.result_digest,
      'committed_at', receipt.committed_at
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_tool_invocation_result(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  result_row record;
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'TOOL_INVOCATION_RESULT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'TOOL_INVOCATION_AUTHORITY', null, null, 'TOOL', false
  );
  db_now := pg_catalog.clock_timestamp();
  select source.*, blob.ciphertext_hash as blob_hash
  into result_row
  from app_data_agent.research_invocation_results as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  join app_data_agent.research_invocation_result_blobs as blob
    on blob.app_id = source.app_id
   and blob.tenant_id = source.tenant_id
   and blob.environment = source.environment
   and blob.blob_id = source.blob_id
   and blob.result_record_kind = source.record_kind
   and blob.result_record_id = source.record_id
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and source.record_kind = 'TOOL_INVOCATION_RESULT'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid
    and source.state = 'AVAILABLE'
    and source.deletion_due_at > db_now;
  if not found then
    raise exception using errcode = 'P0001', message = 'REPLAY_SNAPSHOT_UNAVAILABLE';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'tool-invocation-result@1.0.0',
      'scope', scope_json,
      'run_id', result_row.run_id,
      'principal_id', result_row.principal_id,
      'invocation_id', result_row.invocation_id,
      'reservation_id', result_row.reservation_id,
      'preparation_id', result_row.preparation_id,
      'output_binding', result_row.metadata_json,
      'digest', result_row.digest,
      'byte_length', result_row.byte_length,
      'blob_hash', result_row.blob_hash,
      'deletion_due_at', result_row.deletion_due_at
    )
  );
end
$function$;

create function app_data_agent.resolve_invocation_result_ciphertext(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  result_ref jsonb := command_json -> 'result_ref';
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 7
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(result_ref) <> 'object'
    or command_json ->> 'access_reason' not in (
      'INVOCATION_RETURN', 'IDEMPOTENT_REPLAY', 'AUTHORIZED_ANALYSIS'
    )
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESULT_DECRYPTION_AUTHORITY',
    null,
    null,
    null,
    false
  );
  db_now := pg_catalog.clock_timestamp();
  if not exists (
    select 1
    from app_data_agent.research_invocation_results as result
    where result.app_id = (scope_json ->> 'app_id')::uuid
      and result.tenant_id = (scope_json ->> 'tenant_id')::uuid
      and result.environment = scope_json ->> 'environment'
      and result.run_id = (command_json ->> 'run_id')::uuid
      and result.principal_id = (command_json ->> 'principal_id')::uuid
      and result.record_id = (result_ref ->> 'record_id')::uuid
      and result.record_kind = result_ref ->> 'record_kind'
      and result.state = 'AVAILABLE'
      and result.deletion_due_at > db_now
  ) then
    raise exception using errcode = 'P0001', message = 'REPLAY_SNAPSHOT_UNAVAILABLE';
  end if;
  raise exception using
    errcode = '0A000',
    message = 'RESEARCH_RESULT_DECRYPTION_KEY_UNAVAILABLE';
end
$function$;

-- HOLD: deployment mutation wire 尚未形成可由数据库独立重算的完整 strict schema。
-- 七个入口只验证 executor/protocol/request hash 后显式失败，不写表、不设置 RLS binding，
-- 也不返回伪造成功。后续必须先冻结 exact wire，再替换此 fail-closed 边界。
create function app_data_agent.provision_u6_authority_manifest(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-authority-manifest@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-authority-manifest@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using
    errcode = '0A000',
    message = 'DA_U6_AUTHORITY_MANIFEST_CONTRACT_UNAVAILABLE';
end
$function$;

create function app_data_agent.provision_u6_execution_policy_manifest(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-execution-policy-manifest@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-execution-policy-manifest@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using
    errcode = '0A000',
    message = 'DA_U6_EXECUTION_POLICY_MANIFEST_CONTRACT_UNAVAILABLE';
end
$function$;

create function app_data_agent.stage_u6_result_key_version(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-result-key-stage@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-result-key-stage@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using errcode = '0A000', message = 'RESEARCH_RESULT_KEY_OPERATION_UNAVAILABLE';
end
$function$;

create function app_data_agent.activate_u6_result_key_version(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-result-key-activate@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-result-key-activate@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using errcode = '0A000', message = 'RESEARCH_RESULT_KEY_OPERATION_UNAVAILABLE';
end
$function$;

create function app_data_agent.retire_u6_result_key_version(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-result-key-retire@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-result-key-retire@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using errcode = '0A000', message = 'RESEARCH_RESULT_KEY_OPERATION_UNAVAILABLE';
end
$function$;

create function app_data_agent.compromise_u6_result_key_version(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-result-key-compromise@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-result-key-compromise@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using errcode = '0A000', message = 'RESEARCH_RESULT_KEY_OPERATION_UNAVAILABLE';
end
$function$;

create function app_data_agent.purge_u6_result_ciphertext_access_audits(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  requested_protocol text := envelope_json ->> 'protocol_version';
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or requested_protocol not in (
      'u6-audit-purge-retention@1.0.0',
      'u6-audit-purge-subject-erasure@1.0.0'
    )
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        requested_protocol,
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using
    errcode = '0A000',
    message = 'RESEARCH_RESULT_AUDIT_PURGE_UNAVAILABLE';
end
$function$;
