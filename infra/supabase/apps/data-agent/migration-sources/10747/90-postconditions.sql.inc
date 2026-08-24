do $postconditions$
declare definition text;
begin
  if pg_catalog.to_regprocedure('app_data_agent.commit_analysis_authority(jsonb)') is null then
    raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_COMMIT_CLOSURE_NOT_INSTALLED';
  end if;
  select pg_catalog.pg_get_functiondef('app_data_agent.commit_analysis_authority(jsonb)'::pg_catalog.regprocedure)
  into definition;
  if pg_catalog.strpos(definition,'analysis_stage_oracle_records')=0
    or pg_catalog.strpos(definition,'analysis_stage_explanation_records')=0
    or pg_catalog.strpos(definition,'operator_receipt_closure_hash')=0
    or pg_catalog.strpos(definition,'ANALYSIS_AUTHORITY_OUTPUT_CLOSURE_INVALID')=0
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_COMMIT_CLOSURE_INCOMPLETE'; end if;
end
$postconditions$;
