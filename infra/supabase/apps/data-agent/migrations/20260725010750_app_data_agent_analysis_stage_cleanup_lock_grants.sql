-- analysis_stage_cleanup_lock_grants_migration_checksum: sha256:50a44af9b124688c731b51ff41612bca7ce72d41b18a911f3026a6d78f09292a
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_STAGE_CLEANUP_LOCK_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_STAGE_CLEANUP_LOCK_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010749_app_data_agent_analysis_stage_cleanup_scope_grant')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_LOCK_GRANT_BASELINE_10749_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant update on table app_data_agent.analysis_result_stages to data_agent_u6_cleanup_owner;
grant select on table app_data_agent.analysis_authority_commits to data_agent_u6_cleanup_owner;

create policy analysis_authority_commits_cleanup_read on app_data_agent.analysis_authority_commits
for select to data_agent_u6_cleanup_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,true));
do $postconditions$
declare trigger_definition text;
begin
  select pg_catalog.pg_get_triggerdef(trigger.oid) into trigger_definition
  from pg_catalog.pg_trigger as trigger
  where trigger.tgrelid='app_data_agent.analysis_result_stages'::pg_catalog.regclass
    and trigger.tgname='analysis_result_stages_immutable' and not trigger.tgisinternal;
  if not pg_catalog.has_table_privilege('data_agent_u6_cleanup_owner',
      'app_data_agent.analysis_result_stages','SELECT,UPDATE,DELETE')
    or not pg_catalog.has_table_privilege('data_agent_u6_cleanup_owner',
      'app_data_agent.analysis_authority_commits','SELECT')
    or pg_catalog.strpos(trigger_definition,'analysis_stage_state_immutable')=0
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='analysis_result_stages'
        and policyname='analysis_result_stages_cleanup' and with_check='false')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_LOCK_PRIVILEGE_CLOSURE_INVALID'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010750_app_data_agent_analysis_stage_cleanup_lock_grants',
  'sha256:50a44af9b124688c731b51ff41612bca7ce72d41b18a911f3026a6d78f09292a');
commit;
