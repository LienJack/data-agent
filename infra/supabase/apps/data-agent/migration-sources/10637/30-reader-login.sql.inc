-- ============================================================
-- 10637: Superuser-only password rotation for the isolated login
-- ============================================================

create function app_data_agent.configure_ecommerce_demo_reader(requested_password text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or pg_catalog.current_setting('data_agent.allow_demo_workspace_bootstrap', true) <> 'true'
  then
    raise exception using errcode = '42501', message = 'ADB_ECOMMERCE_READER_CONFIGURATION_UNSAFE';
  end if;
  if pg_catalog.length(requested_password) not between 16 and 1024 then
    raise exception using errcode = '22023', message = 'ADB_ECOMMERCE_READER_PASSWORD_INVALID';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_ecommerce_reader') then
    create role data_agent_ecommerce_reader login inherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
  execute pg_catalog.format('alter role data_agent_ecommerce_reader password %L', requested_password);
  grant data_agent_ecommerce_readonly to data_agent_ecommerce_reader;
  alter role data_agent_ecommerce_reader set search_path = demo_adb_ecommerce_mart, demo_adb_ecommerce_raw;
  return pg_catalog.jsonb_build_object(
    'schema_version', 'ecommerce-demo-reader-result@1.0.0',
    'role_name', 'data_agent_ecommerce_reader',
    'credential_rotated', true
  );
end
$function$;
