-- ============================================================
-- 10658: Agent Team v2 and Sensitive Execution Artifact Authority
-- Forward-only metadata and hash authority; no historical data mutation.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='AGENT_TEAM_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode='42501',message='AGENT_TEAM_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010657_app_data_agent_artifact_export_authority'
  ) then
    raise exception using errcode='P0001',message='AGENT_TEAM_BASELINE_10657_MISSING';
  end if;
  if pg_catalog.to_regclass('app_data_agent.run_attempts') is null
    or pg_catalog.to_regprocedure('app_data_agent.assert_provider_active_worker_lease(jsonb)') is null
  then
    raise exception using errcode='P0001',message='AGENT_TEAM_RUNTIME_AUTHORITY_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u19_team_owner') then
    create role data_agent_u19_team_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
