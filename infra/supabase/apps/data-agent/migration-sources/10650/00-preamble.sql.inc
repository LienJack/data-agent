-- ============================================================
-- 10650: Strict provider command keys without rejecting SecretRef metadata
-- Depends on: 20260725010649_app_data_agent_model_provider_connections
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'MODEL_PROVIDER_COMMAND_GUARD_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'MODEL_PROVIDER_COMMAND_GUARD_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010649_app_data_agent_model_provider_connections'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_COMMAND_GUARD_BASELINE_10649_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
