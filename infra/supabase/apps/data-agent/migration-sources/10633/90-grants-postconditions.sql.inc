-- ============================================================
-- 10633: Exact execution grants and private raw relations
-- ============================================================

alter function platform.list_admin_users(uuid, uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_admin_workspaces(uuid, uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.list_workspace_members(uuid, uuid, uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.read_operations_health(uuid, uuid)
  owner to data_agent_identity_rpc_owner;

revoke all on function platform.list_admin_users(uuid, uuid) from public;
revoke all on function platform.list_admin_workspaces(uuid, uuid) from public;
revoke all on function platform.list_workspace_members(uuid, uuid, uuid) from public;
revoke all on function platform.read_operations_health(uuid, uuid) from public;

grant execute on function platform.list_admin_users(uuid, uuid) to data_agent_backend;
grant execute on function platform.list_admin_workspaces(uuid, uuid) to data_agent_backend;
grant execute on function platform.list_workspace_members(uuid, uuid, uuid)
  to data_agent_backend;
grant execute on function platform.read_operations_health(uuid, uuid)
  to data_agent_backend;

do $postconditions$
declare
  function_name text;
  function_record record;
begin
  foreach function_name in array array[
    'list_admin_users',
    'list_admin_workspaces',
    'list_workspace_members',
    'read_operations_health'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'platform'
      and procedure.proname = function_name;
    if not found
      or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_identity_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',')
        not in ('search_path=', 'search_path=""')
    then
      raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.list_admin_users(uuid,uuid)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.list_admin_workspaces(uuid,uuid)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.list_workspace_members(uuid,uuid,uuid)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend', 'platform.read_operations_health(uuid,uuid)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_RPC_GRANT_MISSING';
  end if;

  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.app_users', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.workspaces', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.model_bills', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.credit_accounts', 'SELECT'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_RAW_RELATION_EXPOSED';
  end if;
end
$postconditions$;
