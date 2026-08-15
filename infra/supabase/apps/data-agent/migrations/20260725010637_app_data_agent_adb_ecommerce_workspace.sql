-- adb_ecommerce_workspace_migration_checksum: sha256:1857b7756d8e0a7ce95385da029a067f2578690762692e11c708b91c8911fa4a
-- ============================================================
-- 10637: E-commerce Demo workspace attachment authority
-- Depends on: 20260725010636_app_data_agent_adb_ecommerce_demo
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'ADB_ECOMMERCE_WORKSPACE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'ADB_ECOMMERCE_WORKSPACE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010636_app_data_agent_adb_ecommerce_demo'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_WORKSPACE_BASELINE_10636_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
-- ============================================================
-- 10637: Workspace-scoped installation receipt
-- ============================================================

create table app_data_agent.demo_workspace_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  dataset_id text not null,
  bundle_digest text not null check (bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  datasource_id uuid not null,
  secret_ref_id uuid not null,
  created_by_principal_id uuid not null,
  status text not null check (status = 'READY'),
  attached_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, dataset_id, bundle_digest),
  foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment) on delete restrict,
  foreign key (app_id, tenant_id, environment, datasource_id)
    references app_data_agent.datasource_connections (app_id, tenant_id, environment, datasource_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, secret_ref_id)
    references app_data_agent.secret_refs (app_id, tenant_id, environment, secret_ref_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, created_by_principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict,
  foreign key (dataset_id, bundle_digest)
    references app_data_agent.demo_dataset_versions (dataset_id, bundle_digest) on delete restrict
);

create trigger demo_workspace_receipts_immutable
before update or delete on app_data_agent.demo_workspace_receipts
for each row execute function app_data_agent.reject_demo_dataset_receipt_mutation();
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
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010637_app_data_agent_adb_ecommerce_workspace',
  'sha256:1857b7756d8e0a7ce95385da029a067f2578690762692e11c708b91c8911fa4a'
);

commit;
