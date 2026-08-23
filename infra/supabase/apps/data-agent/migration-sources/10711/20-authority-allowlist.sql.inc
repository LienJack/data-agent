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
