do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'app.u6_provision_app_id')=0
    or pg_catalog.strpos(definition,'app.u6_provision_tenant_id')=0
    or pg_catalog.strpos(definition,'app.u6_provision_environment')=0
    or pg_catalog.strpos(definition,'platform.lock_u6_authority_binding')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_SCOPE_NOT_INSTALLED'; end if;
end
$postconditions$;
