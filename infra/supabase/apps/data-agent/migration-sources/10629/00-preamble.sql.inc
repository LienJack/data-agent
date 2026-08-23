-- ============================================================
-- 10629: App-global model, price and FX control plane
-- ============================================================
-- Depends on: 20260725010628_app_data_agent_workspace_data_isolation
-- Clean-install only. No model Map or environment credential backfill.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'PRICING_CONTROL_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'PRICING_CONTROL_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010628_app_data_agent_workspace_data_isolation';
  if not found then
    raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_BASELINE_10628_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010629_app_data_agent_model_price_fx_control'
  ) then
    raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_MIGRATION_10629_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('app_data_agent.app_users') is null
    or pg_catalog.to_regprocedure('platform.canonical_sha256(jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'PRICING_CONTROL_BASELINE_AUTHORITY_MISSING';
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
