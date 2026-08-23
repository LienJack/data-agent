create function platform.lock_u6_authority_binding(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_deployment_id uuid,
  requested_principal_id uuid,
  expected_role text,
  requested_mode text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  candidate record;
  deployment record;
  lifecycle record;
  membership record;
begin
  if requested_mode not in ('READ', 'WRITE', 'PROVISION')
    or expected_role not in ('OWNER', 'ANALYST', 'VIEWER')
  then
    raise exception using errcode = '22023', message = 'DA_U6_AUTHORITY_BINDING_INVALID';
  end if;

  if requested_mode in ('READ', 'WRITE') then
    select *
    into candidate
    from platform.current_backend_authority(requested_mode = 'WRITE');
    if candidate.app_id <> requested_app_id
      or candidate.tenant_id <> requested_tenant_id
      or candidate.environment <> requested_environment
      or candidate.deployment_id <> requested_deployment_id
      or candidate.principal_id <> requested_principal_id
      or pg_catalog.upper(candidate.membership_role) <> expected_role
    then
      raise exception using errcode = '42501', message = 'DA_U6_AUTHORITY_STALE_OR_FORBIDDEN';
    end if;
  elsif not pg_catalog.pg_has_role(
    session_user,
    'data_agent_u6_provisioner',
    'SET'
  ) then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;

  perform platform.acquire_lifecycle_shared_lock(requested_app_id, requested_environment);

  select source.*
  into deployment
  from platform.deployment_mappings as source
  where source.app_id = requested_app_id
    and source.environment = requested_environment
    and source.deployment_id = requested_deployment_id
  for share of source nowait;

  select source.*
  into lifecycle
  from platform.app_environment_lifecycle as source
  where source.app_id = requested_app_id
    and source.environment = requested_environment
  for share of source nowait;

  select source.*
  into membership
  from app_data_agent.memberships as source
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.principal_id = requested_principal_id
  for share of source nowait;

  if deployment.deployment_id is null
    or not deployment.is_active
    or lifecycle.app_id is null
    or lifecycle.lifecycle_state <> 'ACTIVE'
    or membership.principal_id is null
    or membership.revoked_at is not null
    or pg_catalog.upper(membership.membership_role) <> expected_role
    or (
      requested_mode = 'WRITE'
      and membership.membership_role not in ('owner', 'analyst')
    )
  then
    raise exception using errcode = '42501', message = 'DA_U6_AUTHORITY_STALE_OR_FORBIDDEN';
  end if;

  return pg_catalog.jsonb_build_object(
    'app_id', requested_app_id,
    'tenant_id', requested_tenant_id,
    'environment', requested_environment,
    'deployment_id', requested_deployment_id,
    'principal_id', requested_principal_id,
    'membership_role', pg_catalog.upper(membership.membership_role),
    'membership_version', membership.membership_version,
    'app_epoch', lifecycle.authority_epoch,
    'lifecycle_state', lifecycle.lifecycle_state
  );
end
$function$;

create function platform.lock_u6_cleanup_platform_evidence(
  requested_app_id uuid,
  requested_environment text,
  requested_app_epoch bigint,
  requested_manifest_id uuid,
  requested_manifest_hash text,
  requested_boundary_receipt_id uuid,
  requested_boundary_receipt_hash text,
  requested_export_operation_id uuid,
  requested_export_operation_hash text,
  requested_backup_operation_id uuid,
  requested_backup_operation_hash text
)
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $function$
declare
  lifecycle record;
  manifest record;
  export_event record;
  boundary_receipt record;
  export_operation record;
  backup_operation record;
begin
  select source.*
  into lifecycle
  from platform.app_environment_lifecycle as source
  where source.app_id = requested_app_id
    and source.environment = requested_environment
  for update of source nowait;

  select source.*
  into manifest
  from platform.resource_manifests as source
  where source.manifest_id = requested_manifest_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  select source.*
  into boundary_receipt
  from platform.boundary_audit_receipts as source
  where source.receipt_id = requested_boundary_receipt_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  select source.*
  into export_event
  from platform.app_lifecycle_events as source
  where source.receipt_id = requested_boundary_receipt_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  select source.*
  into export_operation
  from platform.resource_operation_receipts as source
  where source.operation_receipt_id = requested_export_operation_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  select source.*
  into backup_operation
  from platform.resource_operation_receipts as source
  where source.operation_receipt_id = requested_backup_operation_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  if lifecycle.app_id is null
    or lifecycle.lifecycle_state <> 'DELETE_PENDING'
    or lifecycle.authority_epoch <> requested_app_epoch
    or manifest.manifest_id is null
    or manifest.authority_epoch <> requested_app_epoch
    or manifest.payload_hash <> requested_manifest_hash
    or boundary_receipt.receipt_id is null
    or boundary_receipt.receipt_hash <> requested_boundary_receipt_hash
    or boundary_receipt.operation <> 'EXPORT_COMPLETED'
    or boundary_receipt.status <> 'SUCCEEDED'
    or boundary_receipt.previous_state <> 'EXPORT_PENDING'
    or boundary_receipt.resulting_state <> 'FROZEN'
    or export_event.event_id is null
    or export_event.operation <> 'EXPORT_COMPLETED'
    or export_event.previous_state <> 'EXPORT_PENDING'
    or export_event.resulting_state <> 'FROZEN'
    or export_operation.operation_receipt_id is null
    or export_operation.operation <> 'EXPORT'
    or export_operation.payload_hash <> requested_export_operation_hash
    or export_operation.manifest_id <> requested_manifest_id
    or backup_operation.operation_receipt_id is null
    or backup_operation.operation <> 'BACKUP'
    or backup_operation.payload_hash <> requested_backup_operation_hash
    or backup_operation.manifest_id <> requested_manifest_id
    or backup_operation.upstream_receipt_id <> requested_export_operation_id
  then
    raise exception using errcode = '42501', message = 'DA_U6_CLEANUP_EVIDENCE_INVALID';
  end if;

  return pg_catalog.jsonb_build_object(
    'app_id', requested_app_id,
    'environment', requested_environment,
    'app_epoch', requested_app_epoch,
    'manifest_id', requested_manifest_id,
    'manifest_hash', requested_manifest_hash,
    'boundary_receipt_id', requested_boundary_receipt_id,
    'boundary_receipt_hash', requested_boundary_receipt_hash,
    'export_operation_id', requested_export_operation_id,
    'export_operation_hash', requested_export_operation_hash,
    'backup_operation_id', requested_backup_operation_id,
    'backup_operation_hash', requested_backup_operation_hash
  );
end
$function$;

create function app_data_agent.u6_domain_sha256(
  requested_domain text,
  requested_payload jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(requested_domain, 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to(
        app_data_agent.runtime_canonical_json(requested_payload),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;

create function app_data_agent.u6_uuid_v5(
  requested_namespace uuid,
  requested_name bytea
)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  raw bytea;
  encoded text;
begin
  raw := pg_catalog.substring(
    extensions.digest(pg_catalog.uuid_send(requested_namespace) || requested_name, 'sha1'),
    1,
    16
  );
  raw := pg_catalog.set_byte(raw, 6, (pg_catalog.get_byte(raw, 6) & 15) | 80);
  raw := pg_catalog.set_byte(raw, 8, (pg_catalog.get_byte(raw, 8) & 63) | 128);
  encoded := pg_catalog.encode(raw, 'hex');
  return (
    pg_catalog.substring(encoded, 1, 8) || '-' ||
    pg_catalog.substring(encoded, 9, 4) || '-' ||
    pg_catalog.substring(encoded, 13, 4) || '-' ||
    pg_catalog.substring(encoded, 17, 4) || '-' ||
    pg_catalog.substring(encoded, 21, 12)
  )::uuid;
end
$function$;

create function app_data_agent.u6_strict_base64url_decode(
  requested_value text
)
returns bytea
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  decoded bytea;
  padded text;
  round_trip text;
begin
  if requested_value !~ '^[A-Za-z0-9_-]*$'
    or pg_catalog.length(requested_value) % 4 = 1
  then
    raise exception using errcode = '22023', message = 'DA_U6_BASE64URL_INVALID';
  end if;
  padded := pg_catalog.translate(requested_value, '-_', '+/')
    || pg_catalog.repeat('=', (4 - pg_catalog.length(requested_value) % 4) % 4);
  begin
    decoded := pg_catalog.decode(padded, 'base64');
  exception
    when invalid_parameter_value or data_exception then
      raise exception using errcode = '22023', message = 'DA_U6_BASE64URL_INVALID';
  end;
  round_trip := pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(decoded, 'base64'), '+/', '-_'),
    '='
  );
  if round_trip <> requested_value then
    raise exception using errcode = '22023', message = 'DA_U6_BASE64URL_INVALID';
  end if;
  return decoded;
end
$function$;

create function app_data_agent.u6_constant_time_equal(
  left_value bytea,
  right_value bytea
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  maximum_length integer;
  difference integer;
  index_value integer;
  left_byte integer;
  right_byte integer;
begin
  maximum_length := pg_catalog.greatest(
    pg_catalog.length(left_value),
    pg_catalog.length(right_value)
  );
  difference := pg_catalog.length(left_value) # pg_catalog.length(right_value);
  if maximum_length = 0 then
    return difference = 0;
  end if;
  for index_value in 0..maximum_length - 1 loop
    left_byte := case
      when index_value < pg_catalog.length(left_value)
        then pg_catalog.get_byte(left_value, index_value)
      else 0
    end;
    right_byte := case
      when index_value < pg_catalog.length(right_value)
        then pg_catalog.get_byte(right_value, index_value)
      else 0
    end;
    difference := difference | (left_byte # right_byte);
  end loop;
  return difference = 0;
end
$function$;

create function app_data_agent.lock_u6_authority_capability(
  envelope_json jsonb,
  expected_authority_kind text,
  expected_artifact_domain text,
  expected_frontier_kind text,
  expected_resource_kind text,
  require_write boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  requested_capability_id uuid;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_principal_id uuid;
  candidate record;
  locked_binding jsonb;
  locator_assignment_key text;
  head record;
  capability record;
  db_now timestamptz;
begin
  if envelope_json is null
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(
        case
          when pg_catalog.jsonb_typeof(envelope_json) = 'object' then envelope_json
          else '{}'::jsonb
        end
      )
    ) <> 3
    or envelope_json ->> 'protocol_version' <> 'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(envelope_json -> 'command') <> 'object'
    or require_write is null
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;

  begin
    requested_capability_id :=
      (envelope_json ->> 'authority_capability_id')::uuid;
    command_json := envelope_json -> 'command';
    scope_json := command_json -> 'scope';
    if pg_catalog.jsonb_typeof(scope_json) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(
          case
            when pg_catalog.jsonb_typeof(scope_json) = 'object' then scope_json
            else '{}'::jsonb
          end
        )
      ) <> 3
    then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
    end if;
    requested_app_id := (scope_json ->> 'app_id')::uuid;
    requested_tenant_id := (scope_json ->> 'tenant_id')::uuid;
    requested_environment := scope_json ->> 'environment';
    requested_principal_id := (command_json ->> 'principal_id')::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end;

  select *
  into candidate
  from platform.current_backend_authority(require_write);

  locked_binding := platform.lock_u6_authority_binding(
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    candidate.deployment_id,
    requested_principal_id,
    pg_catalog.upper(candidate.membership_role),
    case when require_write then 'WRITE' else 'READ' end
  );

  -- This first read only locates the assignment Head. The capability is not
  -- trusted until Head -> Capability have been locked in the frozen order.
  select source.assignment_key
  into locator_assignment_key
  from app_data_agent.research_authority_capabilities as source
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.capability_id = requested_capability_id;
  if locator_assignment_key is null then
    raise exception using errcode = '42501', message = 'DA_U6_CAPABILITY_REQUIRED';
  end if;

  select source.*
  into head
  from app_data_agent.research_authority_capability_heads as source
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.assignment_key = locator_assignment_key
  for update of source nowait;

  select source.*
  into capability
  from app_data_agent.research_authority_capabilities as source
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.capability_id = requested_capability_id
    and source.assignment_key = locator_assignment_key
  for update of source nowait;

  db_now := pg_catalog.clock_timestamp();
  if head.assignment_key is null
    or capability.capability_id is null
    or head.current_capability_id <> capability.capability_id
    or head.current_authority_epoch <> capability.authority_epoch
    or capability.state <> 'ACTIVE'
    or capability.expires_at <= db_now
    or capability.principal_id <> requested_principal_id
    or capability.deployment_id <> candidate.deployment_id
    or capability.membership_version <> (locked_binding ->> 'membership_version')::bigint
    or capability.app_epoch <> (locked_binding ->> 'app_epoch')::bigint
    or capability.membership_role <> (locked_binding ->> 'membership_role')
    or capability.authority_kind <> expected_authority_kind
    or capability.artifact_authority_domain is distinct from expected_artifact_domain
    or capability.frontier_kind is distinct from expected_frontier_kind
    or capability.resource_kind is distinct from expected_resource_kind
  then
    raise exception using errcode = '42501', message = 'DA_U6_CAPABILITY_REQUIRED';
  end if;

  return pg_catalog.to_jsonb(capability);
end
$function$;

create function app_data_agent.commit_research_revocation_receipt(
  input_json jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  document_json jsonb;
  envelope_json jsonb;
  inserted_count bigint;
begin
  if input_json is null
    or pg_catalog.jsonb_typeof(input_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(
        case
          when pg_catalog.jsonb_typeof(input_json) = 'object' then input_json
          else '{}'::jsonb
        end
      )
    ) <> 2
    or pg_catalog.jsonb_typeof(input_json -> 'document') <> 'object'
    or (input_json ->> 'document_checksum') is null
  then
    raise exception using errcode = '22023', message = 'DA_U6_REVOCATION_RECEIPT_INVALID';
  end if;
  document_json := input_json -> 'document';
  envelope_json := document_json -> 'envelope';
  if input_json ->> 'document_checksum'
      <> app_data_agent.runtime_canonical_sha256(document_json)
    or envelope_json ->> 'artifact_type' <> 'ReadinessRevocationReceipt'
    or envelope_json ->> 'schema_version' <> '1.0.0'
    or document_json #>> '{payload,protocol_version}' <> 'readiness-revocation@1.0.0'
    or (envelope_json ->> 'worker_fence')::bigint <> 0
  then
    raise exception using errcode = '23514', message = 'DA_U6_REVOCATION_RECEIPT_INVALID';
  end if;

  insert into app_data_agent.artifacts (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type,
    revision, content_hash, document_json, worker_fence, is_active,
    parent_revision, parent_content_hash, created_at
  )
  values (
    (envelope_json ->> 'app_id')::uuid,
    (envelope_json ->> 'tenant_id')::uuid,
    envelope_json ->> 'environment',
    (envelope_json ->> 'run_id')::uuid,
    (envelope_json ->> 'artifact_id')::uuid,
    'ReadinessRevocationReceipt',
    (envelope_json ->> 'revision')::integer,
    envelope_json ->> 'content_hash',
    document_json,
    0,
    true,
    nullif(envelope_json #>> '{parent_ref,revision}', '')::integer,
    nullif(envelope_json #>> '{parent_ref,content_hash}', ''),
    pg_catalog.clock_timestamp()
  )
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 and not exists (
    select 1
    from app_data_agent.artifacts as artifact
    where artifact.app_id = (envelope_json ->> 'app_id')::uuid
      and artifact.tenant_id = (envelope_json ->> 'tenant_id')::uuid
      and artifact.environment = envelope_json ->> 'environment'
      and artifact.run_id = (envelope_json ->> 'run_id')::uuid
      and artifact.artifact_id = (envelope_json ->> 'artifact_id')::uuid
      and artifact.revision = (envelope_json ->> 'revision')::integer
      and artifact.content_hash = envelope_json ->> 'content_hash'
      and artifact.document_json = document_json
  ) then
    raise exception using errcode = '23505', message = 'DA_U6_REVOCATION_RECEIPT_CONFLICT';
  end if;
  return pg_catalog.jsonb_build_object(
    'created', inserted_count = 1,
    'reference', pg_catalog.jsonb_build_object(
      'app_id', envelope_json ->> 'app_id',
      'tenant_id', envelope_json ->> 'tenant_id',
      'environment', envelope_json ->> 'environment',
      'run_id', envelope_json ->> 'run_id',
      'artifact_id', envelope_json ->> 'artifact_id',
      'artifact_type', 'ReadinessRevocationReceipt',
      'revision', (envelope_json ->> 'revision')::integer,
      'content_hash', envelope_json ->> 'content_hash'
    )
  );
end
$function$;

create function app_data_agent.commit_research_system_artifact(
  input_json jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  created_count bigint;
begin
  if input_json is null or pg_catalog.jsonb_typeof(input_json) <> 'object' then
    raise exception using errcode = '22023', message = 'DA_U6_SYSTEM_ARTIFACT_INVALID';
  end if;
  insert into app_data_agent.research_system_artifacts (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type,
    revision, content_hash, principal_id, idempotency_key, reservation_id,
    invocation_id, request_profile_hash, request_hash, field_count, byte_count,
    token_count, hmac_hash, policy_ref, payload_json
  )
  values (
    (input_json #>> '{scope,app_id}')::uuid,
    (input_json #>> '{scope,tenant_id}')::uuid,
    input_json #>> '{scope,environment}',
    (input_json ->> 'run_id')::uuid,
    (input_json ->> 'artifact_id')::uuid,
    'AgentDataProjectionReceipt',
    1,
    input_json ->> 'content_hash',
    (input_json ->> 'principal_id')::uuid,
    input_json ->> 'idempotency_key',
    (input_json ->> 'reservation_id')::uuid,
    (input_json ->> 'invocation_id')::uuid,
    input_json ->> 'request_profile_hash',
    input_json ->> 'request_hash',
    (input_json ->> 'field_count')::bigint,
    (input_json ->> 'byte_count')::bigint,
    (input_json ->> 'token_count')::bigint,
    input_json ->> 'hmac_hash',
    input_json -> 'policy_ref',
    input_json -> 'payload'
  )
  on conflict do nothing;
  get diagnostics created_count = row_count;
  if created_count = 0 and not exists (
    select 1
    from app_data_agent.research_system_artifacts as artifact
    where artifact.app_id = (input_json #>> '{scope,app_id}')::uuid
      and artifact.tenant_id = (input_json #>> '{scope,tenant_id}')::uuid
      and artifact.environment = input_json #>> '{scope,environment}'
      and artifact.run_id = (input_json ->> 'run_id')::uuid
      and artifact.artifact_id = (input_json ->> 'artifact_id')::uuid
      and artifact.artifact_type = 'AgentDataProjectionReceipt'
      and artifact.revision = 1
      and artifact.content_hash = input_json ->> 'content_hash'
      and artifact.principal_id = (input_json ->> 'principal_id')::uuid
      and artifact.idempotency_key = input_json ->> 'idempotency_key'
      and artifact.reservation_id = (input_json ->> 'reservation_id')::uuid
      and artifact.invocation_id = (input_json ->> 'invocation_id')::uuid
      and artifact.request_profile_hash = input_json ->> 'request_profile_hash'
      and artifact.request_hash = input_json ->> 'request_hash'
      and artifact.field_count = (input_json ->> 'field_count')::bigint
      and artifact.byte_count = (input_json ->> 'byte_count')::bigint
      and artifact.token_count = (input_json ->> 'token_count')::bigint
      and artifact.hmac_hash = input_json ->> 'hmac_hash'
      and artifact.policy_ref = input_json -> 'policy_ref'
      and artifact.payload_json = input_json -> 'payload'
    for update of artifact
  ) then
    raise exception using
      errcode = '23505',
      message = 'DA_U6_SYSTEM_ARTIFACT_IDEMPOTENCY_CONFLICT';
  end if;
  return pg_catalog.jsonb_build_object(
    'created', created_count = 1,
    'artifact_id', input_json ->> 'artifact_id',
    'revision', 1,
    'content_hash', input_json ->> 'content_hash'
  );
end
$function$;
