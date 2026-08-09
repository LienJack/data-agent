-- ============================================================
-- 10624: Semantic Explorer read authority
-- ============================================================
-- Depends on: 20260725010623_app_data_agent_schema_discovery
-- Adds narrow server-only Explorer read RPCs over the immutable release
-- authority. No authority table or active pointer is added.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_EXPLORER_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_EXPLORER_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_EXPLORER_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010623_app_data_agent_schema_discovery';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_BASELINE_10623_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010624_app_data_agent_semantic_explorer'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_MIGRATION_10624_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regnamespace('semantic') is null
    or pg_catalog.to_regclass('semantic.semantic_active_pointer') is null
    or pg_catalog.to_regclass('semantic.semantic_source_release') is null
    or pg_catalog.to_regclass('semantic.semantic_executable_projection') is null
    or pg_catalog.to_regclass('semantic.semantic_relationship_projection') is null
    or pg_catalog.to_regclass('semantic.semantic_runtime_restriction_projection') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_AUTHORITY_SURFACE_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
