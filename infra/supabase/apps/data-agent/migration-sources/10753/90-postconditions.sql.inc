do $postconditions$
declare append_definition text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.append_analysis_context_journal(jsonb)'::pg_catalog.regprocedure)
    into strict append_definition;
  if pg_catalog.strpos(pg_catalog.lower(append_definition),'for update')<>0
    or pg_catalog.strpos(append_definition,'pg_advisory_xact_lock')=0
  then raise exception using errcode='P0001',message='ANALYSIS_CONTEXT_JOURNAL_LOCK_REPAIR_DEFINITION_STALE'; end if;
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.append_analysis_context_journal(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_CONTEXT_JOURNAL_LOCK_REPAIR_EXECUTE_GRANT_MISSING'; end if;
  if (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.append_analysis_context_journal(jsonb)'::pg_catalog.regprocedure)
      <>'data_agent_u6_rpc_owner'
  then raise exception using errcode='P0001',message='ANALYSIS_CONTEXT_JOURNAL_LOCK_REPAIR_OWNER_DRIFT'; end if;
end
$postconditions$;
