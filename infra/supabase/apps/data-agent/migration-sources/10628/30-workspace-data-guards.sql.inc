-- ============================================================
-- 10628: Datasource freeze, active binding and immutable attribution guards
-- ============================================================

create function app_data_agent.workspace_command_payload_is_valid(
  requested_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if requested_payload is null
    or pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or not app_data_agent.command_payload_is_valid(
      requested_payload - 'datasource_id' - 'conversation_id'
    )
  then
    return false;
  end if;
  if requested_payload ? 'datasource_id' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'datasource_id') <> 'string'
    or not (requested_payload ->> 'datasource_id' ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ) then
    return false;
  end if;
  if requested_payload ? 'conversation_id' and (
    not (requested_payload ? 'datasource_id')
    or pg_catalog.jsonb_typeof(requested_payload -> 'conversation_id') <> 'string'
    or not (requested_payload ->> 'conversation_id' ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ) then
    return false;
  end if;
  return true;
end
$function$;

revoke all on function app_data_agent.workspace_command_payload_is_valid(jsonb) from public;
grant execute on function app_data_agent.workspace_command_payload_is_valid(jsonb)
  to data_agent_backend;

alter table app_data_agent.commands drop constraint commands_payload_json_check;
alter table app_data_agent.commands
  add constraint commands_workspace_payload_check
  check (app_data_agent.workspace_command_payload_is_valid(payload_json));

create function app_data_agent.guard_qa_conversation_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
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
  if new.datasource_id is distinct from old.datasource_id then
    if old.datasource_id is not null or exists (
      select 1
      from app_data_agent.qa_messages as message
      where message.app_id = old.app_id
        and message.tenant_id = old.tenant_id
        and message.environment = old.environment
        and message.conversation_id = old.conversation_id
    ) then
      raise exception using errcode = '23514', message = 'CONVERSATION_DATASOURCE_FROZEN';
    end if;
    if not exists (
      select 1
      from app_data_agent.datasource_connections as datasource
      where datasource.app_id = new.app_id
        and datasource.tenant_id = new.tenant_id
        and datasource.environment = new.environment
        and datasource.datasource_id = new.datasource_id
        and datasource.status = 'ACTIVE'
    ) then
      raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
    end if;
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end
$function$;

create trigger qa_conversation_update_guard
before update on app_data_agent.qa_conversations
for each row execute function app_data_agent.guard_qa_conversation_update();

create function app_data_agent.guard_qa_message_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  bound_datasource_id uuid;
begin
  select conversation.datasource_id
  into bound_datasource_id
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
  if bound_datasource_id is null then
    raise exception using errcode = '23514', message = 'CONVERSATION_DATASOURCE_REQUIRED';
  end if;
  if not exists (
    select 1
    from app_data_agent.datasource_connections as datasource
    where datasource.app_id = new.app_id
      and datasource.tenant_id = new.tenant_id
      and datasource.environment = new.environment
      and datasource.datasource_id = bound_datasource_id
      and datasource.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
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

create trigger qa_message_insert_guard
before insert on app_data_agent.qa_messages
for each row execute function app_data_agent.guard_qa_message_insert();

create function app_data_agent.guard_workspace_run_binding_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from app_data_agent.datasource_connections as datasource
    where datasource.app_id = new.app_id
      and datasource.tenant_id = new.tenant_id
      and datasource.environment = new.environment
      and datasource.datasource_id = new.datasource_id
      and datasource.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;
  return new;
end
$function$;

create trigger workspace_run_binding_insert_guard
before insert on app_data_agent.workspace_run_bindings
for each row execute function app_data_agent.guard_workspace_run_binding_insert();

create function app_data_agent.reject_workspace_data_attribution_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'WORKSPACE_DATA_ATTRIBUTION_IMMUTABLE';
end
$function$;

create trigger workspace_run_bindings_immutable
before update or delete on app_data_agent.workspace_run_bindings
for each row execute function app_data_agent.reject_workspace_data_attribution_mutation();

create trigger qa_messages_immutable
before update on app_data_agent.qa_messages
for each row execute function app_data_agent.reject_workspace_data_attribution_mutation();
