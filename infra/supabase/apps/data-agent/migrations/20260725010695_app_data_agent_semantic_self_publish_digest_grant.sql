-- semantic_self_publish_digest_grant_migration_checksum: sha256:2f48f1760c6702daab42717b3a468cfeb42d1ce23fe7bc268a757ce72cf5916b
-- 10695 grants self-publish its repaired canonical digest dependency.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_SELF_PUBLISH_DIGEST_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_SELF_PUBLISH_DIGEST_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010694_app_data_agent_semantic_revision_evidence_read')
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_DIGEST_GRANT_BASELINE_10694_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant usage on schema semantic to data_agent_u5_self_publish_owner;
grant execute on function semantic.authoring_sha256(jsonb) to data_agent_u5_self_publish_owner;
do $postconditions$
begin
  if not pg_catalog.has_schema_privilege('data_agent_u5_self_publish_owner','semantic','USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_u5_self_publish_owner','semantic.authoring_sha256(jsonb)','EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon','semantic.self_review_and_publish_semantic_candidate(jsonb)','EXECUTE'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_DIGEST_GRANT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010695_app_data_agent_semantic_self_publish_digest_grant',
  'sha256:2f48f1760c6702daab42717b3a468cfeb42d1ce23fe7bc268a757ce72cf5916b'
);
commit;
