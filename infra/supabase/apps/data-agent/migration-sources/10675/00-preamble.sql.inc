-- 10675 adds an atomic creator self-review + publish path for an explicitly saved revision.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_SELF_PUBLISH_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_SELF_PUBLISH_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010674_app_data_agent_semantic_explicit_revisions')
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_BASELINE_10674_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u5_self_publish_owner') then
    create role data_agent_u5_self_publish_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
