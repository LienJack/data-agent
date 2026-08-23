-- knowledge_evidence_revision_repair_migration_checksum: sha256:847e1767f33776b43b314f87be83f41b794526ed4664d9fc6c8d688d9dfaf11e
-- 10679 permits READY revisions to select immutable blocks from their retained sources.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='KNOWLEDGE_EVIDENCE_REVISION_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='KNOWLEDGE_EVIDENCE_REVISION_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010678_app_data_agent_knowledge_evidence_authority_repair')
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REVISION_REPAIR_BASELINE_10678_MISSING'; end if;
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
  old_predicate constant text :=
    'and block.knowledge_base_revision=(requested_selection#>>''{knowledge_base_ref,revision}'')::bigint
      and block.knowledge_base_revision_hash=requested_selection#>>''{knowledge_base_ref,revision_hash}''';
  new_predicate constant text :=
    'and block.knowledge_base_revision<=(requested_selection#>>''{knowledge_base_ref,revision}'')::bigint
      and exists(
        select 1
        from app_data_agent.knowledge_base_revisions selected_base
        join app_data_agent.knowledge_document_revisions selected_document
          on selected_document.app_id=block.app_id
          and selected_document.tenant_id=block.tenant_id
          and selected_document.environment=block.environment
          and selected_document.knowledge_base_id=block.knowledge_base_id
          and selected_document.document_id=block.document_id
          and selected_document.revision=block.document_revision
        where selected_base.app_id=block.app_id
          and selected_base.tenant_id=block.tenant_id
          and selected_base.environment=block.environment
          and selected_base.knowledge_base_id=block.knowledge_base_id
          and selected_base.revision=(requested_selection#>>''{knowledge_base_ref,revision}'')::bigint
          and selected_base.revision_hash=requested_selection#>>''{knowledge_base_ref,revision_hash}''
          and selected_base.status=''READY''
          and exists(
            select 1 from pg_catalog.jsonb_array_elements(selected_base.source_refs_json) retained_source
            where retained_source.value=selected_document.revision_json->''source_file_ref''
          )
      )';
begin
  current_definition:=pg_catalog.pg_get_functiondef(function_signature);
  if pg_catalog.strpos(current_definition,old_predicate)=0
    or pg_catalog.strpos(current_definition,'selected_base.status=''READY''')>0
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REVISION_REPAIR_BASELINE_CHANGED'; end if;
  repaired_definition:=pg_catalog.replace(current_definition,old_predicate,new_predicate);
  if pg_catalog.strpos(repaired_definition,old_predicate)>0
    or pg_catalog.strpos(repaired_definition,new_predicate)=0
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REVISION_REPAIR_REWRITE_FAILED'; end if;
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
  if pg_catalog.strpos(definition,'selected_base.status=''READY''')=0
    or pg_catalog.strpos(definition,'retained_source.value=selected_document.revision_json->''source_file_ref''')=0
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.create_knowledge_evidence_selection(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'anon','app_data_agent.create_knowledge_evidence_selection(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='KNOWLEDGE_EVIDENCE_REVISION_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010679_app_data_agent_knowledge_evidence_revision_repair',
  'sha256:847e1767f33776b43b314f87be83f41b794526ed4664d9fc6c8d688d9dfaf11e'
);
commit;
