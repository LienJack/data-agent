-- research_authority_binding_reuse_migration_checksum: sha256:5bc6f6c4389d33c59ed64735a7f2e995a8faaee50849303c6a115957662340c5
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_BINDING_REUSE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_BINDING_REUSE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010714_app_data_agent_research_authority_platform_binding')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_BINDING_REUSE_BASELINE_10714_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'platform.lock_u6_authority_binding')=0
    or pg_catalog.strpos(definition,'''PROVISION''')=0
    or pg_catalog.strpos(definition,'requested_membership_role')=0
    or pg_catalog.strpos(definition,'lock_research_analysis_provisioning_binding')>0
    or pg_catalog.to_regprocedure(
      'platform.lock_research_analysis_provisioning_binding(uuid,uuid,text,uuid,uuid)'
    ) is not null
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_BINDING_REUSE_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010715_app_data_agent_research_authority_binding_reuse',
  'sha256:5bc6f6c4389d33c59ed64735a7f2e995a8faaee50849303c6a115957662340c5');
commit;
