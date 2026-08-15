-- ============================================================
-- 10636: Least privilege and executable closure checks
-- ============================================================

revoke all on all tables in schema demo_adb_ecommerce_raw, demo_adb_ecommerce_mart from public;
grant select on all tables in schema demo_adb_ecommerce_raw, demo_adb_ecommerce_mart to data_agent_ecommerce_readonly;
alter default privileges for role postgres in schema demo_adb_ecommerce_raw revoke all on tables from public;
alter default privileges for role postgres in schema demo_adb_ecommerce_mart revoke all on tables from public;
alter default privileges for role postgres in schema demo_adb_ecommerce_raw grant select on tables to data_agent_ecommerce_readonly;
alter default privileges for role postgres in schema demo_adb_ecommerce_mart grant select on tables to data_agent_ecommerce_readonly;

revoke all on app_data_agent.demo_dataset_versions, app_data_agent.demo_dataset_active_versions
from public, anon, authenticated, service_role, data_agent_backend, data_agent_ecommerce_readonly;
grant select on app_data_agent.demo_dataset_versions, app_data_agent.demo_dataset_active_versions
to data_agent_backend;
revoke all on function app_data_agent.guard_demo_fixture_mutation() from public;
revoke all on function app_data_agent.reject_demo_dataset_receipt_mutation() from public;

do $postconditions$
declare raw_count integer;
declare mart_count integer;
declare view_count integer;
begin
  select count(*) into raw_count from information_schema.tables
  where table_schema = 'demo_adb_ecommerce_raw' and table_type = 'BASE TABLE';
  select count(*) into mart_count from information_schema.tables
  where table_schema = 'demo_adb_ecommerce_mart' and table_type = 'BASE TABLE';
  select count(*) into view_count from information_schema.views
  where table_schema = 'demo_adb_ecommerce_mart';
  if raw_count <> 12 or mart_count <> 14 or view_count <> 5 then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_RELATION_CLOSURE_FAILED';
  end if;
  if pg_catalog.has_schema_privilege('data_agent_ecommerce_readonly', 'app_data_agent', 'USAGE') then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_CONTROL_SCHEMA_EXPOSED';
  end if;
  if not pg_catalog.has_table_privilege(
    'data_agent_ecommerce_readonly', 'demo_adb_ecommerce_mart.v_order_360', 'SELECT'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_READ_ROLE_INCOMPLETE';
  end if;
  if pg_catalog.has_table_privilege(
    'data_agent_ecommerce_readonly', 'demo_adb_ecommerce_raw.olist_orders', 'INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_READ_ROLE_MUTABLE';
  end if;
end
$postconditions$;
