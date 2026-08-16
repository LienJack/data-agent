alter table app_data_agent.model_provider_connections owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_provider_connection_versions owner to data_agent_identity_rpc_owner;
alter function platform.list_model_provider_connections(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;

alter table app_data_agent.model_provider_connections enable row level security;
alter table app_data_agent.model_provider_connections force row level security;
create policy model_provider_connections_pricing_rpc_policy
  on app_data_agent.model_provider_connections for all to data_agent_identity_rpc_owner
  using (true) with check (true);
alter table app_data_agent.model_provider_connection_versions enable row level security;
alter table app_data_agent.model_provider_connection_versions force row level security;
create policy model_provider_connection_versions_pricing_rpc_policy
  on app_data_agent.model_provider_connection_versions for all to data_agent_identity_rpc_owner
  using (true) with check (true);

grant select, insert, update, delete on table
  app_data_agent.model_provider_connections,
  app_data_agent.model_provider_connection_versions
to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.model_provider_connections,
  app_data_agent.model_provider_connection_versions
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function platform.list_model_provider_connections(uuid,uuid) from public;
revoke all on function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb) from public;

grant execute on function platform.list_model_provider_connections(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)
  to data_agent_backend;

do $postconditions$
begin
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.model_provider_connections',
    'SELECT,INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_BACKEND_TABLE_ACL_FAILED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'app_data_agent.model_catalog_entries'::regclass
      and attname = 'provider_connection_id' and not attisdropped
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_CATALOG_LINK_MISSING';
  end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_backend', 'app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_SELECTION_GRANT_MISSING';
  end if;
end
$postconditions$;
