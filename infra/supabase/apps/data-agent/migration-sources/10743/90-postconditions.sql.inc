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
