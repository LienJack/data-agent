do $patch_default_policy$
declare definition text;
  predecessor_fragment constant text:=$fragment$
      'schema_version','run-execution-policy@1.0.0',
      'campaign_id',null,
      'case_id',null,
$fragment$;
  successor_fragment constant text:=$fragment$
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind',null,
      'campaign_id',null,
      'case_id',null,
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.assert_provider_active_worker_lease(jsonb)'::regprocedure)
    into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,predecessor_fragment,'')))
      /pg_catalog.length(predecessor_fragment)<>1
  then raise exception using errcode='P0001',
    message='ROOT_DEFAULT_POLICY_COMPATIBILITY_PATCH_DRIFT'; end if;
  execute pg_catalog.replace(definition,predecessor_fragment,successor_fragment);
end
$patch_default_policy$;
