-- research_authority_provisioning_scope_migration_checksum: sha256:4ede90a260910f8b18b0e12b297c2666ec5a6cf8ab09fa41425f468046762304
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_PROVISIONING_SCOPE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_PROVISIONING_SCOPE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010720_app_data_agent_research_authority_uuid_grant')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_SCOPE_BASELINE_10720_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $scope_repair$
declare
  definition text;
  rewritten text;
  binding_call constant text := '  locked_binding:=platform.lock_u6_authority_binding(
    requested_app_id,requested_tenant_id,requested_environment,
    requested_deployment_id,requested_principal_id,requested_membership_role,''PROVISION''
  );';
  scoped_binding_call constant text := '  locked_binding:=platform.lock_u6_authority_binding(
    requested_app_id,requested_tenant_id,requested_environment,
    requested_deployment_id,requested_principal_id,requested_membership_role,''PROVISION''
  );
  perform pg_catalog.set_config(''app.u6_provision_app_id'',requested_app_id::text,true);
  perform pg_catalog.set_config(''app.u6_provision_tenant_id'',requested_tenant_id::text,true);
  perform pg_catalog.set_config(''app.u6_provision_environment'',requested_environment,true);';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,binding_call)=0
    or pg_catalog.strpos(definition,'app.u6_provision_app_id')>0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_SCOPE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,binding_call,scoped_binding_call);
  execute rewritten;
end
$scope_repair$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'app.u6_provision_app_id')=0
    or pg_catalog.strpos(definition,'app.u6_provision_tenant_id')=0
    or pg_catalog.strpos(definition,'app.u6_provision_environment')=0
    or pg_catalog.strpos(definition,'platform.lock_u6_authority_binding')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_SCOPE_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010721_app_data_agent_research_authority_provisioning_scope',
  'sha256:4ede90a260910f8b18b0e12b297c2666ec5a6cf8ab09fa41425f468046762304');
commit;
