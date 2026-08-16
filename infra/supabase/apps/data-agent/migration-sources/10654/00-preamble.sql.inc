-- ============================================================
-- 10654: Greenfield Provider Invocation and Usage authority
-- Depends on: 20260725010653_app_data_agent_effective_run_config
-- Creates empty authority tables only. No historical row transfer or dual path.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'PROVIDER_INVOCATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'PROVIDER_INVOCATION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010653_app_data_agent_effective_run_config'
  ) then
    raise exception using errcode = 'P0001', message = 'PROVIDER_INVOCATION_BASELINE_10653_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_provider_invocation_rpc_owner'
  ) then
    create role data_agent_provider_invocation_rpc_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_provider_smoke_rpc_owner'
  ) then
    create role data_agent_provider_smoke_rpc_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
