do $postconditions$
begin
  if pg_catalog.to_regclass('app_data_agent.analysis_stage_oracle_records') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_stage_explanation_records') is null
    or pg_catalog.to_regprocedure('app_data_agent.record_analysis_stage_oracle(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.record_analysis_stage_explanation(jsonb)') is null
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_OBSERVATION_AUTHORITY_NOT_INSTALLED'; end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_stage_oracle_records'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_stage_explanation_records'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_OBSERVATION_RLS_NOT_FORCED'; end if;
end
$postconditions$;
