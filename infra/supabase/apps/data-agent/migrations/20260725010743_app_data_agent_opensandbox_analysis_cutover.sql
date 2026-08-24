-- opensandbox_analysis_cutover_migration_checksum: sha256:f39e71e89cf54e4b3b70b3d23cabf6d9a246903ec07d06ae3c36d4ba1d0af0aa
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='OPENSANDBOX_ANALYSIS_CUTOVER_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='OPENSANDBOX_ANALYSIS_CUTOVER_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010742_app_data_agent_semantic_relationship_projection_reuse_epoch')
  then raise exception using errcode='P0001',message='OPENSANDBOX_ANALYSIS_CUTOVER_BASELINE_10742_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $cutover$
declare
  function_definition text;
  legacy_allowlist constant text := '''AnalysisInputMaterializationReceipt'', ''SandboxProgram'', ''SandboxExecutionReceipt'', ''SandboxResult''';
  current_allowlist constant text := '''AnalysisInputMaterializationReceipt'', ''SandboxExecutionReceipt'', ''SandboxResult''';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(function_definition,legacy_allowlist)=0 then
    raise exception using errcode='P0001',message='OPENSANDBOX_ANALYSIS_ALLOWLIST_SOURCE_MISMATCH';
  end if;
  execute pg_catalog.replace(function_definition,legacy_allowlist,current_allowlist);
end
$cutover$;

revoke all on function app_data_agent.load_analysis_python_source(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
drop function app_data_agent.load_analysis_python_source(jsonb);
do $postconditions$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(
      function_definition,
      '''AnalysisInputMaterializationReceipt'', ''SandboxProgram'', ''SandboxExecutionReceipt'', ''SandboxResult'''
    )<>0
    or pg_catalog.strpos(
      function_definition,
      '''AnalysisInputMaterializationReceipt'', ''SandboxExecutionReceipt'', ''SandboxResult'''
    )=0
    or pg_catalog.to_regprocedure('app_data_agent.load_analysis_python_source(jsonb)') is not null
  then raise exception using errcode='P0001',message='OPENSANDBOX_ANALYSIS_CUTOVER_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010743_app_data_agent_opensandbox_analysis_cutover',
  'sha256:f39e71e89cf54e4b3b70b3d23cabf6d9a246903ec07d06ae3c36d4ba1d0af0aa');
commit;
