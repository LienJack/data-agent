alter function app_data_agent.load_analysis_python_source(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.load_analysis_python_source(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_analysis_python_source(jsonb)
  to data_agent_backend;

do $postconditions$
declare definition text;
begin
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_analysis_python_source(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.analysis_python_sources','SELECT,INSERT,UPDATE,DELETE')
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_REPLAY_GRANT_UNSAFE'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.load_analysis_python_source(jsonb)'::pg_catalog.regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'analysis-python-source-load@1.0.0')=0
    or pg_catalog.strpos(definition,'AnalysisProgram')=0
    or pg_catalog.strpos(definition,'RESEARCH_AUTHORITY_FENCE_MISMATCH')=0
    or pg_catalog.strpos(definition,'ciphertext_base64')=0
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_REPLAY_CONTRACT_UNSAFE'; end if;
end
$postconditions$;
