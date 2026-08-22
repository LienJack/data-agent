-- semantic_self_publish_canonicalizer_grant_migration_checksum: sha256:53530f568a3cc221f99aa0b695824aed6c4689f0a45f7bf2cedd3766d17a26dc
-- 10696 grants self-publish the canonicalizer used by semantic.authoring_sha256.
begin;
do $bootstrap$ begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_SELF_PUBLISH_CANONICALIZER_GRANT_EXECUTOR_UNSAFE'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010695_app_data_agent_semantic_self_publish_digest_grant')
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_CANONICALIZER_GRANT_BASELINE_10695_MISSING'; end if;
end $bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant execute on function semantic.authoring_canonical_json(jsonb)
  to data_agent_u5_self_publish_owner;
do $postconditions$ begin
  if not pg_catalog.has_function_privilege(
    'data_agent_u5_self_publish_owner','semantic.authoring_canonical_json(jsonb)','EXECUTE'
  ) then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_CANONICALIZER_GRANT_POSTCONDITION_FAILED'; end if;
end $postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010696_app_data_agent_semantic_self_publish_canonicalizer_grant',
  'sha256:53530f568a3cc221f99aa0b695824aed6c4689f0a45f7bf2cedd3766d17a26dc'
);
commit;
