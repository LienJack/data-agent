do $scope_repair$
declare
  inventory_definition text;
  execute_definition text;
  inventory_unscoped constant text :=
    'execute pg_catalog.format(''select pg_catalog.count(*) from app_data_agent.%I'',target)' ||
    pg_catalog.chr(10) || '      into target_count;';
  inventory_scoped constant text :=
    'execute pg_catalog.format(''select pg_catalog.count(*) from app_data_agent.%I ' ||
    'where app_id=$1 and environment=$2'',target)' || pg_catalog.chr(10) ||
    '      into target_count using scope.app_id,scope.environment;';
  delete_unscoped constant text :=
    'execute pg_catalog.format(''delete from app_data_agent.%I'',target);';
  delete_scoped constant text :=
    'execute pg_catalog.format(''delete from app_data_agent.%I ' ||
    'where app_id=$1 and environment=$2'',target)' || pg_catalog.chr(10) ||
    '      using (command->>''app_id'')::uuid,command->>''environment'';';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.legacy_attribution_cleanup_inventory(uuid)'::regprocedure)
    into strict inventory_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.execute_legacy_attribution_cleanup(jsonb)'::regprocedure)
    into strict execute_definition;
  if (pg_catalog.length(inventory_definition)-pg_catalog.length(
      pg_catalog.replace(inventory_definition,inventory_unscoped,'')))
        <>pg_catalog.length(inventory_unscoped)
    or (pg_catalog.length(execute_definition)-pg_catalog.length(
      pg_catalog.replace(execute_definition,delete_unscoped,'')))
        <>pg_catalog.length(delete_unscoped)
  then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_SOURCE_DRIFT';
  end if;
  execute pg_catalog.replace(inventory_definition,inventory_unscoped,inventory_scoped);
  execute pg_catalog.replace(execute_definition,delete_unscoped,delete_scoped);
end
$scope_repair$;
