-- ============================================================
-- 10660: Workspace File and Content Authority
-- Content-addressed bytes, immutable ACL revisions, U10 FILE_SCAN.
-- No data import, Falcon execution, Provider invocation, or billing.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='WORKSPACE_FILES_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='WORKSPACE_FILES_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010659_app_data_agent_job_center'
  ) then raise exception using errcode='P0001',message='WORKSPACE_FILES_BASELINE_10659_MISSING'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.assert_job_active_lease(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
    or pg_catalog.to_regprocedure('platform.current_backend_authority(boolean)') is null
  then raise exception using errcode='P0001',message='WORKSPACE_FILES_AUTHORITY_PREREQUISITE_MISSING'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u6_file_owner') then
    create role data_agent_u6_file_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
