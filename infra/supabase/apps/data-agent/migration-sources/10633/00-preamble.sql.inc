-- ============================================================
-- 10633: Workspace administration and operational health reads
-- Depends on: 20260725010632_app_data_agent_semantic_json_portability
-- Clean-install only. No legacy administration projection is supported.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'OPERATIONS_ADMIN_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'OPERATIONS_ADMIN_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010632_app_data_agent_semantic_json_portability'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_BASELINE_10632_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010633_app_data_agent_operations_admin'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_MIGRATION_10633_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regprocedure('platform.resolve_super_admin_scope(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('platform.resolve_workspace_authority(uuid,uuid,uuid,boolean)') is null
    or pg_catalog.to_regclass('app_data_agent.billing_runtime_state') is null
  then
    raise exception using errcode = 'P0001', message = 'OPERATIONS_ADMIN_BASELINE_AUTHORITY_MISSING';
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
