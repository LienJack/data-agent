begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010505_app_data_agent_runtime_api',
  'sha256:e48fddfb3e829eeba87d8f8a0672ed7c41cd078c474802c5cc14355a4d076dde'
);

-- Forward-replace only live U4 browser APIs after 10500 revoked legacy code.
-- Never edit migration 10200; its checksum is already registered by U2.
create or replace function api.data_agent__accept_run_command(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_run_id uuid,
  requested_command_id uuid,
  requested_idempotency_key text,
  requested_question text,
  requested_payload_json jsonb,
  requested_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorized_scope record;
  existing_record app_data_agent.idempotency_records%rowtype;
  existing_command app_data_agent.commands%rowtype;
  existing_run app_data_agent.runs%rowtype;
  created_run app_data_agent.runs%rowtype;
  created_command app_data_agent.commands%rowtype;
  idempotency_lock_key text;
  run_lock_key text;
  accept_at timestamptz;
begin
  if requested_idempotency_key is null
    or pg_catalog.length(requested_idempotency_key) not between 1 and 256
    or app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb(requested_idempotency_key),
      'idempotency_key'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_COMMAND_PAYLOAD_INVALID';
  end if;

  select *
  into authorized_scope
  from platform.authorize_browser_context(
    requested_deployment_id,
    requested_tenant_id,
    true
  );

  if requested_question is null
    or pg_catalog.length(pg_catalog.btrim(requested_question))
      not between 1 and 4000
    or app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb(requested_question),
      'question'
    )
    or requested_payload_json is null
    or pg_catalog.jsonb_typeof(requested_payload_json) <> 'object'
    or requested_payload_hash is distinct from
      platform.canonical_sha256(requested_payload_json)
    or not app_data_agent.command_payload_is_valid(requested_payload_json)
    or requested_payload_json ->> 'kind'
      is distinct from 'START_L2_RESEARCH'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_COMMAND_PAYLOAD_INVALID';
  end if;

  idempotency_lock_key :=
    'data-agent:idempotency:' ||
    authorized_scope.app_id::text || ':' ||
    authorized_scope.tenant_id::text || ':' ||
    authorized_scope.environment || ':' ||
    authorized_scope.principal_id::text || ':' ||
    requested_idempotency_key;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(idempotency_lock_key, 0)
  );

  select record.*
  into existing_record
  from app_data_agent.idempotency_records as record
  where record.app_id = authorized_scope.app_id
    and record.tenant_id = authorized_scope.tenant_id
    and record.environment = authorized_scope.environment
    and record.principal_id = authorized_scope.principal_id
    and record.idempotency_key = requested_idempotency_key;

  if found then
    select command.*
    into strict existing_command
    from app_data_agent.commands as command
    where command.app_id = existing_record.app_id
      and command.tenant_id = existing_record.tenant_id
      and command.environment = existing_record.environment
      and command.command_id = existing_record.command_id
      and command.principal_id = existing_record.principal_id;
    select run.*
    into strict existing_run
    from app_data_agent.runs as run
    where run.app_id = existing_command.app_id
      and run.tenant_id = existing_command.tenant_id
      and run.environment = existing_command.environment
      and run.run_id = existing_command.run_id;

    if (
      authorized_scope.membership_role <> 'owner'
      and existing_run.principal_id <> authorized_scope.principal_id
    ) then
      raise exception using
        errcode = '42501',
        message = 'DA_OBJECT_FORBIDDEN';
    end if;
    if (
      existing_record.payload_hash <> requested_payload_hash
      or existing_record.command_id <> requested_command_id
      or existing_command.run_id <> requested_run_id
      or existing_run.question <> requested_question
      or existing_command.payload_json <> requested_payload_json
    ) then
      raise exception using
        errcode = '23505',
        message = 'DA_IDEMPOTENCY_CONFLICT';
    end if;

    return pg_catalog.jsonb_build_object(
      'replayed',
      true,
      'run',
      pg_catalog.to_jsonb(existing_run) - 'next_queue_sequence',
      'command',
      pg_catalog.to_jsonb(existing_command)
    );
  end if;

  run_lock_key :=
    'data-agent:run:' ||
    authorized_scope.app_id::text || ':' ||
    authorized_scope.tenant_id::text || ':' ||
    authorized_scope.environment || ':' ||
    requested_run_id::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(run_lock_key, 0)
  );

  if exists (
    select 1
    from app_data_agent.runs as run
    where run.app_id = authorized_scope.app_id
      and run.tenant_id = authorized_scope.tenant_id
      and run.environment = authorized_scope.environment
      and run.run_id = requested_run_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'DA_RUN_ALREADY_EXISTS';
  end if;

  accept_at := pg_catalog.clock_timestamp();

  begin
    insert into app_data_agent.runs (
      app_id,
      tenant_id,
      environment,
      run_id,
      principal_id,
      question,
      next_queue_sequence,
      created_at,
      updated_at
    )
    values (
      authorized_scope.app_id,
      authorized_scope.tenant_id,
      authorized_scope.environment,
      requested_run_id,
      authorized_scope.principal_id,
      requested_question,
      2,
      accept_at,
      accept_at
    )
    returning * into created_run;
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'DA_RUN_ALREADY_EXISTS';
  end;

  begin
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
      created_at
    )
    values (
      authorized_scope.app_id,
      authorized_scope.tenant_id,
      authorized_scope.environment,
      requested_command_id,
      requested_run_id,
      authorized_scope.principal_id,
      requested_idempotency_key,
      requested_payload_json,
      requested_payload_hash,
      accept_at
    )
    returning * into created_command;
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'DA_COMMAND_IDENTITY_CONFLICT';
  end;

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
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    authorized_scope.principal_id,
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
    created_at
  )
  values (
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    pg_catalog.gen_random_uuid(),
    requested_run_id,
    1,
    'command.accepted',
    pg_catalog.jsonb_build_object(
      'commandId',
      requested_command_id,
      'payloadHash',
      requested_payload_hash
    ),
    accept_at
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
    queue_sequence,
    available_at,
    created_at
  )
  values (
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    pg_catalog.gen_random_uuid(),
    requested_run_id,
    requested_command_id,
    'run.command.accepted',
    pg_catalog.jsonb_build_object(
      'appId',
      authorized_scope.app_id,
      'tenantId',
      authorized_scope.tenant_id,
      'environment',
      authorized_scope.environment,
      'runId',
      requested_run_id,
      'commandId',
      requested_command_id,
      'payloadHash',
      requested_payload_hash
    ),
    1,
    accept_at,
    accept_at
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
  values
    (
      authorized_scope.app_id,
      authorized_scope.tenant_id,
      authorized_scope.environment,
      pg_catalog.gen_random_uuid(),
      authorized_scope.principal_id,
      'RUN_CREATED',
      'run',
      requested_run_id::text,
      pg_catalog.jsonb_build_object('source', 'accept_run_command'),
      accept_at
    ),
    (
      authorized_scope.app_id,
      authorized_scope.tenant_id,
      authorized_scope.environment,
      pg_catalog.gen_random_uuid(),
      authorized_scope.principal_id,
      'COMMAND_SUBMITTED',
      'command',
      requested_command_id::text,
      pg_catalog.jsonb_build_object(
        'runId',
        requested_run_id,
        'idempotencyKey',
        requested_idempotency_key,
        'payloadHash',
        requested_payload_hash
      ),
      accept_at
    );

  return pg_catalog.jsonb_build_object(
    'replayed',
    false,
    'run',
    pg_catalog.to_jsonb(created_run) - 'next_queue_sequence',
    'command',
    pg_catalog.to_jsonb(created_command)
  );
end
$$;


create or replace function api.data_agent__get_run(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorized_scope record;
  selected_run app_data_agent.runs%rowtype;
begin
  select *
  into authorized_scope
  from platform.authorize_browser_context(
    requested_deployment_id,
    requested_tenant_id,
    false
  );

  select run.*
  into selected_run
  from app_data_agent.runs as run
  where run.app_id = authorized_scope.app_id
    and run.tenant_id = authorized_scope.tenant_id
    and run.environment = authorized_scope.environment
    and run.run_id = requested_run_id
    and (
      authorized_scope.membership_role = 'owner'
      or run.principal_id = authorized_scope.principal_id
    );
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_NOT_FOUND';
  end if;

  return pg_catalog.to_jsonb(selected_run) - 'next_queue_sequence';
end
$$;


grant execute on function api.data_agent__get_run(
  uuid,
  uuid,
  uuid
) to authenticated, data_agent_backend;

commit;
