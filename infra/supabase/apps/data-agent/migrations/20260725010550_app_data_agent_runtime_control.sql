begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010550_app_data_agent_runtime_control',
  'sha256:9ac51aabe7b610bae9fe48b848e42fd779872954b67eed78616cfd5bdac37475'
);

create or replace function app_data_agent.request_run_control(
  requested_command jsonb,
  requested_event jsonb,
  requested_event_hash text,
  expected_projection_hash text,
  requested_projection jsonb,
  requested_projection_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  target_run app_data_agent.runs%rowtype;
  current_projection app_data_agent.run_projections%rowtype;
  existing_record app_data_agent.idempotency_records%rowtype;
  existing_command app_data_agent.commands%rowtype;
  existing_event app_data_agent.run_events%rowtype;
  existing_outbox app_data_agent.outbox%rowtype;
  existing_audit app_data_agent.audit_log%rowtype;
  active_attempt app_data_agent.run_attempts%rowtype;
  requested_operation text;
  requested_run_id uuid;
  requested_command_id uuid;
  requested_event_id uuid;
  requested_outbox_id uuid;
  requested_audit_id uuid;
  requested_idempotency_key text;
  requested_occurred_at timestamptz;
  requested_sequence bigint;
  requested_worker_fence bigint;
  requested_projection_status text;
  command_payload jsonb;
  command_payload_hash text;
  control_topic text;
  allocated_queue_sequence bigint;
  replay_projection app_data_agent.run_projections%rowtype;
  idempotency_lock_key text;
  control_at timestamptz;
begin
  if requested_command is null
    or requested_event is null
    or requested_projection is null
    or pg_catalog.jsonb_typeof(requested_command) <> 'object'
    or pg_catalog.jsonb_typeof(requested_event) <> 'object'
    or pg_catalog.jsonb_typeof(requested_projection) <> 'object'
    or requested_command ->> 'schema_version' <> '1.0.0'
    or requested_event ->> 'schema_version' <> '1.0.0'
    or requested_projection ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(requested_command -> 'scope') <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'scope') <> 'object'
    or pg_catalog.jsonb_typeof(requested_projection -> 'scope') <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'payload') <> 'object'
    or requested_event_hash is null
    or requested_event_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_projection_hash is null
    or requested_projection_hash !~ '^sha256:[0-9a-f]{64}$'
    or expected_projection_hash is null
    or expected_projection_hash !~ '^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
    or app_data_agent.contains_potential_plaintext_secret(requested_event)
    or app_data_agent.contains_potential_plaintext_secret(requested_projection)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_CONTROL_INPUT_INVALID';
  end if;
  if requested_event_hash <>
    app_data_agent.runtime_canonical_sha256(requested_event)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_MISMATCH';
  end if;
  if requested_projection_hash <>
    app_data_agent.runtime_canonical_sha256(requested_projection)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_HASH_MISMATCH';
  end if;

  begin
    requested_operation := requested_command ->> 'operation';
    requested_run_id := (requested_command ->> 'run_id')::uuid;
    requested_command_id := (requested_command ->> 'command_id')::uuid;
    requested_event_id := (requested_command ->> 'event_id')::uuid;
    requested_outbox_id := (requested_command ->> 'outbox_id')::uuid;
    requested_audit_id := (requested_command ->> 'audit_id')::uuid;
    requested_idempotency_key :=
      requested_command ->> 'idempotency_key';
    requested_occurred_at :=
      (requested_command ->> 'occurred_at')::timestamptz;
    requested_sequence := (requested_event ->> 'sequence')::bigint;
    requested_worker_fence :=
      (requested_event ->> 'worker_fence')::bigint;
    requested_projection_status := requested_projection ->> 'status';
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_CONTROL_INPUT_INVALID';
  end;

  if requested_operation not in ('CANCEL', 'RESUME')
    or requested_idempotency_key is null
    or pg_catalog.length(requested_idempotency_key) not between 1 and 256
    or requested_event ->> 'event_id' <> requested_event_id::text
    or requested_event ->> 'run_id' <> requested_run_id::text
    or requested_event ->> 'idempotency_key'
      <> requested_idempotency_key
    or requested_event ->> 'occurred_at'
      <> requested_command ->> 'occurred_at'
    or requested_event ->> 'occurred_at'
      <> app_data_agent.runtime_iso_timestamp(requested_occurred_at)
    or requested_event -> 'payload' ->> 'command_id'
      <> requested_command_id::text
    or requested_projection ->> 'run_id' <> requested_run_id::text
    or requested_projection ->> 'last_event_id' <> requested_event_id::text
    or (requested_projection ->> 'version')::bigint <> requested_sequence
    or (requested_projection ->> 'worker_fence')::bigint
      <> requested_worker_fence
    or requested_command -> 'scope' <> requested_event -> 'scope'
    or requested_command -> 'scope' <> requested_projection -> 'scope'
    or (
      requested_operation = 'CANCEL'
      and (
        requested_event ->> 'event_type' <> 'run.cancel_requested'
        or requested_projection_status <> 'CANCELLED'
      )
    )
    or (
      requested_operation = 'RESUME'
      and (
        requested_event ->> 'event_type' <> 'run.resumed'
        or requested_projection_status <> 'QUEUED'
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_CONTROL_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if requested_command -> 'scope' ->> 'app_id'
      <> current_authority.app_id::text
    or requested_command -> 'scope' ->> 'tenant_id'
      <> current_authority.tenant_id::text
    or requested_command -> 'scope' ->> 'environment'
      <> current_authority.environment
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_CONTROL_SCOPE_FORBIDDEN';
  end if;

  command_payload := pg_catalog.jsonb_build_object(
    'kind',
    case requested_operation
      when 'CANCEL' then 'CANCEL_RUN'
      else 'RESUME_RUN'
    end
  );
  command_payload_hash := platform.canonical_sha256(command_payload);
  control_topic := case requested_operation
    when 'CANCEL' then 'run.control.cancelled'
    else 'run.work.resume'
  end;
  idempotency_lock_key :=
    'data-agent:runtime-control:' ||
    current_authority.app_id::text || ':' ||
    current_authority.tenant_id::text || ':' ||
    current_authority.environment || ':' ||
    current_authority.principal_id::text || ':' ||
    requested_idempotency_key;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(idempotency_lock_key, 0)
  );

  select run.*
  into target_run
  from app_data_agent.runs as run
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and (
      current_authority.membership_role = 'owner'
      or run.principal_id = current_authority.principal_id
    )
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_NOT_FOUND';
  end if;

  select record.*
  into existing_record
  from app_data_agent.idempotency_records as record
  where record.app_id = current_authority.app_id
    and record.tenant_id = current_authority.tenant_id
    and record.environment = current_authority.environment
    and record.principal_id = current_authority.principal_id
    and record.idempotency_key = requested_idempotency_key;
  if found then
    select command.*
    into strict existing_command
    from app_data_agent.commands as command
    where command.app_id = existing_record.app_id
      and command.tenant_id = existing_record.tenant_id
      and command.environment = existing_record.environment
      and command.command_id = existing_record.command_id;
    select event.*
    into existing_event
    from app_data_agent.run_events as event
    where event.app_id = existing_record.app_id
      and event.tenant_id = existing_record.tenant_id
      and event.environment = existing_record.environment
      and event.run_id = requested_run_id
      and event.command_id = existing_record.command_id
      and event.dedupe_key = requested_idempotency_key;
    select message.*
    into existing_outbox
    from app_data_agent.outbox as message
    where message.app_id = existing_record.app_id
      and message.tenant_id = existing_record.tenant_id
      and message.environment = existing_record.environment
      and message.run_id = requested_run_id
      and message.command_id = existing_record.command_id;
    select audit.*
    into existing_audit
    from app_data_agent.audit_log as audit
    where audit.app_id = existing_record.app_id
      and audit.tenant_id = existing_record.tenant_id
      and audit.environment = existing_record.environment
      and audit.resource_type = 'run'
      and audit.resource_id = requested_run_id::text
      and audit.details ->> 'commandId' = existing_record.command_id::text;
    if existing_record.command_id <> requested_command_id
      or existing_record.payload_hash <> command_payload_hash
      or existing_command.run_id <> requested_run_id
      or existing_command.payload_json <> command_payload
      or existing_event.event_id is null
      or existing_event.event_id <> requested_event_id
      or existing_event.event_hash <> requested_event_hash
      or existing_event.event_document <> requested_event
      or existing_outbox.outbox_id is null
      or existing_outbox.outbox_id <> requested_outbox_id
      or existing_audit.audit_id is null
      or existing_audit.audit_id <> requested_audit_id
    then
      raise exception using
        errcode = '23505',
        message = 'DA_RUN_CONTROL_IDEMPOTENCY_CONFLICT';
    end if;
    select projection.*
    into replay_projection
    from app_data_agent.run_projections as projection
    where projection.app_id = current_authority.app_id
      and projection.tenant_id = current_authority.tenant_id
      and projection.environment = current_authority.environment
      and projection.run_id = requested_run_id
    order by projection.version desc
    limit 1;
    return pg_catalog.jsonb_build_object(
      'replayed',
      true,
      'command_id',
      existing_command.command_id,
      'event_id',
      existing_event.event_id,
      'event_hash',
      existing_event.event_hash,
      'outbox_id',
      existing_outbox.outbox_id,
      'audit_id',
      existing_audit.audit_id,
      'projection',
      replay_projection.projection_json,
      'projection_hash',
      replay_projection.projection_hash
    );
  end if;

  select projection.*
  into current_projection
  from app_data_agent.run_projections as projection
  where projection.app_id = current_authority.app_id
    and projection.tenant_id = current_authority.tenant_id
    and projection.environment = current_authority.environment
    and projection.run_id = requested_run_id
  order by projection.version desc
  limit 1
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_PROJECTION_NOT_FOUND';
  end if;
  if current_projection.projection_hash <> expected_projection_hash
    or requested_sequence <> current_projection.version + 1
    or current_projection.projection_json ->> 'terminal_event_id' is not null
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_CONTROL_PROJECTION_CONFLICT';
  end if;
  if requested_projection <>
    app_data_agent.reduce_run_projection_document(
      current_projection.projection_json,
      requested_event
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_SEMANTIC_MISMATCH';
  end if;

  if requested_operation = 'CANCEL' then
    if target_run.status not in ('QUEUED', 'RUNNING', 'WAITING')
      or current_projection.status not in ('QUEUED', 'RUNNING', 'WAITING')
      or requested_worker_fence <> target_run.active_fence + 1
      or requested_worker_fence <= current_projection.worker_fence
    then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_CONTROL_STATE_INVALID';
    end if;
  else
    if target_run.status <> 'WAITING'
      or current_projection.status <> 'WAITING'
      or requested_worker_fence <> target_run.active_fence
      or requested_worker_fence <> current_projection.worker_fence
    then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_CONTROL_STATE_INVALID';
    end if;
  end if;

  select attempt.*
  into active_attempt
  from app_data_agent.run_attempts as attempt
  where attempt.app_id = current_authority.app_id
    and attempt.tenant_id = current_authority.tenant_id
    and attempt.environment = current_authority.environment
    and attempt.run_id = requested_run_id
    and attempt.status = 'ACTIVE'
  for update;

  control_at := pg_catalog.clock_timestamp();

  insert into app_data_agent.commands (
    app_id,
    tenant_id,
    environment,
    command_id,
    run_id,
    principal_id,
    idempotency_key,
    payload_json,
    payload_hash,
    status,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_command_id,
    requested_run_id,
    current_authority.principal_id,
    requested_idempotency_key,
    command_payload,
    command_payload_hash,
    case requested_operation
      when 'CANCEL' then 'SUCCEEDED'
      else 'ACCEPTED'
    end,
    control_at
  );

  insert into app_data_agent.idempotency_records (
    app_id,
    tenant_id,
    environment,
    principal_id,
    idempotency_key,
    command_id,
    payload_hash,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    current_authority.principal_id,
    requested_idempotency_key,
    requested_command_id,
    command_payload_hash,
    control_at
  );

  if requested_operation = 'CANCEL' then
    if active_attempt.attempt_id is not null then
      update app_data_agent.run_attempts as cancelled_attempt
      set status = 'CANCELLED',
          finished_at = control_at
      where cancelled_attempt.app_id = current_authority.app_id
        and cancelled_attempt.tenant_id = current_authority.tenant_id
        and cancelled_attempt.environment = current_authority.environment
        and cancelled_attempt.attempt_id = active_attempt.attempt_id;
    end if;

    update app_data_agent.outbox as cancelled_message
    set status = 'DEAD_LETTER',
        lease_owner = null,
        lease_expires_at = null
    where cancelled_message.app_id = current_authority.app_id
      and cancelled_message.tenant_id = current_authority.tenant_id
      and cancelled_message.environment = current_authority.environment
      and cancelled_message.run_id = requested_run_id
      and cancelled_message.status in ('PENDING', 'FAILED', 'LEASED');

    update app_data_agent.runs as cancelled_run
    set status = 'CANCELLED',
        active_fence = requested_worker_fence,
        updated_at = control_at
    where cancelled_run.app_id = current_authority.app_id
      and cancelled_run.tenant_id = current_authority.tenant_id
      and cancelled_run.environment = current_authority.environment
      and cancelled_run.run_id = requested_run_id;
  else
    update app_data_agent.runs as resumed_run
    set status = 'QUEUED',
        updated_at = control_at
    where resumed_run.app_id = current_authority.app_id
      and resumed_run.tenant_id = current_authority.tenant_id
      and resumed_run.environment = current_authority.environment
      and resumed_run.run_id = requested_run_id;
  end if;

  update app_data_agent.runs as run
  set next_queue_sequence = run.next_queue_sequence + 1,
      updated_at = pg_catalog.clock_timestamp()
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
  returning run.next_queue_sequence - 1
  into strict allocated_queue_sequence;

  insert into app_data_agent.run_events (
    app_id,
    tenant_id,
    environment,
    event_id,
    run_id,
    sequence,
    event_type,
    payload_json,
    attempt_id,
    command_id,
    dedupe_key,
    event_hash,
    worker_fence,
    event_document,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_event_id,
    requested_run_id,
    requested_sequence,
    requested_event ->> 'event_type',
    requested_event -> 'payload',
    active_attempt.attempt_id,
    requested_command_id,
    requested_idempotency_key,
    requested_event_hash,
    requested_worker_fence,
    requested_event,
    requested_occurred_at
  );

  insert into app_data_agent.run_projections (
    app_id,
    tenant_id,
    environment,
    run_id,
    version,
    status,
    worker_fence,
    event_id,
    projection_hash,
    projection_json,
    occurred_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_run_id,
    requested_sequence,
    requested_projection_status,
    requested_worker_fence,
    requested_event_id,
    requested_projection_hash,
    requested_projection,
    requested_occurred_at
  );

  insert into app_data_agent.outbox (
    app_id,
    tenant_id,
    environment,
    outbox_id,
    run_id,
    command_id,
    topic,
    payload_json,
    status,
    available_at,
    run_fence,
    published_at,
    created_at,
    queue_sequence
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_outbox_id,
    requested_run_id,
    requested_command_id,
    control_topic,
    pg_catalog.jsonb_build_object(
      'run_id',
      requested_run_id,
      'command_id',
      requested_command_id,
      'operation',
      requested_operation,
      'event_id',
      requested_event_id
    ),
    case requested_operation
      when 'CANCEL' then 'PUBLISHED'
      else 'PENDING'
    end,
    control_at,
    requested_worker_fence,
    case requested_operation
      when 'CANCEL' then control_at
      else null
    end,
    control_at,
    allocated_queue_sequence
  );

  insert into app_data_agent.audit_log (
    app_id,
    tenant_id,
    environment,
    audit_id,
    principal_id,
    action,
    resource_type,
    resource_id,
    details,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_audit_id,
    current_authority.principal_id,
    'RUN_' || requested_operation || '_REQUESTED',
    'run',
    requested_run_id::text,
    pg_catalog.jsonb_build_object(
      'commandId',
      requested_command_id,
      'eventId',
      requested_event_id,
      'workerFence',
      requested_worker_fence
    ),
    control_at
  );

  return pg_catalog.jsonb_build_object(
    'replayed',
    false,
    'command_id',
    requested_command_id,
    'event_id',
    requested_event_id,
    'event_hash',
    requested_event_hash,
    'outbox_id',
    requested_outbox_id,
    'audit_id',
    requested_audit_id,
    'projection',
    requested_projection,
    'projection_hash',
    requested_projection_hash
  );
end
$$;

commit;
