-- semantic_relationship_retry_repair_migration_checksum: sha256:a78a36f975b3b1fdad67f4d245d4480e567598413d2a86c2058491aea61d3298
-- 10689 repairs relationship-index retry scheduling without schema-qualifying SQL LEAST syntax.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_RELATIONSHIP_RETRY_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_RELATIONSHIP_RETRY_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010688_app_data_agent_semantic_authoring_digest_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_RETRY_REPAIR_BASELINE_10688_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $repair$
declare
  function_definition text;
  broken_expression constant text := 'pg_catalog.least(300, 5 * (job.failure_count + 1))';
  repaired_expression constant text := 'least(300::bigint, 5::bigint * (job.failure_count + 1))';
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.fail_relationship_index_attempt(uuid,uuid,text,uuid,text,uuid,bigint,uuid,text)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(function_definition)-pg_catalog.length(
    pg_catalog.replace(function_definition,broken_expression,'')
  ))/pg_catalog.length(broken_expression)<>1
  then raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_RETRY_REPAIR_SOURCE_DRIFT'; end if;
  execute pg_catalog.replace(function_definition,broken_expression,repaired_expression);
end
$repair$;
do $postconditions$
declare function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.fail_relationship_index_attempt(uuid,uuid,text,uuid,text,uuid,bigint,uuid,text)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(function_definition,'pg_catalog.least(300, 5 * (job.failure_count + 1))')>0
    or pg_catalog.strpos(function_definition,'least(300::bigint, 5::bigint * (job.failure_count + 1))')=0
  then raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_RETRY_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010689_app_data_agent_semantic_relationship_retry_repair',
  'sha256:a78a36f975b3b1fdad67f4d245d4480e567598413d2a86c2058491aea61d3298'
);
commit;
