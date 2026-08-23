create function platform.lock_research_analysis_provisioning_binding(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  deployment record;
  lifecycle record;
  membership record;
begin
  if pg_catalog.current_setting('role',true)<>'data_agent_u6_provisioner'
    or requested_app_id is null
    or requested_tenant_id is null
    or requested_environment is null
    or requested_deployment_id is null
    or requested_principal_id is null
  then raise exception using errcode='42501',message='DA_U6_PROVISIONER_REQUIRED'; end if;

  select source.* into deployment
  from platform.deployment_mappings as source
  where source.app_id=requested_app_id
    and source.environment=requested_environment
    and source.deployment_id=requested_deployment_id
  for share of source nowait;
  select source.* into lifecycle
  from platform.app_environment_lifecycle as source
  where source.app_id=requested_app_id and source.environment=requested_environment
  for share of source nowait;
  select source.* into membership
  from app_data_agent.memberships as source
  where source.app_id=requested_app_id
    and source.tenant_id=requested_tenant_id
    and source.environment=requested_environment
    and source.principal_id=requested_principal_id
  for share of source nowait;
  if deployment.deployment_id is null
    or not deployment.is_active
    or deployment.revoked_at is not null
    or lifecycle.app_id is null
    or lifecycle.lifecycle_state<>'ACTIVE'
    or membership.principal_id is null
    or membership.revoked_at is not null
    or pg_catalog.upper(membership.membership_role) not in ('OWNER','ANALYST')
  then raise exception using errcode='42501',message='DA_U6_AUTHORITY_BINDING_INVALID'; end if;

  return pg_catalog.jsonb_build_object(
    'membership_version',membership.membership_version,
    'app_epoch',lifecycle.authority_epoch,
    'membership_role',pg_catalog.upper(membership.membership_role)
  );
end
$function$;

alter function platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid)
owner to data_agent_u6_platform_lock_owner;
revoke all privileges on function platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority,data_agent_u6_provisioner;
grant execute on function platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid)
to data_agent_u6_provisioner_owner;

revoke select on table platform.deployment_mappings
from data_agent_u6_provisioner_owner;
revoke select on table platform.app_environment_lifecycle
from data_agent_u6_provisioner_owner;
revoke select on table app_data_agent.memberships
from data_agent_u6_provisioner_owner;
