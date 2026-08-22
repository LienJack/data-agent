-- knowledge_document_authority_repair_migration_checksum: sha256:93857d25687ae8c986463353304b586d97e7910b4f190bcc8388f8e0e3017137
-- 10684 repairs Markdown knowledge-document authorship authority.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='KNOWLEDGE_DOCUMENT_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='KNOWLEDGE_DOCUMENT_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010683_app_data_agent_semantic_provider_authority')
  then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_REPAIR_BASELINE_10683_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $repair$
declare
  function_signature constant regprocedure :=
    'app_data_agent.commit_knowledge_document(jsonb,jsonb)'::regprocedure;
  current_definition text;
  repaired_definition text;
begin
  current_definition:=pg_catalog.pg_get_functiondef(function_signature);
  if pg_catalog.strpos(current_definition,'attempt.principal_id::text')=0
    or pg_catalog.strpos(current_definition,'job.principal_id::text')>0
  then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_REPAIR_BASELINE_CHANGED'; end if;
  repaired_definition:=pg_catalog.replace(
    current_definition,
    'attempt.principal_id::text',
    'job.principal_id::text'
  );
  if pg_catalog.strpos(repaired_definition,'attempt.principal_id::text')>0
    or pg_catalog.strpos(repaired_definition,'job.principal_id::text')=0
  then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_REPAIR_REWRITE_FAILED'; end if;
  execute repaired_definition;
end
$repair$;
alter function app_data_agent.commit_knowledge_document(jsonb,jsonb)
  owner to data_agent_u15_knowledge_owner;
revoke all on function app_data_agent.commit_knowledge_document(jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_data_agent.commit_knowledge_document(jsonb,jsonb)
  to data_agent_backend;

do $postconditions$
declare definition text:=pg_catalog.pg_get_functiondef(
  'app_data_agent.commit_knowledge_document(jsonb,jsonb)'::regprocedure
);
begin
  if pg_catalog.strpos(definition,'attempt.principal_id::text')>0
    or pg_catalog.strpos(definition,'job.principal_id::text')=0
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_knowledge_document(jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'anon','app_data_agent.commit_knowledge_document(jsonb,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='KNOWLEDGE_DOCUMENT_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010684_app_data_agent_knowledge_document_authority_repair',
  'sha256:93857d25687ae8c986463353304b586d97e7910b4f190bcc8388f8e0e3017137'
);
commit;
