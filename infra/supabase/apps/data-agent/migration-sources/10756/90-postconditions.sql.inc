do $postconditions$
declare definition text;
begin
  select prosrc into strict definition from pg_catalog.pg_proc
    where oid='app_data_agent.stage_analysis_result(jsonb,jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(definition,'contents_json->>((artifact_record.ordinality-1)::integer)')=0
  then raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_ORDINALITY_REPAIR_DEFINITION_STALE'; end if;
  if (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.stage_analysis_result(jsonb,jsonb)'::pg_catalog.regprocedure)
      <>'data_agent_u6_rpc_owner'
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.stage_analysis_result(jsonb,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_ORDINALITY_REPAIR_GRANT_DRIFT'; end if;
end
$postconditions$;
