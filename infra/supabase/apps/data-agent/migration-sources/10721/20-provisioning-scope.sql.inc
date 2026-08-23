do $scope_repair$
declare
  definition text;
  rewritten text;
  binding_call constant text := '  locked_binding:=platform.lock_u6_authority_binding(
    requested_app_id,requested_tenant_id,requested_environment,
    requested_deployment_id,requested_principal_id,requested_membership_role,''PROVISION''
  );';
  scoped_binding_call constant text := '  locked_binding:=platform.lock_u6_authority_binding(
    requested_app_id,requested_tenant_id,requested_environment,
    requested_deployment_id,requested_principal_id,requested_membership_role,''PROVISION''
  );
  perform pg_catalog.set_config(''app.u6_provision_app_id'',requested_app_id::text,true);
  perform pg_catalog.set_config(''app.u6_provision_tenant_id'',requested_tenant_id::text,true);
  perform pg_catalog.set_config(''app.u6_provision_environment'',requested_environment,true);';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,binding_call)=0
    or pg_catalog.strpos(definition,'app.u6_provision_app_id')>0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_SCOPE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,binding_call,scoped_binding_call);
  execute rewritten;
end
$scope_repair$;
