do $postconditions$
begin
  if not pg_catalog.has_function_privilege(
    'data_agent_u6_provisioner_owner','app_data_agent.u6_uuid_v5(uuid,bytea)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_u6_provisioner','app_data_agent.u6_uuid_v5(uuid,bytea)','EXECUTE'
  ) then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_UUID_GRANT_NOT_INSTALLED'; end if;
end
$postconditions$;
