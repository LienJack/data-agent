-- qa_resource_binding_migration_checksum: sha256:46a31d3aa374ae7ecf5619c6c7a8f081a30d9c373c5d4e85f33cfcfb56b5ab10
-- ============================================================
-- 10648: Q&A conversation resources and immutable Run snapshots
-- Depends on: 20260725010647_app_data_agent_workspace_command_payload
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'QA_RESOURCE_BINDING_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'QA_RESOURCE_BINDING_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010647_app_data_agent_workspace_command_payload'
  ) then
    raise exception using errcode = 'P0001', message = 'QA_RESOURCE_BINDING_BASELINE_10647_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
alter table app_data_agent.qa_conversations
  add column model_profile_id uuid,
  add column resource_version bigint not null default 1 check (resource_version >= 1);

update app_data_agent.qa_conversations as conversation
set model_profile_id = conversation.model_id::uuid
where conversation.model_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from app_data_agent.model_catalog_entries as catalog
    where catalog.app_id = conversation.app_id
      and catalog.environment = conversation.environment
      and catalog.model_profile_id = conversation.model_id::uuid
  );

alter table app_data_agent.qa_conversations
  add constraint qa_conversations_model_profile_fk
  foreign key (app_id, environment, model_profile_id)
  references app_data_agent.model_catalog_entries (app_id, environment, model_profile_id)
  on delete restrict;

alter table app_data_agent.workspace_run_bindings
  add column model_profile_id uuid,
  add column model_config_version bigint check (model_config_version is null or model_config_version >= 1),
  add column provider text check (
    provider is null or provider in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')
  ),
  add column model_id text check (
    model_id is null or pg_catalog.length(pg_catalog.btrim(model_id)) between 1 and 256
  ),
  add column datasource_binding_hash text check (
    datasource_binding_hash is null or datasource_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint workspace_run_bindings_model_snapshot_complete check (
    pg_catalog.num_nonnulls(
      model_profile_id, model_config_version, provider, model_id, datasource_binding_hash
    ) in (0, 5)
  ),
  add constraint workspace_run_bindings_model_config_fk
  foreign key (app_id, environment, model_profile_id, model_config_version)
  references app_data_agent.model_config_versions (
    app_id, environment, model_profile_id, config_version
  ) on delete restrict;

create table app_data_agent.qa_resource_switch_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 128),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_json jsonb not null check (
    pg_catalog.jsonb_typeof(result_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(result_json)
  ),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, principal_id, idempotency_key)
);

revoke all on table app_data_agent.qa_resource_switch_operations from public;
create or replace function app_data_agent.guard_qa_conversation_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  resources_changed boolean;
begin
  if new.app_id <> old.app_id
    or new.tenant_id <> old.tenant_id
    or new.environment <> old.environment
    or new.conversation_id <> old.conversation_id
    or new.owner_principal_id <> old.owner_principal_id
    or new.created_at <> old.created_at
  then
    raise exception using errcode = '42501', message = 'CONVERSATION_SCOPE_IMMUTABLE';
  end if;

  resources_changed := new.datasource_id is distinct from old.datasource_id
    or new.model_profile_id is distinct from old.model_profile_id
    or new.model_id is distinct from old.model_id;

  if resources_changed then
    if exists (
      select 1 from app_data_agent.qa_messages as message
      where message.app_id = old.app_id
        and message.tenant_id = old.tenant_id
        and message.environment = old.environment
        and message.conversation_id = old.conversation_id
    ) then
      raise exception using errcode = '23514', message = 'CONVERSATION_RESOURCES_FROZEN';
    end if;
    if new.datasource_id is null or not exists (
      select 1 from app_data_agent.datasource_connections as datasource
      where datasource.app_id = new.app_id
        and datasource.tenant_id = new.tenant_id
        and datasource.environment = new.environment
        and datasource.datasource_id = new.datasource_id
        and datasource.status = 'ACTIVE'
    ) then
      raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
    end if;
    if new.model_profile_id is null or new.model_id is distinct from new.model_profile_id::text
      or not exists (
        select 1 from platform.list_active_model_catalog(
          nullif(pg_catalog.current_setting('data_agent.deployment_id', true), '')::uuid,
          nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
        ) as catalog
        where catalog.app_id = new.app_id
          and catalog.environment = new.environment
          and catalog.model_profile_id = new.model_profile_id
          and catalog.status = 'ACTIVE'
      )
    then
      raise exception using errcode = '23503', message = 'MODEL_PROFILE_NOT_AVAILABLE';
    end if;
    if new.resource_version <> old.resource_version + 1 then
      raise exception using errcode = '40001', message = 'CONVERSATION_RESOURCE_VERSION_CONFLICT';
    end if;
  elsif new.resource_version <> old.resource_version then
    raise exception using errcode = '42501', message = 'CONVERSATION_RESOURCE_VERSION_IMMUTABLE';
  end if;

  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end
$function$;

create or replace function app_data_agent.guard_qa_message_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  bound_datasource_id uuid;
  bound_model_profile_id uuid;
begin
  select conversation.datasource_id, conversation.model_profile_id
  into bound_datasource_id, bound_model_profile_id
  from app_data_agent.qa_conversations as conversation
  where conversation.app_id = new.app_id
    and conversation.tenant_id = new.tenant_id
    and conversation.environment = new.environment
    and conversation.conversation_id = new.conversation_id
    and conversation.owner_principal_id = new.owner_principal_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CONVERSATION_NOT_FOUND_OR_DENIED';
  end if;
  if bound_datasource_id is null or bound_model_profile_id is null then
    raise exception using errcode = '23514', message = 'CONVERSATION_RESOURCES_REQUIRED';
  end if;
  if not exists (
    select 1 from app_data_agent.datasource_connections as datasource
    where datasource.app_id = new.app_id
      and datasource.tenant_id = new.tenant_id
      and datasource.environment = new.environment
      and datasource.datasource_id = bound_datasource_id
      and datasource.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;
  if not exists (
    select 1 from platform.list_active_model_catalog(
      nullif(pg_catalog.current_setting('data_agent.deployment_id', true), '')::uuid,
      nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
    ) as catalog
    where catalog.app_id = new.app_id
      and catalog.environment = new.environment
      and catalog.model_profile_id = bound_model_profile_id
      and catalog.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'MODEL_PROFILE_NOT_AVAILABLE';
  end if;
  update app_data_agent.qa_conversations as conversation
  set updated_at = pg_catalog.clock_timestamp()
  where conversation.app_id = new.app_id
    and conversation.tenant_id = new.tenant_id
    and conversation.environment = new.environment
    and conversation.conversation_id = new.conversation_id;
  return new;
end
$function$;

create or replace function app_data_agent.guard_workspace_run_binding_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from app_data_agent.datasource_connections as datasource
    where datasource.app_id = new.app_id
      and datasource.tenant_id = new.tenant_id
      and datasource.environment = new.environment
      and datasource.datasource_id = new.datasource_id
      and datasource.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;
  if new.model_profile_id is not null and not exists (
    select 1
    from platform.list_active_model_catalog(
      nullif(pg_catalog.current_setting('data_agent.deployment_id', true), '')::uuid,
      nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
    ) as catalog
    where catalog.app_id = new.app_id
      and catalog.environment = new.environment
      and catalog.model_profile_id = new.model_profile_id
      and catalog.config_version = new.model_config_version
      and catalog.provider = new.provider
      and catalog.model_id = new.model_id
      and catalog.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'RUN_MODEL_BINDING_INVALID';
  end if;
  if new.conversation_id is not null and new.model_profile_id is not null and not exists (
    select 1
    from app_data_agent.qa_conversations as conversation
    where conversation.app_id = new.app_id
      and conversation.tenant_id = new.tenant_id
      and conversation.environment = new.environment
      and conversation.conversation_id = new.conversation_id
      and conversation.owner_principal_id = new.principal_id
      and conversation.datasource_id = new.datasource_id
      and conversation.model_profile_id = new.model_profile_id
  ) then
    raise exception using errcode = '23514', message = 'RUN_CONVERSATION_RESOURCE_MISMATCH';
  end if;
  return new;
end
$function$;
create function app_data_agent.switch_qa_conversation_resources(command jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $function$
declare
  scope_app_id uuid := nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid;
  scope_tenant_id uuid := nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid;
  scope_environment text := nullif(pg_catalog.current_setting('data_agent.environment', true), '');
  scope_principal_id uuid := nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid;
  input_hash text;
  existing_operation app_data_agent.qa_resource_switch_operations%rowtype;
  current_conversation app_data_agent.qa_conversations%rowtype;
  result_conversation app_data_agent.qa_conversations%rowtype;
  message_count bigint;
  result_json jsonb;
  result_kind text;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE')
    or scope_app_id is null or scope_tenant_id is null
    or scope_environment is null or scope_principal_id is null
  then
    raise exception using errcode = '42501', message = 'APP_CAPABILITY_REQUIRED';
  end if;
  if command is null or pg_catalog.jsonb_typeof(command) <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command)) <> 7
    or command ->> 'schema_version' <> 'qa-conversation-resource-switch@1.0.0'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
  then
    raise exception using errcode = '22023', message = 'CONVERSATION_RESOURCE_SWITCH_INVALID';
  end if;

  input_hash := platform.canonical_sha256(command);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(scope_app_id, scope_tenant_id, scope_environment,
      scope_principal_id, command ->> 'idempotency_key')::text, 0
  ));
  select * into existing_operation
  from app_data_agent.qa_resource_switch_operations as operation
  where operation.app_id = scope_app_id
    and operation.tenant_id = scope_tenant_id
    and operation.environment = scope_environment
    and operation.principal_id = scope_principal_id
    and operation.idempotency_key = command ->> 'idempotency_key'
  for update;
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'CONVERSATION_RESOURCE_SWITCH_CONFLICT';
    end if;
    return existing_operation.result_json;
  end if;

  select * into current_conversation
  from app_data_agent.qa_conversations as conversation
  where conversation.app_id = scope_app_id
    and conversation.tenant_id = scope_tenant_id
    and conversation.environment = scope_environment
    and conversation.conversation_id = (command ->> 'conversation_id')::uuid
    and conversation.owner_principal_id = scope_principal_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CONVERSATION_NOT_FOUND_OR_DENIED';
  end if;
  if current_conversation.resource_version <> (command ->> 'expected_resource_version')::bigint then
    raise exception using errcode = '40001', message = 'CONVERSATION_RESOURCE_VERSION_CONFLICT';
  end if;
  if not exists (
    select 1 from app_data_agent.datasource_connections as datasource
    where datasource.app_id = scope_app_id
      and datasource.tenant_id = scope_tenant_id
      and datasource.environment = scope_environment
      and datasource.datasource_id = (command ->> 'datasource_id')::uuid
      and datasource.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;
  if not exists (
    select 1 from platform.list_active_model_catalog(
      nullif(pg_catalog.current_setting('data_agent.deployment_id', true), '')::uuid,
      scope_principal_id
    ) as catalog
    where catalog.app_id = scope_app_id
      and catalog.environment = scope_environment
      and catalog.model_profile_id = (command ->> 'model_profile_id')::uuid
      and catalog.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'MODEL_PROFILE_NOT_AVAILABLE';
  end if;

  select pg_catalog.count(*) into message_count
  from app_data_agent.qa_messages as message
  where message.app_id = scope_app_id
    and message.tenant_id = scope_tenant_id
    and message.environment = scope_environment
    and message.conversation_id = current_conversation.conversation_id;

  if message_count = 0 then
    update app_data_agent.qa_conversations as conversation
    set datasource_id = (command ->> 'datasource_id')::uuid,
        model_profile_id = (command ->> 'model_profile_id')::uuid,
        model_id = command ->> 'model_profile_id',
        resource_version = conversation.resource_version + 1
    where conversation.app_id = scope_app_id
      and conversation.tenant_id = scope_tenant_id
      and conversation.environment = scope_environment
      and conversation.conversation_id = current_conversation.conversation_id
    returning * into result_conversation;
    result_kind := 'UPDATED_CURRENT';
  else
    insert into app_data_agent.qa_conversations (
      app_id, tenant_id, environment, conversation_id, owner_principal_id,
      title, datasource_id, model_id, model_profile_id, resource_version
    ) values (
      scope_app_id, scope_tenant_id, scope_environment, pg_catalog.gen_random_uuid(),
      scope_principal_id, current_conversation.title,
      (command ->> 'datasource_id')::uuid, command ->> 'model_profile_id',
      (command ->> 'model_profile_id')::uuid, 1
    ) returning * into result_conversation;
    result_kind := 'CREATED_REPLACEMENT';
  end if;

  result_json := pg_catalog.jsonb_build_object(
    'kind', result_kind,
    'conversation', pg_catalog.jsonb_build_object(
      'schema_version', 'workspace-conversation@1.0.0',
      'workspace_id', result_conversation.tenant_id,
      'conversation_id', result_conversation.conversation_id,
      'owner_principal_id', result_conversation.owner_principal_id,
      'title', result_conversation.title,
      'datasource_id', result_conversation.datasource_id,
      'model_id', result_conversation.model_id,
      'model_profile_id', result_conversation.model_profile_id,
      'resource_version', result_conversation.resource_version,
      'message_count', 0,
      'created_at', result_conversation.created_at,
      'updated_at', result_conversation.updated_at
    )
  );
  if result_kind = 'CREATED_REPLACEMENT' then
    result_json := result_json || pg_catalog.jsonb_build_object(
      'replaced_id', current_conversation.conversation_id
    );
  end if;

  insert into app_data_agent.qa_resource_switch_operations (
    app_id, tenant_id, environment, operation_id, principal_id,
    idempotency_key, input_hash, result_json
  ) values (
    scope_app_id, scope_tenant_id, scope_environment,
    (command ->> 'operation_id')::uuid, scope_principal_id,
    command ->> 'idempotency_key', input_hash, result_json
  );
  return result_json;
end
$function$;

revoke all on function app_data_agent.switch_qa_conversation_resources(jsonb) from public;
grant execute on function app_data_agent.switch_qa_conversation_resources(jsonb) to data_agent_backend;
create or replace function app_data_agent.command_payload_is_valid(requested_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
  payload_kind text;
begin
  if requested_payload is null
    or pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload)
  then return false; end if;
  payload_kind := requested_payload ->> 'kind';
  if payload_kind not in ('START_L2_RESEARCH', 'START_QA_ANALYSIS') then return false; end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(requested_payload) as payload_key(key)
    where payload_key.key not in (
      'kind','mode','question_version','dataset_id','secret_refs','datasource_id',
      'conversation_id','message_id','model_profile_id','model_config_version',
      'provider','model_id','datasource_binding_hash'
    )
  ) then return false; end if;
  if payload_kind = 'START_QA_ANALYSIS' and not (
    requested_payload ?& array[
      'datasource_id','conversation_id','message_id','model_profile_id',
      'model_config_version','provider','model_id','datasource_binding_hash'
    ]
  ) then return false; end if;
  if requested_payload ? 'mode' and requested_payload ->> 'mode' <> 'L2' then return false; end if;
  if requested_payload ? 'secret_refs' then
    if pg_catalog.jsonb_typeof(requested_payload -> 'secret_refs') <> 'array'
      or pg_catalog.jsonb_array_length(requested_payload -> 'secret_refs') not between 1 and 32
    then return false; end if;
    for item in select value from pg_catalog.jsonb_array_elements(requested_payload -> 'secret_refs')
    loop
      if item #>> '{}' !~* '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then return false; end if;
    end loop;
  end if;
  if requested_payload ? 'datasource_id' and requested_payload ->> 'datasource_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'conversation_id' and requested_payload ->> 'conversation_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'message_id' and requested_payload ->> 'message_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_profile_id' and requested_payload ->> 'model_profile_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_config_version' and requested_payload ->> 'model_config_version'
    !~ '^[1-9][0-9]*$'
  then return false; end if;
  if requested_payload ? 'provider' and requested_payload ->> 'provider'
    not in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')
  then return false; end if;
  if requested_payload ? 'model_id' and pg_catalog.length(requested_payload ->> 'model_id') not between 1 and 256
  then return false; end if;
  if requested_payload ? 'datasource_binding_hash' and requested_payload ->> 'datasource_binding_hash'
    !~ '^sha256:[0-9a-f]{64}$'
  then return false; end if;
  return true;
end
$function$;
alter table app_data_agent.qa_resource_switch_operations enable row level security;
alter table app_data_agent.qa_resource_switch_operations force row level security;

create policy qa_resource_switch_operations_backend_scope
  on app_data_agent.qa_resource_switch_operations for all to data_agent_backend
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
  );

grant select, insert, update on table app_data_agent.qa_resource_switch_operations to data_agent_backend;

do $postconditions$
begin
  if not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.qa_resource_switch_operations', 'SELECT'
  ) or not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.qa_resource_switch_operations', 'INSERT'
  ) or not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.qa_resource_switch_operations', 'UPDATE'
  ) then
    raise exception using errcode = 'P0001', message = 'QA_RESOURCE_SWITCH_ACL_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'app_data_agent.qa_conversations'::regclass
      and attname = 'model_profile_id' and not attisdropped
  ) then raise exception using errcode = 'P0001', message = 'QA_MODEL_PROFILE_COLUMN_MISSING'; end if;
  if not app_data_agent.command_payload_is_valid(
    '{"kind":"START_QA_ANALYSIS","datasource_id":"00000000-0000-4000-8000-00000000fa01","conversation_id":"00000000-0000-4000-8000-00000000fa04","message_id":"00000000-0000-4000-8000-00000000fa05","model_profile_id":"00000000-0000-4000-8000-00000000fa06","model_config_version":1,"provider":"deepseek","model_id":"deepseek-v4-pro","datasource_binding_hash":"sha256:46a31d3aa374ae7ecf5619c6c7a8f081a30d9c373c5d4e85f33cfcfb56b5ab10"}'::jsonb
  ) then raise exception using errcode = 'P0001', message = 'QA_COMMAND_PAYLOAD_REJECTED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010648_app_data_agent_qa_resource_binding',
  'sha256:0000000000000000000000000000000000000000000000000000000000000000'
);

commit;
