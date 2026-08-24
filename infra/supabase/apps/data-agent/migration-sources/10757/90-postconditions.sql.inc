do $postconditions$
declare read_definition text; commit_definition text;
begin
  select prosrc into strict read_definition from pg_catalog.pg_proc
    where oid='app_data_agent.read_analysis_result_stage(jsonb)'::pg_catalog.regprocedure;
  select prosrc into strict commit_definition from pg_catalog.pg_proc
    where oid='app_data_agent.commit_analysis_authority(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(read_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(read_definition,'analysis_stage_oracle_records')=0
    or pg_catalog.strpos(read_definition,'analysis_stage_explanation_records')=0
    or pg_catalog.strpos(read_definition,'''oracle_record''')=0
    or pg_catalog.strpos(read_definition,'''explanation_record''')=0
    or pg_catalog.strpos(commit_definition,'#variable_conflict use_variable')=0
    or pg_catalog.strpos(commit_definition,'operator_receipt_closure_hash')=0
    or pg_catalog.strpos(commit_definition,'ANALYSIS_AUTHORITY_ORACLE_RECORD_INVALID')=0
    or pg_catalog.strpos(commit_definition,'ANALYSIS_AUTHORITY_EXPLANATION_RECORD_INVALID')=0
    or pg_catalog.strpos(commit_definition,'ANALYSIS_AUTHORITY_OUTPUT_CLOSURE_INVALID')=0
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CLOSURE_RESTORE_DEFINITION_STALE'; end if;
  if exists(
      select 1 from pg_catalog.pg_proc
      where oid in (
        'app_data_agent.read_analysis_result_stage(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.commit_analysis_authority(jsonb)'::pg_catalog.regprocedure
      ) and pg_catalog.pg_get_userbyid(proowner)<>'data_agent_u6_rpc_owner'
    )
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.read_analysis_result_stage(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_analysis_authority(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CLOSURE_RESTORE_GRANT_DRIFT'; end if;
end
$postconditions$;
