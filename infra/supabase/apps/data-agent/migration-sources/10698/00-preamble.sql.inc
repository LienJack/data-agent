-- 10698 repairs the installed Root Harness runtime without rewriting applied migration history.
begin;
do $bootstrap$
declare installed_10696_checksum text;
begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_EXECUTOR_UNSAFE'; end if;
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_POSTGRES_17_REQUIRED'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010697_app_data_agent_agent_team_trace_content')
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_BASELINE_10697_MISSING'; end if;
  select migration_checksum into installed_10696_checksum from platform.migration_ledger
  where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010696_app_data_agent_model_driven_subagent_harness';
  if installed_10696_checksum is distinct from
    'sha256:8e74cfd247270428117ffed554f6020ba0c752881d19012d3ad64438acecdac2'
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_BASELINE_10696_DRIFT'; end if;
end
$bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
