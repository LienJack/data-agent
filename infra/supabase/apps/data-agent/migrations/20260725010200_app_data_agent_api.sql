begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010200_app_data_agent_api',
  'sha256:bdd07a8f7e636f1d7841d7579f778f1778523c5fd2fc7d38bfa9c0c42ae734f3'
);

create or replace function api.data_agent__begin_request_context(
  requested_deployment_id uuid,
  requested_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorized_scope record;
begin
  select *
  into authorized_scope
  from platform.authorize_browser_context(
    requested_deployment_id,
    requested_tenant_id,
    false
  );

  return pg_catalog.jsonb_build_object(
    'appId', authorized_scope.app_id,
    'tenantId', authorized_scope.tenant_id,
    'environment', authorized_scope.environment,
    'principalId', authorized_scope.principal_id,
    'role', authorized_scope.membership_role,
    'deploymentId', authorized_scope.deployment_id
  );
end
$$;

create or replace function api.data_agent__create_run(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_run_id uuid,
  requested_question text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorized_scope record;
  created_run app_data_agent.runs%rowtype;
begin
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
  then
    raise exception using
      errcode = '22023',
      message = 'DA_COMMAND_PAYLOAD_INVALID';
  end if;

  insert into app_data_agent.runs (
    app_id,
    tenant_id,
    environment,
    run_id,
    principal_id,
    question
  )
  values (
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    requested_run_id,
    authorized_scope.principal_id,
    requested_question
  )
  returning * into created_run;

  insert into app_data_agent.audit_log (
    app_id,
    tenant_id,
    environment,
    audit_id,
    principal_id,
    action,
    resource_type,
    resource_id,
    details
  )
  values (
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    pg_catalog.gen_random_uuid(),
    authorized_scope.principal_id,
    'RUN_CREATED',
    'run',
    requested_run_id::text,
    pg_catalog.jsonb_build_object('source', 'api')
  );

  return pg_catalog.to_jsonb(created_run);
end
$$;

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
begin
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
      pg_catalog.to_jsonb(existing_run),
      'command',
      pg_catalog.to_jsonb(existing_command)
    );
  end if;

  insert into app_data_agent.runs (
    app_id,
    tenant_id,
    environment,
    run_id,
    principal_id,
    question
  )
  values (
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    requested_run_id,
    authorized_scope.principal_id,
    requested_question
  )
  returning * into created_run;

  insert into app_data_agent.commands (
    app_id,
    tenant_id,
    environment,
    command_id,
    run_id,
    principal_id,
    idempotency_key,
    payload_json,
    payload_hash
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
    requested_payload_hash
  )
  returning * into created_command;

  insert into app_data_agent.idempotency_records (
    app_id,
    tenant_id,
    environment,
    principal_id,
    idempotency_key,
    command_id,
    payload_hash
  )
  values (
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    authorized_scope.principal_id,
    requested_idempotency_key,
    requested_command_id,
    requested_payload_hash
  );

  insert into app_data_agent.run_events (
    app_id,
    tenant_id,
    environment,
    event_id,
    run_id,
    sequence,
    event_type,
    payload_json
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
    )
  );

  insert into app_data_agent.outbox (
    app_id,
    tenant_id,
    environment,
    outbox_id,
    run_id,
    command_id,
    topic,
    payload_json
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
    )
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
    details
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
      pg_catalog.jsonb_build_object('source', 'accept_run_command')
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
      )
    );

  return pg_catalog.jsonb_build_object(
    'replayed',
    false,
    'run',
    pg_catalog.to_jsonb(created_run),
    'command',
    pg_catalog.to_jsonb(created_command)
  );
end
$$;

create or replace function api.data_agent__submit_command(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_command_id uuid,
  requested_run_id uuid,
  requested_idempotency_key text,
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
  created_command app_data_agent.commands%rowtype;
  target_run app_data_agent.runs%rowtype;
  next_sequence bigint;
  idempotency_lock_key text;
begin
  select *
  into authorized_scope
  from platform.authorize_browser_context(
    requested_deployment_id,
    requested_tenant_id,
    true
  );

  if requested_payload_json is null
    or pg_catalog.jsonb_typeof(requested_payload_json) <> 'object'
    or requested_payload_hash is distinct from
      platform.canonical_sha256(requested_payload_json)
    or not app_data_agent.command_payload_is_valid(requested_payload_json)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_COMMAND_PAYLOAD_INVALID';
  end if;

  select run.*
  into target_run
  from app_data_agent.runs as run
  where run.app_id = authorized_scope.app_id
    and run.tenant_id = authorized_scope.tenant_id
    and run.environment = authorized_scope.environment
    and run.run_id = requested_run_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_NOT_FOUND';
  end if;
  if (
    authorized_scope.membership_role <> 'owner'
    and target_run.principal_id <> authorized_scope.principal_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_OBJECT_FORBIDDEN';
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

    if (
      existing_record.payload_hash <> requested_payload_hash
      or existing_record.command_id <> requested_command_id
      or existing_command.run_id <> requested_run_id
      or existing_command.payload_json <> requested_payload_json
    ) then
      raise exception using
        errcode = '23505',
        message = 'DA_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.to_jsonb(existing_command);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'data-agent:run-event:' ||
      authorized_scope.app_id::text || ':' ||
      authorized_scope.tenant_id::text || ':' ||
      authorized_scope.environment || ':' ||
      requested_run_id::text,
      0
    )
  );

  insert into app_data_agent.commands (
    app_id,
    tenant_id,
    environment,
    command_id,
    run_id,
    principal_id,
    idempotency_key,
    payload_json,
    payload_hash
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
    requested_payload_hash
  )
  returning * into created_command;

  insert into app_data_agent.idempotency_records (
    app_id,
    tenant_id,
    environment,
    principal_id,
    idempotency_key,
    command_id,
    payload_hash
  )
  values (
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    authorized_scope.principal_id,
    requested_idempotency_key,
    requested_command_id,
    requested_payload_hash
  );

  select coalesce(pg_catalog.max(event.sequence), 0) + 1
  into next_sequence
  from app_data_agent.run_events as event
  where event.app_id = authorized_scope.app_id
    and event.tenant_id = authorized_scope.tenant_id
    and event.environment = authorized_scope.environment
    and event.run_id = requested_run_id;

  insert into app_data_agent.run_events (
    app_id,
    tenant_id,
    environment,
    event_id,
    run_id,
    sequence,
    event_type,
    payload_json
  )
  values (
    authorized_scope.app_id,
    authorized_scope.tenant_id,
    authorized_scope.environment,
    pg_catalog.gen_random_uuid(),
    requested_run_id,
    next_sequence,
    'command.accepted',
    pg_catalog.jsonb_build_object(
      'commandId',
      requested_command_id,
      'payloadHash',
      requested_payload_hash
    )
  );

  insert into app_data_agent.outbox (
    app_id,
    tenant_id,
    environment,
    outbox_id,
    run_id,
    command_id,
    topic,
    payload_json
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
    )
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
    details
  )
  values (
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
    )
  );

  return pg_catalog.to_jsonb(created_command);
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
    and run.run_id = requested_run_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_NOT_FOUND';
  end if;
  if (
    authorized_scope.membership_role <> 'owner'
    and selected_run.principal_id <> authorized_scope.principal_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_OBJECT_FORBIDDEN';
  end if;

  return pg_catalog.to_jsonb(selected_run);
end
$$;

create or replace function api.data_agent__list_demo_cases()
returns table (
  eval_case_id uuid,
  benchmark_suite text,
  case_key text,
  prompt text,
  dataset_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  authenticated_principal uuid;
  demo_app_id uuid;
  demo_tenant_id uuid;
  demo_environment text;
begin
  authenticated_principal := auth.uid();
  if authenticated_principal is null then
    raise exception using
      errcode = '42501',
      message = 'DA_DEMO_AUTH_REQUIRED';
  end if;

  select demo.app_id, demo.tenant_id, demo.environment
  into demo_app_id, demo_tenant_id, demo_environment
  from platform.demo_principals as demo
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = demo.app_id
   and lifecycle.environment = demo.environment
  join platform.deployment_mappings as deployment
    on deployment.app_id = demo.app_id
   and deployment.environment = demo.environment
  join app_data_agent.memberships as membership
    on membership.app_id = demo.app_id
   and membership.tenant_id = demo.tenant_id
   and membership.environment = demo.environment
   and membership.principal_id = demo.principal_id
  where demo.principal_id = authenticated_principal
    and demo.is_active
    and deployment.is_active
    and lifecycle.lifecycle_state <> 'DELETED'
    and membership.membership_role = 'demo'
    and membership.revoked_at is null
  order by deployment.created_at
  limit 1;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'DA_DEMO_FORBIDDEN';
  end if;

  return query
  select
    eval_case.eval_case_id,
    eval_case.benchmark_suite,
    eval_case.case_key,
    eval_case.prompt,
    dataset.dataset_name
  from app_data_agent.eval_cases as eval_case
  join app_data_agent.datasets as dataset
    on dataset.app_id = eval_case.app_id
   and dataset.tenant_id = eval_case.tenant_id
   and dataset.environment = eval_case.environment
   and dataset.dataset_id = eval_case.dataset_id
  where eval_case.app_id = demo_app_id
    and eval_case.tenant_id = demo_tenant_id
    and eval_case.environment = demo_environment
    and eval_case.is_demo_eligible
    and dataset.data_classification = 'SYNTHETIC'
  order by eval_case.benchmark_suite, eval_case.case_key;
end
$$;

create view api.data_agent__runs
with (security_invoker = true)
as
select
  run.app_id,
  run.tenant_id,
  run.environment,
  run.run_id,
  run.principal_id,
  run.status,
  run.active_fence,
  run.question,
  run.created_at,
  run.updated_at
from app_data_agent.runs as run;

select platform.register_api_operation(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'begin_request_context',
  'data_agent__begin_request_context'
);
select platform.register_api_operation(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'create_run',
  'data_agent__create_run'
);
select platform.register_api_operation(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'accept_run_command',
  'data_agent__accept_run_command'
);
select platform.register_api_operation(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'submit_command',
  'data_agent__submit_command'
);
select platform.register_api_operation(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'get_run',
  'data_agent__get_run'
);
select platform.register_api_operation(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'list_demo_cases',
  'data_agent__list_demo_cases'
);
select platform.register_api_operation(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'runs',
  'data_agent__runs'
);

revoke all privileges on function api.data_agent__begin_request_context(
  uuid,
  uuid
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function api.data_agent__create_run(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function api.data_agent__accept_run_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function api.data_agent__submit_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function api.data_agent__get_run(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function api.data_agent__list_demo_cases()
from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on table api.data_agent__runs
from public, anon, authenticated, service_role, data_agent_backend;

grant execute on function api.data_agent__begin_request_context(
  uuid,
  uuid
) to authenticated, data_agent_backend;
grant execute on function api.data_agent__accept_run_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text
) to authenticated;
grant execute on function api.data_agent__submit_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text
) to authenticated, data_agent_backend;
grant execute on function api.data_agent__get_run(
  uuid,
  uuid,
  uuid
) to authenticated, data_agent_backend;
grant execute on function api.data_agent__list_demo_cases()
to anon, authenticated;
grant select on table api.data_agent__runs to data_agent_backend;

commit;
