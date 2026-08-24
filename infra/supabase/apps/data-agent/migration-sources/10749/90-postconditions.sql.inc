do $postconditions$
begin
  if not pg_catalog.has_function_privilege('data_agent_u6_cleanup_owner',
    'platform.backend_context_matches(uuid,uuid,text,boolean)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_SCOPE_GRANT_MISSING'; end if;
end
$postconditions$;
