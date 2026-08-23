-- research_authority_platform_binding_migration_checksum: sha256:3b5890e4d3c29db39a1eed9b841a3bcae4b20e4c5a2b06650f5f61bee3f34aa9
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_PLATFORM_BINDING_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_PLATFORM_BINDING_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010713_app_data_agent_research_authority_provisioning_lock_repair')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PLATFORM_BINDING_BASELINE_10713_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010714_app_data_agent_research_authority_platform_binding',
  'sha256:3b5890e4d3c29db39a1eed9b841a3bcae4b20e4c5a2b06650f5f61bee3f34aa9');
commit;
