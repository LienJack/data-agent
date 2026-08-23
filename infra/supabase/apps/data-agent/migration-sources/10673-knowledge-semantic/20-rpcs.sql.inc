create function app_data_agent.commit_knowledge_document(requested_lease jsonb,requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype; requested_document jsonb; item jsonb;
  existing app_data_agent.knowledge_document_revisions%rowtype; expected_ordinal bigint:=0;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','document','blocks'
    ]) or requested_command->>'schema_version'<>'knowledge-document-commit@1.0.0'
    or pg_catalog.jsonb_typeof(requested_command->'document')<>'object'
    or pg_catalog.jsonb_typeof(requested_command->'blocks')<>'array'
    or pg_catalog.jsonb_array_length(requested_command->'blocks') not between 1 and 20000
  then raise exception using errcode='22023',message='KNOWLEDGE_DOCUMENT_COMMIT_INVALID'; end if;
  requested_document:=requested_command->'document';
  if not app_data_agent.provider_json_object_has_exact_keys(requested_document,array[
      'schema_version','scope','knowledge_base_ref','document_id','revision','source_file_ref',
      'parent_document_ref','parser_version','policy_version','canonical_markdown_hash',
      'block_manifest_hash','block_count','status','reason_code','created_by_principal_id',
      'created_at','revision_hash'
    ]) or requested_document->>'schema_version'<>'knowledge-document-revision@1.0.0'
    or requested_document->>'revision_hash'<>app_data_agent.u2_canonical_sha256(requested_document-'revision_hash')
    or requested_document->>'status'<>'READY' or requested_document->'reason_code'<>'null'::jsonb
    or (requested_document->>'block_count')::bigint<>pg_catalog.jsonb_array_length(requested_command->'blocks')
    or requested_document->>'block_manifest_hash' is distinct from (
      select app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_agg(value->>'block_hash' order by ordinality))
      from pg_catalog.jsonb_array_elements(requested_command->'blocks') with ordinality block(value,ordinality)
    )
  then raise exception using errcode='22023',message='KNOWLEDGE_DOCUMENT_COMMIT_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind='KNOWLEDGE_INDEX';
  select * into strict base from app_data_agent.knowledge_base_revisions
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and knowledge_base_id=(job.input_json#>>'{parameters,knowledge_base_id}')::uuid
    and revision=(job.input_json#>>'{parameters,revision}')::bigint
    and revision_hash=job.input_json#>>'{parameters,revision_hash}' and status='INDEXING';
  if requested_document->'scope'<>pg_catalog.jsonb_build_object(
      'app_id',base.app_id,'tenant_id',base.tenant_id,'environment',base.environment)
    or requested_document->'knowledge_base_ref'<>pg_catalog.jsonb_build_object(
      'knowledge_base_id',base.knowledge_base_id,'revision',base.revision,'revision_hash',base.revision_hash)
    or requested_document->>'created_by_principal_id'<>attempt.principal_id::text
    or not exists(select 1 from pg_catalog.jsonb_array_elements(base.source_refs_json) source
      where source.value=requested_document->'source_file_ref')
  then raise exception using errcode='40001',message='KNOWLEDGE_DOCUMENT_AUTHORITY_CHANGED'; end if;
  select * into existing from app_data_agent.knowledge_document_revisions
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and document_id=(requested_document->>'document_id')::uuid
    and revision=(requested_document->>'revision')::bigint;
  if found then
    if existing.revision_json<>requested_document or exists(
      select 1 from pg_catalog.jsonb_array_elements(requested_command->'blocks') requested
      where not exists(select 1 from app_data_agent.knowledge_document_blocks persisted
        where persisted.app_id=base.app_id and persisted.tenant_id=base.tenant_id
          and persisted.environment=base.environment and persisted.block_json=requested.value)
    ) then raise exception using errcode='23505',message='KNOWLEDGE_DOCUMENT_REPLAY_CONFLICT'; end if;
    return existing.revision_json;
  end if;
  insert into app_data_agent.knowledge_document_revisions(
    app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,
    knowledge_base_revision_hash,document_id,revision,source_file_id,source_file_revision,
    source_file_revision_hash,parent_document_id,parent_document_revision,parent_canonical_markdown_hash,
    parser_version,policy_version,canonical_markdown_hash,block_manifest_hash,block_count,status,
    reason_code,revision_hash,revision_json,created_by_principal_id,created_at
  ) values (
    base.app_id,base.tenant_id,base.environment,base.knowledge_base_id,base.revision,base.revision_hash,
    (requested_document->>'document_id')::uuid,(requested_document->>'revision')::bigint,
    (requested_document#>>'{source_file_ref,file_id}')::uuid,
    (requested_document#>>'{source_file_ref,revision}')::bigint,
    requested_document#>>'{source_file_ref,revision_hash}',
    (requested_document#>>'{parent_document_ref,document_id}')::uuid,
    (requested_document#>>'{parent_document_ref,revision}')::bigint,
    requested_document#>>'{parent_document_ref,canonical_markdown_hash}',
    requested_document->>'parser_version',requested_document->>'policy_version',
    requested_document->>'canonical_markdown_hash',requested_document->>'block_manifest_hash',
    (requested_document->>'block_count')::bigint,'READY',null,requested_document->>'revision_hash',
    requested_document,(requested_document->>'created_by_principal_id')::uuid,
    (requested_document->>'created_at')::timestamptz
  );
  for item in select value from pg_catalog.jsonb_array_elements(requested_command->'blocks') loop
    if not app_data_agent.provider_json_object_has_exact_keys(item,array[
        'schema_version','scope','knowledge_base_ref','document_ref','source_file_ref','block_id',
        'kind','ordinal','start_byte','end_byte','start_line','end_line','heading_ancestry',
        'canonical_text','normalized_text_hash','block_hash'
      ]) or item->>'schema_version'<>'knowledge-document-block@1.0.0'
      or item->>'block_hash'<>app_data_agent.u2_canonical_sha256(item-'block_hash')
      or item->'scope'<>requested_document->'scope'
      or item->'knowledge_base_ref'<>requested_document->'knowledge_base_ref'
      or item->'source_file_ref'<>requested_document->'source_file_ref'
      or item->'document_ref'<>pg_catalog.jsonb_build_object(
        'document_id',requested_document->'document_id','revision',requested_document->'revision',
        'canonical_markdown_hash',requested_document->'canonical_markdown_hash')
      or (item->>'ordinal')::bigint<>expected_ordinal
      or (item->>'end_byte')::bigint<=(item->>'start_byte')::bigint
      or (item->>'end_line')::bigint<(item->>'start_line')::bigint
      or item->>'normalized_text_hash'<>app_data_agent.u2_canonical_sha256(item->'canonical_text')
    then raise exception using errcode='22023',message='KNOWLEDGE_DOCUMENT_BLOCK_INVALID'; end if;
    insert into app_data_agent.knowledge_document_blocks(
      app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,
      knowledge_base_revision_hash,document_id,document_revision,canonical_markdown_hash,
      block_id,ordinal,block_kind,start_byte,end_byte,start_line,end_line,
      normalized_text_hash,canonical_text,block_hash,block_json
    ) values (
      base.app_id,base.tenant_id,base.environment,base.knowledge_base_id,base.revision,base.revision_hash,
      (requested_document->>'document_id')::uuid,(requested_document->>'revision')::bigint,
      requested_document->>'canonical_markdown_hash',(item->>'block_id')::uuid,
      expected_ordinal,item->>'kind',(item->>'start_byte')::bigint,(item->>'end_byte')::bigint,
      (item->>'start_line')::bigint,(item->>'end_line')::bigint,item->>'normalized_text_hash',
      item->>'canonical_text',item->>'block_hash',item
    );
    expected_ordinal:=expected_ordinal+1;
  end loop;
  return requested_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow or not_null_violation or foreign_key_violation then
  raise exception using errcode='22023',message='KNOWLEDGE_DOCUMENT_COMMIT_INVALID';
end
$function$;

create function app_data_agent.list_knowledge_documents(requested_knowledge_base_id uuid,requested_limit integer)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record;
begin
  if requested_limit not between 1 and 200 then
    raise exception using errcode='22023',message='KNOWLEDGE_DOCUMENT_LIST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  if not exists(select 1 from app_data_agent.knowledge_bases base
    where base.app_id=authority.app_id and base.tenant_id=authority.tenant_id
      and base.environment=authority.environment and base.knowledge_base_id=requested_knowledge_base_id)
  then raise exception using errcode='42501',message='KNOWLEDGE_BASE_NOT_FOUND_OR_DENIED'; end if;
  return coalesce((select pg_catalog.jsonb_agg(revision_json order by created_at desc,document_id,revision desc)
    from (select revision_json,created_at,document_id,revision
      from app_data_agent.knowledge_document_revisions
      where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
        and knowledge_base_id=requested_knowledge_base_id
      order by created_at desc,document_id,revision desc limit requested_limit) selected),'[]'::jsonb);
end
$function$;

create function app_data_agent.get_knowledge_document(requested_document_id uuid,requested_revision bigint)
returns jsonb language plpgsql security definer set search_path=''
as $function$
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
    'usage','[]'::jsonb
  );
exception when no_data_found then
  raise exception using errcode='42501',message='KNOWLEDGE_DOCUMENT_NOT_FOUND_OR_DENIED';
end
$function$;

create function app_data_agent.create_knowledge_evidence_selection(requested_selection jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.knowledge_evidence_selections%rowtype;
  item jsonb; previous_identity text; identity text; ordinal bigint:=0;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_selection,array[
      'schema_version','selection_id','scope','knowledge_base_ref','intended_semantic_domain',
      'block_refs','selected_by_principal_id','selected_at','selection_hash'
    ]) or requested_selection->>'schema_version'<>'knowledge-evidence-selection@1.0.0'
    or requested_selection->>'selection_hash'<>app_data_agent.u2_canonical_sha256(requested_selection-'selection_hash')
    or pg_catalog.jsonb_typeof(requested_selection->'block_refs')<>'array'
    or pg_catalog.jsonb_array_length(requested_selection->'block_refs') not between 1 and 256
  then raise exception using errcode='22023',message='KNOWLEDGE_EVIDENCE_SELECTION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_selection->'scope'<>pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment)
    or requested_selection->>'selected_by_principal_id'<>authority.principal_id::text
  then raise exception using errcode='42501',message='KNOWLEDGE_EVIDENCE_SELECTION_SCOPE_MISMATCH'; end if;
  select * into existing from app_data_agent.knowledge_evidence_selections
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and selection_id=(requested_selection->>'selection_id')::uuid;
  if found then
    if existing.selection_json<>requested_selection then
      raise exception using errcode='23505',message='KNOWLEDGE_EVIDENCE_SELECTION_CONFLICT'; end if;
    return existing.selection_json;
  end if;
  insert into app_data_agent.knowledge_evidence_selections(
    app_id,tenant_id,environment,selection_id,knowledge_base_id,knowledge_base_revision,
    knowledge_base_revision_hash,intended_semantic_domain,selected_by_principal_id,
    selected_at,selection_hash,selection_json
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,(requested_selection->>'selection_id')::uuid,
    (requested_selection#>>'{knowledge_base_ref,knowledge_base_id}')::uuid,
    (requested_selection#>>'{knowledge_base_ref,revision}')::bigint,
    requested_selection#>>'{knowledge_base_ref,revision_hash}',requested_selection->>'intended_semantic_domain',
    authority.principal_id,(requested_selection->>'selected_at')::timestamptz,
    requested_selection->>'selection_hash',requested_selection
  );
  for item in select value from pg_catalog.jsonb_array_elements(requested_selection->'block_refs') loop
    if not app_data_agent.provider_json_object_has_exact_keys(item,array['document_ref','block_id','block_hash'])
      or not app_data_agent.provider_json_object_has_exact_keys(item->'document_ref',array[
        'document_id','revision','canonical_markdown_hash'])
    then raise exception using errcode='22023',message='KNOWLEDGE_EVIDENCE_SELECTION_INVALID'; end if;
    identity:=(item#>>'{document_ref,document_id}')||':'||
      pg_catalog.lpad(item#>>'{document_ref,revision}',16,'0')||':'||
      (item->>'block_id')||':'||(item->>'block_hash');
    if previous_identity is not null and previous_identity>=identity then
      raise exception using errcode='22023',message='KNOWLEDGE_EVIDENCE_SELECTION_NOT_CANONICAL'; end if;
    previous_identity:=identity;
    insert into app_data_agent.knowledge_evidence_selection_blocks(
      app_id,tenant_id,environment,selection_id,ordinal,document_id,document_revision,block_id,block_hash
    ) select authority.app_id,authority.tenant_id,authority.environment,
      (requested_selection->>'selection_id')::uuid,ordinal,block.document_id,block.document_revision,
      block.block_id,block.block_hash
    from app_data_agent.knowledge_document_blocks block
    where block.app_id=authority.app_id and block.tenant_id=authority.tenant_id
      and block.environment=authority.environment
      and block.knowledge_base_id=(requested_selection#>>'{knowledge_base_ref,knowledge_base_id}')::uuid
      and block.knowledge_base_revision=(requested_selection#>>'{knowledge_base_ref,revision}')::bigint
      and block.knowledge_base_revision_hash=requested_selection#>>'{knowledge_base_ref,revision_hash}'
      and block.document_id=(item#>>'{document_ref,document_id}')::uuid
      and block.document_revision=(item#>>'{document_ref,revision}')::bigint
      and block.canonical_markdown_hash=item#>>'{document_ref,canonical_markdown_hash}'
      and block.block_id=(item->>'block_id')::uuid and block.block_hash=item->>'block_hash';
    if not found then raise exception using errcode='42501',message='KNOWLEDGE_EVIDENCE_BLOCK_NOT_FOUND_OR_DENIED'; end if;
    ordinal:=ordinal+1;
  end loop;
  return requested_selection;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow or foreign_key_violation then
  raise exception using errcode='22023',message='KNOWLEDGE_EVIDENCE_SELECTION_INVALID';
end
$function$;

create function app_data_agent.get_knowledge_evidence_selection(requested_selection_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; selected app_data_agent.knowledge_evidence_selections%rowtype;
begin
  select * into strict authority from platform.current_backend_authority(false);
  select selection.* into strict selected
  from app_data_agent.knowledge_evidence_selections selection
  join app_data_agent.knowledge_base_revisions revision
    on revision.app_id=selection.app_id and revision.tenant_id=selection.tenant_id
    and revision.environment=selection.environment
    and revision.knowledge_base_id=selection.knowledge_base_id
    and revision.revision=selection.knowledge_base_revision
    and revision.revision_hash=selection.knowledge_base_revision_hash
  where selection.app_id=authority.app_id and selection.tenant_id=authority.tenant_id
    and selection.environment=authority.environment and selection.selection_id=requested_selection_id
    and (revision.revision_json#>>'{acl,visibility}'='WORKSPACE' or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(revision.revision_json#>'{acl,principal_ids}') item
      where item=authority.principal_id::text
    ));
  return pg_catalog.jsonb_build_object(
    'selection',selected.selection_json,
    'blocks',coalesce((select pg_catalog.jsonb_agg(block.block_json order by selected_block.ordinal)
      from app_data_agent.knowledge_evidence_selection_blocks selected_block
      join app_data_agent.knowledge_document_blocks block
        on block.app_id=selected_block.app_id and block.tenant_id=selected_block.tenant_id
        and block.environment=selected_block.environment
        and block.document_id=selected_block.document_id
        and block.document_revision=selected_block.document_revision
        and block.block_id=selected_block.block_id and block.block_hash=selected_block.block_hash
      where selected_block.app_id=selected.app_id and selected_block.tenant_id=selected.tenant_id
        and selected_block.environment=selected.environment
        and selected_block.selection_id=selected.selection_id),'[]'::jsonb),
    'annotations',coalesce((select pg_catalog.jsonb_agg(annotation.annotation_json order by annotation.created_at,annotation.annotation_id)
      from app_data_agent.knowledge_correction_annotations annotation
      join app_data_agent.knowledge_evidence_selection_blocks selected_block
        on selected_block.app_id=annotation.app_id and selected_block.tenant_id=annotation.tenant_id
        and selected_block.environment=annotation.environment
        and selected_block.document_id=annotation.document_id
        and selected_block.document_revision=annotation.document_revision
        and selected_block.block_id=annotation.block_id and selected_block.block_hash=annotation.block_hash
      where selected_block.selection_id=selected.selection_id),'[]'::jsonb)
  );
exception when no_data_found then
  raise exception using errcode='42501',message='KNOWLEDGE_EVIDENCE_SELECTION_NOT_FOUND_OR_DENIED';
end
$function$;

create function app_data_agent.create_knowledge_correction_annotation(requested_annotation jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.knowledge_correction_annotations%rowtype;
  block app_data_agent.knowledge_document_blocks%rowtype; effective_base app_data_agent.knowledge_base_revisions%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_annotation,array[
      'schema_version','annotation_id','scope','knowledge_base_ref','block_ref','annotation_kind',
      'correction_text','reason','effective_knowledge_base_revision','created_by_principal_id',
      'created_at','annotation_hash'
    ]) or requested_annotation->>'schema_version'<>'knowledge-correction-annotation@1.0.0'
    or requested_annotation->>'annotation_hash'<>app_data_agent.u2_canonical_sha256(requested_annotation-'annotation_hash')
    or requested_annotation->>'annotation_kind' not in ('CORRECTION','SUPPLEMENT')
    or pg_catalog.length(pg_catalog.btrim(requested_annotation->>'correction_text')) not between 1 and 20000
    or pg_catalog.length(pg_catalog.btrim(requested_annotation->>'reason')) not between 1 and 2000
  then raise exception using errcode='22023',message='KNOWLEDGE_CORRECTION_ANNOTATION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_annotation->'scope'<>pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment)
    or requested_annotation->>'created_by_principal_id'<>authority.principal_id::text
  then raise exception using errcode='42501',message='KNOWLEDGE_CORRECTION_ANNOTATION_SCOPE_MISMATCH'; end if;
  select * into existing from app_data_agent.knowledge_correction_annotations
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and annotation_id=(requested_annotation->>'annotation_id')::uuid;
  if found then
    if existing.annotation_json<>requested_annotation then
      raise exception using errcode='23505',message='KNOWLEDGE_CORRECTION_ANNOTATION_CONFLICT'; end if;
    return existing.annotation_json;
  end if;
  select * into strict block from app_data_agent.knowledge_document_blocks
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and document_id=(requested_annotation#>>'{block_ref,document_ref,document_id}')::uuid
    and document_revision=(requested_annotation#>>'{block_ref,document_ref,revision}')::bigint
    and canonical_markdown_hash=requested_annotation#>>'{block_ref,document_ref,canonical_markdown_hash}'
    and block_id=(requested_annotation#>>'{block_ref,block_id}')::uuid
    and block_hash=requested_annotation#>>'{block_ref,block_hash}';
  select * into strict effective_base from app_data_agent.knowledge_base_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and knowledge_base_id=block.knowledge_base_id
    and knowledge_base_id=(requested_annotation#>>'{knowledge_base_ref,knowledge_base_id}')::uuid
    and revision=(requested_annotation->>'effective_knowledge_base_revision')::bigint
    and revision=(requested_annotation#>>'{knowledge_base_ref,revision}')::bigint
    and revision_hash=requested_annotation#>>'{knowledge_base_ref,revision_hash}'
    and revision>=block.knowledge_base_revision
    and (revision_json#>>'{acl,visibility}'='WORKSPACE' or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(revision_json#>'{acl,principal_ids}') item
      where item=authority.principal_id::text
    ));
  insert into app_data_agent.knowledge_correction_annotations(
    app_id,tenant_id,environment,annotation_id,knowledge_base_id,document_id,document_revision,
    block_id,block_hash,annotation_kind,correction_text,reason,effective_knowledge_base_revision,
    created_by_principal_id,created_at,annotation_hash,annotation_json
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (requested_annotation->>'annotation_id')::uuid,effective_base.knowledge_base_id,
    block.document_id,block.document_revision,block.block_id,block.block_hash,
    requested_annotation->>'annotation_kind',pg_catalog.btrim(requested_annotation->>'correction_text'),
    pg_catalog.btrim(requested_annotation->>'reason'),effective_base.revision,authority.principal_id,
    (requested_annotation->>'created_at')::timestamptz,requested_annotation->>'annotation_hash',requested_annotation
  );
  return requested_annotation;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow or foreign_key_violation then
  raise exception using errcode='22023',message='KNOWLEDGE_CORRECTION_ANNOTATION_INVALID';
end
$function$;
