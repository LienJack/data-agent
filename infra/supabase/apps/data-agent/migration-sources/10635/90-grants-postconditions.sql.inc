-- ============================================================
-- 10635: Hardening and executable postconditions
-- ============================================================

revoke all on function app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)
  from public, anon, authenticated, service_role, data_agent_backend;

do $postconditions$
begin
  if pg_catalog.to_regprocedure(
    'app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)'
  ) is null then
    raise exception using errcode = 'P0001', message = 'SUPERADMIN_EMAIL_SYNC_FUNCTION_MISSING';
  end if;
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.sync_local_super_admin_credentials(uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'SUPERADMIN_EMAIL_SYNC_FUNCTION_EXPOSED';
  end if;
end
$postconditions$;
