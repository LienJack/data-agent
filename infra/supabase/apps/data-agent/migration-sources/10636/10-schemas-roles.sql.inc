-- ============================================================
-- 10636: Isolated schemas and read-only group role
-- ============================================================

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_ecommerce_readonly') then
    create role data_agent_ecommerce_readonly nologin nosuperuser nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$roles$;

create schema demo_adb_ecommerce_raw authorization postgres;
create schema demo_adb_ecommerce_mart authorization postgres;

revoke all on schema demo_adb_ecommerce_raw, demo_adb_ecommerce_mart from public;
grant usage on schema demo_adb_ecommerce_raw, demo_adb_ecommerce_mart to data_agent_ecommerce_readonly;
