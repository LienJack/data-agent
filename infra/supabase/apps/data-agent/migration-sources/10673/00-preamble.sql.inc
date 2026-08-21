-- 10673 adds owner-private Q&A folders, lifecycle commands and 30-day trash authority.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='QA_DIRECTORY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='QA_DIRECTORY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010672_app_data_agent_team_runtime_repairs')
  then raise exception using errcode='P0001',message='QA_DIRECTORY_BASELINE_10672_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_qa_directory_owner') then
    create role data_agent_qa_directory_owner nologin noinherit nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
