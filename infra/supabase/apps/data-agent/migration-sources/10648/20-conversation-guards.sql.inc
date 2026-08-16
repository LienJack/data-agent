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
