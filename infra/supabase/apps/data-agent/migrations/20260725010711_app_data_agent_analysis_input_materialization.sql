-- analysis_input_materialization_migration_checksum: sha256:17813337856f5154bef237da6d299d5f8d41e632646af022ea464f91e1a50a72
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_INPUT_MATERIALIZATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_INPUT_MATERIALIZATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010710_app_data_agent_analysis_python_source_replay')
  then raise exception using errcode='P0001',message='ANALYSIS_INPUT_MATERIALIZATION_BASELINE_10710_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $migration$
declare
  function_definition text;
  old_allowlist constant text := '''SandboxProgram'', ''SandboxExecutionReceipt'', ''SandboxResult''';
  new_allowlist constant text := '''AnalysisInputMaterializationReceipt'', ''SandboxProgram'', ''SandboxExecutionReceipt'', ''SandboxResult''';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)'::pg_catalog.regprocedure
  ) into function_definition;
  if function_definition is null or pg_catalog.strpos(function_definition,old_allowlist)=0 then
    raise exception using errcode='P0001',message='ANALYSIS_SYSTEM_ARTIFACT_ALLOWLIST_SOURCE_MISMATCH';
  end if;
  execute pg_catalog.replace(function_definition,old_allowlist,new_allowlist);
end
$migration$;
do $postconditions$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(function_definition,'''AnalysisInputMaterializationReceipt''')=0 then
    raise exception using errcode='P0001',message='ANALYSIS_INPUT_MATERIALIZATION_AUTHORITY_NOT_INSTALLED';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010711_app_data_agent_analysis_input_materialization',
  'sha256:17813337856f5154bef237da6d299d5f8d41e632646af022ea464f91e1a50a72');
commit;
