do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'platform.lock_u6_authority_binding')=0
    or pg_catalog.strpos(definition,'''PROVISION''')=0
    or pg_catalog.strpos(definition,'requested_membership_role')=0
    or pg_catalog.strpos(definition,'lock_research_analysis_provisioning_binding')>0
    or pg_catalog.to_regprocedure(
      'platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid)'
    ) is not null
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_BINDING_REUSE_NOT_INSTALLED'; end if;
end
$postconditions$;
