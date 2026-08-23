alter table app_data_agent.analysis_python_sources owner to data_agent_u6_rpc_owner;
alter function app_data_agent.reject_analysis_python_source_mutation()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_analysis_python_source(jsonb,bytea)
  owner to data_agent_u6_rpc_owner;

revoke all on app_data_agent.analysis_python_sources
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.reject_analysis_python_source_mutation(),
  app_data_agent.commit_analysis_python_source(jsonb,bytea)
  from public,anon,authenticated,service_role,data_agent_backend;
grant select,insert on app_data_agent.analysis_python_sources to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.commit_analysis_python_source(jsonb,bytea)
  to data_agent_backend;

do $postconditions$
declare definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname='analysis_python_sources'
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.analysis_python_sources','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_analysis_python_source(jsonb,bytea)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_GRANT_UNSAFE'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_python_source(jsonb,bytea)'::pg_catalog.regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'analysis-python-source-receipt@1.0.0')=0
    or pg_catalog.strpos(definition,'AnalysisProgram')=0
    or pg_catalog.strpos(definition,'DEEPSEEK_GENERATED')=0
    or pg_catalog.strpos(definition,'RESEARCH_AUTHORITY_FENCE_MISMATCH')=0
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_SOURCE_CONTRACT_UNSAFE'; end if;
end
$postconditions$;
