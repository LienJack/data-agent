alter function app_data_agent.provision_u6_authority_manifest(jsonb)
owner to data_agent_u6_provisioner_owner;
revoke all privileges on function app_data_agent.provision_u6_authority_manifest(jsonb)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
grant execute on function app_data_agent.provision_u6_authority_manifest(jsonb)
to data_agent_u6_provisioner;

do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'RESEARCH_ANALYSIS_WORKER')=0
    or pg_catalog.strpos(definition,'DA_U6_AUTHORITY_MANIFEST_CONTRACT_UNAVAILABLE')>0
    or pg_catalog.strpos(definition,'REPORT_READ_AUTHORITY')=0
    or pg_catalog.strpos(definition,'pg_advisory_xact_lock')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONER_NOT_INSTALLED'; end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_u6_provisioner','app_data_agent.provision_u6_authority_manifest(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend','app_data_agent.provision_u6_authority_manifest(jsonb)','EXECUTE'
  ) then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONER_ACL_INVALID'; end if;
end
$postconditions$;
