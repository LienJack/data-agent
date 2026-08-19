-- ============================================================
-- 10634: Hardening and executable postconditions
-- ============================================================

alter function platform.list_admin_users(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function platform.list_workspace_members(uuid,uuid,uuid) owner to data_agent_identity_rpc_owner;
revoke all on function app_data_agent.bind_new_app_user_username() from public;
revoke all on function app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)
  from public, anon, authenticated, service_role, data_agent_backend;

do $postconditions$
begin
  if pg_catalog.to_regprocedure(
    'app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)'
  ) is null then
    raise exception using errcode = 'P0001', message = 'USERNAME_LOGIN_SYNC_FUNCTION_MISSING';
  end if;
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'USERNAME_LOGIN_SYNC_FUNCTION_EXPOSED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid=attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='data_agent_auth' and relation.relname='user'
      and attribute.attname='username' and not attribute.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid=attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent' and relation.relname='app_users'
      and attribute.attname='username' and not attribute.attisdropped
  ) then
    raise exception using errcode = 'P0001', message = 'USERNAME_LOGIN_COLUMN_MISSING';
  end if;
end
$postconditions$;
