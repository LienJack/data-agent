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
