-- analysis_authority_row_lock_policy_migration_checksum: sha256:96496035866dc4d94736ad152785aab17dfc9c77499dbf62f61f81143f35b5fc
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_AUTHORITY_ROW_LOCK_POLICY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_AUTHORITY_ROW_LOCK_POLICY_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010759_app_data_agent_analysis_authority_row_lock_grant')
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_POLICY_BASELINE_10759_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create policy analysis_result_stages_rpc_lock on app_data_agent.analysis_result_stages
for update to data_agent_u6_rpc_owner
using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check(false);
do $postconditions$
declare policy_qual text;
begin
  select qual into policy_qual from pg_catalog.pg_policies
  where schemaname='app_data_agent' and tablename='analysis_result_stages'
    and policyname='analysis_result_stages_rpc_lock' and cmd='UPDATE'
    and roles='{data_agent_u6_rpc_owner}' and with_check='false';
  if policy_qual is null
    or pg_catalog.strpos(policy_qual,'backend_run_object_matches')=0
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_POLICY_DRIFT'; end if;
  if not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner','app_data_agent.analysis_result_stages','UPDATE')
    or not exists(select 1 from pg_catalog.pg_class
      where oid='app_data_agent.analysis_result_stages'::pg_catalog.regclass
        and relrowsecurity and relforcerowsecurity)
  then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_ROW_LOCK_POLICY_BOUNDARY_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010760_app_data_agent_analysis_authority_row_lock_policy',
  'sha256:96496035866dc4d94736ad152785aab17dfc9c77499dbf62f61f81143f35b5fc');
commit;
