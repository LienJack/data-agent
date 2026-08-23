begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010560_app_data_agent_runtime_backend_acceptance',
  'sha256:6580a5a72e573665eec707a8d0ed9132efc5fee3b8e7e7c7797273ad6a61dbbb'
);

create or replace function app_data_agent.accept_backend_run_command(
  requested_command jsonb,
  requested_payload_hash text,
  requested_event jsonb,
  requested_event_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  existing_record app_data_agent.idempotency_records%rowtype;
  existing_command app_data_agent.commands%rowtype;
  existing_run app_data_agent.runs%rowtype;
  existing_event app_data_agent.run_events%rowtype;
  existing_projection app_data_agent.run_projections%rowtype;
  existing_outbox app_data_agent.outbox%rowtype;
  expected_initial_projection jsonb;
  existing_outbox_count bigint;
  existing_audit_complete boolean;
  requested_run_id uuid;
  requested_command_id uuid;
  requested_event_id uuid;
  requested_outbox_id uuid;
  requested_audit_id uuid;
  requested_idempotency_key text;
  requested_question text;
  requested_payload jsonb;
  requested_occurred_at timestamptz;
  idempotency_lock_key text;
  run_lock_key text;
  accept_at timestamptz;
begin
  if requested_command is null
    or requested_event is null
    or requested_payload_hash is null
    or requested_event_hash is null
    or pg_catalog.jsonb_typeof(requested_command) <> 'object'
    or pg_catalog.jsonb_typeof(requested_event) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(requested_command)
    ) <> 8
    or not requested_command ?& array[
      'run_id',
      'command_id',
      'event_id',
      'outbox_id',
      'audit_id',
      'idempotency_key',
      'question',
      'payload'
    ]
    or pg_catalog.jsonb_typeof(
      requested_command -> 'run_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_command -> 'command_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_command -> 'event_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_command -> 'outbox_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_command -> 'audit_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_command -> 'idempotency_key'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_command -> 'question'
    ) <> 'string'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(requested_event)
    ) <> 10
    or not requested_event ?& array[
      'schema_version',
      'event_id',
      'scope',
      'run_id',
      'sequence',
      'worker_fence',
      'idempotency_key',
      'occurred_at',
      'event_type',
      'payload'
    ]
    or pg_catalog.jsonb_typeof(
      requested_event -> 'schema_version'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'event_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'run_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'sequence'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'worker_fence'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'idempotency_key'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'occurred_at'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'event_type'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(requested_command -> 'payload') <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'scope') <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(requested_event -> 'scope')
    ) <> 3
    or not (requested_event -> 'scope') ?& array[
      'app_id',
      'tenant_id',
      'environment'
    ]
    or pg_catalog.jsonb_typeof(
      requested_event -> 'scope' -> 'app_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'scope' -> 'tenant_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'scope' -> 'environment'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(requested_event -> 'payload') <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(requested_event -> 'payload')
    ) <> 2
    or not (requested_event -> 'payload') ?& array[
      'command_id',
      'payload_hash'
    ]
    or pg_catalog.jsonb_typeof(
      requested_event -> 'payload' -> 'command_id'
    ) <> 'string'
    or pg_catalog.jsonb_typeof(
      requested_event -> 'payload' -> 'payload_hash'
    ) <> 'string'
    or requested_payload_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_event_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_event ->> 'schema_version' <> '1.0.0'
    or requested_event ->> 'event_type' <> 'run.accepted'
    or requested_event ->> 'sequence' <> '1'
    or requested_event ->> 'worker_fence' <> '0'
    or app_data_agent.contains_potential_plaintext_secret(
      requested_command -> 'question',
      'question'
    )
    or app_data_agent.contains_potential_plaintext_secret(
      requested_command -> 'idempotency_key',
      'idempotency_key'
    )
    or app_data_agent.contains_potential_plaintext_secret(
      requested_command -> 'payload'
    )
    or app_data_agent.contains_potential_plaintext_secret(requested_event)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_COMMAND_ACCEPTANCE_INPUT_INVALID';
  end if;

  begin
    requested_run_id := (requested_command ->> 'run_id')::uuid;
    requested_command_id := (requested_command ->> 'command_id')::uuid;
    requested_event_id := (requested_command ->> 'event_id')::uuid;
    requested_outbox_id := (requested_command ->> 'outbox_id')::uuid;
    requested_audit_id := (requested_command ->> 'audit_id')::uuid;
    requested_occurred_at :=
      (requested_event ->> 'occurred_at')::timestamptz;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'DA_COMMAND_ACCEPTANCE_INPUT_INVALID';
  end;

  requested_idempotency_key := requested_command ->> 'idempotency_key';
  requested_question := requested_command ->> 'question';
  requested_payload := requested_command -> 'payload';
  if requested_idempotency_key is null
    or pg_catalog.length(requested_idempotency_key) not between 1 and 256
    or requested_question is null
    or pg_catalog.length(pg_catalog.btrim(requested_question))
      not between 1 and 4000
    or not app_data_agent.command_payload_is_valid(requested_payload)
    or requested_payload ->> 'kind'
      is distinct from 'START_L2_RESEARCH'
    or requested_payload_hash <>
      platform.canonical_sha256(requested_payload)
    or requested_event_hash <>
      app_data_agent.runtime_canonical_sha256(requested_event)
    or requested_event ->> 'event_id'
      is distinct from requested_event_id::text
    or requested_event ->> 'run_id'
      is distinct from requested_run_id::text
    or requested_event ->> 'idempotency_key'
      is distinct from 'event:' || requested_event_id::text
    or requested_event ->> 'occurred_at'
      is distinct from
        app_data_agent.runtime_iso_timestamp(requested_occurred_at)
    or requested_event -> 'payload' ->> 'command_id'
      is distinct from requested_command_id::text
    or requested_event -> 'payload' ->> 'payload_hash'
      is distinct from requested_payload_hash
  then
    raise exception using
      errcode = '22023',
      message = 'DA_COMMAND_ACCEPTANCE_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if requested_event -> 'scope' <> pg_catalog.jsonb_build_object(
    'app_id',
    current_authority.app_id,
    'tenant_id',
    current_authority.tenant_id,
    'environment',
    current_authority.environment
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_COMMAND_ACCEPTANCE_SCOPE_FORBIDDEN';
  end if;

  idempotency_lock_key :=
    'data-agent:idempotency:' ||
    current_authority.app_id::text || ':' ||
    current_authority.tenant_id::text || ':' ||
    current_authority.environment || ':' ||
    current_authority.principal_id::text || ':' ||
    requested_idempotency_key;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(idempotency_lock_key, 0)
  );

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
    into existing_command
    from app_data_agent.commands as command
    where command.app_id = existing_record.app_id
      and command.tenant_id = existing_record.tenant_id
      and command.environment = existing_record.environment
      and command.command_id = existing_record.command_id
      and command.principal_id = existing_record.principal_id;
    select run.*
    into existing_run
    from app_data_agent.runs as run
    where run.app_id = existing_command.app_id
      and run.tenant_id = existing_command.tenant_id
      and run.environment = existing_command.environment
      and run.run_id = existing_command.run_id;
    select event.*
    into existing_event
    from app_data_agent.run_events as event
    where event.app_id = existing_command.app_id
      and event.tenant_id = existing_command.tenant_id
      and event.environment = existing_command.environment
      and event.run_id = existing_command.run_id
      and event.sequence = 1;
    select projection.*
    into existing_projection
    from app_data_agent.run_projections as projection
    where projection.app_id = existing_command.app_id
      and projection.tenant_id = existing_command.tenant_id
      and projection.environment = existing_command.environment
      and projection.run_id = existing_command.run_id
      and projection.version = 1;
    select message.*
    into existing_outbox
    from app_data_agent.outbox as message
    where message.app_id = existing_command.app_id
      and message.tenant_id = existing_command.tenant_id
      and message.environment = existing_command.environment
      and message.command_id = existing_command.command_id
      and message.topic = 'run.command.accepted'
    order by message.created_at, message.outbox_id
    limit 1;
    select pg_catalog.count(*)
    into existing_outbox_count
    from app_data_agent.outbox as message
    where message.app_id = existing_command.app_id
      and message.tenant_id = existing_command.tenant_id
      and message.environment = existing_command.environment
      and message.command_id = existing_command.command_id
      and message.topic = 'run.command.accepted';
    select (
      exists (
        select 1
        from app_data_agent.audit_log as audit
        where audit.app_id = existing_command.app_id
          and audit.tenant_id = existing_command.tenant_id
          and audit.environment = existing_command.environment
          and audit.principal_id = existing_command.principal_id
          and audit.action = 'RUN_COMMAND_ACCEPTED'
          and audit.resource_type = 'run'
          and audit.resource_id = existing_command.run_id::text
          and audit.details = pg_catalog.jsonb_build_object(
            'command_id',
            existing_command.command_id,
            'payload_hash',
            existing_command.payload_hash,
            'source',
            'repository'
          )
      )
      or (
        exists (
          select 1
          from app_data_agent.audit_log as audit
          where audit.app_id = existing_command.app_id
            and audit.tenant_id = existing_command.tenant_id
            and audit.environment = existing_command.environment
            and audit.principal_id = existing_command.principal_id
            and audit.action = 'RUN_CREATED'
            and audit.resource_type = 'run'
            and audit.resource_id = existing_command.run_id::text
            and audit.details =
              '{"source":"accept_run_command"}'::jsonb
        )
        and exists (
          select 1
          from app_data_agent.audit_log as audit
          where audit.app_id = existing_command.app_id
            and audit.tenant_id = existing_command.tenant_id
            and audit.environment = existing_command.environment
            and audit.principal_id = existing_command.principal_id
            and audit.action = 'COMMAND_SUBMITTED'
            and audit.resource_type = 'command'
            and audit.resource_id = existing_command.command_id::text
            and audit.details = pg_catalog.jsonb_build_object(
              'runId',
              existing_command.run_id,
              'idempotencyKey',
              existing_command.idempotency_key,
              'payloadHash',
              existing_command.payload_hash
            )
        )
      )
    )
    into existing_audit_complete;

    expected_initial_projection := pg_catalog.jsonb_build_object(
      'schema_version',
      '1.0.0',
      'scope',
      existing_event.event_document -> 'scope',
      'run_id',
      existing_command.run_id,
      'status',
      'QUEUED',
      'version',
      1,
      'worker_fence',
      0,
      'attempt_count',
      0,
      'last_event_id',
      existing_event.event_id,
      'last_occurred_at',
      existing_event.event_document -> 'occurred_at',
      'active_artifact_ref',
      null,
      'active_snapshot_ref',
      null,
      'last_side_effect_receipt_id',
      null,
      'terminal_event_id',
      null
    );
    if existing_record.command_id is distinct from requested_command_id
      or existing_record.payload_hash is distinct from requested_payload_hash
      or existing_command.command_id is null
      or existing_command.run_id is distinct from requested_run_id
      or existing_command.idempotency_key is distinct from
        requested_idempotency_key
      or existing_command.payload_json is distinct from requested_payload
      or existing_run.run_id is null
      or existing_run.principal_id is distinct from
        current_authority.principal_id
      or existing_run.question is distinct from requested_question
      or existing_event.event_id is null
      or existing_event.event_type is distinct from 'run.accepted'
      or existing_event.sequence is distinct from 1
      or existing_event.worker_fence is distinct from 0
      or existing_event.command_id is distinct from requested_command_id
      or existing_event.dedupe_key is distinct from
        'event:' || existing_event.event_id::text
      or existing_event.payload_json is distinct from
        pg_catalog.jsonb_build_object(
        'command_id',
        requested_command_id,
        'payload_hash',
        requested_payload_hash
      )
      or existing_event.event_hash is distinct from
        app_data_agent.runtime_canonical_sha256(
          existing_event.event_document
        )
      or existing_event.event_document is distinct from
        pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        existing_event.event_id,
        'scope',
        pg_catalog.jsonb_build_object(
          'app_id',
          existing_event.app_id,
          'tenant_id',
          existing_event.tenant_id,
          'environment',
          existing_event.environment
        ),
        'run_id',
        existing_event.run_id,
        'sequence',
        1,
        'worker_fence',
        0,
        'idempotency_key',
        existing_event.dedupe_key,
        'occurred_at',
        app_data_agent.runtime_iso_timestamp(existing_event.created_at),
        'event_type',
        'run.accepted',
        'payload',
        existing_event.payload_json
      )
      or existing_projection.run_id is null
      or existing_projection.status is distinct from 'QUEUED'
      or existing_projection.worker_fence is distinct from 0
      or existing_projection.event_id is distinct from
        existing_event.event_id
      or existing_projection.projection_json is distinct from
        expected_initial_projection
      or existing_projection.projection_hash is distinct from
        app_data_agent.runtime_canonical_sha256(
          expected_initial_projection
        )
      or existing_outbox.outbox_id is null
      or existing_outbox_count is distinct from 1
      or existing_outbox.run_id is distinct from requested_run_id
      or existing_outbox.command_id is distinct from requested_command_id
      or not (
        existing_outbox.payload_json = pg_catalog.jsonb_build_object(
          'app_id',
          existing_command.app_id,
          'tenant_id',
          existing_command.tenant_id,
          'environment',
          existing_command.environment,
          'run_id',
          existing_command.run_id,
          'command_id',
          existing_command.command_id,
          'payload_hash',
          existing_command.payload_hash
        )
        or existing_outbox.payload_json = pg_catalog.jsonb_build_object(
          'appId',
          existing_command.app_id,
          'tenantId',
          existing_command.tenant_id,
          'environment',
          existing_command.environment,
          'runId',
          existing_command.run_id,
          'commandId',
          existing_command.command_id,
          'payloadHash',
          existing_command.payload_hash
        )
      )
      or existing_audit_complete is distinct from true
    then
      raise exception using
        errcode = '23505',
        message = 'DA_COMMAND_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'created',
      false,
      'run_id',
      existing_run.run_id,
      'command_id',
      existing_command.command_id,
      'outbox_id',
      existing_outbox.outbox_id,
      'payload_hash',
      existing_command.payload_hash
    );
  end if;

  run_lock_key :=
    'data-agent:run:' ||
    current_authority.app_id::text || ':' ||
    current_authority.tenant_id::text || ':' ||
    current_authority.environment || ':' ||
    requested_run_id::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(run_lock_key, 0)
  );

  if exists (
    select 1
    from app_data_agent.runs as run
    where run.app_id = current_authority.app_id
      and run.tenant_id = current_authority.tenant_id
      and run.environment = current_authority.environment
      and run.run_id = requested_run_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'DA_RUN_ALREADY_EXISTS';
  end if;
  if exists (
    select 1
    from app_data_agent.commands as command
    where command.app_id = current_authority.app_id
      and command.tenant_id = current_authority.tenant_id
      and command.environment = current_authority.environment
      and command.command_id = requested_command_id
  ) or exists (
    select 1
    from app_data_agent.run_events as event
    where event.app_id = current_authority.app_id
      and event.tenant_id = current_authority.tenant_id
      and event.environment = current_authority.environment
      and event.event_id = requested_event_id
  ) or exists (
    select 1
    from app_data_agent.outbox as message
    where message.app_id = current_authority.app_id
      and message.tenant_id = current_authority.tenant_id
      and message.environment = current_authority.environment
      and message.outbox_id = requested_outbox_id
  ) or exists (
    select 1
    from app_data_agent.audit_log as audit
    where audit.app_id = current_authority.app_id
      and audit.tenant_id = current_authority.tenant_id
      and audit.environment = current_authority.environment
      and audit.audit_id = requested_audit_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'DA_COMMAND_IDENTITY_CONFLICT';
  end if;

  accept_at := pg_catalog.clock_timestamp();

  begin
    insert into app_data_agent.runs (
      app_id,
      tenant_id,
      environment,
      run_id,
      principal_id,
      status,
      active_fence,
      question,
      created_at,
      updated_at,
      next_queue_sequence
    )
    values (
      current_authority.app_id,
      current_authority.tenant_id,
      current_authority.environment,
      requested_run_id,
      current_authority.principal_id,
      'QUEUED',
      0,
      requested_question,
      accept_at,
      accept_at,
      2
    );
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'DA_RUN_ALREADY_EXISTS';
  end;

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
    requested_payload,
    requested_payload_hash,
    'ACCEPTED',
    accept_at
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
    requested_payload_hash,
    accept_at
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
    command_id,
    worker_fence,
    dedupe_key,
    event_hash,
    event_document,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_event_id,
    requested_run_id,
    1,
    'run.accepted',
    requested_event -> 'payload',
    requested_command_id,
    0,
    requested_event ->> 'idempotency_key',
    requested_event_hash,
    requested_event,
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
    attempt_count,
    available_at,
    lease_token,
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
    'run.command.accepted',
    pg_catalog.jsonb_build_object(
      'app_id',
      current_authority.app_id,
      'tenant_id',
      current_authority.tenant_id,
      'environment',
      current_authority.environment,
      'command_id',
      requested_command_id,
      'run_id',
      requested_run_id,
      'payload_hash',
      requested_payload_hash
    ),
    'PENDING',
    0,
    accept_at,
    0,
    accept_at,
    1
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
    'RUN_COMMAND_ACCEPTED',
    'run',
    requested_run_id::text,
    pg_catalog.jsonb_build_object(
      'command_id',
      requested_command_id,
      'payload_hash',
      requested_payload_hash,
      'source',
      'repository'
    ),
    accept_at
  );

  return pg_catalog.jsonb_build_object(
    'created',
    true,
    'run_id',
    requested_run_id,
    'command_id',
    requested_command_id,
    'outbox_id',
    requested_outbox_id,
    'payload_hash',
    requested_payload_hash
  );
end
$$;

-- This forward API is intentionally unavailable until 10570 installs the
-- final least-privilege matrix. Do not rely only on migrator default ACLs.
revoke all privileges on function app_data_agent.accept_backend_run_command(
  jsonb,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;

commit;
