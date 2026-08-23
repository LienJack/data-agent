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
