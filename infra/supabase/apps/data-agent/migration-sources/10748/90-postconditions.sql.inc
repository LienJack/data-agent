do $postconditions$
declare function_owner text;
begin
  if pg_catalog.to_regclass('app_data_agent.analysis_result_stage_cleanup_receipts') is null
    or pg_catalog.to_regprocedure('app_data_agent.cleanup_expired_analysis_result_stages(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.analysis_stage_state_immutable()') is null
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_AUTHORITY_NOT_INSTALLED'; end if;
  if not exists(select 1 from pg_catalog.pg_class
    where oid='app_data_agent.analysis_result_stage_cleanup_receipts'::pg_catalog.regclass
      and relrowsecurity and relforcerowsecurity)
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_RECEIPT_RLS_NOT_FORCED'; end if;
  select roles.rolname into function_owner
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_roles as roles on roles.oid=functions.proowner
  where functions.oid='app_data_agent.cleanup_expired_analysis_result_stages(jsonb)'::pg_catalog.regprocedure;
  if function_owner<>'data_agent_u6_cleanup_owner'
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.cleanup_expired_analysis_result_stages(jsonb)','EXECUTE')
    or not pg_catalog.has_table_privilege('data_agent_u6_cleanup_owner',
      'app_data_agent.analysis_result_stages','SELECT,DELETE')
    or pg_catalog.has_table_privilege('data_agent_u6_cleanup_owner',
      'app_data_agent.analysis_result_stages','INSERT,UPDATE')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_PRIVILEGE_CLOSURE_INVALID'; end if;
end
$postconditions$;
