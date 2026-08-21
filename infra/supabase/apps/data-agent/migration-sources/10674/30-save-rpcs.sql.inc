create function semantic.save_semantic_candidate_revision(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare scope_value jsonb; app_id_value uuid; tenant_id_value uuid; environment_value text;
  domain_value text; principal_value uuid; run_record semantic.semantic_authoring_run%rowtype;
  candidate_record semantic.semantic_candidate%rowtype;
  idempotency_record semantic.semantic_candidate_revision_save_idempotency%rowtype;
  source_revision_id_value uuid:=extensions.gen_random_uuid();
  candidate_revision_id_value uuid:=extensions.gen_random_uuid();
  source_revision_number_value integer; candidate_revision_number_value integer;
  source_digest_value text; revision_payload_value jsonb; revision_digest_value text;
  result_value jsonb; evidence_value jsonb;
begin
  if p_command is null or pg_catalog.jsonb_typeof(p_command)<>'object'
    or p_command-array[
      'schema_version','command_id','scope','semantic_domain','principal_id','authoring_run_id',
      'candidate_id','base_release_id','expected_working_revision','expected_graph_digest',
      'final_graph','final_graph_digest','manual_patch','operation_origins','evidence_selection_refs',
      'validation_receipt','summary','idempotency_key','saved_at','command_hash'
    ]<>'{}'::jsonb
    or p_command->>'schema_version'<>'semantic-candidate-revision-save-command@1.0.0'
    or p_command->>'command_hash'<>platform.canonical_sha256(p_command-'command_hash')
    or platform.canonical_sha256(p_command->'final_graph')<>p_command->>'final_graph_digest'
    or pg_catalog.jsonb_typeof(p_command->'operation_origins')<>'array'
    or pg_catalog.jsonb_typeof(p_command->'evidence_selection_refs')<>'array'
    or pg_catalog.jsonb_array_length(p_command->'operation_origins')>256
    or pg_catalog.jsonb_array_length(p_command->'evidence_selection_refs')>32
    or pg_catalog.length(p_command->>'summary') not between 1 and 2048
    or p_command#>>'{validation_receipt,graph_digest}'<>p_command->>'final_graph_digest'
    or coalesce((p_command#>>'{validation_receipt,valid}')::boolean,false) is not true
    or p_command#>>'{validation_receipt,receipt_digest}'<>
      platform.canonical_sha256((p_command->'validation_receipt')-'receipt_digest')
  then raise exception using errcode='22023',message='SEMANTIC_CANDIDATE_SAVE_INVALID'; end if;
  scope_value:=p_command->'scope'; app_id_value:=(scope_value->>'app_id')::uuid;
  tenant_id_value:=(scope_value->>'tenant_id')::uuid; environment_value:=scope_value->>'environment';
  domain_value:=p_command->>'semantic_domain'; principal_value:=(p_command->>'principal_id')::uuid;
  perform semantic.assert_explorer_scope(
    app_id_value,tenant_id_value,environment_value,principal_value,domain_value
  );
  perform semantic.lock_semantic_authority_fence(
    app_id_value,tenant_id_value,environment_value,domain_value
  );
  select item.* into idempotency_record
  from semantic.semantic_candidate_revision_save_idempotency item
  where item.app_id=app_id_value and item.tenant_id=tenant_id_value
    and item.environment=environment_value and item.semantic_domain=domain_value
    and item.principal_id=principal_value and item.idempotency_key=(p_command->>'idempotency_key')::uuid
  for update;
  if found then
    if idempotency_record.command_hash<>p_command->>'command_hash' then
      raise exception using errcode='23505',message='SEMANTIC_CANDIDATE_SAVE_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(idempotency_record.result_json,'{disposition}','"REPLAYED"'::jsonb);
  end if;
  select run.* into run_record from semantic.semantic_authoring_run run
  where run.app_id=app_id_value and run.tenant_id=tenant_id_value
    and run.environment=environment_value and run.semantic_domain=domain_value
    and run.authoring_run_id=(p_command->>'authoring_run_id')::uuid
    and run.principal_id=principal_value for update;
  if not found or run_record.status<>'READY_FOR_REVIEW'
    or run_record.candidate_id<>(p_command->>'candidate_id')::uuid
    or run_record.base_release_id<>(p_command->>'base_release_id')::uuid
    or run_record.working_revision<>(p_command->>'expected_working_revision')::integer
    or run_record.graph_digest<>p_command->>'expected_graph_digest'
    or run_record.graph_id<>(p_command#>>'{final_graph,metadata,graph_id}')::uuid
  then raise exception using errcode='40001',message='SEMANTIC_CANDIDATE_SAVE_CONFLICT'; end if;
  perform 1 from semantic.semantic_active_pointer pointer
  where pointer.app_id=app_id_value and pointer.tenant_id=tenant_id_value
    and pointer.environment=environment_value and pointer.semantic_domain=domain_value
    and pointer.current_release_id=run_record.base_release_id
    and pointer.current_release_generation=run_record.base_release_generation for share;
  if not found then raise exception using errcode='40001',message='SEMANTIC_CANDIDATE_SAVE_STALE'; end if;
  select candidate.* into candidate_record from semantic.semantic_candidate candidate
  where candidate.app_id=app_id_value and candidate.tenant_id=tenant_id_value
    and candidate.environment=environment_value and candidate.semantic_domain=domain_value
    and candidate.candidate_id=run_record.candidate_id
    and candidate.proposer_principal=principal_value::text and candidate.candidate_status='DRAFT'
  for update;
  if not found then raise exception using errcode='42501',message='SEMANTIC_CANDIDATE_SAVE_FORBIDDEN'; end if;
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(run_record.working_graph->'nodes') base_node
    where base_node.value->>'node_type' in ('PHYSICAL_TABLE','PHYSICAL_COLUMN')
      and not exists(select 1 from pg_catalog.jsonb_array_elements(p_command#>'{final_graph,nodes}') final_node
        where final_node.value=base_node.value)
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(p_command#>'{final_graph,nodes}') final_node
    where final_node.value->>'node_type' in ('PHYSICAL_TABLE','PHYSICAL_COLUMN')
      and not exists(select 1 from pg_catalog.jsonb_array_elements(run_record.working_graph->'nodes') base_node
        where base_node.value=final_node.value)
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(run_record.working_graph->'edges') base_edge
    where base_edge.value->>'edge_type' in ('CONTAINS_COLUMN','FOREIGN_KEY_TO')
      and not exists(select 1 from pg_catalog.jsonb_array_elements(p_command#>'{final_graph,edges}') final_edge
        where final_edge.value=base_edge.value)
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(p_command#>'{final_graph,edges}') final_edge
    where final_edge.value->>'edge_type' in ('CONTAINS_COLUMN','FOREIGN_KEY_TO')
      and not exists(select 1 from pg_catalog.jsonb_array_elements(run_record.working_graph->'edges') base_edge
        where base_edge.value=final_edge.value)
  ) then raise exception using errcode='42501',message='SEMANTIC_CANDIDATE_SAVE_SYSTEM_MANAGED_MUTATION'; end if;
  for evidence_value in select value from pg_catalog.jsonb_array_elements(p_command->'evidence_selection_refs') loop
    if evidence_value-array['selection_id','selection_hash']<>'{}'::jsonb or not exists(
      select 1 from app_data_agent.knowledge_evidence_selections selection
      where selection.app_id=app_id_value and selection.tenant_id=tenant_id_value
        and selection.environment=environment_value
        and selection.selection_id=(evidence_value->>'selection_id')::uuid
        and selection.selection_hash=evidence_value->>'selection_hash'
        and selection.intended_semantic_domain=domain_value
    ) then raise exception using errcode='42501',message='SEMANTIC_CANDIDATE_SAVE_EVIDENCE_INVALID'; end if;
  end loop;
  select coalesce(pg_catalog.max(revision.revision_number),0)+1 into source_revision_number_value
  from semantic.semantic_source_revision revision
  where revision.app_id=app_id_value and revision.tenant_id=tenant_id_value
    and revision.environment=environment_value and revision.semantic_domain=domain_value;
  select coalesce(pg_catalog.max(revision.revision_number),0)+1 into candidate_revision_number_value
  from semantic.semantic_candidate_revision revision
  where revision.app_id=app_id_value and revision.tenant_id=tenant_id_value
    and revision.environment=environment_value and revision.semantic_domain=domain_value
    and revision.candidate_id=run_record.candidate_id;
  source_digest_value:=semantic.semantic_sha256(
    'semantic-explicit-candidate-source@1.0.0',
    pg_catalog.jsonb_build_object(
      'candidate_id',run_record.candidate_id,'revision_number',candidate_revision_number_value,
      'final_graph_digest',p_command->>'final_graph_digest','command_hash',p_command->>'command_hash'
    )
  );
  revision_payload_value:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-explicit-candidate-revision@1.0.0',
    'title',p_command->>'summary','description',p_command->>'summary','risk_level','MEDIUM',
    'source_revision_id',source_revision_id_value,'base_release_id',run_record.base_release_id,
    'authoring_run_id',run_record.authoring_run_id,'source_graph',p_command->'final_graph',
    'source_graph_digest',p_command->>'final_graph_digest','manual_patch',p_command->'manual_patch',
    'operation_origins',p_command->'operation_origins',
    'evidence_selection_refs',p_command->'evidence_selection_refs',
    'validation_receipt',p_command->'validation_receipt',
    'diff',pg_catalog.jsonb_build_object(
      'schema_version','semantic-diff@1.0.0','summary',p_command->>'summary',
      'operations',coalesce(p_command#>'{manual_patch,operations}','[]'::jsonb)
    )
  );
  revision_digest_value:=semantic.semantic_sha256(
    run_record.candidate_id::text,
    pg_catalog.jsonb_build_object(
      'revision_number',candidate_revision_number_value,'source_revision_id',source_revision_id_value,
      'revision_payload',revision_payload_value,'author_principal',principal_value,
      'change_description',p_command->>'summary','change_class','MINOR'
    )
  );
  insert into semantic.semantic_source_revision(
    app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
    base_release_id,base_release_generation,source_payload,source_digest,
    author_principal,change_description,change_class
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,source_revision_id_value,
    source_revision_number_value,run_record.base_release_id,run_record.base_release_generation,
    p_command->'final_graph',source_digest_value,principal_value::text,p_command->>'summary','MINOR'
  );
  insert into semantic.semantic_candidate_revision(
    app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,revision_number,
    source_revision_id,revision_payload,revision_digest,author_principal,change_description,change_class
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,run_record.candidate_id,
    candidate_revision_id_value,candidate_revision_number_value,source_revision_id_value,
    revision_payload_value,revision_digest_value,principal_value::text,p_command->>'summary','MINOR'
  );
  update semantic.semantic_candidate set current_revision_id=candidate_revision_id_value,
    updated_at=pg_catalog.clock_timestamp()
  where app_id=app_id_value and tenant_id=tenant_id_value and environment=environment_value
    and semantic_domain=domain_value and candidate_id=run_record.candidate_id;
  update semantic.semantic_authoring_run set
    materialized_source_revision_id=source_revision_id_value,
    materialized_candidate_revision_id=candidate_revision_id_value,
    working_revision=case when p_command->'manual_patch'='null'::jsonb then working_revision
      else (p_command#>>'{manual_patch,to_working_revision}')::integer end,
    graph_digest=p_command->>'final_graph_digest',
    validation_receipt_digest=p_command#>>'{validation_receipt,receipt_digest}',
    working_graph=p_command->'final_graph',
    updated_at=pg_catalog.clock_timestamp()
  where app_id=app_id_value and tenant_id=tenant_id_value and environment=environment_value
    and semantic_domain=domain_value and authoring_run_id=run_record.authoring_run_id;
  for evidence_value in select value from pg_catalog.jsonb_array_elements(p_command->'evidence_selection_refs') loop
    insert into app_data_agent.knowledge_semantic_usage_references(
      app_id,tenant_id,environment,usage_id,selection_id,selection_hash,semantic_domain,
      usage_kind,subject_id,subject_revision,subject_hash,created_by_principal_id
    ) values (
      app_id_value,tenant_id_value,environment_value,extensions.gen_random_uuid(),
      (evidence_value->>'selection_id')::uuid,evidence_value->>'selection_hash',domain_value,
      'CANDIDATE_REVISION',candidate_revision_id_value,candidate_revision_number_value,
      revision_digest_value,principal_value
    );
  end loop;
  result_value:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-candidate-revision-save-result@1.0.0','disposition','CREATED',
    'candidate_id',run_record.candidate_id,'source_revision_id',source_revision_id_value,
    'candidate_revision_id',candidate_revision_id_value,'revision_number',candidate_revision_number_value,
    'final_graph_digest',p_command->>'final_graph_digest',
    'validation_receipt_digest',p_command#>>'{validation_receipt,receipt_digest}',
    'saved_at',p_command->>'saved_at'
  );
  insert into semantic.semantic_candidate_revision_save_idempotency(
    app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key,command_hash,
    candidate_id,source_revision_id,candidate_revision_id,revision_number,result_json
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,principal_value,
    (p_command->>'idempotency_key')::uuid,p_command->>'command_hash',run_record.candidate_id,
    source_revision_id_value,candidate_revision_id_value,candidate_revision_number_value,result_value
  );
  insert into app_data_agent.audit_log(
    app_id,tenant_id,environment,audit_id,principal_id,action,resource_type,resource_id,details
  ) values (
    app_id_value,tenant_id_value,environment_value,extensions.gen_random_uuid(),principal_value,
    'SEMANTIC_CANDIDATE_REVISION_SAVED','semantic_candidate_revision',candidate_revision_id_value::text,
    pg_catalog.jsonb_build_object(
      'candidate_id',run_record.candidate_id,'revision_number',candidate_revision_number_value,
      'final_graph_digest',p_command->>'final_graph_digest','base_release_id',run_record.base_release_id
    )
  );
  return result_value;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='SEMANTIC_CANDIDATE_SAVE_INVALID';
end
$function$;

create function semantic.get_saved_semantic_candidate_revision(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,
  p_semantic_domain text,p_authoring_run_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result_value jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain
  );
  select saved.result_json into result_value
  from semantic.semantic_authoring_run run
  join semantic.semantic_candidate_revision_save_idempotency saved
    on saved.app_id=run.app_id and saved.tenant_id=run.tenant_id
    and saved.environment=run.environment and saved.semantic_domain=run.semantic_domain
    and saved.principal_id=run.principal_id
    and saved.candidate_id=run.candidate_id
    and saved.candidate_revision_id=run.materialized_candidate_revision_id
  where run.app_id=p_app_id and run.tenant_id=p_tenant_id
    and run.environment=p_environment and run.semantic_domain=p_semantic_domain
    and run.principal_id=p_principal_id and run.authoring_run_id=p_authoring_run_id
  order by saved.created_at desc
  limit 1;
  return result_value;
end
$function$;

create or replace function app_data_agent.get_knowledge_document(
  requested_document_id uuid,requested_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare authority record; document app_data_agent.knowledge_document_revisions%rowtype;
begin
  select * into strict authority from platform.current_backend_authority(false);
  select * into strict document from app_data_agent.knowledge_document_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and document_id=requested_document_id and revision=requested_revision;
  return pg_catalog.jsonb_build_object(
    'document',document.revision_json,
    'blocks',coalesce((select pg_catalog.jsonb_agg(block_json order by ordinal)
      from app_data_agent.knowledge_document_blocks block
      where block.app_id=document.app_id and block.tenant_id=document.tenant_id
        and block.environment=document.environment and block.document_id=document.document_id
        and block.document_revision=document.revision),'[]'::jsonb),
    'annotations',coalesce((select pg_catalog.jsonb_agg(annotation_json order by created_at,annotation_id)
      from app_data_agent.knowledge_correction_annotations annotation
      where annotation.app_id=document.app_id and annotation.tenant_id=document.tenant_id
        and annotation.environment=document.environment and annotation.document_id=document.document_id
        and annotation.document_revision=document.revision),'[]'::jsonb),
    'usage',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'usage_kind',usage.usage_kind,'semantic_domain',usage.semantic_domain,
      'subject_id',usage.subject_id,'subject_revision',usage.subject_revision,
      'subject_hash',usage.subject_hash,'evidence_ref',block.block_json-
        array['schema_version','scope','knowledge_base_ref','source_file_ref','kind','ordinal',
          'start_byte','end_byte','start_line','end_line','heading_ancestry','canonical_text',
          'normalized_text_hash']
    ) order by usage.created_at,usage.usage_id,selected_block.ordinal)
      from app_data_agent.knowledge_semantic_usage_references usage
      join app_data_agent.knowledge_evidence_selection_blocks selected_block
        on selected_block.app_id=usage.app_id and selected_block.tenant_id=usage.tenant_id
        and selected_block.environment=usage.environment and selected_block.selection_id=usage.selection_id
      join app_data_agent.knowledge_document_blocks block
        on block.app_id=selected_block.app_id and block.tenant_id=selected_block.tenant_id
        and block.environment=selected_block.environment and block.document_id=selected_block.document_id
        and block.document_revision=selected_block.document_revision and block.block_id=selected_block.block_id
        and block.block_hash=selected_block.block_hash
      where usage.app_id=document.app_id and usage.tenant_id=document.tenant_id
        and usage.environment=document.environment and block.document_id=document.document_id
        and block.document_revision=document.revision),'[]'::jsonb)
  );
exception when no_data_found then
  raise exception using errcode='42501',message='KNOWLEDGE_DOCUMENT_NOT_FOUND_OR_DENIED';
end
$function$;
