-- research_authority_provisioning_lock_repair_migration_checksum: sha256:c16249e452174eb244295b5726cfea9c079d31b08fea418a08df8e235a8aa757
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_PROVISIONING_LOCK_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_PROVISIONING_LOCK_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010712_app_data_agent_research_authority_provisioning')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_LOCK_REPAIR_BASELINE_10712_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant select on table platform.deployment_mappings
to data_agent_u6_provisioner_owner;
grant select on table platform.app_environment_lifecycle
to data_agent_u6_provisioner_owner;
grant select on table app_data_agent.memberships
to data_agent_u6_provisioner_owner;

do $lock_repair$
declare
  definition text;
  rewritten text;
  old_deployment constant text := 'from platform.deployment_mappings as source
  where source.app_id=requested_app_id
    and source.environment=requested_environment
    and source.deployment_id=requested_deployment_id
  for update of source;';
  new_deployment constant text := 'from platform.deployment_mappings as source
  where source.app_id=requested_app_id
    and source.environment=requested_environment
    and source.deployment_id=requested_deployment_id
  for share of source;';
  old_lifecycle constant text := 'from platform.app_environment_lifecycle as source
  where source.app_id=requested_app_id and source.environment=requested_environment
  for update of source;';
  new_lifecycle constant text := 'from platform.app_environment_lifecycle as source
  where source.app_id=requested_app_id and source.environment=requested_environment
  for share of source;';
  old_membership constant text := 'from app_data_agent.memberships as source
  where source.app_id=requested_app_id
    and source.tenant_id=requested_tenant_id
    and source.environment=requested_environment
    and source.principal_id=requested_principal_id
  for update of source;';
  new_membership constant text := 'from app_data_agent.memberships as source
  where source.app_id=requested_app_id
    and source.tenant_id=requested_tenant_id
    and source.environment=requested_environment
    and source.principal_id=requested_principal_id
  for share of source;';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,old_deployment)=0
    or pg_catalog.strpos(definition,old_lifecycle)=0
    or pg_catalog.strpos(definition,old_membership)=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_LOCK_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,old_deployment,new_deployment);
  rewritten:=pg_catalog.replace(rewritten,old_lifecycle,new_lifecycle);
  rewritten:=pg_catalog.replace(rewritten,old_membership,new_membership);
  execute rewritten;
end
$lock_repair$;
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
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010713_app_data_agent_research_authority_provisioning_lock_repair',
  'sha256:c16249e452174eb244295b5726cfea9c079d31b08fea418a08df8e235a8aa757');
commit;
