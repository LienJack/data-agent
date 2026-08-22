-- 10689 grants self-publish the canonicalizer used by semantic.authoring_sha256.
begin;
do $bootstrap$ begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_SELF_PUBLISH_CANONICALIZER_GRANT_EXECUTOR_UNSAFE'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010688_app_data_agent_semantic_self_publish_digest_grant')
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_CANONICALIZER_GRANT_BASELINE_10688_MISSING'; end if;
end $bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
