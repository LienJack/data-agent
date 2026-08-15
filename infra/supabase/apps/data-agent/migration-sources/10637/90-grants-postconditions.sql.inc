-- ============================================================
-- 10637: Private receipt and bootstrap authority
-- ============================================================

revoke all on app_data_agent.demo_workspace_receipts
from public, anon, authenticated, service_role, data_agent_backend, data_agent_ecommerce_readonly;
grant select on app_data_agent.demo_workspace_receipts to data_agent_backend;
revoke all on function app_data_agent.configure_ecommerce_demo_reader(text)
from public, anon, authenticated, service_role, data_agent_backend, data_agent_ecommerce_readonly;

do $postconditions$
begin
  if pg_catalog.has_function_privilege(
    'data_agent_backend', 'app_data_agent.configure_ecommerce_demo_reader(text)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_READER_FUNCTION_EXPOSED';
  end if;
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.demo_workspace_receipts', 'INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_WORKSPACE_RECEIPT_MUTABLE';
  end if;
end
$postconditions$;
