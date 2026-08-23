grant select on table platform.deployment_mappings
to data_agent_u6_provisioner_owner;
grant select on table platform.app_environment_lifecycle
to data_agent_u6_provisioner_owner;
grant select on table app_data_agent.memberships
to data_agent_u6_provisioner_owner;

do $lock_repair$
declare
  definition text;
  rewritten text;
  old_deployment constant text := 'from platform.deployment_mappings as source
  where source.app_id=requested_app_id
    and source.environment=requested_environment
    and source.deployment_id=requested_deployment_id
  for update of source;';
  new_deployment constant text := 'from platform.deployment_mappings as source
  where source.app_id=requested_app_id
    and source.environment=requested_environment
    and source.deployment_id=requested_deployment_id
  for share of source;';
  old_lifecycle constant text := 'from platform.app_environment_lifecycle as source
  where source.app_id=requested_app_id and source.environment=requested_environment
  for update of source;';
  new_lifecycle constant text := 'from platform.app_environment_lifecycle as source
  where source.app_id=requested_app_id and source.environment=requested_environment
  for share of source;';
  old_membership constant text := 'from app_data_agent.memberships as source
  where source.app_id=requested_app_id
    and source.tenant_id=requested_tenant_id
    and source.environment=requested_environment
    and source.principal_id=requested_principal_id
  for update of source;';
  new_membership constant text := 'from app_data_agent.memberships as source
  where source.app_id=requested_app_id
    and source.tenant_id=requested_tenant_id
    and source.environment=requested_environment
    and source.principal_id=requested_principal_id
  for share of source;';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,old_deployment)=0
    or pg_catalog.strpos(definition,old_lifecycle)=0
    or pg_catalog.strpos(definition,old_membership)=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_LOCK_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,old_deployment,new_deployment);
  rewritten:=pg_catalog.replace(rewritten,old_lifecycle,new_lifecycle);
  rewritten:=pg_catalog.replace(rewritten,old_membership,new_membership);
  execute rewritten;
end
$lock_repair$;
