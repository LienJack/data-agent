-- ============================================================
-- 10632: Semantic workspace JSON portability
-- Depends on: 20260725010631_app_data_agent_model_billing_settlement
-- Clean-install only. No legacy semantic import backfill is supported.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_PORTABILITY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_PORTABILITY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010631_app_data_agent_model_billing_settlement'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_BASELINE_10631_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010632_app_data_agent_semantic_json_portability'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_MIGRATION_10632_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_source_release') is null
    or pg_catalog.to_regclass('app_data_agent.datasource_connections') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_BASELINE_AUTHORITY_MISSING';
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
