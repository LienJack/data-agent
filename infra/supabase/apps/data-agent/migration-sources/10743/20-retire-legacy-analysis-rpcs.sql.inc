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
