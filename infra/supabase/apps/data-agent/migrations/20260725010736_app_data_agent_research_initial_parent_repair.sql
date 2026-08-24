-- research_initial_parent_repair_migration_checksum: sha256:e0c455bcac1a0526d929a15e3dc49228baf61920e7eec7afb59cc90aaeb6ea02
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_INITIAL_PARENT_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_INITIAL_PARENT_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010735_app_data_agent_research_artifact_update_grant')
  then raise exception using errcode='P0001',message='RESEARCH_INITIAL_PARENT_REPAIR_BASELINE_10735_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

do $repair$
declare
  source_definition text;
  repaired_definition text;
  source_marker constant text := 'when active_artifact.artifact_id is null then null';
  repaired_marker constant text := 'when active_artifact.artifact_id is null then ''null''::jsonb';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_l2_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict source_definition;
  if pg_catalog.strpos(source_definition,source_marker)=0 then
    raise exception using errcode='P0001',message='RESEARCH_INITIAL_PARENT_L2_SOURCE_MISMATCH';
  end if;
  repaired_definition:=pg_catalog.replace(source_definition,source_marker,repaired_marker);
  execute repaired_definition;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_analysis_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict source_definition;
  if pg_catalog.strpos(source_definition,source_marker)=0 then
    raise exception using errcode='P0001',message='RESEARCH_INITIAL_PARENT_ANALYSIS_SOURCE_MISMATCH';
  end if;
  repaired_definition:=pg_catalog.replace(source_definition,source_marker,repaired_marker);
  execute repaired_definition;
end
$repair$;

do $postconditions$
declare
  l2_definition text;
  analysis_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_l2_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict l2_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_analysis_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict analysis_definition;
  if pg_catalog.strpos(l2_definition,'when active_artifact.artifact_id is null then ''null''::jsonb')=0
    or pg_catalog.strpos(analysis_definition,'when active_artifact.artifact_id is null then ''null''::jsonb')=0
  then raise exception using errcode='P0001',message='RESEARCH_INITIAL_PARENT_REPAIR_NOT_INSTALLED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010736_app_data_agent_research_initial_parent_repair',
  'sha256:e0c455bcac1a0526d929a15e3dc49228baf61920e7eec7afb59cc90aaeb6ea02');
commit;
