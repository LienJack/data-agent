do $postconditions$
declare definition text; compact_definition text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb)'::pg_catalog.regprocedure)
    into strict definition;
  compact_definition:=pg_catalog.regexp_replace(definition,'[[:space:]]','','g');
  if pg_catalog.strpos(definition,'capability_envelope:=pg_catalog.jsonb_build_object')=0
    or pg_catalog.strpos(compact_definition,
      'lock_u6_authority_capability(capability_envelope,')=0
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CAPABILITY_ENVELOPE_REPAIR_DEFINITION_STALE'; end if;
  if (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb)'::pg_catalog.regprocedure)
      <>'data_agent_u6_rpc_owner'
  then raise exception using errcode='P0001',message='ANALYSIS_LIFECYCLE_CAPABILITY_ENVELOPE_REPAIR_OWNER_DRIFT'; end if;
end
$postconditions$;
