do $postconditions$
declare stage_definition text; read_definition text; commit_definition text;
begin
  select prosrc into strict stage_definition from pg_catalog.pg_proc
    where oid='app_data_agent.stage_analysis_result(jsonb,jsonb)'::pg_catalog.regprocedure;
  select prosrc into strict read_definition from pg_catalog.pg_proc
    where oid='app_data_agent.read_analysis_result_stage(jsonb)'::pg_catalog.regprocedure;
  select prosrc into strict commit_definition from pg_catalog.pg_proc
    where oid='app_data_agent.commit_analysis_authority(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(stage_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(stage_definition,'source.idempotency_key=command_json')=0
    or pg_catalog.strpos(read_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(read_definition,'stored.command_json')=0
    or pg_catalog.strpos(commit_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(commit_definition,'source.idempotency_key=command_json')=0
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_VARIABLE_CONFLICT_REPAIR_DEFINITION_STALE'; end if;
  if exists(
      select 1 from pg_catalog.pg_proc
      where oid in (
        'app_data_agent.stage_analysis_result(jsonb,jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.read_analysis_result_stage(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.commit_analysis_authority(jsonb)'::pg_catalog.regprocedure
      ) and pg_catalog.pg_get_userbyid(proowner)<>'data_agent_u6_rpc_owner'
    )
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.stage_analysis_result(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.read_analysis_result_stage(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_analysis_authority(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_VARIABLE_CONFLICT_REPAIR_GRANT_DRIFT'; end if;
end
$postconditions$;
