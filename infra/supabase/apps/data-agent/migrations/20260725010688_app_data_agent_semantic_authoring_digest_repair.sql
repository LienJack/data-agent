-- semantic_authoring_digest_repair_migration_checksum: sha256:e094d5e59a1572d2990c347df0381f94a7dcca48957ad0b49533ef77272acbfe
-- 10688 aligns explicit semantic authoring RPC validation with the TypeScript canonical JSON contract.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_AUTHORING_DIGEST_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_AUTHORING_DIGEST_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010687_app_data_agent_semantic_provider_validator_grant')
  then raise exception using errcode='P0001',message='SEMANTIC_AUTHORING_DIGEST_REPAIR_BASELINE_10687_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $repair$
declare
  function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.start_manual_semantic_authoring(jsonb)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(function_definition,'platform.canonical_sha256')=0
    or pg_catalog.strpos(function_definition,'semantic.authoring_sha256')>0
  then raise exception using errcode='P0001',message='SEMANTIC_MANUAL_DIGEST_REPAIR_SOURCE_DRIFT'; end if;
  function_definition:=pg_catalog.replace(
    function_definition,'platform.canonical_sha256','semantic.authoring_sha256'
  );
  execute function_definition;

  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.self_review_and_publish_semantic_candidate(jsonb)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(function_definition)-pg_catalog.length(
    pg_catalog.replace(function_definition,'platform.canonical_sha256','')
  ))/pg_catalog.length('platform.canonical_sha256')<>4
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_DIGEST_REPAIR_SOURCE_DRIFT'; end if;
  function_definition:=pg_catalog.replace(
    function_definition,'platform.canonical_sha256','semantic.authoring_sha256'
  );
  execute function_definition;
end
$repair$;
do $postconditions$
declare manual_definition text; publish_definition text;
begin
  manual_definition:=pg_catalog.pg_get_functiondef(
    'semantic.start_manual_semantic_authoring(jsonb)'::pg_catalog.regprocedure
  );
  publish_definition:=pg_catalog.pg_get_functiondef(
    'semantic.self_review_and_publish_semantic_candidate(jsonb)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(manual_definition,'platform.canonical_sha256')>0
    or pg_catalog.strpos(manual_definition,'semantic.authoring_sha256')=0
    or pg_catalog.strpos(publish_definition,'platform.canonical_sha256')>0
    or (pg_catalog.length(publish_definition)-pg_catalog.length(
      pg_catalog.replace(publish_definition,'semantic.authoring_sha256','')
    ))/pg_catalog.length('semantic.authoring_sha256')<>4
  then raise exception using errcode='P0001',message='SEMANTIC_AUTHORING_DIGEST_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010688_app_data_agent_semantic_authoring_digest_repair',
  'sha256:e094d5e59a1572d2990c347df0381f94a7dcca48957ad0b49533ef77272acbfe'
);
commit;
