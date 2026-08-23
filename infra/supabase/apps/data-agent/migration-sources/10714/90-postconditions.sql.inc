do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'platform.lock_research_analysis_provisioning_binding')=0
    or pg_catalog.strpos(definition,'from platform.deployment_mappings')>0
    or not pg_catalog.has_function_privilege(
      'data_agent_u6_provisioner_owner',
      'platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid)','EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'data_agent_u6_provisioner',
      'platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid)','EXECUTE'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_u6_provisioner_owner','platform.deployment_mappings','SELECT'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_u6_provisioner_owner','platform.app_environment_lifecycle','SELECT'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_u6_provisioner_owner','app_data_agent.memberships','SELECT'
    )
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PLATFORM_BINDING_NOT_INSTALLED'; end if;
end
$postconditions$;
