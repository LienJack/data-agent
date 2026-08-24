do $postconditions$
begin
  if not pg_catalog.has_schema_privilege('data_agent_u6_cleanup_owner','extensions','USAGE')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_HASH_GRANT_MISSING'; end if;
end
$postconditions$;
