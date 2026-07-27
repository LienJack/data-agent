create function app_data_agent.authorize_agent_data_projection(
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
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 18
    or command_json ->> 'schema_version' <> '1.0.0'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'AGENT_DATA_PROJECTION_AUTHORITY',
    null,
    null,
    null,
    true
  );

  -- The frozen wire does not carry tenant HMAC material. PostgreSQL must not
  -- replace that keyed proof with a plain digest or accept caller-provided
  -- counts. The endpoint therefore remains explicitly fail-closed until the
  -- server-owned Projection Authority is wired to this transaction.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.revoke_tool_invocation_permit(
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
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 10
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'transition_id', 'permit_ref',
        'expected_status', 'transition', 'reason_code'
      ]
    )
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'permit_ref') <> 'object'
    or command_json ->> 'expected_status' <> 'ACTIVE'
    or command_json ->> 'transition' <> 'REVOKE'
    or command_json ->> 'reason_code'
      not in ('POLICY_REVOKED', 'RUN_TERMINATED', 'TOOL_REMOVED')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'TOOL_POLICY_AUTHORITY',
    null,
    null,
    null,
    true
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.expire_tool_invocation_permit(
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
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 10
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'transition_id', 'permit_ref',
        'expected_status', 'transition', 'reason_code'
      ]
    )
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'permit_ref') <> 'object'
    or command_json ->> 'expected_status' <> 'ACTIVE'
    or command_json ->> 'transition' <> 'EXPIRE'
    or command_json ->> 'reason_code' <> 'PERMIT_TTL_EXPIRED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'TOOL_POLICY_EXPIRY_AUTHORITY',
    null,
    null,
    null,
    true
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.tombstone_invocation_result(
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
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 9
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'transition_id', 'result_ref',
        'expected_blob_state', 'reason_code'
      ]
    )
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'result_ref') <> 'object'
    or command_json ->> 'expected_blob_state' <> 'AVAILABLE'
    or command_json ->> 'reason_code' <> 'RETENTION_PERIOD_ELAPSED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESULT_RETENTION_AUTHORITY',
    null,
    null,
    null,
    true
  );
  -- The current physical projection cannot clear every frozen sensitive
  -- field and prove the active legal-hold/backup boundary atomically.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.erase_subject_invocation_result(
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
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 11
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'transition_id', 'result_ref',
        'expected_blob_state', 'reason_code', 'erasure_request_id',
        'erasure_request_hash'
      ]
    )
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'result_ref') <> 'object'
    or command_json ->> 'expected_blob_state' <> 'AVAILABLE'
    or command_json ->> 'reason_code' <> 'SUBJECT_ERASURE_CONFIRMED'
    or command_json ->> 'erasure_request_hash' !~ '^sha256:[0-9a-f]{64}$'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESULT_ERASURE_AUTHORITY',
    null,
    null,
    null,
    true
  );
  -- External subject-request verification, backup expiry and complete
  -- sensitive-field erasure are not yet one transactional authority.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.issue_tool_invocation_permit(
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
  policy_ref jsonb;
  capability_json jsonb;
  target_run record;
  target_policy record;
  target_limit record;
  target_identity record;
  target_permit record;
  conflicting_transition record;
  policy_version text;
  effective_ttl_ms bigint;
  db_now timestamptz;
  payload_json jsonb;
  permit_ref jsonb;
  payload_hash text;
begin
  command_json := envelope_json -> 'command';
  scope_json := command_json -> 'scope';
  policy_ref := command_json -> 'policy_receipt_ref';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 13
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(scope_json)
    ) <> 3
    or pg_catalog.jsonb_typeof(policy_ref) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(policy_ref)
    ) <> 8
    or policy_ref ->> 'artifact_type' <> 'PolicyReceipt'
    or command_json ->> 'tool_name' is null
    or pg_catalog.length(command_json ->> 'tool_name') not between 1 and 2000
    or command_json ->> 'tool_version' is null
    or pg_catalog.length(command_json ->> 'tool_version') not between 1 and 128
    or command_json ->> 'arguments_schema_hash' !~ '^sha256:[0-9a-f]{64}$'
    or command_json ->> 'arguments_hash' !~ '^sha256:[0-9a-f]{64}$'
    or command_json ->> 'requested_ttl_ms' !~ '^[1-9][0-9]{0,7}$'
    or (command_json ->> 'requested_ttl_ms')::bigint not between 1 and 86400000
    or command_json ->> 'idempotency_key' is null
    or pg_catalog.length(command_json ->> 'idempotency_key') not between 1 and 256
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  capability_json := app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'TOOL_POLICY_AUTHORITY',
    null,
    null,
    null,
    true
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  if target_run.run_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_policy
  from app_data_agent.artifacts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.artifact_id = (policy_ref ->> 'artifact_id')::uuid
    and source.artifact_type = 'PolicyReceipt'
    and source.revision = (policy_ref ->> 'revision')::integer
    and source.content_hash = policy_ref ->> 'content_hash'
    and source.is_active
  for key share of source nowait;
  if target_policy.artifact_id is null
    or policy_ref ->> 'app_id' is distinct from target_run.app_id::text
    or policy_ref ->> 'tenant_id' is distinct from target_run.tenant_id::text
    or policy_ref ->> 'environment' is distinct from target_run.environment
    or policy_ref ->> 'run_id' is distinct from target_run.run_id::text
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT',
        'retryable', false
      )
    );
  end if;

  policy_version := pg_catalog.coalesce(
    target_policy.document_json ->> 'policy_version',
    target_policy.document_json #>> '{payload,policy_version}',
    target_policy.document_json #>> '{envelope,policy_version}'
  );
  if policy_version is null
    or pg_catalog.length(policy_version) not between 1 and 128
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_COMMITTED',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_limit
  from app_data_agent.research_tool_permit_policy_limits as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.policy_version = policy_version
  for key share of source nowait;
  if target_limit.policy_version is null
    or target_limit.tool_permit_max_ttl_ms not between 1 and 300000
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
        'retryable', false
      )
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      app_data_agent.u6_domain_sha256(
        'u6-tool-permit@1.0.0',
        pg_catalog.jsonb_build_array(
          target_run.app_id,
          target_run.tenant_id,
          target_run.environment,
          command_json ->> 'record_id'
        )
      ),
      0
    )
  );
  select source.*
  into target_identity
  from app_data_agent.research_system_record_identities as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.record_kind = 'TOOL_INVOCATION_PERMIT'
    and source.record_id = (command_json ->> 'record_id')::uuid
    and source.record_version = 1
  for update of source nowait;
  select source.*
  into target_permit
  from app_data_agent.research_tool_invocation_permits as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.record_id = (command_json ->> 'record_id')::uuid
  for update of source nowait;
  select source.*
  into conflicting_transition
  from app_data_agent.research_system_record_transition_operations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.transition_id = (command_json ->> 'transition_id')::uuid
  for update of source nowait;

  if conflicting_transition.transition_id is not null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;

  if target_identity.record_id is not null
    or target_permit.record_id is not null
  then
    if target_identity.record_id is null
      or target_permit.record_id is null
      or target_identity.commit_id <> (command_json ->> 'transition_id')::uuid
      or target_identity.run_id <> target_run.run_id
      or target_identity.principal_id <> target_run.principal_id
      or target_permit.run_id <> target_run.run_id
      or target_permit.principal_id <> target_run.principal_id
      or target_permit.tool_name <> command_json ->> 'tool_name'
      or target_permit.tool_version <> command_json ->> 'tool_version'
      or target_permit.arguments_schema_hash
        <> command_json ->> 'arguments_schema_hash'
      or target_permit.arguments_hash <> command_json ->> 'arguments_hash'
      or target_permit.policy_receipt_ref <> policy_ref
      or target_permit.tool_policy_version <> policy_version
      or target_permit.tool_permit_policy_limit_hash
        <> target_limit.policy_limit_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    if target_permit.status <> 'ACTIVE' then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_SYSTEM_RECORD_NOT_ACTIVE',
          'retryable', false
        )
      );
    end if;
    payload_json := pg_catalog.jsonb_build_object(
      'protocol_version', 'tool-invocation-permit@1.0.0',
      'scope', scope_json,
      'run_id', target_permit.run_id,
      'principal_id', target_permit.principal_id,
      'tool_name', target_permit.tool_name,
      'tool_version', target_permit.tool_version,
      'arguments_schema_hash', target_permit.arguments_schema_hash,
      'arguments_hash', target_permit.arguments_hash,
      'policy_receipt_ref', target_permit.policy_receipt_ref,
      'tool_policy_version', target_permit.tool_policy_version,
      'tool_permit_policy_limit_hash',
        target_permit.tool_permit_policy_limit_hash,
      'registry', 'ALLOWLISTED',
      'effect', 'READ_ONLY',
      'source_role', 'NON_SOURCE',
      'external_side_effect', 'NO_EXTERNAL_SIDE_EFFECT',
      'authority_epoch', target_permit.authority_epoch,
      'expires_at', target_permit.expires_at
    );
    permit_ref := pg_catalog.jsonb_build_object(
      'record_kind', 'TOOL_INVOCATION_PERMIT',
      'record_id', target_permit.record_id,
      'scope', scope_json,
      'run_id', target_permit.run_id,
      'record_version', 1,
      'content_hash', target_identity.content_hash,
      'commit_id', target_identity.commit_id,
      'owner_kind', 'TOOL_POLICY_AUTHORITY',
      'commit_capability', 'TOOL_POLICY_AUTHORITY',
      'resolver_capabilities',
        pg_catalog.jsonb_build_array(
          'RESOURCE_AUTHORITY',
          'TOOL_INVOCATION_AUTHORITY'
        ),
      'producer', 'TOOL_POLICY_SERVICE',
      'store', 'research_tool_invocation_permits',
      'commit', 'issue_tool_invocation_permit@1.0.0',
      'resolver', 'resolve_current_tool_invocation_permit@1.0.0',
      'status', 'ACTIVE',
      'authority_epoch', target_permit.authority_epoch,
      'expires_at', target_permit.expires_at,
      'revocation_seq', target_permit.revocation_seq
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'permit_ref', permit_ref,
        'payload', payload_json,
        'status', 'ACTIVE',
        'revoked_at', null,
        'expired_at', null
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if (capability_json ->> 'expires_at')::timestamptz <= db_now then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_EXPIRED',
        'retryable', false
      )
    );
  end if;
  effective_ttl_ms := pg_catalog.least(
    (command_json ->> 'requested_ttl_ms')::bigint,
    target_limit.tool_permit_max_ttl_ms,
    300000::bigint
  );
  payload_json := pg_catalog.jsonb_build_object(
    'protocol_version', 'tool-invocation-permit@1.0.0',
    'scope', scope_json,
    'run_id', target_run.run_id,
    'principal_id', target_run.principal_id,
    'tool_name', command_json ->> 'tool_name',
    'tool_version', command_json ->> 'tool_version',
    'arguments_schema_hash', command_json ->> 'arguments_schema_hash',
    'arguments_hash', command_json ->> 'arguments_hash',
    'policy_receipt_ref', policy_ref,
    'tool_policy_version', policy_version,
    'tool_permit_policy_limit_hash', target_limit.policy_limit_hash,
    'registry', 'ALLOWLISTED',
    'effect', 'READ_ONLY',
    'source_role', 'NON_SOURCE',
    'external_side_effect', 'NO_EXTERNAL_SIDE_EFFECT',
    'authority_epoch', (capability_json ->> 'authority_epoch')::bigint,
    'expires_at',
      db_now + (effective_ttl_ms * pg_catalog.interval '1 millisecond')
  );
  payload_hash := app_data_agent.runtime_canonical_sha256(payload_json);
  permit_ref := pg_catalog.jsonb_build_object(
    'record_kind', 'TOOL_INVOCATION_PERMIT',
    'record_id', command_json ->> 'record_id',
    'scope', scope_json,
    'run_id', target_run.run_id,
    'record_version', 1,
    'content_hash', payload_hash,
    'commit_id', command_json ->> 'transition_id',
    'owner_kind', 'TOOL_POLICY_AUTHORITY',
    'commit_capability', 'TOOL_POLICY_AUTHORITY',
    'resolver_capabilities',
      pg_catalog.jsonb_build_array(
        'RESOURCE_AUTHORITY',
        'TOOL_INVOCATION_AUTHORITY'
      ),
    'producer', 'TOOL_POLICY_SERVICE',
    'store', 'research_tool_invocation_permits',
    'commit', 'issue_tool_invocation_permit@1.0.0',
    'resolver', 'resolve_current_tool_invocation_permit@1.0.0',
    'status', 'ACTIVE',
    'authority_epoch', (capability_json ->> 'authority_epoch')::bigint,
    'expires_at', payload_json -> 'expires_at',
    'revocation_seq', 0
  );
  insert into app_data_agent.research_system_record_identities (
    app_id, tenant_id, environment, record_kind, record_id, record_version,
    run_id, principal_id, content_hash, commit_id, authority_epoch, committed_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    'TOOL_INVOCATION_PERMIT', (command_json ->> 'record_id')::uuid, 1,
    target_run.run_id, target_run.principal_id, payload_hash,
    (command_json ->> 'transition_id')::uuid,
    (capability_json ->> 'authority_epoch')::bigint, db_now
  );
  insert into app_data_agent.research_tool_invocation_permits (
    app_id, tenant_id, environment, record_id, record_version, record_kind,
    run_id, principal_id, tool_name, tool_version, arguments_schema_hash,
    arguments_hash, policy_receipt_ref, tool_policy_version,
    tool_permit_policy_limit_hash, authority_epoch, status, revocation_seq,
    expires_at, revoked_at, expired_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    (command_json ->> 'record_id')::uuid, 1, 'TOOL_INVOCATION_PERMIT',
    target_run.run_id, target_run.principal_id, command_json ->> 'tool_name',
    command_json ->> 'tool_version',
    command_json ->> 'arguments_schema_hash',
    command_json ->> 'arguments_hash', policy_ref, policy_version,
    target_limit.policy_limit_hash,
    (capability_json ->> 'authority_epoch')::bigint, 'ACTIVE', 0,
    (payload_json ->> 'expires_at')::timestamptz, null, null
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'permit_ref', permit_ref,
      'payload', payload_json,
      'status', 'ACTIVE',
      'revoked_at', null,
      'expired_at', null
    )
  );
end
$function$;

create function app_data_agent.settle_research_resource(
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
  usage_ref jsonb;
  resource_kind text;
  input_hash text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  target_identity record;
  target_usage record;
  existing_transition record;
  resolved_actual_json jsonb;
  over_limit boolean;
  db_now timestamptz;
  result_state text;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 10
    or command_json ->> 'schema_version' <> '1.0.0'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  usage_ref := command_json -> 'invocation_outcome_usage_ref';
  select source.resource_kind
  into resource_kind
  from app_data_agent.research_resource_reservations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid;
  if resource_kind not in ('MODEL', 'SQL', 'TOOL') then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-settle@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.run_id = target_reservation.run_id
    and source.run_fence = target_reservation.worker_fence
    and source.active_attempt_id = target_reservation.attempt_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = target_reservation.invocation_id
  for key share of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into target_identity
  from app_data_agent.research_system_record_identities as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.record_kind = 'INVOCATION_OUTCOME_USAGE'
    and source.record_id = (usage_ref ->> 'record_id')::uuid
    and source.record_version = 1
  for key share of source nowait;
  select source.*
  into target_usage
  from app_data_agent.research_invocation_outcome_usage as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.record_id = target_identity.record_id
  for key share of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'SETTLE'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;

  if target_run.run_id is null
    or target_reservation.state not in ('IN_USE', 'ABANDONED')
    or target_reservation.invocation_id <> (command_json ->> 'invocation_id')::uuid
    or target_reservation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_invocation.invocation_id <> target_reservation.invocation_id
    or target_invocation.outcome_usage_ref is distinct from usage_ref
    or target_identity.record_id is null
    or target_usage.record_id is null
    or target_usage.invocation_id <> target_invocation.invocation_id
    or target_usage.reservation_id <> target_reservation.reservation_id
    or target_usage.resource_lease_id <> target_reservation.resource_lease_id
    or target_usage.resource_kind <> resource_kind
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE',
        'retryable', false
      )
    );
  end if;

  resolved_actual_json := target_usage.actual_json;
  over_limit := case resource_kind
    when 'MODEL' then
      (resolved_actual_json ->> 'invocations')::bigint > 1
      or (resolved_actual_json ->> 'input_tokens')::bigint
        > (target_reservation.reserved_json ->> 'input_tokens')::bigint
      or (resolved_actual_json ->> 'output_tokens')::bigint
        > (target_reservation.reserved_json ->> 'output_tokens')::bigint
      or (resolved_actual_json ->> 'cost_microusd')::bigint
        > (target_reservation.reserved_json ->> 'cost_microusd')::bigint
    when 'SQL' then
      (resolved_actual_json ->> 'executions')::bigint > 1
      or (resolved_actual_json ->> 'elapsed_ms')::bigint
        > (target_reservation.reserved_json ->> 'timeout_ms')::bigint
      or (resolved_actual_json ->> 'rows')::bigint
        > (target_reservation.reserved_json ->> 'max_rows')::bigint
      or (resolved_actual_json ->> 'bytes')::bigint
        > (target_reservation.reserved_json ->> 'max_bytes')::bigint
    else
      (resolved_actual_json ->> 'tool_calls')::bigint > 1
      or (resolved_actual_json ->> 'elapsed_ms')::bigint
        > (target_reservation.reserved_json ->> 'timeout_ms')::bigint
  end;
  if target_usage.outcome = 'COMPLETED'
    and (
      (resource_kind = 'MODEL' and resolved_actual_json ->> 'invocations' <> '1')
      or (resource_kind = 'SQL' and resolved_actual_json ->> 'executions' <> '1')
      or (resource_kind = 'TOOL' and resolved_actual_json ->> 'tool_calls' <> '1')
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE',
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  result_state := case when over_limit then 'SETTLED_OVER_LIMIT' else 'SETTLED' end;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_reservation.reservation_id,
    'state', result_state,
    'reserved', target_reservation.reserved_json,
    'actual', resolved_actual_json,
    'invocation_outcome_usage_ref', usage_ref,
    'settled_at', db_now
  );
  update app_data_agent.research_resource_reservations
  set state = result_state,
      actual_json = resolved_actual_json,
      invocation_outcome_usage_ref = usage_ref,
      ended_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_reservation.app_id, target_reservation.tenant_id,
    target_reservation.environment, (command_json ->> 'transition_id')::uuid,
    target_reservation.reservation_id, target_reservation.principal_id,
    command_json ->> 'idempotency_key', input_hash, 'SETTLE',
    target_reservation.state, result_state, result_json, db_now
  );
  if over_limit then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.start_research_invocation(
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
  resource_kind text;
  input_hash text;
  stage_name text;
  expected_transition_id uuid;
  expected_stage_key text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  existing_request record;
  target_projection record;
  target_sql_artifact record;
  target_execution_permit record;
  target_permit_identity record;
  target_permit record;
  target_invocation record;
  existing_transition record;
  db_now timestamptz;
  result_json jsonb;
  request_metadata jsonb;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'START'
    or command_json ->> 'expected_state' <> 'AUTHORIZED'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> (case resource_kind
      when 'MODEL' then 22
      when 'SQL' then 23
      else 25
    end)
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-invocation-start@1.0.0',
    command_json
  );
  stage_name := app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      scope_json ->> 'app_id',
      scope_json ->> 'tenant_id',
      scope_json ->> 'environment',
      command_json ->> 'run_id',
      command_json ->> 'invocation_id',
      'START'
    )
  );
  expected_transition_id := app_data_agent.u6_uuid_v5(
    '6d8f4e9a-45d7-5c31-8f6a-6f3cf9c42b18'::uuid,
    pg_catalog.convert_to(stage_name, 'UTF8')
  );
  expected_stage_key := 'u6-invocation@1:' ||
    pg_catalog.translate(
      pg_catalog.rtrim(
        pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(stage_name, 'UTF8'), 'sha256'),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    );
  if (command_json ->> 'transition_id')::uuid <> expected_transition_id
    or command_json ->> 'idempotency_key' <> expected_stage_key
    or pg_catalog.jsonb_typeof(command_json -> 'outer_request_binding') <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json -> 'outer_request_binding')
    ) <> 2
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.outbox_id = (
      select attempt.outbox_id
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = target_reservation.app_id
        and attempt.tenant_id = target_reservation.tenant_id
        and attempt.environment = target_reservation.environment
        and attempt.attempt_id = target_reservation.attempt_id
    )
    and source.run_id = target_reservation.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;

  select source.*
  into existing_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.invocation_id = (command_json ->> 'invocation_id')::uuid
      or (
        source.run_id = target_reservation.run_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key =
          command_json #>> '{outer_request_binding,outer_idempotency_key}'
      )
    )
  order by source.invocation_id
  limit 1
  for update of source nowait;

  if resource_kind = 'MODEL' then
    select source.*
    into target_projection
    from app_data_agent.research_system_artifacts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.run_id = target_reservation.run_id
      and source.artifact_id =
        (command_json #>> '{projection_receipt_ref,artifact_id}')::uuid
      and source.artifact_type = 'AgentDataProjectionReceipt'
      and source.revision =
        (command_json #>> '{projection_receipt_ref,revision}')::integer
      and source.content_hash =
        command_json #>> '{projection_receipt_ref,content_hash}'
    for key share of source nowait;
  elsif resource_kind = 'SQL' then
    select source.*
    into target_sql_artifact
    from app_data_agent.artifacts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.run_id = target_reservation.run_id
      and source.artifact_id =
        (command_json #>> '{sql_artifact_ref,artifact_id}')::uuid
      and source.artifact_type = 'SqlArtifact'
      and source.revision =
        (command_json #>> '{sql_artifact_ref,revision}')::integer
      and source.content_hash = command_json #>> '{sql_artifact_ref,content_hash}'
    for key share of source nowait;
    select source.*
    into target_execution_permit
    from app_data_agent.artifacts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.run_id = target_reservation.run_id
      and source.artifact_id =
        (command_json #>> '{execution_permit_ref,artifact_id}')::uuid
      and source.artifact_type = 'ExecutionPermit'
      and source.revision =
        (command_json #>> '{execution_permit_ref,revision}')::integer
      and source.content_hash =
        command_json #>> '{execution_permit_ref,content_hash}'
    for key share of source nowait;
  else
    select source.*
    into target_permit_identity
    from app_data_agent.research_system_record_identities as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_kind = 'TOOL_INVOCATION_PERMIT'
      and source.record_id =
        (command_json #>> '{tool_invocation_permit_ref,record_id}')::uuid
      and source.record_version = 1
    for update of source nowait;
    select source.*
    into target_permit
    from app_data_agent.research_tool_invocation_permits as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_id = target_permit_identity.record_id
    for update of source nowait;
  end if;

  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_invocation_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = expected_transition_id
      or (
        source.invocation_id = target_invocation.invocation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = expected_stage_key
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'START'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if target_run.run_id is null
    or target_reservation.state <> 'IN_USE'
    or target_reservation.resource_kind <> resource_kind
    or target_reservation.invocation_id <> target_invocation.invocation_id
    or target_reservation.request_id <> (command_json ->> 'request_id')::uuid
    or target_reservation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_reservation.reservation_seq
      <> (command_json ->> 'reservation_seq')::bigint
    or target_reservation.canonical_request_digest
      <> command_json ->> 'canonical_request_digest'
    or target_invocation.state <> 'AUTHORIZED'
    or target_attempt.status <> 'ACTIVE'
    or target_attempt.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_outbox.status <> 'LEASED'
    or target_outbox.active_attempt_id <> target_attempt.attempt_id
    or target_outbox.run_fence <> target_attempt.worker_fence
    or db_now >= target_attempt.lease_expires_at
    or db_now >= target_outbox.lease_expires_at
    or db_now >= target_reservation.lease_expires_at
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH',
        'retryable', false
      )
    );
  end if;
  if existing_request.invocation_id is not null
    and existing_request.input_hash
      <> command_json #>> '{outer_request_binding,outer_input_hash}'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  if (resource_kind = 'MODEL' and target_projection.artifact_id is null)
    or (
      resource_kind = 'SQL'
      and (
        target_sql_artifact.artifact_id is null
        or target_execution_permit.artifact_id is null
      )
    )
    or (
      resource_kind = 'TOOL'
      and (
        target_permit.record_id is null
        or target_permit.run_id <> target_run.run_id
        or target_permit.principal_id <> target_run.principal_id
        or target_permit.status <> 'ACTIVE'
        or db_now >= target_permit.expires_at
      )
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', case resource_kind
          when 'MODEL' then 'MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED'
          when 'SQL' then 'SQL_INVOCATION_NOT_AUTHORIZED'
          else 'TOOL_INVOCATION_NOT_AUTHORIZED'
        end,
        'retryable', false
      )
    );
  end if;

  request_metadata := pg_catalog.jsonb_build_object(
    'resource_kind', resource_kind,
    'reservation_id', target_reservation.reservation_id,
    'reservation_seq', target_reservation.reservation_seq,
    'resource_lease_id', target_reservation.resource_lease_id,
    'request_id', target_reservation.request_id,
    'attempt_id', target_reservation.attempt_id,
    'worker_fence', target_reservation.worker_fence,
    'canonical_request_digest', target_reservation.canonical_request_digest,
    'outer_input_hash',
      command_json #>> '{outer_request_binding,outer_input_hash}'
  );
  if existing_request.invocation_id is null then
    insert into app_data_agent.research_invocation_request_operations (
      app_id, tenant_id, environment, invocation_id, run_id, principal_id,
      reservation_id, request_id, idempotency_key, input_hash, resource_kind,
      canonical_request_digest, request_json, outcome, completed_at
    )
    values (
      target_reservation.app_id, target_reservation.tenant_id,
      target_reservation.environment, target_invocation.invocation_id,
      target_reservation.run_id, target_reservation.principal_id,
      target_reservation.reservation_id, target_reservation.request_id,
      command_json #>> '{outer_request_binding,outer_idempotency_key}',
      command_json #>> '{outer_request_binding,outer_input_hash}',
      resource_kind, target_reservation.canonical_request_digest,
      request_metadata, 'STARTED', db_now
    );
  end if;

  update app_data_agent.research_invocation_commits
  set state = 'STARTED',
      started_at = db_now
  where app_id = target_invocation.app_id
    and tenant_id = target_invocation.tenant_id
    and environment = target_invocation.environment
    and invocation_id = target_invocation.invocation_id;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'resource_kind', target_invocation.resource_kind,
    'invocation_version', 1,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'committed_at', db_now,
    'state', 'STARTED',
    'outcome_hash', null,
    'outcome_unknown_hash', null,
    'start_created', true,
    'outer_request_replayed', existing_request.invocation_id is not null
  );
  insert into app_data_agent.research_invocation_transition_operations (
    app_id, tenant_id, environment, transition_id, invocation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, expected_transition_id,
    target_invocation.invocation_id, target_invocation.principal_id,
    expected_stage_key, input_hash, 'START', 'AUTHORIZED', 'STARTED',
    result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.mark_research_invocation_outcome_unknown(
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
  resource_kind text;
  input_hash text;
  stage_name text;
  expected_transition_id uuid;
  expected_stage_key text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  existing_transition record;
  active_preparation record;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 18
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'MARK_OUTCOME_UNKNOWN'
    or command_json ->> 'expected_state' <> 'STARTED'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  stage_name := app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      scope_json ->> 'app_id',
      scope_json ->> 'tenant_id',
      scope_json ->> 'environment',
      command_json ->> 'run_id',
      command_json ->> 'invocation_id',
      'OUTCOME_UNKNOWN'
    )
  );
  expected_transition_id := app_data_agent.u6_uuid_v5(
    '6d8f4e9a-45d7-5c31-8f6a-6f3cf9c42b18'::uuid,
    pg_catalog.convert_to(stage_name, 'UTF8')
  );
  expected_stage_key := 'u6-invocation@1:' ||
    pg_catalog.translate(
      pg_catalog.rtrim(
        pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(stage_name, 'UTF8'), 'sha256'),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    );
  if (command_json ->> 'transition_id')::uuid <> expected_transition_id
    or command_json ->> 'idempotency_key' <> expected_stage_key
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  input_hash := app_data_agent.u6_domain_sha256(
    'research-invocation-outcome-unknown@1.0.0',
    command_json
  );
  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.outbox_id = (
      select attempt.outbox_id
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = target_reservation.app_id
        and attempt.tenant_id = target_reservation.tenant_id
        and attempt.environment = target_reservation.environment
        and attempt.attempt_id = target_reservation.attempt_id
    )
    and source.run_id = target_reservation.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_invocation_transition_operations as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and (
      source.transition_id = expected_transition_id
      or (
        source.invocation_id = target_invocation.invocation_id
        and source.principal_id = target_invocation.principal_id
        and source.idempotency_key = expected_stage_key
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'MARK_OUTCOME_UNKNOWN'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;
  select source.*
  into active_preparation
  from app_data_agent.research_invocation_terminal_preparations as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and source.invocation_id = target_invocation.invocation_id
    and source.state in ('PREPARING', 'PREPARED')
  order by source.preparation_id
  limit 1
  for update of source nowait;
  if active_preparation.preparation_id is not null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESULT_TERMINAL_PREPARATION_BUSY',
        'retryable', true
      )
    );
  end if;
  if target_invocation.state <> 'STARTED'
    or target_invocation.resource_kind <> resource_kind
    or target_invocation.canonical_request_digest
      <> command_json ->> 'canonical_request_digest'
    or target_invocation.reservation_id <> target_reservation.reservation_id
    or target_invocation.reservation_seq
      <> (command_json ->> 'reservation_seq')::bigint
    or target_invocation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_invocation.request_id <> (command_json ->> 'request_id')::uuid
    or target_invocation.attempt_id <> (command_json ->> 'attempt_id')::uuid
    or target_invocation.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or command_json ->> 'outcome_unknown_hash'
      !~ '^sha256:[0-9a-f]{64}$'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  update app_data_agent.research_invocation_commits
  set state = 'OUTCOME_UNKNOWN',
      outcome_unknown_hash = command_json ->> 'outcome_unknown_hash'
  where app_id = target_invocation.app_id
    and tenant_id = target_invocation.tenant_id
    and environment = target_invocation.environment
    and invocation_id = target_invocation.invocation_id;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'resource_kind', target_invocation.resource_kind,
    'invocation_version', 2,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'committed_at', db_now,
    'state', 'OUTCOME_UNKNOWN',
    'outcome_hash', null,
    'outcome_unknown_hash', command_json ->> 'outcome_unknown_hash'
  );
  insert into app_data_agent.research_invocation_transition_operations (
    app_id, tenant_id, environment, transition_id, invocation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, expected_transition_id,
    target_invocation.invocation_id, target_invocation.principal_id,
    expected_stage_key, input_hash, 'MARK_OUTCOME_UNKNOWN',
    'STARTED', 'OUTCOME_UNKNOWN', result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.abort_invocation_terminal_preparation(
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
  resource_kind text;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'ABORT_TERMINAL_PREPARATION'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  -- The current storage projection cannot atomically clear the claim,
  -- commitment and AAD groups required by the frozen ABORTED truth table.
  -- Refuse rather than invent an OUTCOME_UNKNOWN recovery receipt.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.cancel_research_resource(
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
  termination_ref jsonb;
  usage_ref jsonb;
  resource_kind text;
  input_hash text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_invocation record;
  termination_identity record;
  target_termination record;
  usage_identity record;
  target_usage record;
  existing_transition record;
  resolved_actual_json jsonb;
  over_limit boolean;
  db_now timestamptz;
  result_state text;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'CANCEL'
    or command_json ->> 'source_state' not in ('RESERVED', 'IN_USE', 'ABANDONED')
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> (case when command_json ->> 'source_state' = 'RESERVED' then 10 else 14 end)
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  select source.resource_kind
  into resource_kind
  from app_data_agent.research_resource_reservations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid;
  if resource_kind not in ('MODEL', 'SQL', 'TOOL') then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-cancel@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  if target_run.run_id is null
    or target_reservation.reservation_id is null
    or target_reservation.principal_id <> target_run.principal_id
    or target_reservation.run_id <> target_run.run_id
    or command_json ->> 'reason_code'
      not in ('CALLER_CANCELLED', 'RUN_TERMINATED', 'POLICY_REJECTED')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
        'retryable', false
      )
    );
  end if;

  if target_reservation.state <> 'RESERVED' then
    termination_ref := command_json -> 'adapter_termination_receipt_ref';
    usage_ref := command_json -> 'invocation_outcome_usage_ref';
    select source.*
    into target_outbox
    from app_data_agent.outbox as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.run_id = target_reservation.run_id
      and source.active_attempt_id = target_reservation.attempt_id
      and source.run_fence = target_reservation.worker_fence
    for update of source nowait;
    select source.*
    into target_attempt
    from app_data_agent.run_attempts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.attempt_id = target_reservation.attempt_id
      and source.outbox_id = target_outbox.outbox_id
      and source.run_id = target_reservation.run_id
      and source.worker_fence = target_reservation.worker_fence
    for update of source nowait;
    select source.*
    into target_invocation
    from app_data_agent.research_invocation_commits as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.invocation_id = (command_json ->> 'invocation_id')::uuid
    for update of source nowait;
    select source.*
    into termination_identity
    from app_data_agent.research_system_record_identities as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_kind = 'ADAPTER_TERMINATION_RECEIPT'
      and source.record_id = (termination_ref ->> 'record_id')::uuid
      and source.record_version = 1
    for key share of source nowait;
    select source.*
    into target_termination
    from app_data_agent.research_adapter_termination_receipts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_id = termination_identity.record_id
    for key share of source nowait;
    select source.*
    into usage_identity
    from app_data_agent.research_system_record_identities as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_kind = 'INVOCATION_OUTCOME_USAGE'
      and source.record_id = (usage_ref ->> 'record_id')::uuid
      and source.record_version = 1
    for key share of source nowait;
    select source.*
    into target_usage
    from app_data_agent.research_invocation_outcome_usage as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_id = usage_identity.record_id
    for key share of source nowait;
  end if;

  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'CANCEL'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;

  if target_reservation.state <> command_json ->> 'source_state' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if target_reservation.state = 'RESERVED' then
    result_state := 'CANCELLED';
    result_json := pg_catalog.jsonb_build_object(
      'reservation_id', target_reservation.reservation_id,
      'previous_state', 'RESERVED',
      'state', 'CANCELLED',
      'reason_code', command_json ->> 'reason_code',
      'actual', null,
      'ended_at', db_now
    );
  else
    if target_invocation.invocation_id is null
      or target_invocation.invocation_id <> target_reservation.invocation_id
      or target_termination.record_id is null
      or target_termination.invocation_id <> target_invocation.invocation_id
      or target_termination.reservation_id <> target_reservation.reservation_id
      or target_termination.resource_lease_id <> target_reservation.resource_lease_id
      or target_termination.resource_kind <> resource_kind
      or target_usage.record_id is null
      or target_usage.invocation_id <> target_invocation.invocation_id
      or target_usage.reservation_id <> target_reservation.reservation_id
      or target_usage.resource_lease_id <> target_reservation.resource_lease_id
      or target_usage.resource_kind <> resource_kind
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED',
          'retryable', true
        )
      );
    end if;
    resolved_actual_json := target_usage.actual_json;
    over_limit := case resource_kind
      when 'MODEL' then
        (resolved_actual_json ->> 'invocations')::bigint > 1
        or (resolved_actual_json ->> 'input_tokens')::bigint
          > (target_reservation.reserved_json ->> 'input_tokens')::bigint
        or (resolved_actual_json ->> 'output_tokens')::bigint
          > (target_reservation.reserved_json ->> 'output_tokens')::bigint
        or (resolved_actual_json ->> 'cost_microusd')::bigint
          > (target_reservation.reserved_json ->> 'cost_microusd')::bigint
      when 'SQL' then
        (resolved_actual_json ->> 'executions')::bigint > 1
        or (resolved_actual_json ->> 'elapsed_ms')::bigint
          > (target_reservation.reserved_json ->> 'timeout_ms')::bigint
        or (resolved_actual_json ->> 'rows')::bigint
          > (target_reservation.reserved_json ->> 'max_rows')::bigint
        or (resolved_actual_json ->> 'bytes')::bigint
          > (target_reservation.reserved_json ->> 'max_bytes')::bigint
      else
        (resolved_actual_json ->> 'tool_calls')::bigint > 1
        or (resolved_actual_json ->> 'elapsed_ms')::bigint
          > (target_reservation.reserved_json ->> 'timeout_ms')::bigint
    end;
    if over_limit then
      result_state := 'SETTLED_OVER_LIMIT';
      result_json := pg_catalog.jsonb_build_object(
        'reservation_id', target_reservation.reservation_id,
        'state', result_state,
        'reserved', target_reservation.reserved_json,
        'actual', resolved_actual_json,
        'invocation_outcome_usage_ref', usage_ref,
        'settled_at', db_now
      );
    elsif target_usage.outcome = 'COMPLETED' then
      result_state := 'SETTLED';
      result_json := pg_catalog.jsonb_build_object(
        'reservation_id', target_reservation.reservation_id,
        'state', result_state,
        'reserved', target_reservation.reserved_json,
        'actual', resolved_actual_json,
        'invocation_outcome_usage_ref', usage_ref,
        'settled_at', db_now
      );
    elsif target_usage.outcome = 'FAILED' then
      result_state := 'CANCELLED';
      result_json := pg_catalog.jsonb_build_object(
        'reservation_id', target_reservation.reservation_id,
        'previous_state', target_reservation.state,
        'state', 'CANCELLED',
        'reason_code', command_json ->> 'reason_code',
        'actual', resolved_actual_json,
        'adapter_termination_receipt_ref', termination_ref,
        'invocation_outcome_usage_ref', usage_ref,
        'ended_at', db_now
      );
    else
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED',
          'retryable', true
        )
      );
    end if;
  end if;

  update app_data_agent.research_resource_reservations
  set state = result_state,
      actual_json = resolved_actual_json,
      invocation_outcome_usage_ref = usage_ref,
      adapter_termination_receipt_ref = termination_ref,
      end_reason_code = command_json ->> 'reason_code',
      ended_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_reservation.app_id, target_reservation.tenant_id,
    target_reservation.environment, (command_json ->> 'transition_id')::uuid,
    target_reservation.reservation_id, target_reservation.principal_id,
    command_json ->> 'idempotency_key', input_hash, 'CANCEL',
    target_reservation.state, result_state, result_json, db_now
  );
  if result_state = 'SETTLED_OVER_LIMIT' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.expire_research_resource(
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
  resource_kind text;
  input_hash text;
  target_run record;
  target_reservation record;
  existing_transition record;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 10
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'EXPIRE'
    or command_json ->> 'source_state' <> 'RESERVED'
    or command_json ->> 'reason_code' <> 'RESERVATION_TTL_EXPIRED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  select source.resource_kind
  into resource_kind
  from app_data_agent.research_resource_reservations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-expire@1.0.0',
    command_json
  );
  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'EXPIRE'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  if target_reservation.state <> 'RESERVED'
    or db_now < target_reservation.reservation_expires_at
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_reservation.reservation_id,
    'previous_state', 'RESERVED',
    'state', 'EXPIRED',
    'reason_code', 'RESERVATION_TTL_EXPIRED',
    'actual', null,
    'ended_at', db_now
  );
  update app_data_agent.research_resource_reservations
  set state = 'EXPIRED',
      end_reason_code = 'RESERVATION_TTL_EXPIRED',
      ended_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_reservation.app_id, target_reservation.tenant_id,
    target_reservation.environment, (command_json ->> 'transition_id')::uuid,
    target_reservation.reservation_id, target_reservation.principal_id,
    command_json ->> 'idempotency_key', input_hash, 'EXPIRE',
    'RESERVED', 'EXPIRED', result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.mark_research_resource_abandoned(
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
  resource_kind text;
  input_hash text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  existing_transition record;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 14
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'ABANDONED'
    or command_json ->> 'source_state' <> 'IN_USE'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  select source.resource_kind
  into resource_kind
  from app_data_agent.research_resource_reservations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-abandoned@1.0.0',
    command_json
  );
  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.run_id = target_reservation.run_id
    and source.active_attempt_id = target_reservation.attempt_id
    and source.run_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = target_reservation.invocation_id
  for key share of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'ABANDONED'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;
  if target_reservation.state <> 'IN_USE'
    or target_reservation.invocation_id <> (command_json ->> 'invocation_id')::uuid
    or target_reservation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_reservation.attempt_id <> (command_json ->> 'attempt_id')::uuid
    or target_reservation.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_invocation.state <> 'OUTCOME_UNKNOWN'
    or target_invocation.outcome_unknown_hash
      <> command_json ->> 'outcome_unknown_hash'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED',
        'retryable', true
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_reservation.reservation_id,
    'previous_state', 'IN_USE',
    'state', 'ABANDONED',
    'outcome_unknown_hash', target_invocation.outcome_unknown_hash,
    'ended_at', db_now
  );
  update app_data_agent.research_resource_reservations
  set state = 'ABANDONED',
      outcome_unknown_hash = target_invocation.outcome_unknown_hash,
      ended_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_reservation.app_id, target_reservation.tenant_id,
    target_reservation.environment, (command_json ->> 'transition_id')::uuid,
    target_reservation.reservation_id, target_reservation.principal_id,
    command_json ->> 'idempotency_key', input_hash, 'ABANDONED',
    'IN_USE', 'ABANDONED', result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.reserve_research_resource(
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
  requested_json jsonb;
  brief_ref jsonb;
  resource_kind text;
  input_hash text;
  requested_input_tokens bigint;
  requested_output_tokens bigint;
  requested_cost_microusd bigint;
  requested_timeout_ms bigint;
  requested_max_rows bigint;
  requested_max_bytes bigint;
  target_run record;
  target_brief record;
  target_head record;
  existing_reservation record;
  active_tenant_count bigint;
  active_principal_count bigint;
  consumed_input_tokens bigint;
  consumed_output_tokens bigint;
  consumed_cost_microusd bigint;
  consumed_sql_executions bigint;
  brief_input_limit bigint;
  brief_output_limit bigint;
  brief_token_run_limit bigint;
  brief_cost_run_limit bigint;
  brief_sql_limit bigint;
  next_seq bigint;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 8
    or command_json ->> 'schema_version' <> '1.0.0'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  scope_json := command_json -> 'scope';
  requested_json := command_json -> 'requested';
  brief_ref := command_json -> 'research_brief_ref';
  resource_kind := requested_json ->> 'resource_kind';
  if pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(scope_json)
    ) <> 3
    or pg_catalog.jsonb_typeof(requested_json) <> 'object'
    or pg_catalog.jsonb_typeof(brief_ref) <> 'object'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
    or command_json ->> 'idempotency_key' is null
    or pg_catalog.length(command_json ->> 'idempotency_key') not between 1 and 256
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  if (
    resource_kind = 'MODEL'
    and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(requested_json)
      ) <> 5
      or requested_json ->> 'input_tokens' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'output_tokens' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'cost_microusd' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'concurrent_slots' <> '1'
    )
  ) or (
    resource_kind = 'SQL'
    and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(requested_json)
      ) <> 6
      or requested_json ->> 'executions' <> '1'
      or requested_json ->> 'timeout_ms' !~ '^[1-9][0-9]{0,15}$'
      or requested_json ->> 'max_rows' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'max_bytes' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'concurrent_slots' <> '1'
    )
  ) or (
    resource_kind = 'TOOL'
    and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(requested_json)
      ) <> 4
      or requested_json ->> 'tool_calls' <> '1'
      or requested_json ->> 'timeout_ms' !~ '^[1-9][0-9]{0,15}$'
      or requested_json ->> 'concurrent_slots' <> '1'
    )
  ) then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );

  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-reserve@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  if target_run.run_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_brief
  from app_data_agent.artifacts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.artifact_id = (brief_ref ->> 'artifact_id')::uuid
    and source.artifact_type = 'ResearchBrief'
    and source.revision = (brief_ref ->> 'revision')::integer
    and source.content_hash = brief_ref ->> 'content_hash'
    and source.is_active
  for key share of source nowait;
  if target_brief.artifact_id is null
    or brief_ref ->> 'app_id' is distinct from target_run.app_id::text
    or brief_ref ->> 'tenant_id' is distinct from target_run.tenant_id::text
    or brief_ref ->> 'environment' is distinct from target_run.environment
    or brief_ref ->> 'run_id' is distinct from target_run.run_id::text
    or target_brief.document_json #>> '{envelope,status}' <> 'COMMITTED'
    or target_brief.document_json #>> '{payload,artifact_type}' <> 'ResearchBrief'
    or target_brief.document_json #>> '{payload,protocol_version}'
      <> 'research-brief@1.0.0'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT',
        'retryable', false
      )
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      app_data_agent.runtime_canonical_json(
        pg_catalog.jsonb_build_array(
          'u6-resource-tenant@1.0.0',
          target_run.app_id,
          target_run.tenant_id,
          target_run.environment
        )
      ),
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      app_data_agent.runtime_canonical_json(
        pg_catalog.jsonb_build_array(
          'u6-resource-principal@1.0.0',
          target_run.app_id,
          target_run.tenant_id,
          target_run.environment,
          target_run.principal_id
        )
      ),
      0
    )
  );

  select source.*
  into existing_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and (
      source.reservation_id = (command_json ->> 'reservation_id')::uuid
      or (
        source.run_id = target_run.run_id
        and source.principal_id = target_run.principal_id
        and source.reserve_idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.reservation_id
  limit 1
  for update of source nowait;
  if existing_reservation.reservation_id is not null then
    if existing_reservation.reservation_id
        <> (command_json ->> 'reservation_id')::uuid
      or existing_reservation.reserve_input_hash <> input_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'reservation_id', existing_reservation.reservation_id,
        'reservation_seq', existing_reservation.reservation_seq,
        'state', 'RESERVED',
        'requested', existing_reservation.requested_json,
        'reserved', existing_reservation.reserved_json,
        'expires_at', existing_reservation.reservation_expires_at
      )
    );
  end if;

  select pg_catalog.count(*)
  into active_tenant_count
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.state in ('RESERVED', 'IN_USE', 'ABANDONED');
  select pg_catalog.count(*)
  into active_principal_count
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.principal_id = target_run.principal_id
    and source.state in ('RESERVED', 'IN_USE', 'ABANDONED');
  if active_tenant_count >= 8 or active_principal_count >= 2 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;

  brief_input_limit := (target_brief.document_json #>>
    '{payload,budget,max_provider_input_tokens_per_call}')::bigint;
  brief_output_limit := (target_brief.document_json #>>
    '{payload,budget,max_provider_output_tokens_per_call}')::bigint;
  brief_token_run_limit := (target_brief.document_json #>>
    '{payload,budget,max_provider_tokens_per_run}')::bigint;
  brief_cost_run_limit := (target_brief.document_json #>>
    '{payload,budget,max_provider_cost_microusd_per_run}')::bigint;
  brief_sql_limit := (target_brief.document_json #>>
    '{payload,budget,max_sql_executions}')::bigint;

  if resource_kind = 'MODEL' then
    requested_input_tokens := (requested_json ->> 'input_tokens')::bigint;
    requested_output_tokens := (requested_json ->> 'output_tokens')::bigint;
    requested_cost_microusd := (requested_json ->> 'cost_microusd')::bigint;
    select
      pg_catalog.coalesce(pg_catalog.sum(
        (source.reserved_json ->> 'input_tokens')::bigint
      ), 0),
      pg_catalog.coalesce(pg_catalog.sum(
        (source.reserved_json ->> 'output_tokens')::bigint
      ), 0),
      pg_catalog.coalesce(pg_catalog.sum(
        (source.reserved_json ->> 'cost_microusd')::bigint
      ), 0)
    into consumed_input_tokens, consumed_output_tokens, consumed_cost_microusd
    from app_data_agent.research_resource_reservations as source
    where source.app_id = target_run.app_id
      and source.tenant_id = target_run.tenant_id
      and source.environment = target_run.environment
      and source.run_id = target_run.run_id
      and source.resource_kind = 'MODEL'
      and source.state in (
        'RESERVED', 'IN_USE', 'ABANDONED', 'SETTLED', 'SETTLED_OVER_LIMIT'
      );
    if requested_input_tokens > pg_catalog.least(32000, brief_input_limit)
      or requested_output_tokens > pg_catalog.least(8000, brief_output_limit)
      or requested_input_tokens + requested_output_tokens
        + consumed_input_tokens + consumed_output_tokens
        > pg_catalog.least(256000, brief_token_run_limit)
      or requested_cost_microusd + consumed_cost_microusd
        > pg_catalog.least(5000000, brief_cost_run_limit)
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
          'retryable', false
        )
      );
    end if;
  elsif resource_kind = 'SQL' then
    requested_timeout_ms := (requested_json ->> 'timeout_ms')::bigint;
    requested_max_rows := (requested_json ->> 'max_rows')::bigint;
    requested_max_bytes := (requested_json ->> 'max_bytes')::bigint;
    select pg_catalog.count(*)
    into consumed_sql_executions
    from app_data_agent.research_resource_reservations as source
    where source.app_id = target_run.app_id
      and source.tenant_id = target_run.tenant_id
      and source.environment = target_run.environment
      and source.run_id = target_run.run_id
      and source.resource_kind = 'SQL'
      and source.state in (
        'RESERVED', 'IN_USE', 'ABANDONED', 'SETTLED', 'SETTLED_OVER_LIMIT'
      );
    if requested_timeout_ms > 30000
      or requested_max_rows > 10000
      or requested_max_bytes > 8388608
      or consumed_sql_executions + 1 > pg_catalog.least(16, brief_sql_limit)
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
          'retryable', false
        )
      );
    end if;
  elsif (requested_json ->> 'timeout_ms')::bigint > 600000 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;

  insert into app_data_agent.research_resource_run_heads (
    app_id, tenant_id, environment, run_id, next_reservation_seq, updated_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    target_run.run_id, 1, pg_catalog.clock_timestamp()
  )
  on conflict do nothing;

  select source.*
  into target_head
  from app_data_agent.research_resource_run_heads as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
  for update of source nowait;
  if target_head.run_id is null
    or target_head.next_reservation_seq >= 9007199254740991
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;

  next_seq := target_head.next_reservation_seq;
  db_now := pg_catalog.clock_timestamp();
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', command_json ->> 'reservation_id',
    'reservation_seq', next_seq,
    'state', 'RESERVED',
    'requested', requested_json,
    'reserved', requested_json,
    'expires_at', db_now + pg_catalog.make_interval(secs => 60)
  );

  insert into app_data_agent.research_resource_reservations (
    app_id, tenant_id, environment, reservation_id, run_id, principal_id,
    reservation_seq, reserve_idempotency_key, reserve_input_hash,
    research_brief_ref, resource_kind, requested_json, reserved_json, state,
    reservation_expires_at, reserved_at
  )
  values (
    target_run.app_id,
    target_run.tenant_id,
    target_run.environment,
    (command_json ->> 'reservation_id')::uuid,
    target_run.run_id,
    target_run.principal_id,
    next_seq,
    command_json ->> 'idempotency_key',
    input_hash,
    brief_ref,
    resource_kind,
    requested_json,
    requested_json,
    'RESERVED',
    db_now + pg_catalog.make_interval(secs => 60),
    db_now
  );
  update app_data_agent.research_resource_run_heads
  set next_reservation_seq = next_seq + 1,
      updated_at = db_now
  where app_id = target_run.app_id
    and tenant_id = target_run.tenant_id
    and environment = target_run.environment
    and run_id = target_run.run_id;

  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.begin_research_resource(
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
  resource_kind text;
  input_hash text;
  capability_json jsonb;
  target_run record;
  target_reservation record;
  attempt_locator record;
  target_outbox record;
  target_attempt record;
  target_identity record;
  target_permit record;
  existing_transition record;
  generated_resource_lease_id uuid;
  computed_lease_expires_at timestamptz;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> (case when resource_kind = 'TOOL' then 14 else 13 end)
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  capability_json := app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-begin@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  if target_run.run_id is null
    or target_reservation.reservation_id is null
    or target_reservation.run_id <> target_run.run_id
    or target_reservation.principal_id <> target_run.principal_id
    or target_reservation.resource_kind <> resource_kind
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.outbox_id, source.run_id
  into attempt_locator
  from app_data_agent.run_attempts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.attempt_id = (command_json ->> 'attempt_id')::uuid;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.outbox_id = attempt_locator.outbox_id
    and source.run_id = target_run.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.attempt_id = (command_json ->> 'attempt_id')::uuid
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_run.run_id
  for update of source nowait;

  if resource_kind = 'TOOL' then
    select source.*
    into target_identity
    from app_data_agent.research_system_record_identities as source
    where source.app_id = target_run.app_id
      and source.tenant_id = target_run.tenant_id
      and source.environment = target_run.environment
      and source.record_kind = 'TOOL_INVOCATION_PERMIT'
      and source.record_id =
        (command_json #>> '{tool_invocation_permit_ref,record_id}')::uuid
      and source.record_version = 1
    for update of source nowait;
    select source.*
    into target_permit
    from app_data_agent.research_tool_invocation_permits as source
    where source.app_id = target_run.app_id
      and source.tenant_id = target_run.tenant_id
      and source.environment = target_run.environment
      and source.record_id = target_identity.record_id
    for update of source nowait;
  end if;

  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_run.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.transition_id <> (command_json ->> 'transition_id')::uuid
      or existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'BEGIN'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if target_reservation.state <> 'RESERVED'
    or db_now >= target_reservation.reservation_expires_at
    or target_attempt.attempt_id is null
    or target_attempt.status <> 'ACTIVE'
    or target_attempt.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_outbox.status <> 'LEASED'
    or target_outbox.active_attempt_id <> target_attempt.attempt_id
    or target_outbox.run_fence <> target_attempt.worker_fence
    or db_now >= target_attempt.lease_expires_at
    or db_now >= target_outbox.lease_expires_at
    or pg_catalog.least(
      target_attempt.lease_expires_at,
      target_outbox.lease_expires_at
    ) - db_now < pg_catalog.make_interval(secs => 5)
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH',
        'retryable', false
      )
    );
  end if;
  if resource_kind = 'TOOL'
    and (
      target_permit.record_id is null
      or target_permit.run_id <> target_run.run_id
      or target_permit.principal_id <> target_run.principal_id
      or target_permit.status <> 'ACTIVE'
      or db_now >= target_permit.expires_at
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_SYSTEM_RECORD_NOT_ACTIVE',
        'retryable', false
      )
    );
  end if;

  generated_resource_lease_id := extensions.gen_random_uuid();
  computed_lease_expires_at := pg_catalog.least(
    db_now + pg_catalog.make_interval(secs => 900),
    target_attempt.lease_expires_at,
    target_outbox.lease_expires_at
  );
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_reservation.reservation_id,
    'reservation_seq', target_reservation.reservation_seq,
    'state', 'IN_USE',
    'invocation_id', command_json ->> 'invocation_id',
    'resource_lease_id', generated_resource_lease_id,
    'request_id', command_json ->> 'request_id',
    'lease_expires_at', computed_lease_expires_at,
    'resource_kind', resource_kind,
    'canonical_request_digest', command_json ->> 'canonical_request_digest'
  );
  if resource_kind = 'TOOL' then
    result_json := result_json || pg_catalog.jsonb_build_object(
      'tool_invocation_permit_ref', command_json -> 'tool_invocation_permit_ref'
    );
  end if;

  insert into app_data_agent.research_invocation_commits (
    app_id, tenant_id, environment, invocation_id, run_id, principal_id,
    reservation_id, reservation_seq, resource_lease_id, request_id,
    attempt_id, outbox_id, worker_fence, resource_kind,
    canonical_request_digest, authority_epoch, state, created_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    (command_json ->> 'invocation_id')::uuid,
    target_run.run_id, target_run.principal_id, target_reservation.reservation_id,
    target_reservation.reservation_seq, generated_resource_lease_id,
    (command_json ->> 'request_id')::uuid, target_attempt.attempt_id,
    target_outbox.outbox_id, target_attempt.worker_fence, resource_kind,
    command_json ->> 'canonical_request_digest',
    (capability_json ->> 'authority_epoch')::bigint, 'AUTHORIZED', db_now
  );
  update app_data_agent.research_resource_reservations
  set state = 'IN_USE',
      invocation_id = (command_json ->> 'invocation_id')::uuid,
      request_id = (command_json ->> 'request_id')::uuid,
      resource_lease_id = generated_resource_lease_id,
      canonical_request_digest = command_json ->> 'canonical_request_digest',
      attempt_id = target_attempt.attempt_id,
      worker_fence = target_attempt.worker_fence,
      lease_expires_at = computed_lease_expires_at,
      begun_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    (command_json ->> 'transition_id')::uuid, target_reservation.reservation_id,
    target_run.principal_id, command_json ->> 'idempotency_key', input_hash,
    'BEGIN', 'RESERVED', 'IN_USE', result_json, db_now
  );

  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.prepare_invocation_terminal(
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
  resource_kind text;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  -- A claim is useful only if the database can preserve the complete
  -- CLAIMED/COMMITTED/TOMBSTONED/ABORTED nullable truth table and both key
  -- metadata bindings. The current physical projection cannot do that
  -- without retaining fields that the frozen contract requires cleared.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_KEY_ROTATION_CONFLICT',
      'retryable', true
    )
  );
end
$function$;

create function app_data_agent.commit_invocation_terminal(
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
  terminal_actual_json jsonb;
  resource_kind text;
  input_hash text;
  stage_name text;
  stage_code text;
  expected_transition_id uuid;
  expected_stage_key text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  existing_transition record;
  conflicting_preparation record;
  capability_json jsonb;
  db_now timestamptz;
  usage_payload jsonb;
  outcome_hash text;
  usage_content_hash text;
  generated_outcome_usage_ref jsonb;
  result_json jsonb;
  actual_count bigint;
  terminal_error_code text;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'command_kind'
      not in ('FAILED_TERMINAL', 'ENCRYPTED_RESULT_TERMINAL')
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  capability_json := app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  if command_json ->> 'command_kind' = 'ENCRYPTED_RESULT_TERMINAL' then
    -- Never acknowledge encrypted completion without a safely committed
    -- preparation/key/AAD/blob graph. The server may retry after the storage
    -- projection and key lifecycle are installed; no rows are written here.
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESULT_INTEGRITY_FAILURE',
        'retryable', false
      )
    );
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_object_keys(command_json)
  ) <> 14
    or command_json ->> 'outcome' <> 'FAILED'
    or command_json ->> 'expected_state'
      not in ('AUTHORIZED', 'STARTED', 'OUTCOME_UNKNOWN')
    or pg_catalog.jsonb_typeof(command_json -> 'actual') <> 'object'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  scope_json := command_json -> 'scope';
  terminal_actual_json := command_json -> 'actual';
  terminal_error_code := command_json ->> 'error_code';
  if (resource_kind = 'MODEL' and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(terminal_actual_json)
      ) <> 5
      or terminal_actual_json ->> 'resource_kind' <> 'MODEL'
      or terminal_actual_json ->> 'invocations' not in ('0', '1')
      or terminal_actual_json ->> 'input_tokens' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_actual_json ->> 'output_tokens' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_actual_json ->> 'cost_microusd' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_error_code not in (
        'MODEL_PROVIDER_REJECTED', 'MODEL_PROVIDER_ERROR',
        'MODEL_PROVIDER_RATE_LIMITED', 'MODEL_TIMEOUT', 'MODEL_CANCELLED',
        'MODEL_RESULT_INVALID', 'MODEL_RESULT_GOVERNANCE_REJECTED'
      )
    ))
    or (resource_kind = 'SQL' and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(terminal_actual_json)
      ) <> 5
      or terminal_actual_json ->> 'resource_kind' <> 'SQL'
      or terminal_actual_json ->> 'executions' not in ('0', '1')
      or terminal_actual_json ->> 'elapsed_ms' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_actual_json ->> 'rows' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_actual_json ->> 'bytes' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_error_code not in (
        'SQL_EXECUTION_FAILED', 'SQL_TIMEOUT', 'SQL_CANCELLED',
        'SQL_RESULT_INVALID', 'SQL_RESULT_GOVERNANCE_REJECTED'
      )
    ))
    or (resource_kind = 'TOOL' and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(terminal_actual_json)
      ) <> 3
      or terminal_actual_json ->> 'resource_kind' <> 'TOOL'
      or terminal_actual_json ->> 'tool_calls' not in ('0', '1')
      or terminal_actual_json ->> 'elapsed_ms' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_error_code not in (
        'TOOL_EXECUTION_FAILED', 'TOOL_TIMEOUT', 'TOOL_CANCELLED',
        'TOOL_RESULT_INVALID', 'TOOL_RESULT_GOVERNANCE_REJECTED'
      )
    ))
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  actual_count := case resource_kind
    when 'MODEL' then (terminal_actual_json ->> 'invocations')::bigint
    when 'SQL' then (terminal_actual_json ->> 'executions')::bigint
    else (terminal_actual_json ->> 'tool_calls')::bigint
  end;
  if command_json ->> 'expected_state' = 'AUTHORIZED' and actual_count <> 0 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TERMINAL_CONFLICT',
        'retryable', false
      )
    );
  end if;

  stage_code := case
    when command_json ->> 'expected_state' = 'OUTCOME_UNKNOWN'
      then 'TERMINAL_LATE'
    else 'TERMINAL_INITIAL'
  end;
  stage_name := app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      scope_json ->> 'app_id',
      scope_json ->> 'tenant_id',
      scope_json ->> 'environment',
      command_json ->> 'run_id',
      command_json ->> 'invocation_id',
      stage_code
    )
  );
  expected_transition_id := app_data_agent.u6_uuid_v5(
    '6d8f4e9a-45d7-5c31-8f6a-6f3cf9c42b18'::uuid,
    pg_catalog.convert_to(stage_name, 'UTF8')
  );
  expected_stage_key := 'u6-invocation@1:' ||
    pg_catalog.translate(
      pg_catalog.rtrim(
        pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(stage_name, 'UTF8'), 'sha256'),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    );
  if (command_json ->> 'transition_id')::uuid <> expected_transition_id
    or command_json ->> 'idempotency_key' <> expected_stage_key
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  input_hash := app_data_agent.u6_domain_sha256(
    'research-invocation-failed-terminal@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (
      select invocation.reservation_id
      from app_data_agent.research_invocation_commits as invocation
      where invocation.app_id = target_run.app_id
        and invocation.tenant_id = target_run.tenant_id
        and invocation.environment = target_run.environment
        and invocation.invocation_id = (command_json ->> 'invocation_id')::uuid
    )
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.outbox_id = (
      select attempt.outbox_id
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = target_reservation.app_id
        and attempt.tenant_id = target_reservation.tenant_id
        and attempt.environment = target_reservation.environment
        and attempt.attempt_id = target_reservation.attempt_id
    )
    and source.run_id = target_reservation.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for key share of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_invocation_transition_operations as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and (
      source.transition_id = expected_transition_id
      or (
        source.invocation_id = target_invocation.invocation_id
        and source.principal_id = target_invocation.principal_id
        and source.idempotency_key = expected_stage_key
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'COMMIT_TERMINAL'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_INVOCATION_TERMINAL_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;
  select source.*
  into conflicting_preparation
  from app_data_agent.research_invocation_terminal_preparations as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and source.invocation_id = target_invocation.invocation_id
    and source.state <> 'ABORTED'
  order by source.preparation_id
  limit 1
  for update of source nowait;
  if target_run.run_id is null
    or target_invocation.state <> command_json ->> 'expected_state'
    or target_invocation.resource_kind <> resource_kind
    or target_invocation.invocation_id <> (command_json ->> 'invocation_id')::uuid
    or target_invocation.principal_id <> (command_json ->> 'principal_id')::uuid
    or target_invocation.reservation_id <> target_reservation.reservation_id
    or (
      command_json ->> 'expected_state' <> 'AUTHORIZED'
      and target_request.invocation_id is null
    )
    or (
      command_json ->> 'expected_state' = 'OUTCOME_UNKNOWN'
      and exists (
        select 1
        from app_data_agent.research_invocation_terminal_preparations as preparation
        where preparation.app_id = target_invocation.app_id
          and preparation.tenant_id = target_invocation.tenant_id
          and preparation.environment = target_invocation.environment
          and preparation.invocation_id = target_invocation.invocation_id
          and preparation.state = 'ABORTED'
          and preparation.idempotency_key like '%TERMINAL_LATE%'
      )
    )
    or conflicting_preparation.preparation_id is not null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TERMINAL_CONFLICT',
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  usage_payload := pg_catalog.jsonb_build_object(
    'protocol_version', 'invocation-outcome-usage@1.0.0',
    'scope', scope_json,
    'run_id', target_invocation.run_id,
    'principal_id', target_invocation.principal_id,
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'resource_kind', resource_kind,
    'observed_at', db_now,
    'outcome', 'FAILED',
    'actual', terminal_actual_json,
    'completion_binding', null,
    'error_code', terminal_error_code
  );
  outcome_hash := app_data_agent.u6_domain_sha256(
    'invocation-outcome-usage@1.0.0',
    usage_payload
  );
  usage_payload := usage_payload || pg_catalog.jsonb_build_object(
    'outcome_hash', outcome_hash
  );
  usage_content_hash := app_data_agent.runtime_canonical_sha256(usage_payload);
  generated_outcome_usage_ref := pg_catalog.jsonb_build_object(
    'record_kind', 'INVOCATION_OUTCOME_USAGE',
    'record_id', command_json ->> 'outcome_usage_record_id',
    'scope', scope_json,
    'run_id', target_invocation.run_id,
    'record_version', 1,
    'content_hash', usage_content_hash,
    'commit_id', expected_transition_id,
    'adapter_kind', resource_kind,
    'owner_kind', resource_kind || '_ADAPTER_AUTHORITY',
    'commit_capability', resource_kind || '_INVOCATION_AUTHORITY',
    'producer', resource_kind || '_ADAPTER',
    'store', 'research_invocation_outcome_usage',
    'resolver_capability', 'RESOURCE_AUTHORITY',
    'commit', 'commit_invocation_terminal@1.0.0',
    'resolver', 'resolve_committed_invocation_outcome_usage@1.0.0',
    'status', 'COMMITTED',
    'authority_epoch', (capability_json ->> 'authority_epoch')::bigint,
    'expires_at', null,
    'revocation_seq', 0
  );
  insert into app_data_agent.research_system_record_identities (
    app_id, tenant_id, environment, record_kind, record_id, record_version,
    run_id, principal_id, content_hash, commit_id, authority_epoch, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, 'INVOCATION_OUTCOME_USAGE',
    (command_json ->> 'outcome_usage_record_id')::uuid, 1,
    target_invocation.run_id, target_invocation.principal_id,
    usage_content_hash, expected_transition_id,
    (capability_json ->> 'authority_epoch')::bigint, db_now
  );
  insert into app_data_agent.research_invocation_outcome_usage (
    app_id, tenant_id, environment, record_id, record_version, record_kind,
    run_id, principal_id, invocation_id, reservation_id, resource_lease_id,
    resource_kind, outcome, actual_json, completion_binding, error_code,
    outcome_hash, observed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment,
    (command_json ->> 'outcome_usage_record_id')::uuid, 1,
    'INVOCATION_OUTCOME_USAGE', target_invocation.run_id,
    target_invocation.principal_id, target_invocation.invocation_id,
    target_invocation.reservation_id, target_invocation.resource_lease_id,
    resource_kind, 'FAILED', terminal_actual_json, null,
    terminal_error_code, outcome_hash, db_now
  );
  update app_data_agent.research_invocation_commits
  set state = 'FAILED',
      outcome_unknown_hash = null,
      result_ref = null,
      secure_execution_receipt_ref = null,
      outcome_usage_ref = generated_outcome_usage_ref,
      error_code = terminal_error_code,
      terminal_hash = outcome_hash,
      terminal_at = db_now
  where app_id = target_invocation.app_id
    and tenant_id = target_invocation.tenant_id
    and environment = target_invocation.environment
    and invocation_id = target_invocation.invocation_id;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'committed_at', db_now,
    'outcome_hash', outcome_hash,
    'outcome_usage_ref', generated_outcome_usage_ref,
    'resource_kind', resource_kind,
    'adapter_method', case resource_kind
      when 'MODEL' then 'MODEL_PROVIDER'
      when 'SQL' then 'SQL_EXECUTOR'
      else 'TOOL_ADAPTER'
    end,
    'state', 'FAILED',
    'result_ref', null,
    'secure_execution_receipt_ref',
      case when resource_kind = 'SQL' then null else null end,
    'output_binding', null,
    'error_code', error_code,
    'usage', actual_json
  );
  insert into app_data_agent.research_invocation_transition_operations (
    app_id, tenant_id, environment, transition_id, invocation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, expected_transition_id,
    target_invocation.invocation_id, target_invocation.principal_id,
    expected_stage_key, input_hash, 'COMMIT_TERMINAL',
    command_json ->> 'expected_state', 'FAILED', result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.commit_adapter_termination_receipt(
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
  resource_kind text;
  input_hash text;
  capability_json jsonb;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  existing_identity record;
  existing_receipt record;
  db_now timestamptz;
  payload_json jsonb;
  content_hash text;
  result_ref jsonb;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 18
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'termination' <> 'TERMINATED'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  capability_json := app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  scope_json := command_json -> 'scope';
  input_hash := app_data_agent.u6_domain_sha256(
    'adapter-termination-receipt@1.0.0',
    command_json
  );
  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.outbox_id = (
      select attempt.outbox_id
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = target_reservation.app_id
        and attempt.tenant_id = target_reservation.tenant_id
        and attempt.environment = target_reservation.environment
        and attempt.attempt_id = target_reservation.attempt_id
    )
    and source.run_id = target_reservation.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for key share of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_identity
  from app_data_agent.research_system_record_identities as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and source.record_kind = 'ADAPTER_TERMINATION_RECEIPT'
    and source.record_id = (command_json ->> 'record_id')::uuid
    and source.record_version = 1
  for update of source nowait;
  if existing_identity.record_id is not null then
    select source.*
    into existing_receipt
    from app_data_agent.research_adapter_termination_receipts as source
    where source.app_id = existing_identity.app_id
      and source.tenant_id = existing_identity.tenant_id
      and source.environment = existing_identity.environment
      and source.record_id = existing_identity.record_id
    for key share of source nowait;
    if existing_identity.commit_id <> (command_json ->> 'transition_id')::uuid
      or existing_receipt.payload_json ->> 'input_hash' <> input_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_receipt.payload_json -> 'ref'
    );
  end if;
  if target_invocation.invocation_id is null
    or target_invocation.reservation_id <> target_reservation.reservation_id
    or target_invocation.reservation_seq
      <> (command_json ->> 'reservation_seq')::bigint
    or target_invocation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_invocation.request_id <> (command_json ->> 'request_id')::uuid
    or target_invocation.attempt_id <> (command_json ->> 'attempt_id')::uuid
    or target_invocation.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_invocation.resource_kind <> resource_kind
    or target_invocation.canonical_request_digest
      <> command_json ->> 'canonical_request_digest'
    or command_json ->> 'termination_digest' !~ '^sha256:[0-9a-f]{64}$'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_SYSTEM_RECORD_BINDING_MISMATCH',
        'retryable', false
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  payload_json := pg_catalog.jsonb_build_object(
    'protocol_version', 'adapter-termination@1.0.0',
    'scope', scope_json,
    'run_id', target_invocation.run_id,
    'principal_id', target_invocation.principal_id,
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'resource_kind', resource_kind,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'termination', 'TERMINATED',
    'termination_digest', command_json ->> 'termination_digest',
    'terminated_at', db_now,
    'input_hash', input_hash
  );
  content_hash := app_data_agent.runtime_canonical_sha256(
    payload_json - 'input_hash'
  );
  result_ref := pg_catalog.jsonb_build_object(
    'record_kind', 'ADAPTER_TERMINATION_RECEIPT',
    'record_id', command_json ->> 'record_id',
    'scope', scope_json,
    'run_id', target_invocation.run_id,
    'record_version', 1,
    'content_hash', content_hash,
    'commit_id', command_json ->> 'transition_id',
    'adapter_kind', resource_kind,
    'owner_kind', resource_kind || '_ADAPTER_AUTHORITY',
    'commit_capability', resource_kind || '_INVOCATION_AUTHORITY',
    'producer', resource_kind || '_ADAPTER',
    'store', 'research_adapter_termination_receipts',
    'resolver_capability', 'RESOURCE_AUTHORITY',
    'commit', 'commit_adapter_termination_receipt@1.0.0',
    'resolver', 'resolve_committed_adapter_termination_receipt@1.0.0',
    'status', 'COMMITTED',
    'authority_epoch', (capability_json ->> 'authority_epoch')::bigint,
    'expires_at', null,
    'revocation_seq', 0
  );
  payload_json := payload_json || pg_catalog.jsonb_build_object('ref', result_ref);
  insert into app_data_agent.research_system_record_identities (
    app_id, tenant_id, environment, record_kind, record_id, record_version,
    run_id, principal_id, content_hash, commit_id, authority_epoch, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, 'ADAPTER_TERMINATION_RECEIPT',
    (command_json ->> 'record_id')::uuid, 1, target_invocation.run_id,
    target_invocation.principal_id, content_hash,
    (command_json ->> 'transition_id')::uuid,
    (capability_json ->> 'authority_epoch')::bigint, db_now
  );
  insert into app_data_agent.research_adapter_termination_receipts (
    app_id, tenant_id, environment, record_id, record_version, record_kind,
    run_id, principal_id, invocation_id, reservation_id, resource_lease_id,
    resource_kind, canonical_request_digest, termination_digest,
    payload_json, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, (command_json ->> 'record_id')::uuid,
    1, 'ADAPTER_TERMINATION_RECEIPT', target_invocation.run_id,
    target_invocation.principal_id, target_invocation.invocation_id,
    target_invocation.reservation_id, target_invocation.resource_lease_id,
    resource_kind, target_invocation.canonical_request_digest,
    command_json ->> 'termination_digest', payload_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_ref
  );
end
$function$;
