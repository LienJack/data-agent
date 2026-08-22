-- 10697 reuses immutable compiled projections when a source-only change leaves them unchanged.
begin;
do $bootstrap$ begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_PROJECTION_REUSE_EXECUTOR_UNSAFE'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010696_app_data_agent_semantic_self_publish_canonicalizer_grant')
  then raise exception using errcode='P0001',message='SEMANTIC_PROJECTION_REUSE_BASELINE_10696_MISSING'; end if;
end $bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
