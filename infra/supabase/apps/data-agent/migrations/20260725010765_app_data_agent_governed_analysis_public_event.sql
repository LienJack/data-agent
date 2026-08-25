-- governed_analysis_public_event_migration_checksum: sha256:88696f80dcd69d4f00320f077b90466e426a317bf4c84e82f1c92bc03fd86568
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010764_app_data_agent_governed_analysis_product_profile')
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_BASELINE_10764_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $cutover$
declare
  source_definition text;
  current_definition text;
  retired_profile_set constant text := '(''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
  current_profile_set constant text := '(''governed-analysis-agent'',''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
  ) into strict source_definition;
  if pg_catalog.strpos(source_definition,retired_profile_set)=0
    or pg_catalog.strpos(source_definition,'governed-analysis-agent')<>0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_SOURCE_MISMATCH'; end if;
  current_definition:=pg_catalog.replace(source_definition,retired_profile_set,current_profile_set);
  if current_definition=source_definition
    or pg_catalog.strpos(current_definition,retired_profile_set)<>0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_REWRITE_FAILED'; end if;
  execute current_definition;
end
$cutover$;
do $postconditions$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(function_definition,'governed-analysis-agent')=0
    or pg_catalog.strpos(function_definition,
      '(''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')')<>0
    or pg_catalog.strpos(function_definition,'command.payload_json->>''kind''')<>0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_NOT_INSTALLED'; end if;
  if not app_data_agent.public_run_v2_payload_is_valid(
    'run.agent_status',
    pg_catalog.jsonb_build_object(
      'profile_id','governed-analysis-agent',
      'task_id','00000000-0000-4000-8000-000000000001',
      'status','RUNNING','phase','analysis','title','Analysis','summary','Running',
      'duration_ms',null,'error_code',null
    ),
    pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000000002',
      'environment','local'
    ),
    '00000000-0000-4000-8000-000000000003'::uuid
  ) then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_PROFILE_REJECTED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010765_app_data_agent_governed_analysis_public_event',
  'sha256:88696f80dcd69d4f00320f077b90466e426a317bf4c84e82f1c92bc03fd86568');
commit;
