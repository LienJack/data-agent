-- ============================================================
-- 10628: Workspace data persistence and isolation
-- ============================================================
-- Depends on: 20260725010627_app_data_agent_workspace_identity
-- Clean-install only: no legacy Map migration, backfill or dual-write.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'WORKSPACE_DATA_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'WORKSPACE_DATA_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'WORKSPACE_DATA_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010627_app_data_agent_workspace_identity';
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_BASELINE_10627_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010628_app_data_agent_workspace_data_isolation'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_MIGRATION_10628_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('app_data_agent.workspaces') is null
    or pg_catalog.to_regclass('app_data_agent.secret_refs') is null
    or pg_catalog.to_regclass('semantic.semantic_domain_registry') is null
    or pg_catalog.to_regprocedure('platform.backend_context_matches(uuid,uuid,text,boolean)') is null
  then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_BASELINE_AUTHORITY_MISSING';
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
