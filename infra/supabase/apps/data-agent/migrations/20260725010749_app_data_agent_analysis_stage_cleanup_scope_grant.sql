-- analysis_stage_cleanup_scope_grant_migration_checksum: sha256:ef5abfba9d1f7f191aaaefcd64d617f2e441a1bcc4161e72b12b330b6782b224
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_STAGE_CLEANUP_SCOPE_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_STAGE_CLEANUP_SCOPE_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010748_app_data_agent_analysis_stage_cleanup_authority')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_SCOPE_GRANT_BASELINE_10748_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant execute on function platform.backend_context_matches(uuid,uuid,text,boolean)
to data_agent_u6_cleanup_owner;
do $postconditions$
begin
  if not pg_catalog.has_function_privilege('data_agent_u6_cleanup_owner',
    'platform.backend_context_matches(uuid,uuid,text,boolean)','EXECUTE')
  then raise exception using errcode='P0001',message='ANALYSIS_STAGE_CLEANUP_SCOPE_GRANT_MISSING'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010749_app_data_agent_analysis_stage_cleanup_scope_grant',
  'sha256:ef5abfba9d1f7f191aaaefcd64d617f2e441a1bcc4161e72b12b330b6782b224');
commit;
