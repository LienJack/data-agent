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
    '{"kind":"START_QA_ANALYSIS","datasource_id":"00000000-0000-4000-8000-00000000fa01","conversation_id":"00000000-0000-4000-8000-00000000fa04","message_id":"00000000-0000-4000-8000-00000000fa05","model_profile_id":"00000000-0000-4000-8000-00000000fa06","model_config_version":1,"provider":"deepseek","model_id":"deepseek-v4-pro","datasource_binding_hash":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb
  ) then raise exception using errcode = 'P0001', message = 'QA_COMMAND_PAYLOAD_REJECTED'; end if;
end
$postconditions$;
