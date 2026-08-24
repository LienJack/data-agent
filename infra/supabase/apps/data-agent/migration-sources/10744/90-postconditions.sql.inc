do $postconditions$
begin
  if pg_catalog.to_regclass('app_data_agent.analysis_operator_results') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_context_journal') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_result_stages') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_result_stage_artifacts') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_authority_commits') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_authority_current') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_authority_outbox') is null
    or pg_catalog.to_regprocedure('app_data_agent.append_analysis_context_journal(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_governed_operator_result(jsonb,bytea)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_governed_operator_result(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_analysis_context_journal(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_analysis_context_model_cell_source(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.stage_analysis_result(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_analysis_result_stage(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_analysis_authority(jsonb)') is null
  then raise exception using errcode='P0001',message='ANALYSIS_GOVERNED_RESULT_JOURNAL_NOT_INSTALLED'; end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_operator_results'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_context_journal'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_result_stages'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_result_stage_artifacts'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_authority_commits'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_authority_current'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_authority_outbox'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
  then raise exception using errcode='P0001',message='ANALYSIS_GOVERNED_RESULT_RLS_NOT_FORCED'; end if;
end
$postconditions$;
