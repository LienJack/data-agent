create function app_data_agent.load_knowledge_index_target(requested_lease jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype;
  profile app_data_agent.knowledge_embedding_profile_revisions%rowtype; sources jsonb;
begin
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id;
  if job.kind<>'KNOWLEDGE_INDEX' or job.input_json->>'kind'<>'KNOWLEDGE_INDEX'
    or job.input_json->'resource_refs'<>'[]'::jsonb
    or not app_data_agent.provider_json_object_has_exact_keys(job.input_json->'parameters',array[
      'knowledge_base_id','revision','revision_hash','generation_id'
    ])
  then raise exception using errcode='22023',message='KNOWLEDGE_INDEX_JOB_INVALID'; end if;
  select * into strict base from app_data_agent.knowledge_base_revisions
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and knowledge_base_id=(job.input_json#>>'{parameters,knowledge_base_id}')::uuid
    and revision=(job.input_json#>>'{parameters,revision}')::bigint
    and revision_hash=job.input_json#>>'{parameters,revision_hash}' and status='INDEXING';
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and generation_id=(job.input_json#>>'{parameters,generation_id}')::uuid
    and knowledge_base_id=base.knowledge_base_id and knowledge_base_revision=base.revision
    and knowledge_base_revision_hash=base.revision_hash and state in ('INDEXING','READY');
  select * into strict profile from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and profile_id=base.profile_id and revision=base.profile_revision
    and profile_hash=base.profile_hash and status='READY';
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'file_ref',source.reference,'blob_hash',revision.blob_hash,
    'byte_size',(revision.revision_json->>'byte_size')::bigint,
    'detected_mime',revision.revision_json->>'detected_mime','storage_key',blob.storage_key,
    'classification','INTERNAL'
  ) order by source.ordinal) into sources
  from pg_catalog.jsonb_array_elements(base.source_refs_json) with ordinality source(reference,ordinal)
  join app_data_agent.workspace_file_revisions revision
    on revision.app_id=base.app_id and revision.tenant_id=base.tenant_id
    and revision.environment=base.environment
    and revision.file_id=(source.reference->>'file_id')::uuid
    and revision.revision=(source.reference->>'revision')::bigint
    and revision.revision_hash=source.reference->>'revision_hash' and revision.status='READY'
  join app_data_agent.workspace_files current_file
    on current_file.app_id=revision.app_id and current_file.tenant_id=revision.tenant_id
    and current_file.environment=revision.environment and current_file.file_id=revision.file_id
    and current_file.current_revision=revision.revision
    and current_file.current_revision_hash=revision.revision_hash
  join app_data_agent.workspace_content_blobs blob
    on blob.app_id=revision.app_id and blob.tenant_id=revision.tenant_id
    and blob.environment=revision.environment and blob.blob_hash=revision.blob_hash
    and blob.status='AVAILABLE';
  if sources is null or pg_catalog.jsonb_array_length(sources)<>pg_catalog.jsonb_array_length(base.source_refs_json) then
    raise exception using errcode='40001',message='KNOWLEDGE_SOURCE_STALE'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','knowledge-index-target@1.0.0','knowledge_base',base.revision_json,
    'generation',generation.generation_json,'embedding_profile',profile.profile_json,'sources',sources
  );
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_INDEX_TARGET_STALE';
end
$function$;

create function app_data_agent.commit_knowledge_blocked_projection(
  requested_lease jsonb, requested_receipt jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype;
  profile app_data_agent.knowledge_embedding_profile_revisions%rowtype;
  existing app_data_agent.knowledge_projection_receipts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_receipt,array[
      'schema_version','receipt_id','scope','knowledge_base_ref','source_file_ref','chunk_id',
      'classification','provider','projection_policy_version','redaction_count',
      'pii_finding_count','credential_finding_count','prompt_injection_detected','decision',
      'payload_hash','projected_at','receipt_hash'
    ]) or requested_receipt->>'schema_version'<>'knowledge-data-projection-receipt@1.0.0'
    or requested_receipt->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(requested_receipt-'receipt_hash')
    or requested_receipt->>'decision'<>'POLICY_BLOCKED'
    or not (
      requested_receipt->>'classification' in ('RESTRICTED','SECRET')
      or (requested_receipt->>'pii_finding_count')::bigint>0
      or (requested_receipt->>'credential_finding_count')::bigint>0
      or (requested_receipt->>'prompt_injection_detected')::boolean
    )
  then raise exception using errcode='22023',message='KNOWLEDGE_PROJECTION_RECEIPT_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind='KNOWLEDGE_INDEX';
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and generation_id=(job.input_json#>>'{parameters,generation_id}')::uuid
    and state='INDEXING';
  select * into strict base from app_data_agent.knowledge_base_revisions
  where app_id=generation.app_id and tenant_id=generation.tenant_id and environment=generation.environment
    and knowledge_base_id=generation.knowledge_base_id and revision=generation.knowledge_base_revision
    and revision_hash=generation.knowledge_base_revision_hash;
  select * into strict profile from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and profile_id=base.profile_id and revision=base.profile_revision and profile_hash=base.profile_hash;
  if requested_receipt#>>'{scope,app_id}'<>generation.app_id::text
    or requested_receipt#>>'{scope,tenant_id}'<>generation.tenant_id::text
    or requested_receipt#>>'{scope,environment}'<>generation.environment
    or requested_receipt#>>'{knowledge_base_ref,knowledge_base_id}'<>base.knowledge_base_id::text
    or (requested_receipt#>>'{knowledge_base_ref,revision}')::bigint<>base.revision
    or requested_receipt#>>'{knowledge_base_ref,revision_hash}'<>base.revision_hash
    or requested_receipt->>'provider'<>profile.profile_json->>'provider'
    or requested_receipt->>'projection_policy_version'<>profile.profile_json->>'projection_policy_version'
    or not exists (
      select 1 from pg_catalog.jsonb_array_elements(generation.generation_json->'source_file_refs') source_ref
      where source_ref.value=requested_receipt->'source_file_ref'
    )
  then raise exception using errcode='40001',message='KNOWLEDGE_PROJECTION_AUTHORITY_CHANGED'; end if;
  insert into app_data_agent.knowledge_projection_receipts(
    app_id,tenant_id,environment,receipt_id,knowledge_base_id,generation_id,chunk_id,
    projection_kind,decision,receipt_hash,receipt_json,projected_at
  ) values (
    generation.app_id,generation.tenant_id,generation.environment,
    (requested_receipt->>'receipt_id')::uuid,generation.knowledge_base_id,generation.generation_id,
    (requested_receipt->>'chunk_id')::uuid,'CHUNK','POLICY_BLOCKED',
    requested_receipt->>'receipt_hash',requested_receipt,(requested_receipt->>'projected_at')::timestamptz
  ) on conflict (app_id,tenant_id,environment,receipt_id) do nothing;
  select * into strict existing from app_data_agent.knowledge_projection_receipts
  where app_id=generation.app_id and tenant_id=generation.tenant_id
    and environment=generation.environment and receipt_id=(requested_receipt->>'receipt_id')::uuid;
  if existing.receipt_json<>requested_receipt or existing.decision<>'POLICY_BLOCKED' then
    raise exception using errcode='23505',message='KNOWLEDGE_PROJECTION_RECEIPT_CONFLICT'; end if;
  return existing.receipt_json;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow or unique_violation then
  raise exception using errcode='22023',message='KNOWLEDGE_PROJECTION_RECEIPT_INVALID';
end
$function$;

create function app_data_agent.stage_knowledge_generation(requested_lease jsonb,requested_stage jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype; item jsonb; chunk jsonb;
  projection jsonb; vector jsonb; new_document jsonb; expected_dimensions integer;
  expected_provider text; expected_projection_policy text; expected_ordinal bigint:=0;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_stage,array[
      'schema_version','generation_ref','chunks','manifest_hash'
    ]) or requested_stage->>'schema_version'<>'knowledge-generation-stage@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_stage->'generation_ref',array[
      'generation_id','generation_revision','generation_hash'
    ]) or requested_stage->>'manifest_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(requested_stage->'chunks')<>'array'
    or pg_catalog.jsonb_array_length(requested_stage->'chunks') not between 1 and 100000
  then raise exception using errcode='22023',message='KNOWLEDGE_GENERATION_STAGE_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind='KNOWLEDGE_INDEX';
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and generation_id=(requested_stage#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_stage#>>'{generation_ref,generation_revision}')::bigint
    and state in ('INDEXING','READY') for update;
  if generation.generation_id<>(job.input_json#>>'{parameters,generation_id}')::uuid then
    raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STAGE_CONFLICT';
  end if;
  if exists (select 1 from app_data_agent.knowledge_chunks c
      where c.app_id=generation.app_id and c.tenant_id=generation.tenant_id
        and c.environment=generation.environment and c.generation_id=generation.generation_id)
  then
    if generation.manifest_hash<>requested_stage->>'manifest_hash'
      or generation.chunk_count<>pg_catalog.jsonb_array_length(requested_stage->'chunks')
    then raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STAGE_CONFLICT'; end if;
    for item in select value from pg_catalog.jsonb_array_elements(requested_stage->'chunks') loop
      if not app_data_agent.provider_json_object_has_exact_keys(item,array[
          'chunk','normalized_text','vector','projection_receipt'
        ]) or not exists (
          select 1
          from app_data_agent.knowledge_chunks existing_chunk
          join app_data_agent.knowledge_projection_receipts existing_projection
            on existing_projection.app_id=existing_chunk.app_id
            and existing_projection.tenant_id=existing_chunk.tenant_id
            and existing_projection.environment=existing_chunk.environment
            and existing_projection.generation_id=existing_chunk.generation_id
            and existing_projection.chunk_id=existing_chunk.chunk_id
            and existing_projection.projection_kind='CHUNK'
          where existing_chunk.app_id=generation.app_id
            and existing_chunk.tenant_id=generation.tenant_id
            and existing_chunk.environment=generation.environment
            and existing_chunk.generation_id=generation.generation_id
            and existing_chunk.chunk_id=(item#>>'{chunk,chunk_id}')::uuid
            and existing_chunk.chunk_json=item->'chunk'
            and existing_chunk.normalized_text=item->>'normalized_text'
            and existing_chunk.vector_json=item->'vector'
            and existing_projection.receipt_json=item->'projection_receipt'
        )
      then raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STAGE_CONFLICT'; end if;
    end loop;
    return generation.generation_json;
  end if;
  if generation.generation_hash<>requested_stage#>>'{generation_ref,generation_hash}' then
    raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STAGE_CONFLICT';
  end if;
  if requested_stage->>'manifest_hash' is distinct from (
    select app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_agg(
      element.value#>>'{chunk,chunk_hash}' order by element.ordinality
    ))
    from pg_catalog.jsonb_array_elements(requested_stage->'chunks')
      with ordinality element(value,ordinality)
  ) then raise exception using errcode='22023',message='KNOWLEDGE_GENERATION_STAGE_INVALID'; end if;
  select dimensions,profile.profile_json->>'provider',profile.profile_json->>'projection_policy_version'
  into strict expected_dimensions,expected_provider,expected_projection_policy
  from app_data_agent.knowledge_embedding_profile_revisions profile
  join app_data_agent.knowledge_base_revisions base
    on base.app_id=profile.app_id and base.tenant_id=profile.tenant_id
    and base.environment=profile.environment and base.profile_id=profile.profile_id
    and base.profile_revision=profile.revision and base.profile_hash=profile.profile_hash
  where base.app_id=generation.app_id and base.tenant_id=generation.tenant_id
    and base.environment=generation.environment and base.knowledge_base_id=generation.knowledge_base_id
    and base.revision=generation.knowledge_base_revision;
  for item in select value from pg_catalog.jsonb_array_elements(requested_stage->'chunks') loop
    if not app_data_agent.provider_json_object_has_exact_keys(item,array[
      'chunk','normalized_text','vector','projection_receipt'
    ]) then raise exception using errcode='22023',message='KNOWLEDGE_CHUNK_INVALID'; end if;
    chunk:=item->'chunk';projection:=item->'projection_receipt';vector:=item->'vector';
    if not app_data_agent.provider_json_object_has_exact_keys(chunk,array[
        'schema_version','scope','generation_id','generation_revision','knowledge_base_ref','chunk_id',
        'source_file_ref','ordinal','start_byte','end_byte','text_hash','projection_receipt_hash',
        'embedding_hash','dimensions','chunk_hash'
      ]) or chunk->>'schema_version'<>'knowledge-chunk@1.0.0'
      or chunk->>'chunk_hash'<>app_data_agent.u2_canonical_sha256(chunk-'chunk_hash')
      or chunk->>'generation_id'<>generation.generation_id::text
      or (chunk->>'generation_revision')::bigint<>generation.generation_revision
      or chunk#>>'{scope,app_id}'<>generation.app_id::text
      or chunk#>>'{scope,tenant_id}'<>generation.tenant_id::text
      or chunk#>>'{scope,environment}'<>generation.environment
      or chunk#>>'{knowledge_base_ref,knowledge_base_id}'<>generation.knowledge_base_id::text
      or (chunk#>>'{knowledge_base_ref,revision}')::bigint<>generation.knowledge_base_revision
      or chunk#>>'{knowledge_base_ref,revision_hash}'<>generation.knowledge_base_revision_hash
      or (chunk->>'ordinal')::bigint<>expected_ordinal
      or (chunk->>'end_byte')::bigint<=(chunk->>'start_byte')::bigint
      or chunk->>'dimensions'<>expected_dimensions::text
      or pg_catalog.jsonb_array_length(vector)<>expected_dimensions
      or chunk->>'text_hash'<>app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(item->>'normalized_text'))
      or chunk->>'embedding_hash'<>app_data_agent.u2_canonical_sha256(vector)
      or projection->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(projection-'receipt_hash')
      or projection->>'receipt_hash'<>chunk->>'projection_receipt_hash'
      or projection->>'decision'<>'ALLOW'
      or projection->>'chunk_id'<>chunk->>'chunk_id'
      or projection->'scope'<>chunk->'scope'
      or projection->'knowledge_base_ref'<>chunk->'knowledge_base_ref'
      or projection->'source_file_ref'<>chunk->'source_file_ref'
      or projection->>'payload_hash'<>chunk->>'text_hash'
      or projection->>'provider'<>expected_provider
      or projection->>'projection_policy_version'<>expected_projection_policy
      or not exists (
        select 1 from pg_catalog.jsonb_array_elements(generation.generation_json->'source_file_refs') source_ref
        where source_ref.value=chunk->'source_file_ref'
      )
      or item->>'normalized_text'=''
      or pg_catalog.octet_length(item->>'normalized_text')>32000
    then raise exception using errcode='22023',message='KNOWLEDGE_CHUNK_INVALID'; end if;
    insert into app_data_agent.knowledge_projection_receipts(
      app_id,tenant_id,environment,receipt_id,knowledge_base_id,generation_id,chunk_id,
      projection_kind,decision,receipt_hash,receipt_json,projected_at
    ) values (
      generation.app_id,generation.tenant_id,generation.environment,
      (projection->>'receipt_id')::uuid,generation.knowledge_base_id,generation.generation_id,
      (chunk->>'chunk_id')::uuid,'CHUNK','ALLOW',projection->>'receipt_hash',projection,
      (projection->>'projected_at')::timestamptz
    );
    insert into app_data_agent.knowledge_chunks(
      app_id,tenant_id,environment,generation_id,generation_revision,chunk_id,knowledge_base_id,
      source_file_id,source_file_revision,source_file_revision_hash,ordinal,start_byte,end_byte,
      text_hash,normalized_text,embedding_hash,dimensions,vector_json,chunk_hash,chunk_json
    ) values (
      generation.app_id,generation.tenant_id,generation.environment,generation.generation_id,
      generation.generation_revision,(chunk->>'chunk_id')::uuid,generation.knowledge_base_id,
      (chunk#>>'{source_file_ref,file_id}')::uuid,(chunk#>>'{source_file_ref,revision}')::bigint,
      chunk#>>'{source_file_ref,revision_hash}',(chunk->>'ordinal')::bigint,
      (chunk->>'start_byte')::bigint,(chunk->>'end_byte')::bigint,chunk->>'text_hash',
      item->>'normalized_text',chunk->>'embedding_hash',expected_dimensions,vector,
      chunk->>'chunk_hash',chunk
    );
    expected_ordinal:=expected_ordinal+1;
  end loop;
  new_document:=generation.generation_json-'generation_hash'||pg_catalog.jsonb_build_object(
    'manifest_hash',requested_stage->>'manifest_hash',
    'chunk_count',pg_catalog.jsonb_array_length(requested_stage->'chunks')
  );
  new_document:=new_document||pg_catalog.jsonb_build_object(
    'generation_hash',app_data_agent.u2_canonical_sha256(new_document)
  );
  update app_data_agent.knowledge_index_generations set
    generation_hash=new_document->>'generation_hash',manifest_hash=new_document->>'manifest_hash',
    chunk_count=(new_document->>'chunk_count')::bigint,generation_json=new_document
  where app_id=generation.app_id and tenant_id=generation.tenant_id
    and environment=generation.environment and generation_id=generation.generation_id
    and generation_revision=generation.generation_revision;
  return new_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow or unique_violation then
  raise exception using errcode='22023',message='KNOWLEDGE_GENERATION_STAGE_INVALID';
end
$function$;

create function app_data_agent.commit_knowledge_generation_ready(
  requested_lease jsonb,requested_commit jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype; now_at timestamptz:=pg_catalog.clock_timestamp();
  generation_document jsonb; base_document jsonb; next_revision bigint;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_commit,array[
      'schema_version','generation_ref','checkpoint'
    ]) or requested_commit->>'schema_version'<>'knowledge-generation-ready@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_commit->'generation_ref',array[
      'generation_id','generation_revision','generation_hash'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_commit->'checkpoint',array[
      'index_kind','build_id','manifest_hash','dimensions','sealed_at'
    ]) or requested_commit#>>'{checkpoint,index_kind}'<>'NEO4J_VECTOR'
  then raise exception using errcode='22023',message='KNOWLEDGE_GENERATION_READY_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind='KNOWLEDGE_INDEX';
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and generation_id=(requested_commit#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_commit#>>'{generation_ref,generation_revision}')::bigint
    and state in ('INDEXING','READY')
    and chunk_count>0 and manifest_hash=requested_commit#>>'{checkpoint,manifest_hash}' for update;
  if generation.state='READY' then
    if generation.generation_json->'checkpoint'<>requested_commit->'checkpoint'
      or not exists (
        select 1
        from app_data_agent.knowledge_bases current_base
        join app_data_agent.knowledge_base_revisions current_revision
          on current_revision.app_id=current_base.app_id
          and current_revision.tenant_id=current_base.tenant_id
          and current_revision.environment=current_base.environment
          and current_revision.knowledge_base_id=current_base.knowledge_base_id
          and current_revision.revision=current_base.current_revision
          and current_revision.revision_hash=current_base.current_revision_hash
        where current_base.app_id=generation.app_id
          and current_base.tenant_id=generation.tenant_id
          and current_base.environment=generation.environment
          and current_base.knowledge_base_id=generation.knowledge_base_id
          and current_base.current_status='READY'
          and current_revision.revision_json#>>'{active_generation_ref,generation_id}'=generation.generation_id::text
          and current_revision.revision_json#>>'{active_generation_ref,generation_hash}'=generation.generation_hash
      )
    then raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_READY_CONFLICT'; end if;
    return generation.generation_json;
  end if;
  if generation.generation_hash<>requested_commit#>>'{generation_ref,generation_hash}' then
    raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_READY_CONFLICT';
  end if;
  select * into strict base from app_data_agent.knowledge_base_revisions
  where app_id=generation.app_id and tenant_id=generation.tenant_id and environment=generation.environment
    and knowledge_base_id=generation.knowledge_base_id and revision=generation.knowledge_base_revision
    and revision_hash=generation.knowledge_base_revision_hash and status='INDEXING';
  if (select pg_catalog.count(*) from app_data_agent.knowledge_chunks chunk
      where chunk.app_id=generation.app_id and chunk.tenant_id=generation.tenant_id
        and chunk.environment=generation.environment and chunk.generation_id=generation.generation_id)
      <>generation.chunk_count
  then raise exception using errcode='40001',message='KNOWLEDGE_INDEX_DIGEST_MISMATCH'; end if;
  generation_document:=generation.generation_json-'generation_hash'||pg_catalog.jsonb_build_object(
    'state','READY','checkpoint',requested_commit->'checkpoint','reason_code',null,
    'completed_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  generation_document:=generation_document||pg_catalog.jsonb_build_object(
    'generation_hash',app_data_agent.u2_canonical_sha256(generation_document)
  );
  update app_data_agent.knowledge_index_generations set state='READY',
    generation_hash=generation_document->>'generation_hash',generation_json=generation_document,
    completed_at=now_at
  where app_id=generation.app_id and tenant_id=generation.tenant_id
    and environment=generation.environment and generation_id=generation.generation_id
    and generation_revision=generation.generation_revision;
  next_revision:=base.revision+1;
  base_document:=base.revision_json-'revision_hash'||pg_catalog.jsonb_build_object(
    'revision',next_revision,'status','READY',
    'active_generation_ref',pg_catalog.jsonb_build_object(
      'generation_id',generation.generation_id,'generation_revision',generation.generation_revision,
      'generation_hash',generation_document->>'generation_hash'
    ),
    'created_by_principal_id',job.principal_id,'created_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  base_document:=base_document||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(base_document)
  );
  insert into app_data_agent.knowledge_base_revisions(
    app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash,status,
    profile_id,profile_revision,profile_hash,acl_hash,source_refs_json,revision_json,created_at
  ) values (
    base.app_id,base.tenant_id,base.environment,base.knowledge_base_id,next_revision,
    base_document->>'revision_hash','READY',base.profile_id,base.profile_revision,base.profile_hash,
    base.acl_hash,base.source_refs_json,base_document,now_at
  );
  update app_data_agent.knowledge_bases set current_revision=next_revision,
    current_revision_hash=base_document->>'revision_hash',current_status='READY',updated_at=now_at
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and knowledge_base_id=base.knowledge_base_id;
  return generation_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STALE';
end
$function$;
