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
