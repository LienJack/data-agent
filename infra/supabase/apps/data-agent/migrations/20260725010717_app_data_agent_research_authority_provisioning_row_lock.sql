-- research_authority_provisioning_row_lock_migration_checksum: sha256:b3f66acd9a7c66099507ef9ba2e71f6fa43f55565455c3adaa674b3efbb04c5b
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_PROVISIONING_ROW_LOCK_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_PROVISIONING_ROW_LOCK_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010716_app_data_agent_research_authority_provisioning_rls')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_ROW_LOCK_BASELINE_10716_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create policy memberships_u6_provisioner_lock_update
on app_data_agent.memberships
for update to data_agent_u6_platform_lock_owner
using (pg_catalog.pg_has_role(session_user,'data_agent_u6_provisioner','SET'))
with check (false);
do $postconditions$
declare
  using_definition text;
  check_definition text;
begin
  select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid),
    pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid)
  into strict using_definition,check_definition
  from pg_catalog.pg_policy as policy
  where policy.polrelid='app_data_agent.memberships'::pg_catalog.regclass
    and policy.polname='memberships_u6_provisioner_lock_update';
  if pg_catalog.strpos(using_definition,'data_agent_u6_provisioner')=0
    or pg_catalog.strpos(using_definition,'SESSION_USER')=0
    or check_definition<>'false'
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_ROW_LOCK_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010717_app_data_agent_research_authority_provisioning_row_lock',
  'sha256:b3f66acd9a7c66099507ef9ba2e71f6fa43f55565455c3adaa674b3efbb04c5b');
commit;
