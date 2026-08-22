do $postconditions$
begin
  if not pg_catalog.has_schema_privilege('data_agent_u6_rpc_owner','app_data_agent','USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_u6_rpc_owner',
      'app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon','semantic.commit_authoring_provider_intent(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_VALIDATOR_GRANT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
