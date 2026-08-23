do $binding_reuse$
declare
  definition text;
  rewritten text;
  old_call constant text := '  locked_binding:=platform.lock_research_analysis_provisioning_binding(
    requested_app_id,requested_tenant_id,requested_environment,
    requested_deployment_id,requested_principal_id
  );';
  new_call constant text := '  locked_binding:=platform.lock_u6_authority_binding(
    requested_app_id,requested_tenant_id,requested_environment,
    requested_deployment_id,requested_principal_id,requested_membership_role,''PROVISION''
  );';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,old_call)=0
    or pg_catalog.strpos(definition,'  requested_profile text;')=0
    or pg_catalog.strpos(definition,'    ))<>8')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_BINDING_REUSE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(
    definition,'  requested_profile text;','  requested_profile text;
  requested_membership_role text;'
  );
  rewritten:=pg_catalog.replace(rewritten,'    ))<>8','    ))<>9');
  rewritten:=pg_catalog.replace(
    rewritten,
    '    requested_profile:=envelope_json->>''profile'';',
    '    requested_profile:=envelope_json->>''profile'';
    requested_membership_role:=envelope_json->>''membership_role'';'
  );
  rewritten:=pg_catalog.replace(
    rewritten,
    '  then raise exception using errcode=''22023'',message=''DA_U6_AUTHORITY_MANIFEST_INVALID''; end if;

  db_now:=pg_catalog.clock_timestamp();',
    '  then raise exception using errcode=''22023'',message=''DA_U6_AUTHORITY_MANIFEST_INVALID''; end if;
  if requested_membership_role not in (''OWNER'',''ANALYST'') then
    raise exception using errcode=''22023'',message=''DA_U6_AUTHORITY_MANIFEST_INVALID'';
  end if;

  db_now:=pg_catalog.clock_timestamp();'
  );
  rewritten:=pg_catalog.replace(rewritten,old_call,new_call);
  if pg_catalog.strpos(rewritten,'lock_research_analysis_provisioning_binding')>0
    or pg_catalog.strpos(rewritten,'requested_membership_role')=0
    or pg_catalog.strpos(rewritten,new_call)=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_BINDING_REUSE_INCOMPLETE'; end if;
  execute rewritten;
end
$binding_reuse$;

revoke all privileges on function platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority,
  data_agent_u6_provisioner,data_agent_u6_provisioner_owner;
drop function platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid);
