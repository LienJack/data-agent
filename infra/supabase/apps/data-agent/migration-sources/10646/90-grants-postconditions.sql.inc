revoke all on app_data_agent.falcon_import_receipts
from public, anon, authenticated, service_role, data_agent_backend;
grant select on app_data_agent.falcon_import_receipts to data_agent_backend;
revoke all on function app_data_agent.record_falcon_import_receipt(jsonb)
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.configure_falcon_demo_reader(text)
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.reject_falcon_import_receipt_mutation()
from public, anon, authenticated, service_role, data_agent_backend;

do $postconditions$
begin
  if pg_catalog.has_function_privilege(
    'data_agent_backend', 'app_data_agent.record_falcon_import_receipt(jsonb)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend', 'app_data_agent.configure_falcon_demo_reader(text)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'FALCON_BOOTSTRAP_FUNCTION_EXPOSED';
  end if;
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.falcon_import_receipts', 'INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'FALCON_IMPORT_RECEIPT_MUTABLE';
  end if;
end
$postconditions$;
