begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010530_app_data_agent_runtime_event_settlement',
  'sha256:7c6201b5f1a6807b478d336393c2e423253bb3d5d26cacb1949c3984c55e1021'
);

create or replace function app_data_agent.append_run_event(
  requested_lease jsonb,
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
  existing_event app_data_agent.run_events%rowtype;
  active_attempt app_data_agent.run_attempts%rowtype;
  requested_event_id uuid;
  requested_run_id uuid;
  requested_outbox_id uuid;
  requested_attempt_id uuid;
  lease_command_id uuid;
  requested_worker_id text;
  expected_lease_token bigint;
  lease_run_id uuid;
  lease_worker_fence bigint;
  requested_sequence bigint;
  requested_worker_fence bigint;
  requested_dedupe_key text;
  requested_event_type text;
  requested_occurred_at timestamptz;
  requested_command_id uuid;
  requested_projection_status text;
  requested_projection_version bigint;
  requested_projection_fence bigint;
  requested_error_code text;
  requested_retry_delay_ms bigint;
  active_delivery_attempt_no integer;
  scheduled_retry_at timestamptz;
  required_status text;
  active_message_lease_expires_at timestamptz;
  now_at timestamptz;
begin
  if requested_lease is null
    or pg_catalog.jsonb_typeof(requested_lease) <> 'object'
    or pg_catalog.jsonb_typeof(requested_lease -> 'scope') <> 'object'
    or requested_event is null
    or requested_projection is null
    or pg_catalog.jsonb_typeof(requested_event) <> 'object'
    or pg_catalog.jsonb_typeof(requested_projection) <> 'object'
    or requested_event_hash is null
    or requested_event_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_projection_hash is null
    or requested_projection_hash !~ '^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(
      requested_lease - 'lease_token'
    )
    or app_data_agent.contains_potential_plaintext_secret(requested_event)
    or app_data_agent.contains_potential_plaintext_secret(requested_projection)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_INPUT_INVALID';
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
  if requested_event ->> 'schema_version' <> '1.0.0'
    or requested_projection ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(requested_event -> 'scope') <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'payload') <> 'object'
    or pg_catalog.jsonb_typeof(requested_projection -> 'scope') <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_INPUT_INVALID';
  end if;

  begin
    requested_outbox_id := (requested_lease ->> 'outbox_id')::uuid;
    requested_attempt_id := (requested_lease ->> 'attempt_id')::uuid;
    lease_command_id := (requested_lease ->> 'command_id')::uuid;
    requested_worker_id := requested_lease ->> 'worker_id';
    expected_lease_token := (requested_lease ->> 'lease_token')::bigint;
    lease_run_id := (requested_lease ->> 'run_id')::uuid;
    lease_worker_fence := (requested_lease ->> 'worker_fence')::bigint;
    requested_event_id := (requested_event ->> 'event_id')::uuid;
    requested_run_id := (requested_event ->> 'run_id')::uuid;
    requested_sequence := (requested_event ->> 'sequence')::bigint;
    requested_worker_fence := (requested_event ->> 'worker_fence')::bigint;
    requested_dedupe_key := requested_event ->> 'idempotency_key';
    requested_event_type := requested_event ->> 'event_type';
    requested_occurred_at := (requested_event ->> 'occurred_at')::timestamptz;
    requested_projection_version :=
      (requested_projection ->> 'version')::bigint;
    requested_projection_fence :=
      (requested_projection ->> 'worker_fence')::bigint;
    requested_projection_status := requested_projection ->> 'status';
    if requested_event -> 'payload' ? 'command_id' then
      requested_command_id :=
        (requested_event -> 'payload' ->> 'command_id')::uuid;
    end if;
    if requested_event ->> 'event_type' in (
      'run.retry_scheduled',
      'run.failed'
    ) then
      requested_error_code :=
        requested_event -> 'payload' ->> 'error_code';
    end if;
    if requested_event ->> 'event_type' = 'run.retry_scheduled' then
      requested_retry_delay_ms :=
        (requested_event -> 'payload' ->> 'retry_delay_ms')::bigint;
    end if;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_EVENT_INPUT_INVALID';
  end;

  if requested_sequence < 1
    or requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or expected_lease_token < 1
    or lease_run_id <> requested_run_id
    or lease_worker_fence <> requested_worker_fence
    or requested_lease -> 'scope' is distinct from requested_event -> 'scope'
    or requested_worker_fence < 0
    or requested_dedupe_key is null
    or pg_catalog.length(requested_dedupe_key) not between 1 and 256
    or requested_event ->> 'occurred_at' <>
      app_data_agent.runtime_iso_timestamp(requested_occurred_at)
    or requested_event_type not in (
      'run.leased',
      'run.checkpointed',
      'run.side_effect_committed',
      'run.suspended',
      'run.retry_scheduled',
      'run.completed',
      'run.failed'
    )
    or requested_projection_status not in (
      'QUEUED',
      'RUNNING',
      'WAITING',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    )
    or requested_projection_version <> requested_sequence
    or requested_projection_fence <> requested_worker_fence
    or requested_projection ->> 'run_id' <> requested_run_id::text
    or requested_projection ->> 'last_event_id' <> requested_event_id::text
    or requested_event -> 'scope' ->> 'app_id'
      is distinct from requested_projection -> 'scope' ->> 'app_id'
    or requested_event -> 'scope' ->> 'tenant_id'
      is distinct from requested_projection -> 'scope' ->> 'tenant_id'
    or requested_event -> 'scope' ->> 'environment'
      is distinct from requested_projection -> 'scope' ->> 'environment'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_PROJECTION_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if requested_event -> 'scope' ->> 'app_id'
      <> current_authority.app_id::text
    or requested_event -> 'scope' ->> 'tenant_id'
      <> current_authority.tenant_id::text
    or requested_event -> 'scope' ->> 'environment'
      <> current_authority.environment
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_EVENT_SCOPE_FORBIDDEN';
  end if;

  select run.*
  into target_run
  from app_data_agent.runs as run
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and run.principal_id = current_authority.principal_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_NOT_FOUND';
  end if;

  select event.*
  into existing_event
  from app_data_agent.run_events as event
  where event.app_id = current_authority.app_id
    and event.tenant_id = current_authority.tenant_id
    and event.environment = current_authority.environment
    and event.run_id = requested_run_id
    and event.dedupe_key = requested_dedupe_key;
  if found then
    if not exists (
      select 1
      from app_data_agent.run_attempts as replay_attempt
      where replay_attempt.app_id = current_authority.app_id
        and replay_attempt.tenant_id = current_authority.tenant_id
        and replay_attempt.environment = current_authority.environment
        and replay_attempt.run_id = requested_run_id
        and replay_attempt.outbox_id = requested_outbox_id
        and replay_attempt.attempt_id = requested_attempt_id
        and replay_attempt.command_id = lease_command_id
        and replay_attempt.worker_id = requested_worker_id
        and replay_attempt.lease_token = expected_lease_token
        and replay_attempt.worker_fence = requested_worker_fence
    ) then
      raise exception using
        errcode = '40001',
        message = 'DA_RUN_EVENT_LEASE_STALE';
    end if;
    if existing_event.attempt_id is distinct from requested_attempt_id
      or existing_event.event_id <> requested_event_id
      or existing_event.event_hash <> requested_event_hash
      or existing_event.event_document <> requested_event
    then
      raise exception using
        errcode = '23505',
        message = 'DA_RUN_EVENT_IDEMPOTENCY_CONFLICT';
    end if;
    select projection.*
    into current_projection
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
      'event',
      existing_event.event_document,
      'event_hash',
      existing_event.event_hash,
      'projection',
      current_projection.projection_json,
      'projection_hash',
      current_projection.projection_hash
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
  if expected_projection_hash is null
    or current_projection.projection_hash <> expected_projection_hash
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_PROJECTION_CONFLICT';
  end if;
  if requested_sequence <> current_projection.version + 1 then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_SEQUENCE_INVALID';
  end if;
  if target_run.active_fence <> requested_worker_fence then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_FENCE_STALE';
  end if;
  if current_projection.projection_json ->> 'terminal_event_id' is not null then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_AFTER_TERMINAL';
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

  select attempt.*
  into active_attempt
  from app_data_agent.run_attempts as attempt
  join app_data_agent.outbox as message
    on message.app_id = attempt.app_id
   and message.tenant_id = attempt.tenant_id
   and message.environment = attempt.environment
   and message.run_id = attempt.run_id
   and message.outbox_id = attempt.outbox_id
   and message.command_id = attempt.command_id
   and message.active_attempt_id = attempt.attempt_id
  where attempt.app_id = current_authority.app_id
    and attempt.tenant_id = current_authority.tenant_id
    and attempt.environment = current_authority.environment
    and attempt.run_id = requested_run_id
    and attempt.outbox_id = requested_outbox_id
    and attempt.attempt_id = requested_attempt_id
    and attempt.command_id = lease_command_id
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = expected_lease_token
    and attempt.worker_fence = requested_worker_fence
    and attempt.status = 'ACTIVE'
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = requested_worker_fence
  for update of attempt, message;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_LEASE_STALE';
  end if;
  select message.lease_expires_at
  into active_message_lease_expires_at
  from app_data_agent.outbox as message
  where message.app_id = active_attempt.app_id
    and message.tenant_id = active_attempt.tenant_id
    and message.environment = active_attempt.environment
    and message.outbox_id = active_attempt.outbox_id;
  now_at := pg_catalog.clock_timestamp();
  if active_attempt.lease_expires_at < now_at
    or active_message_lease_expires_at < now_at
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_LEASE_STALE';
  end if;
  select message.attempt_count
  into active_delivery_attempt_no
  from app_data_agent.outbox as message
  where message.app_id = active_attempt.app_id
    and message.tenant_id = active_attempt.tenant_id
    and message.environment = active_attempt.environment
    and message.outbox_id = active_attempt.outbox_id;

  case requested_event_type
    when 'run.leased' then
      if current_projection.status not in ('QUEUED', 'RUNNING')
        or requested_worker_fence <= current_projection.worker_fence
        or (requested_event -> 'payload' ->> 'worker_id')
          is distinct from active_attempt.worker_id
        or (requested_event -> 'payload' ->> 'lease_id')
          is distinct from active_attempt.attempt_id::text
        or (requested_event -> 'payload' ->> 'attempt')::integer
          is distinct from active_attempt.attempt_no
        or requested_command_id is distinct from active_attempt.command_id
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.checkpointed' then
      begin
        perform 1
        from app_data_agent.run_checkpoints as checkpoint
        where checkpoint.app_id = current_authority.app_id
          and checkpoint.tenant_id = current_authority.tenant_id
          and checkpoint.environment = current_authority.environment
          and checkpoint.run_id = requested_run_id
          and checkpoint.attempt_id = active_attempt.attempt_id
          and checkpoint.snapshot_id =
            (requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_id')::uuid
          and checkpoint.snapshot_version =
            (requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_version')::integer
          and checkpoint.snapshot_hash =
            requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_hash'
          and checkpoint.worker_fence = requested_worker_fence
          and checkpoint.event_sequence = current_projection.version
          and requested_event -> 'payload' -> 'active_artifact_ref'
            is not distinct from
              checkpoint.binding_json -> 'active_artifact_ref'
          and (
            checkpoint.binding_json -> 'active_artifact_ref' = 'null'::jsonb
            or exists (
              select 1
              from app_data_agent.artifacts as artifact
              where artifact.app_id = checkpoint.app_id
                and artifact.tenant_id = checkpoint.tenant_id
                and artifact.environment = checkpoint.environment
                and artifact.run_id = checkpoint.run_id
                and artifact.artifact_id =
                  (checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'artifact_id')::uuid
                and artifact.artifact_type =
                  checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'artifact_type'
                and artifact.revision =
                  (checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'revision')::integer
                and artifact.content_hash =
                  checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'content_hash'
                and artifact.is_active
            )
          );
      exception
        when others then
          raise exception using
            errcode = '22023',
            message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end;
      if not found then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.side_effect_committed' then
      begin
        perform 1
        from app_data_agent.run_effect_receipts as receipt
        where receipt.app_id = current_authority.app_id
          and receipt.tenant_id = current_authority.tenant_id
          and receipt.environment = current_authority.environment
          and receipt.run_id = requested_run_id
          and receipt.receipt_id =
            (requested_event -> 'payload' ->> 'receipt_id')::uuid
          and receipt.effect_kind =
            requested_event -> 'payload' ->> 'effect_kind'
          and receipt.input_hash =
            requested_event -> 'payload' ->> 'input_hash'
          and receipt.output_hash =
            requested_event -> 'payload' ->> 'output_hash';
      exception
        when others then
          raise exception using
            errcode = '22023',
            message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end;
      if not found then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.suspended' then
      required_status := 'WAITING';
    when 'run.retry_scheduled' then
      if requested_command_id is distinct from active_attempt.command_id
        or active_delivery_attempt_no >= 5
        or requested_error_code is null
        or requested_error_code !~
          '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
        or pg_catalog.jsonb_typeof(
          requested_event -> 'payload' -> 'retry_delay_ms'
        ) <> 'number'
        or requested_event -> 'payload' ->> 'retry_delay_ms'
          !~ '^(0|[1-9][0-9]{0,7})$'
        or requested_retry_delay_ms not between 1000 and 86400000
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      scheduled_retry_at := now_at + pg_catalog.make_interval(
        secs => requested_retry_delay_ms::double precision / 1000.0
      );
      required_status := 'QUEUED';
    when 'run.completed' then
      required_status := 'COMPLETED';
    when 'run.failed' then
      if requested_error_code is null
        or requested_error_code !~
          '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
        or pg_catalog.jsonb_typeof(
          requested_event -> 'payload' -> 'retryable'
        ) <> 'boolean'
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'FAILED';
  end case;

  if requested_event_type <> 'run.leased'
    and (
      current_projection.status <> 'RUNNING'
      or requested_worker_fence <> current_projection.worker_fence
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_TRANSITION_INVALID';
  end if;
  if requested_projection_status <> required_status then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_PROJECTION_INVALID';
  end if;

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
    requested_event_type,
    requested_event -> 'payload',
    active_attempt.attempt_id,
    requested_command_id,
    requested_dedupe_key,
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

  if requested_event_type = 'run.suspended' then
    update app_data_agent.run_attempts as suspended_attempt
    set status = 'SUSPENDED',
        finished_at = now_at
    where suspended_attempt.app_id = current_authority.app_id
      and suspended_attempt.tenant_id = current_authority.tenant_id
      and suspended_attempt.environment = current_authority.environment
      and suspended_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as suspended_message
    set status = 'PUBLISHED',
        published_at = now_at,
        lease_owner = null,
        lease_expires_at = null
    where suspended_message.app_id = current_authority.app_id
      and suspended_message.tenant_id = current_authority.tenant_id
      and suspended_message.environment = current_authority.environment
      and suspended_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.commands as suspended_command
    set status = 'SUCCEEDED'
    where suspended_command.app_id = current_authority.app_id
      and suspended_command.tenant_id = current_authority.tenant_id
      and suspended_command.environment = current_authority.environment
      and suspended_command.command_id = active_attempt.command_id
      and suspended_command.status = 'PROCESSING';

    update app_data_agent.runs as suspended_run
    set status = 'WAITING',
        updated_at = now_at
    where suspended_run.app_id = current_authority.app_id
      and suspended_run.tenant_id = current_authority.tenant_id
      and suspended_run.environment = current_authority.environment
      and suspended_run.run_id = requested_run_id;
  elsif requested_event_type = 'run.retry_scheduled' then
    update app_data_agent.run_attempts as retry_attempt
    set status = 'RETRY_SCHEDULED',
        error_code = requested_error_code,
        retry_at = scheduled_retry_at,
        finished_at = now_at
    where retry_attempt.app_id = current_authority.app_id
      and retry_attempt.tenant_id = current_authority.tenant_id
      and retry_attempt.environment = current_authority.environment
      and retry_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as retry_message
    set status = 'PENDING',
        available_at = scheduled_retry_at,
        lease_owner = null,
        lease_expires_at = null,
        published_at = null
    where retry_message.app_id = current_authority.app_id
      and retry_message.tenant_id = current_authority.tenant_id
      and retry_message.environment = current_authority.environment
      and retry_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.runs as retry_run
    set status = 'QUEUED',
        updated_at = now_at
    where retry_run.app_id = current_authority.app_id
      and retry_run.tenant_id = current_authority.tenant_id
      and retry_run.environment = current_authority.environment
      and retry_run.run_id = requested_run_id;
  elsif requested_event_type in ('run.completed', 'run.failed') then
    update app_data_agent.run_attempts as terminal_attempt
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end,
        error_code = case requested_event_type
          when 'run.failed' then requested_error_code
          else null
        end,
        finished_at = now_at
    where terminal_attempt.app_id = current_authority.app_id
      and terminal_attempt.tenant_id = current_authority.tenant_id
      and terminal_attempt.environment = current_authority.environment
      and terminal_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as terminal_message
    set status = case requested_event_type
          when 'run.completed' then 'PUBLISHED'
          else 'DEAD_LETTER'
        end,
        published_at = case requested_event_type
          when 'run.completed' then now_at
          else null
        end,
        lease_owner = null,
        lease_expires_at = null
    where terminal_message.app_id = current_authority.app_id
      and terminal_message.tenant_id = current_authority.tenant_id
      and terminal_message.environment = current_authority.environment
      and terminal_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.commands as terminal_command
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end
    where terminal_command.app_id = current_authority.app_id
      and terminal_command.tenant_id = current_authority.tenant_id
      and terminal_command.environment = current_authority.environment
      and terminal_command.command_id = active_attempt.command_id
      and terminal_command.status = 'PROCESSING';

    update app_data_agent.runs as terminal_run
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end,
        updated_at = now_at
    where terminal_run.app_id = current_authority.app_id
      and terminal_run.tenant_id = current_authority.tenant_id
      and terminal_run.environment = current_authority.environment
      and terminal_run.run_id = requested_run_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'replayed',
    false,
    'event',
    requested_event,
    'event_hash',
    requested_event_hash,
    'projection',
    requested_projection,
    'projection_hash',
    requested_projection_hash
  );
end
$$;

create or replace function app_data_agent.complete_run_work(
  requested_outbox_id uuid,
  requested_attempt_id uuid,
  requested_worker_id text,
  expected_lease_token bigint,
  expected_worker_fence bigint,
  final_event_sequence bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
begin
  if requested_outbox_id is null
    or requested_attempt_id is null
    or requested_worker_id is null
    or expected_lease_token is null
    or expected_worker_fence is null
    or final_event_sequence is null
    or final_event_sequence < 1
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_COMPLETE_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  if exists (
    select 1
    from app_data_agent.outbox as message
    join app_data_agent.run_attempts as attempt
      on attempt.app_id = message.app_id
     and attempt.tenant_id = message.tenant_id
     and attempt.environment = message.environment
     and attempt.attempt_id = requested_attempt_id
     and attempt.outbox_id = message.outbox_id
    join app_data_agent.run_projections as projection
      on projection.app_id = message.app_id
     and projection.tenant_id = message.tenant_id
     and projection.environment = message.environment
     and projection.run_id = message.run_id
     and projection.version = final_event_sequence
    join app_data_agent.runs as run
      on run.app_id = message.app_id
     and run.tenant_id = message.tenant_id
     and run.environment = message.environment
     and run.run_id = message.run_id
    where message.app_id = current_authority.app_id
      and message.tenant_id = current_authority.tenant_id
      and message.environment = current_authority.environment
      and message.outbox_id = requested_outbox_id
      and message.active_attempt_id = requested_attempt_id
      and message.lease_token = expected_lease_token
      and message.run_fence = expected_worker_fence
      and attempt.worker_id = requested_worker_id
      and attempt.lease_token = expected_lease_token
      and attempt.worker_fence = expected_worker_fence
      and run.active_fence = expected_worker_fence
      and (
        (
          attempt.status in ('SUCCEEDED', 'FAILED')
          and projection.status in ('COMPLETED', 'FAILED')
          and message.status = case projection.status
            when 'COMPLETED' then 'PUBLISHED'
            else 'DEAD_LETTER'
          end
          and run.status = case projection.status
            when 'COMPLETED' then 'SUCCEEDED'
            else 'FAILED'
          end
        )
        or (
          attempt.status = 'SUSPENDED'
          and projection.status = 'WAITING'
          and message.status = 'PUBLISHED'
          and run.status = 'WAITING'
        )
      )
      and not exists (
        select 1
        from app_data_agent.run_projections as newer
        where newer.app_id = projection.app_id
          and newer.tenant_id = projection.tenant_id
          and newer.environment = projection.environment
          and newer.run_id = projection.run_id
          and newer.version > projection.version
      )
      and run.principal_id = current_authority.principal_id
  ) then
    return true;
  end if;
  return false;
end
$$;

create or replace function app_data_agent.retry_run_work(
  requested_outbox_id uuid,
  requested_attempt_id uuid,
  requested_worker_id text,
  expected_lease_token bigint,
  expected_worker_fence bigint,
  final_event_sequence bigint,
  requested_error_code text,
  requested_retry_delay_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
begin
  if requested_outbox_id is null
    or requested_attempt_id is null
    or requested_worker_id is null
    or expected_lease_token is null
    or expected_worker_fence is null
    or final_event_sequence is null
    or final_event_sequence < 1
    or requested_error_code is null
    or requested_error_code !~ '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
    or requested_retry_delay_ms is null
    or requested_retry_delay_ms not between 1000 and 86400000
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_RETRY_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  return exists (
    select 1
    from app_data_agent.outbox as message
    join app_data_agent.run_attempts as attempt
      on attempt.app_id = message.app_id
     and attempt.tenant_id = message.tenant_id
     and attempt.environment = message.environment
     and attempt.attempt_id = requested_attempt_id
     and attempt.outbox_id = message.outbox_id
    join app_data_agent.run_projections as projection
      on projection.app_id = message.app_id
     and projection.tenant_id = message.tenant_id
     and projection.environment = message.environment
     and projection.run_id = message.run_id
     and projection.version = final_event_sequence
    join app_data_agent.run_events as event
      on event.app_id = message.app_id
     and event.tenant_id = message.tenant_id
     and event.environment = message.environment
     and event.run_id = message.run_id
     and event.sequence = final_event_sequence
    join app_data_agent.runs as run
      on run.app_id = message.app_id
     and run.tenant_id = message.tenant_id
     and run.environment = message.environment
     and run.run_id = message.run_id
    where message.app_id = current_authority.app_id
      and message.tenant_id = current_authority.tenant_id
      and message.environment = current_authority.environment
      and message.outbox_id = requested_outbox_id
      and message.active_attempt_id = requested_attempt_id
      and message.status = 'PENDING'
      and message.lease_token = expected_lease_token
      and message.run_fence = expected_worker_fence
      and attempt.worker_id = requested_worker_id
      and attempt.lease_token = expected_lease_token
      and attempt.worker_fence = expected_worker_fence
      and attempt.status = 'RETRY_SCHEDULED'
      and attempt.error_code = requested_error_code
      and attempt.retry_at = message.available_at
      and projection.status = 'QUEUED'
      and projection.worker_fence = expected_worker_fence
      and event.event_type = 'run.retry_scheduled'
      and event.worker_fence = expected_worker_fence
      and event.payload_json ->> 'error_code' = requested_error_code
      and (event.payload_json ->> 'retry_delay_ms')::bigint =
        requested_retry_delay_ms
      and run.status = 'QUEUED'
      and run.active_fence = expected_worker_fence
      and not exists (
        select 1
        from app_data_agent.run_projections as newer
        where newer.app_id = projection.app_id
          and newer.tenant_id = projection.tenant_id
          and newer.environment = projection.environment
          and newer.run_id = projection.run_id
          and newer.version > projection.version
      )
      and run.principal_id = current_authority.principal_id
  );
end
$$;

commit;
