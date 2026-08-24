do $postconditions$
declare oracle_definition text; explanation_definition text;
begin
  select prosrc into strict oracle_definition from pg_catalog.pg_proc
    where oid='app_data_agent.record_analysis_stage_oracle(jsonb)'::pg_catalog.regprocedure;
  select prosrc into strict explanation_definition from pg_catalog.pg_proc
    where oid='app_data_agent.record_analysis_stage_explanation(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(oracle_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(oracle_definition,'analysis_stage_oracle_records')=0
    or pg_catalog.strpos(explanation_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(explanation_definition,'analysis_stage_explanation_records')=0
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_OBSERVATION_VARIABLE_REPAIR_DEFINITION_STALE'; end if;
  if exists(
      select 1 from pg_catalog.pg_proc
      where oid in (
        'app_data_agent.record_analysis_stage_oracle(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.record_analysis_stage_explanation(jsonb)'::pg_catalog.regprocedure
      ) and pg_catalog.pg_get_userbyid(proowner)<>'data_agent_u6_rpc_owner'
    )
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.record_analysis_stage_oracle(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.record_analysis_stage_explanation(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_OBSERVATION_VARIABLE_REPAIR_GRANT_DRIFT'; end if;
end
$postconditions$;
