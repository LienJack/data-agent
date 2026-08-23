-- qa_directory_semantic_helper_migration_checksum: sha256:2acf66a119655572908c444160d96bfd86cc029d8daf0fc80cb531b939b7d695
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='QA_DIRECTORY_SEMANTIC_HELPER_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='QA_DIRECTORY_SEMANTIC_HELPER_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010731_app_data_agent_semantic_document_hash_precedence')
  then raise exception using errcode='P0001',message='QA_DIRECTORY_SEMANTIC_HELPER_BASELINE_10731_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $directory_helper_cutover$
declare definition text; rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_qa_conversation_directory(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,'app_data_agent.resolved_context_exact_keys',''
    )))/pg_catalog.length('app_data_agent.resolved_context_exact_keys')<>1
    or pg_catalog.strpos(definition,'app_data_agent.semantic_context_exact_keys')>0
  then raise exception using errcode='P0001',message='QA_DIRECTORY_SEMANTIC_HELPER_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(
    definition,
    'app_data_agent.resolved_context_exact_keys',
    'app_data_agent.semantic_context_exact_keys'
  );
  execute rewritten;
end
$directory_helper_cutover$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_qa_conversation_directory(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'app_data_agent.resolved_context_exact_keys')>0
    or pg_catalog.strpos(definition,'app_data_agent.semantic_context_exact_keys')=0
    or pg_catalog.to_regprocedure('app_data_agent.resolved_context_exact_keys(jsonb,text[])') is not null
  then raise exception using errcode='P0001',message='QA_DIRECTORY_SEMANTIC_HELPER_CUTOVER_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010732_app_data_agent_qa_directory_semantic_helper_cutover',
  'sha256:2acf66a119655572908c444160d96bfd86cc029d8daf0fc80cb531b939b7d695');
commit;
