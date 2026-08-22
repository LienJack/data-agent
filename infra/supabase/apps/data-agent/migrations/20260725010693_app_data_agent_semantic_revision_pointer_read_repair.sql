-- semantic_revision_pointer_read_repair_migration_checksum: sha256:00043ad2b82e6ae2f350e2378c89092ca8309795c5e2ca44df4a20278d2fd13a
-- 10693 removes a redundant active-pointer row lock hidden by its read-only RLS policy.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_REVISION_POINTER_READ_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_REVISION_POINTER_READ_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010692_app_data_agent_semantic_revision_idempotency_lock')
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_POINTER_READ_REPAIR_BASELINE_10692_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $repair$
declare function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.save_semantic_candidate_revision(jsonb)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(function_definition)-pg_catalog.length(
    pg_catalog.replace(function_definition,'for share;','')
  ))/pg_catalog.length('for share;')<>1
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_POINTER_READ_REPAIR_SOURCE_DRIFT'; end if;
  execute pg_catalog.replace(function_definition,'for share;',';');
end
$repair$;
do $postconditions$
declare function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.save_semantic_candidate_revision(jsonb)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(function_definition,'for share;')>0
    or pg_catalog.strpos(function_definition,'semantic.lock_semantic_authority_fence')=0
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_POINTER_READ_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010693_app_data_agent_semantic_revision_pointer_read_repair',
  'sha256:00043ad2b82e6ae2f350e2378c89092ca8309795c5e2ca44df4a20278d2fd13a'
);
commit;
