do $postconditions$
declare
  inventory_definition text:=pg_catalog.pg_get_functiondef(
    'app_data_agent.legacy_attribution_cleanup_inventory(uuid)'::regprocedure);
  execute_definition text:=pg_catalog.pg_get_functiondef(
    'app_data_agent.execute_legacy_attribution_cleanup(jsonb)'::regprocedure);
begin
  if inventory_definition not like
      '%where app_id=$1 and environment=$2%into target_count using scope.app_id,scope.environment;%'
    or execute_definition not like
      '%delete from app_data_agent.%I where app_id=$1 and environment=$2%'
    or execute_definition not like
      '%using (command->>''app_id'')::uuid,command->>''environment'';%'
    or inventory_definition like
      '%select pg_catalog.count(*) from app_data_agent.%I'',target)%'
    or execute_definition like '%delete from app_data_agent.%I'',target);%'
    or (select owner_role.rolname from pg_catalog.pg_proc function_row
      join pg_catalog.pg_roles owner_role on owner_role.oid=function_row.proowner
      where function_row.oid=
        'app_data_agent.execute_legacy_attribution_cleanup(jsonb)'::regprocedure)
      <>'data_agent_legacy_attribution_cleanup_owner'
  then
    raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_SCOPE_REPAIR_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

commit;
