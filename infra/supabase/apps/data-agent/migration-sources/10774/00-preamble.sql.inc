begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='FALCON24_QUALIFICATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='FALCON24_QUALIFICATION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010773_app_data_agent_falcon24_ui_trace_gate')
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_BASELINE_10773_MISSING'; end if;
  if pg_catalog.to_regprocedure(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)') is null
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_BASELINE_AUTHORITY_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
