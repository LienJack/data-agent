do $postconditions$
begin
  if not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner','app_data_agent.analysis_result_stages','UPDATE')
    or not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner','app_data_agent.analysis_stage_oracle_records','UPDATE')
    or not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner','app_data_agent.analysis_stage_explanation_records','UPDATE')
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_result_stages'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_stage_oracle_records'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_stage_explanation_records'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or pg_catalog.to_regclass('app_data_agent.analysis_result_stages') is null
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_GRANT_DRIFT'; end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='app_data_agent.analysis_result_stages'::pg_catalog.regclass and tgname='analysis_result_stages_immutable' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='app_data_agent.analysis_stage_oracle_records'::pg_catalog.regclass and tgname='analysis_stage_oracle_records_immutable' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='app_data_agent.analysis_stage_explanation_records'::pg_catalog.regclass and tgname='analysis_stage_explanation_records_immutable' and not tgisinternal)
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_IMMUTABILITY_DRIFT'; end if;
end
$postconditions$;
