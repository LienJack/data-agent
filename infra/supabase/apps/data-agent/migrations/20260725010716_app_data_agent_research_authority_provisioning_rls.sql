-- research_authority_provisioning_rls_migration_checksum: sha256:66f6cf01cc89c5073a7a30f73e553907b3b339b21f25218ce901ff9f0b4fbf7a
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_PROVISIONING_RLS_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_PROVISIONING_RLS_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010715_app_data_agent_research_authority_binding_reuse')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_RLS_BASELINE_10715_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create policy memberships_u6_provisioner_lock_select
on app_data_agent.memberships
for select to data_agent_u6_platform_lock_owner
using (pg_catalog.pg_has_role(session_user,'data_agent_u6_provisioner','SET'));
do $postconditions$
declare policy_definition text;
begin
  select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid)
  into strict policy_definition
  from pg_catalog.pg_policy as policy
  where policy.polrelid='app_data_agent.memberships'::pg_catalog.regclass
    and policy.polname='memberships_u6_provisioner_lock_select';
  if pg_catalog.strpos(policy_definition,'data_agent_u6_provisioner')=0
    or pg_catalog.strpos(policy_definition,'SESSION_USER')=0
    or pg_catalog.strpos(policy_definition,'''SET''')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_RLS_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010716_app_data_agent_research_authority_provisioning_rls',
  'sha256:66f6cf01cc89c5073a7a30f73e553907b3b339b21f25218ce901ff9f0b4fbf7a');
commit;
