-- knowledge_evidence_authority_repair_migration_checksum: sha256:8b7528f70d946bc75922ea79cdac870c93a736f427d28111ccdc1a3e0b783e80
-- 10685 removes an ambiguous PL/pgSQL variable from evidence selection writes.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='KNOWLEDGE_EVIDENCE_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='KNOWLEDGE_EVIDENCE_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010684_app_data_agent_knowledge_document_authority_repair')
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REPAIR_BASELINE_10684_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $repair$
declare
  function_signature constant regprocedure :=
    'app_data_agent.create_knowledge_evidence_selection(jsonb)'::regprocedure;
  current_definition text;
  repaired_definition text;
begin
  current_definition:=pg_catalog.pg_get_functiondef(function_signature);
  if pg_catalog.strpos(current_definition,'ordinal bigint:=0')=0
    or pg_catalog.strpos(current_definition,'selection_ordinal bigint:=0')>0
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REPAIR_BASELINE_CHANGED'; end if;
  repaired_definition:=pg_catalog.replace(current_definition,'ordinal bigint:=0','selection_ordinal bigint:=0');
  repaired_definition:=pg_catalog.replace(
    repaired_definition,
    '(requested_selection->>''selection_id'')::uuid,ordinal,block.document_id',
    '(requested_selection->>''selection_id'')::uuid,selection_ordinal,block.document_id'
  );
  repaired_definition:=pg_catalog.replace(
    repaired_definition,
    'ordinal:=ordinal+1',
    'selection_ordinal:=selection_ordinal+1'
  );
  if repaired_definition~'\mordinal bigint:=0'
    or pg_catalog.strpos(repaired_definition,'selection_ordinal bigint:=0')=0
    or pg_catalog.strpos(repaired_definition,'::uuid,ordinal,block.document_id')>0
    or pg_catalog.strpos(repaired_definition,'    ordinal:=ordinal+1;')>0
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REPAIR_REWRITE_FAILED'; end if;
  execute repaired_definition;
end
$repair$;
alter function app_data_agent.create_knowledge_evidence_selection(jsonb)
  owner to data_agent_u15_knowledge_owner;
revoke all on function app_data_agent.create_knowledge_evidence_selection(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_data_agent.create_knowledge_evidence_selection(jsonb)
  to data_agent_backend;

do $postconditions$
declare definition text:=pg_catalog.pg_get_functiondef(
  'app_data_agent.create_knowledge_evidence_selection(jsonb)'::regprocedure
);
begin
  if pg_catalog.strpos(definition,'selection_ordinal bigint:=0')=0
    or definition~'\mordinal bigint:=0'
    or pg_catalog.strpos(definition,'::uuid,ordinal,block.document_id')>0
    or pg_catalog.strpos(definition,'    ordinal:=ordinal+1;')>0
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.create_knowledge_evidence_selection(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'anon','app_data_agent.create_knowledge_evidence_selection(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010685_app_data_agent_knowledge_evidence_authority_repair',
  'sha256:8b7528f70d946bc75922ea79cdac870c93a736f427d28111ccdc1a3e0b783e80'
);
commit;
