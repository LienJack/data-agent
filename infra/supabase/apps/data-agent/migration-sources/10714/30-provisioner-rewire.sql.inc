do $provisioner_rewire$
declare
  definition text;
  rewritten text;
  old_declarations constant text := '  locked_deployment record;
  locked_lifecycle record;
  locked_membership record;';
  new_declarations constant text := '  locked_binding jsonb;';
  old_binding constant text := '  select source.* into locked_deployment
  from platform.deployment_mappings as source
  where source.app_id=requested_app_id
    and source.environment=requested_environment
    and source.deployment_id=requested_deployment_id
  for share of source;
  select source.* into locked_lifecycle
  from platform.app_environment_lifecycle as source
  where source.app_id=requested_app_id and source.environment=requested_environment
  for share of source;
  select source.* into locked_membership
  from app_data_agent.memberships as source
  where source.app_id=requested_app_id
    and source.tenant_id=requested_tenant_id
    and source.environment=requested_environment
    and source.principal_id=requested_principal_id
  for share of source;
  if locked_deployment.deployment_id is null
    or not locked_deployment.is_active
    or locked_deployment.revoked_at is not null
    or locked_lifecycle.app_id is null
    or locked_lifecycle.lifecycle_state<>''ACTIVE''
    or locked_membership.principal_id is null
    or locked_membership.revoked_at is not null
    or pg_catalog.upper(locked_membership.membership_role) not in (''OWNER'',''ANALYST'')
  then raise exception using errcode=''42501'',message=''DA_U6_AUTHORITY_BINDING_INVALID''; end if;';
  new_binding constant text := '  locked_binding:=platform.lock_research_analysis_provisioning_binding(
    requested_app_id,requested_tenant_id,requested_environment,
    requested_deployment_id,requested_principal_id
  );';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,old_declarations)=0
    or pg_catalog.strpos(definition,old_binding)=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONER_REWIRE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,old_declarations,new_declarations);
  rewritten:=pg_catalog.replace(rewritten,old_binding,new_binding);
  rewritten:=pg_catalog.replace(
    rewritten,'locked_membership.membership_version','(locked_binding->>''membership_version'')::bigint'
  );
  rewritten:=pg_catalog.replace(
    rewritten,'locked_lifecycle.authority_epoch','(locked_binding->>''app_epoch'')::bigint'
  );
  rewritten:=pg_catalog.replace(
    rewritten,'pg_catalog.upper(locked_membership.membership_role)','locked_binding->>''membership_role'''
  );
  if pg_catalog.strpos(rewritten,'locked_membership')>0
    or pg_catalog.strpos(rewritten,'locked_lifecycle')>0
    or pg_catalog.strpos(rewritten,'locked_deployment')>0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONER_REWIRE_INCOMPLETE'; end if;
  execute rewritten;
end
$provisioner_rewire$;
