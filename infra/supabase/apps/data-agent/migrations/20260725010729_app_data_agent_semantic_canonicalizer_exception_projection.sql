-- semantic_canonicalizer_exception_migration_checksum: sha256:7a6cb48bacfa1bda7294b0d45acb3698015b92db4ea38d4a95664142c26f294e
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_CANONICALIZER_EXCEPTION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_CANONICALIZER_EXCEPTION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010728_app_data_agent_semantic_retrieval_hash_phase')
  then raise exception using errcode='P0001',message='SEMANTIC_CANONICALIZER_EXCEPTION_BASELINE_10728_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $canonicalizer_exception_projection$
declare
  definition text;
  rewritten text;
  handler_anchor constant text := $$  if pg_catalog.strpos(failure_context,'semantic_context_uuid_v8_from_hash')>0 then$$;
  canonicalizer_handlers constant text := $$  if pg_catalog.strpos(failure_context,'u2_ecmascript_number')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_NUMBER_CANONICALIZATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'u2_utf16_sort_key')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_KEY_CANONICALIZATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'attribution_canonical_json')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_SCALAR_CANONICALIZATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'u2_contract_canonical_json')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_DOCUMENT_CANONICALIZATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'semantic_context_uuid_v8_from_hash')>0 then$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,handler_anchor)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_NUMBER_CANONICALIZATION_INVALID')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CANONICALIZER_EXCEPTION_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,handler_anchor,canonicalizer_handlers);
  execute rewritten;
end
$canonicalizer_exception_projection$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_NUMBER_CANONICALIZATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_KEY_CANONICALIZATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_SCALAR_CANONICALIZATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_DOCUMENT_CANONICALIZATION_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RETRIEVAL_HASH_INPUT_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CANONICALIZER_EXCEPTION_PROJECTION_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010729_app_data_agent_semantic_canonicalizer_exception_projection',
  'sha256:7a6cb48bacfa1bda7294b0d45acb3698015b92db4ea38d4a95664142c26f294e');
commit;
