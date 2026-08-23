do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'from platform.deployment_mappings as source')=0
    or pg_catalog.strpos(definition,'for share of source')=0
    or pg_catalog.strpos(definition,'from app_data_agent.memberships as source')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_SHARED_LOCK_NOT_INSTALLED'; end if;
  if not pg_catalog.has_table_privilege(
    'data_agent_u6_provisioner_owner','platform.deployment_mappings','SELECT'
  ) or not pg_catalog.has_table_privilege(
    'data_agent_u6_provisioner_owner','platform.app_environment_lifecycle','SELECT'
  ) or not pg_catalog.has_table_privilege(
    'data_agent_u6_provisioner_owner','app_data_agent.memberships','SELECT'
  ) or pg_catalog.has_table_privilege(
    'data_agent_u6_provisioner_owner','platform.deployment_mappings','UPDATE'
  ) or pg_catalog.has_table_privilege(
    'data_agent_u6_provisioner_owner','platform.app_environment_lifecycle','UPDATE'
  ) or pg_catalog.has_table_privilege(
    'data_agent_u6_provisioner_owner','app_data_agent.memberships','UPDATE'
  ) then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_TABLE_ACL_INVALID'; end if;
end
$postconditions$;
