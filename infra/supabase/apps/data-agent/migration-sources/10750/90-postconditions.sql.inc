do $postconditions$
declare trigger_definition text;
begin
  select pg_catalog.pg_get_triggerdef(trigger.oid) into trigger_definition
  from pg_catalog.pg_trigger as trigger
  where trigger.tgrelid='app_data_agent.analysis_result_stages'::pg_catalog.regclass
    and trigger.tgname='analysis_result_stages_immutable' and not trigger.tgisinternal;
  if not pg_catalog.has_table_privilege('data_agent_u6_cleanup_owner',
      'app_data_agent.analysis_result_stages','SELECT,UPDATE,DELETE')
    or not pg_catalog.has_table_privilege('data_agent_u6_cleanup_owner',
      'app_data_agent.analysis_authority_commits','SELECT')
    or pg_catalog.strpos(trigger_definition,'analysis_stage_state_immutable')=0
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='analysis_result_stages'
        and policyname='analysis_result_stages_cleanup' and with_check='false')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_LOCK_PRIVILEGE_CLOSURE_INVALID'; end if;
end
$postconditions$;
