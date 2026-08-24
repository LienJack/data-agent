-- analysis_input_artifact_constraint_migration_checksum: sha256:e30cc609b57c6d1fd8f45e9d223a8cf20b5a795f2368a12eed4495664630b548
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_INPUT_ARTIFACT_CONSTRAINT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_INPUT_ARTIFACT_CONSTRAINT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010738_app_data_agent_run_scoped_sensitive_analysis_input')
  then raise exception using errcode='P0001',message='ANALYSIS_INPUT_ARTIFACT_CONSTRAINT_BASELINE_10738_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

alter table app_data_agent.analysis_system_artifacts
  drop constraint analysis_system_artifacts_artifact_type_check,
  add constraint analysis_system_artifacts_artifact_type_check check (
    artifact_type in (
      'AnalysisInputMaterializationReceipt',
      'SandboxProgram',
      'SandboxExecutionReceipt',
      'SandboxResult'
    )
  );

do $postconditions$
declare
  constraint_definition text;
  function_definition text;
begin
  select pg_catalog.pg_get_constraintdef(oid)
  into strict constraint_definition
  from pg_catalog.pg_constraint
  where conrelid='app_data_agent.analysis_system_artifacts'::pg_catalog.regclass
    and conname='analysis_system_artifacts_artifact_type_check';
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(constraint_definition,'''AnalysisInputMaterializationReceipt''')=0
    or pg_catalog.strpos(function_definition,'''AnalysisInputMaterializationReceipt''')=0
  then raise exception using errcode='P0001',message='ANALYSIS_INPUT_ARTIFACT_CONSTRAINT_NOT_INSTALLED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010739_app_data_agent_analysis_input_artifact_constraint',
  'sha256:e30cc609b57c6d1fd8f45e9d223a8cf20b5a795f2368a12eed4495664630b548');
commit;
