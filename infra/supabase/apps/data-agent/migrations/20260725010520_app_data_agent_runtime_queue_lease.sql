begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010520_app_data_agent_runtime_queue_lease',
  'sha256:a7094608cbb61ebe1bc0f31bacc62b33cfef6ad1cf179363ee60cd4f02bf7bc0'
);

create or replace function app_data_agent.claim_run_work(
  requested_worker_id text,
  requested_limit integer default 1,
  requested_lease_seconds integer default 60
)
returns table (
  outbox_id uuid,
  run_id uuid,
  command_id uuid,
  topic text,
  command_kind text,
  payload jsonb,
  attempt_id uuid,
  attempt_no integer,
  delivery_attempt_no integer,
  lease_duration_ms integer,
  worker_id text,
  lease_token bigint,
  worker_fence bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  candidate record;
  claimed_at timestamptz;
  next_attempt_id uuid;
  next_attempt_no integer;
  next_lease_token bigint;
  next_worker_fence bigint;
  next_expires_at timestamptz;
  budget_projection app_data_agent.run_projections%rowtype;
  budget_projection_document jsonb;
  budget_projection_hash text;
  budget_event_id uuid;
  budget_event jsonb;
  budget_event_hash text;
  claimed_count integer := 0;
  cleanup_count integer := 0;
begin
  if requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb(requested_worker_id),
      'worker_id'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_WORKER_INVALID';
  end if;
  if requested_limit is null or requested_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_WORK_LIMIT_INVALID';
  end if;
  if requested_lease_seconds is null
    or requested_lease_seconds not between 5 and 900
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_WORK_LEASE_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  -- Give expired fifth-attempt settlement and ordinary leases independent
  -- per-call budgets. Exhausted heads are settled first, then requested_limit
  -- ordinary rows can still be returned from the same invocation.
  while claimed_count < requested_limit loop
    claimed_at := pg_catalog.clock_timestamp();
    select
      message.*,
      run.status as run_status,
      run.active_fence,
      run.principal_id,
      command.payload_json as command_payload,
      command.payload_json ->> 'kind' as resolved_command_kind,
      active_attempt.attempt_no as active_attempt_no
    into candidate
    from app_data_agent.outbox as message
    join app_data_agent.runs as run
      on run.app_id = message.app_id
     and run.tenant_id = message.tenant_id
     and run.environment = message.environment
     and run.run_id = message.run_id
    join lateral (
      select queued_command.payload_json
      from app_data_agent.commands as queued_command
      where queued_command.app_id = message.app_id
        and queued_command.tenant_id = message.tenant_id
        and queued_command.environment = message.environment
        and queued_command.command_id = message.command_id
        and queued_command.run_id = message.run_id
        and queued_command.payload_json ->> 'kind' in (
          'START_L2_RESEARCH',
          'RESUME_RUN'
        )
      limit 1
    ) as command on true
    left join lateral (
      select true as blocked
      from app_data_agent.outbox as earlier_message
      join lateral (
        select 1
        from app_data_agent.commands as earlier_command
        where earlier_command.app_id = earlier_message.app_id
          and earlier_command.tenant_id = earlier_message.tenant_id
          and earlier_command.environment = earlier_message.environment
          and earlier_command.command_id = earlier_message.command_id
          and earlier_command.run_id = earlier_message.run_id
          and earlier_command.payload_json ->> 'kind' in (
            'START_L2_RESEARCH',
            'RESUME_RUN'
          )
        limit 1
      ) as earlier_command on true
      where earlier_message.app_id = message.app_id
        and earlier_message.tenant_id = message.tenant_id
        and earlier_message.environment = message.environment
        and earlier_message.run_id = message.run_id
        and earlier_message.topic in (
          'run.command.accepted',
          'run.work.resume'
        )
        and earlier_message.status in ('PENDING', 'FAILED', 'LEASED')
        and earlier_message.queue_sequence < message.queue_sequence
      limit 1
    ) as earlier on true
    left join lateral (
      select attempt.attempt_no
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = message.app_id
        and attempt.tenant_id = message.tenant_id
        and attempt.environment = message.environment
        and attempt.run_id = message.run_id
        and attempt.outbox_id = message.outbox_id
        and attempt.command_id = message.command_id
        and attempt.attempt_id = message.active_attempt_id
      limit 1
    ) as active_attempt on true
    where message.app_id = current_authority.app_id
      and message.tenant_id = current_authority.tenant_id
      and message.environment = current_authority.environment
      and message.topic in ('run.command.accepted', 'run.work.resume')
      and message.claimable_at <= claimed_at
      and cleanup_count < requested_limit
      and message.status = 'LEASED'
      and message.attempt_count >= 5
      and run.status = 'RUNNING'
      and message.lease_expires_at < claimed_at
      and run.principal_id = current_authority.principal_id
      and earlier.blocked is null
    order by
      message.claimable_at,
      message.created_at,
      message.outbox_id
    for update of message, run skip locked
    limit 1;

    if not found then
      select
        message.*,
        run.status as run_status,
        run.active_fence,
        run.principal_id,
        command.payload_json as command_payload,
        command.payload_json ->> 'kind' as resolved_command_kind,
        active_attempt.attempt_no as active_attempt_no
      into candidate
      from app_data_agent.outbox as message
      join app_data_agent.runs as run
        on run.app_id = message.app_id
       and run.tenant_id = message.tenant_id
       and run.environment = message.environment
       and run.run_id = message.run_id
      join lateral (
        select queued_command.payload_json
        from app_data_agent.commands as queued_command
        where queued_command.app_id = message.app_id
          and queued_command.tenant_id = message.tenant_id
          and queued_command.environment = message.environment
          and queued_command.command_id = message.command_id
          and queued_command.run_id = message.run_id
          and queued_command.payload_json ->> 'kind' in (
            'START_L2_RESEARCH',
            'RESUME_RUN'
          )
        limit 1
      ) as command on true
      left join lateral (
        select true as blocked
        from app_data_agent.outbox as earlier_message
        join lateral (
          select 1
          from app_data_agent.commands as earlier_command
          where earlier_command.app_id = earlier_message.app_id
            and earlier_command.tenant_id = earlier_message.tenant_id
            and earlier_command.environment = earlier_message.environment
            and earlier_command.command_id = earlier_message.command_id
            and earlier_command.run_id = earlier_message.run_id
            and earlier_command.payload_json ->> 'kind' in (
              'START_L2_RESEARCH',
              'RESUME_RUN'
            )
          limit 1
        ) as earlier_command on true
        where earlier_message.app_id = message.app_id
          and earlier_message.tenant_id = message.tenant_id
          and earlier_message.environment = message.environment
          and earlier_message.run_id = message.run_id
          and earlier_message.topic in (
            'run.command.accepted',
            'run.work.resume'
          )
          and earlier_message.status in ('PENDING', 'FAILED', 'LEASED')
          and earlier_message.queue_sequence < message.queue_sequence
        limit 1
      ) as earlier on true
      left join lateral (
        select attempt.attempt_no
        from app_data_agent.run_attempts as attempt
        where attempt.app_id = message.app_id
          and attempt.tenant_id = message.tenant_id
          and attempt.environment = message.environment
          and attempt.run_id = message.run_id
          and attempt.outbox_id = message.outbox_id
          and attempt.command_id = message.command_id
          and attempt.attempt_id = message.active_attempt_id
        limit 1
      ) as active_attempt on true
      where message.app_id = current_authority.app_id
        and message.tenant_id = current_authority.tenant_id
        and message.environment = current_authority.environment
        and message.topic in ('run.command.accepted', 'run.work.resume')
        and message.claimable_at <= claimed_at
        and (
          message.status in ('PENDING', 'FAILED')
          or (
            message.status = 'LEASED'
            and message.attempt_count < 5
          )
        )
        and run.principal_id = current_authority.principal_id
        and (
          (
            run.status = 'QUEUED'
            and message.status in ('PENDING', 'FAILED')
          )
          or (
            run.status = 'RUNNING'
            and message.status = 'LEASED'
            and message.lease_expires_at < claimed_at
          )
        )
        and earlier.blocked is null
      order by
        message.claimable_at,
        message.created_at,
        message.outbox_id
      for update of message, run skip locked
      limit 1;
    end if;

    exit when not found;
    if candidate.status = 'LEASED'
      and candidate.attempt_count >= 5
      and candidate.active_attempt_id is not null
    then
      select projection.*
      into budget_projection
      from app_data_agent.run_projections as projection
      where projection.app_id = candidate.app_id
        and projection.tenant_id = candidate.tenant_id
        and projection.environment = candidate.environment
        and projection.run_id = candidate.run_id
      order by projection.version desc
      limit 1
      for update;
      if not found
        or budget_projection.status not in ('QUEUED', 'RUNNING')
        or budget_projection.projection_json ->> 'terminal_event_id' is not null
      then
        raise exception using
          errcode = '40001',
          message = 'DA_RUN_ATTEMPT_BUDGET_PROJECTION_CONFLICT';
      end if;

      budget_projection_document := budget_projection.projection_json;
      if budget_projection.worker_fence <> candidate.active_fence
        or budget_projection.status <> 'RUNNING'
      then
        budget_event_id := pg_catalog.gen_random_uuid();
        budget_event := pg_catalog.jsonb_build_object(
          'schema_version',
          '1.0.0',
          'event_id',
          budget_event_id,
          'scope',
          pg_catalog.jsonb_build_object(
            'app_id',
            candidate.app_id,
            'tenant_id',
            candidate.tenant_id,
            'environment',
            candidate.environment
          ),
          'run_id',
          candidate.run_id,
          'sequence',
          budget_projection.version + 1,
          'worker_fence',
          candidate.active_fence,
          'idempotency_key',
          'attempt-budget-lease:' || candidate.active_attempt_id::text,
          'occurred_at',
          app_data_agent.runtime_iso_timestamp(claimed_at),
          'event_type',
          'run.leased',
          'payload',
          pg_catalog.jsonb_build_object(
            'command_id',
            candidate.command_id,
            'lease_id',
            candidate.active_attempt_id::text,
            'worker_id',
            candidate.lease_owner,
            'attempt',
            candidate.active_attempt_no
          )
        );
        budget_event_hash :=
          app_data_agent.runtime_canonical_sha256(budget_event);
        budget_projection_document :=
          app_data_agent.reduce_run_projection_document(
            budget_projection_document,
            budget_event
          );
        budget_projection_hash :=
          app_data_agent.runtime_canonical_sha256(
            budget_projection_document
          );

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
          candidate.app_id,
          candidate.tenant_id,
          candidate.environment,
          budget_event_id,
          candidate.run_id,
          budget_projection.version + 1,
          'run.leased',
          budget_event -> 'payload',
          candidate.active_attempt_id,
          candidate.command_id,
          budget_event ->> 'idempotency_key',
          budget_event_hash,
          candidate.active_fence,
          budget_event,
          claimed_at
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
          candidate.app_id,
          candidate.tenant_id,
          candidate.environment,
          candidate.run_id,
          budget_projection.version + 1,
          'RUNNING',
          candidate.active_fence,
          budget_event_id,
          budget_projection_hash,
          budget_projection_document,
          claimed_at
        );
      end if;

      budget_event_id := pg_catalog.gen_random_uuid();
      budget_event := pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        budget_event_id,
        'scope',
        pg_catalog.jsonb_build_object(
          'app_id',
          candidate.app_id,
          'tenant_id',
          candidate.tenant_id,
          'environment',
          candidate.environment
        ),
        'run_id',
        candidate.run_id,
        'sequence',
        (budget_projection_document ->> 'version')::bigint + 1,
        'worker_fence',
        candidate.active_fence,
        'idempotency_key',
        'attempt-budget-failed:' || candidate.outbox_id::text,
        'occurred_at',
        app_data_agent.runtime_iso_timestamp(claimed_at),
        'event_type',
        'run.failed',
        'payload',
        pg_catalog.jsonb_build_object(
          'error_code',
          'RUN_ATTEMPT_BUDGET_EXHAUSTED',
          'retryable',
          false
        )
      );
      budget_event_hash :=
        app_data_agent.runtime_canonical_sha256(budget_event);
      budget_projection_document :=
        app_data_agent.reduce_run_projection_document(
          budget_projection_document,
          budget_event
        );
      budget_projection_hash :=
        app_data_agent.runtime_canonical_sha256(
          budget_projection_document
        );

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
        candidate.app_id,
        candidate.tenant_id,
        candidate.environment,
        budget_event_id,
        candidate.run_id,
        (budget_event ->> 'sequence')::bigint,
        'run.failed',
        budget_event -> 'payload',
        candidate.active_attempt_id,
        candidate.command_id,
        budget_event ->> 'idempotency_key',
        budget_event_hash,
        candidate.active_fence,
        budget_event,
        claimed_at
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
        candidate.app_id,
        candidate.tenant_id,
        candidate.environment,
        candidate.run_id,
        (budget_event ->> 'sequence')::bigint,
        'FAILED',
        candidate.active_fence,
        budget_event_id,
        budget_projection_hash,
        budget_projection_document,
        claimed_at
      );

      update app_data_agent.run_attempts as exhausted_attempt
      set status = 'FAILED',
          error_code = 'RUN_ATTEMPT_BUDGET_EXHAUSTED',
          finished_at = claimed_at
      where exhausted_attempt.app_id = candidate.app_id
        and exhausted_attempt.tenant_id = candidate.tenant_id
        and exhausted_attempt.environment = candidate.environment
        and exhausted_attempt.attempt_id = candidate.active_attempt_id
        and exhausted_attempt.status = 'ACTIVE';

      update app_data_agent.outbox as exhausted_message
      set status = 'DEAD_LETTER',
          lease_owner = null,
          lease_expires_at = null
      where exhausted_message.app_id = candidate.app_id
        and exhausted_message.tenant_id = candidate.tenant_id
        and exhausted_message.environment = candidate.environment
        and exhausted_message.outbox_id = candidate.outbox_id;

      update app_data_agent.commands as exhausted_command
      set status = 'FAILED'
      where exhausted_command.app_id = candidate.app_id
        and exhausted_command.tenant_id = candidate.tenant_id
        and exhausted_command.environment = candidate.environment
        and exhausted_command.command_id = candidate.command_id
        and exhausted_command.status = 'PROCESSING';

      update app_data_agent.runs as exhausted_run
      set status = 'FAILED',
          updated_at = claimed_at
      where exhausted_run.app_id = candidate.app_id
        and exhausted_run.tenant_id = candidate.tenant_id
        and exhausted_run.environment = candidate.environment
        and exhausted_run.run_id = candidate.run_id
        and exhausted_run.active_fence = candidate.active_fence;
      cleanup_count := cleanup_count + 1;
      continue;
    end if;

    if candidate.status = 'LEASED'
      and candidate.active_attempt_id is not null
    then
      update app_data_agent.run_attempts as expired
      set status = 'EXPIRED',
          finished_at = claimed_at
      where expired.app_id = candidate.app_id
        and expired.tenant_id = candidate.tenant_id
        and expired.environment = candidate.environment
        and expired.attempt_id = candidate.active_attempt_id
        and expired.status = 'ACTIVE';
    end if;

    select coalesce(pg_catalog.max(attempt.attempt_no), 0)::integer + 1
    into next_attempt_no
    from app_data_agent.run_attempts as attempt
    where attempt.app_id = candidate.app_id
      and attempt.tenant_id = candidate.tenant_id
      and attempt.environment = candidate.environment
      and attempt.run_id = candidate.run_id;

    next_attempt_id := pg_catalog.gen_random_uuid();
    next_lease_token := candidate.lease_token + 1;
    next_worker_fence := candidate.active_fence + 1;
    next_expires_at := claimed_at
      + pg_catalog.make_interval(secs => requested_lease_seconds);

    update app_data_agent.runs as claimed_run
    set status = 'RUNNING',
        active_fence = next_worker_fence,
        updated_at = claimed_at
    where claimed_run.app_id = candidate.app_id
      and claimed_run.tenant_id = candidate.tenant_id
      and claimed_run.environment = candidate.environment
      and claimed_run.run_id = candidate.run_id
      and claimed_run.active_fence = candidate.active_fence;
    if not found then
      raise exception using
        errcode = '40001',
        message = 'DA_RUN_WORK_CLAIM_CONFLICT';
    end if;

    insert into app_data_agent.run_attempts (
      app_id,
      tenant_id,
      environment,
      run_id,
      outbox_id,
      command_id,
      attempt_id,
      attempt_no,
      worker_id,
      lease_token,
      worker_fence,
      lease_expires_at,
      last_heartbeat_at,
      started_at
    )
    values (
      candidate.app_id,
      candidate.tenant_id,
      candidate.environment,
      candidate.run_id,
      candidate.outbox_id,
      candidate.command_id,
      next_attempt_id,
      next_attempt_no,
      requested_worker_id,
      next_lease_token,
      next_worker_fence,
      next_expires_at,
      claimed_at,
      claimed_at
    );

    update app_data_agent.outbox as claimed_message
    set status = 'LEASED',
        attempt_count = claimed_message.attempt_count + 1,
        lease_owner = requested_worker_id,
        lease_token = next_lease_token,
        lease_expires_at = next_expires_at,
        published_at = null,
        active_attempt_id = next_attempt_id,
        run_fence = next_worker_fence,
        last_heartbeat_at = claimed_at
    where claimed_message.app_id = candidate.app_id
      and claimed_message.tenant_id = candidate.tenant_id
      and claimed_message.environment = candidate.environment
      and claimed_message.outbox_id = candidate.outbox_id;

    update app_data_agent.commands as claimed_command
    set status = 'PROCESSING'
    where claimed_command.app_id = candidate.app_id
      and claimed_command.tenant_id = candidate.tenant_id
      and claimed_command.environment = candidate.environment
      and claimed_command.command_id = candidate.command_id
      and claimed_command.status = 'ACCEPTED';

    outbox_id := candidate.outbox_id;
    run_id := candidate.run_id;
    command_id := candidate.command_id;
    topic := candidate.topic;
    command_kind := candidate.resolved_command_kind;
    payload := candidate.command_payload;
    attempt_id := next_attempt_id;
    attempt_no := next_attempt_no;
    delivery_attempt_no := candidate.attempt_count + 1;
    lease_duration_ms := requested_lease_seconds * 1000;
    worker_id := requested_worker_id;
    lease_token := next_lease_token;
    worker_fence := next_worker_fence;
    expires_at := next_expires_at;
    claimed_count := claimed_count + 1;
    return next;
  end loop;
end
$$;

create or replace function app_data_agent.heartbeat_run_work(
  requested_outbox_id uuid,
  requested_attempt_id uuid,
  requested_worker_id text,
  expected_lease_token bigint,
  expected_worker_fence bigint,
  requested_lease_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  target_run_id uuid;
  lease_checked_at timestamptz;
  heartbeat_at timestamptz;
  extended_expires_at timestamptz;
  message_lease_expires_at timestamptz;
  attempt_lease_expires_at timestamptz;
  message_last_heartbeat_at timestamptz;
  attempt_last_heartbeat_at timestamptz;
begin
  if requested_outbox_id is null
    or requested_attempt_id is null
    or requested_worker_id is null
    or expected_lease_token is null
    or expected_worker_fence is null
    or requested_lease_seconds is null
    or requested_lease_seconds not between 5 and 900
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_HEARTBEAT_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  -- All Runtime writers lock Run first. This prevents an Artifact/Control
  -- transaction from holding Run while a Heartbeat holds Outbox/Attempt.
  select run.run_id
  into target_run_id
  from app_data_agent.outbox as message
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
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = expected_worker_fence
    and run.active_fence = expected_worker_fence
    and run.status = 'RUNNING'
    and run.principal_id = current_authority.principal_id
  for update of run;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_LEASE_STALE';
  end if;

  select
    message.lease_expires_at,
    attempt.lease_expires_at,
    message.last_heartbeat_at,
    attempt.last_heartbeat_at
  into
    message_lease_expires_at,
    attempt_lease_expires_at,
    message_last_heartbeat_at,
    attempt_last_heartbeat_at
  from app_data_agent.outbox as message
  join app_data_agent.run_attempts as attempt
    on attempt.app_id = message.app_id
   and attempt.tenant_id = message.tenant_id
   and attempt.environment = message.environment
   and attempt.attempt_id = message.active_attempt_id
   and attempt.outbox_id = message.outbox_id
   and attempt.run_id = message.run_id
  where message.app_id = current_authority.app_id
    and message.tenant_id = current_authority.tenant_id
    and message.environment = current_authority.environment
    and message.run_id = target_run_id
    and message.outbox_id = requested_outbox_id
    and message.active_attempt_id = requested_attempt_id
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = expected_worker_fence
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = expected_lease_token
    and attempt.worker_fence = expected_worker_fence
    and attempt.status = 'ACTIVE'
  for update of message, attempt;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_LEASE_STALE';
  end if;

  -- Take the authority timestamp only after all identity rows are locked.
  -- GREATEST also makes two overlapping Heartbeats strictly monotonic even
  -- when the database clock has microsecond-level ties.
  lease_checked_at := pg_catalog.clock_timestamp();
  if message_lease_expires_at < lease_checked_at
    or attempt_lease_expires_at < lease_checked_at
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_LEASE_STALE';
  end if;
  heartbeat_at := greatest(
    lease_checked_at,
    message_last_heartbeat_at + interval '1 microsecond',
    attempt_last_heartbeat_at + interval '1 microsecond'
  );
  extended_expires_at := heartbeat_at
    + pg_catalog.make_interval(secs => requested_lease_seconds);

  update app_data_agent.run_attempts as attempt
  set lease_expires_at = extended_expires_at,
      last_heartbeat_at = heartbeat_at
  where attempt.app_id = current_authority.app_id
    and attempt.tenant_id = current_authority.tenant_id
    and attempt.environment = current_authority.environment
    and attempt.attempt_id = requested_attempt_id;

  update app_data_agent.outbox as message
  set lease_expires_at = extended_expires_at,
      last_heartbeat_at = heartbeat_at
  where message.app_id = current_authority.app_id
    and message.tenant_id = current_authority.tenant_id
    and message.environment = current_authority.environment
    and message.outbox_id = requested_outbox_id;

  return extended_expires_at;
end
$$;

commit;
