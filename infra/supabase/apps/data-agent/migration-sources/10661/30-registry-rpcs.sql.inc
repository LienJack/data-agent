create function app_data_agent.register_knowledge_embedding_profile(requested_profile jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.knowledge_embedding_profile_revisions%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_profile,array[
      'schema_version','scope','profile_id','revision','provider','model_id','dimensions','normalization',
      'parser_version','chunker_version','projection_policy_version','status','created_at','profile_hash'
    ]) or requested_profile->>'schema_version'<>'embedding-profile-revision@1.0.0'
    or requested_profile->>'profile_hash'<>app_data_agent.u2_canonical_sha256(requested_profile-'profile_hash')
    or requested_profile->>'provider'!~'^[a-z0-9][a-z0-9._-]*$'
    or (requested_profile->>'dimensions')::integer not between 2 and 16384
    or requested_profile->>'normalization' not in ('NONE','L2')
    or requested_profile->>'status' not in ('READY','NOT_READY','STALE')
    or app_data_agent.contains_potential_plaintext_secret(requested_profile)
  then raise exception using errcode='22023',message='KNOWLEDGE_EMBEDDING_PROFILE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_profile->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then raise exception using errcode='42501',message='KNOWLEDGE_SCOPE_MISMATCH'; end if;
  select * into existing from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and profile_id=(requested_profile->>'profile_id')::uuid
    and revision=(requested_profile->>'revision')::bigint;
  if found then
    if existing.profile_hash<>requested_profile->>'profile_hash' then
      raise exception using errcode='23505',message='KNOWLEDGE_EMBEDDING_PROFILE_REPLAY_CONFLICT';
    end if;
    return existing.profile_json;
  end if;
  insert into app_data_agent.knowledge_embedding_profile_revisions(
    app_id,tenant_id,environment,profile_id,revision,provider,model_id,dimensions,status,
    profile_hash,profile_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (requested_profile->>'profile_id')::uuid,(requested_profile->>'revision')::bigint,
    requested_profile->>'provider',requested_profile->>'model_id',
    (requested_profile->>'dimensions')::integer,requested_profile->>'status',
    requested_profile->>'profile_hash',requested_profile,(requested_profile->>'created_at')::timestamptz
  );
  return requested_profile;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='KNOWLEDGE_EMBEDDING_PROFILE_INVALID';
end
$function$;

create function app_data_agent.list_knowledge_embedding_profiles(requested_limit integer)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare authority record;
begin
  if requested_limit not between 1 and 100 then
    raise exception using errcode='22023',message='KNOWLEDGE_PROFILE_LIST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  return coalesce((
    select pg_catalog.jsonb_agg(profile.profile_json order by profile.created_at desc,profile.profile_id)
    from (
      select * from app_data_agent.knowledge_embedding_profile_revisions
      where app_id=authority.app_id and tenant_id=authority.tenant_id
        and environment=authority.environment
      order by created_at desc,profile_id limit requested_limit
    ) profile
  ),'[]'::jsonb);
end
$function$;

create function app_data_agent.create_knowledge_base(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.knowledge_idempotency%rowtype;
  profile app_data_agent.knowledge_embedding_profile_revisions%rowtype;
  now_at timestamptz:=pg_catalog.clock_timestamp(); base_document jsonb; generation_document jsonb;
  generation_id uuid:=pg_catalog.gen_random_uuid(); acl_hash text; result_document jsonb;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','operation_id','workspace_id','name','source_file_refs',
      'embedding_profile_ref','acl','idempotency_key','request_hash'
    ]) or requested_command->>'schema_version'<>'knowledge-base-create@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or pg_catalog.length(pg_catalog.btrim(requested_command->>'name')) not between 1 and 160
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'embedding_profile_ref',array[
      'profile_id','revision','profile_hash'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'acl',array[
      'visibility','principal_ids'
    ]) or requested_command#>>'{acl,visibility}' not in ('WORKSPACE','PRINCIPALS')
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then raise exception using errcode='22023',message='KNOWLEDGE_BASE_CREATE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command->>'workspace_id'<>authority.tenant_id::text then
    raise exception using errcode='42501',message='KNOWLEDGE_SCOPE_MISMATCH';
  end if;
  select * into existing from app_data_agent.knowledge_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and operation_kind='CREATE'
    and idempotency_key=requested_command->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='KNOWLEDGE_IDEMPOTENCY_CONFLICT';
    end if;
    return existing.result_json;
  end if;
  perform app_data_agent.knowledge_assert_source_refs(
    requested_command->'source_file_refs',authority.app_id,authority.tenant_id,
    authority.environment,authority.principal_id
  );
  select * into strict profile from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and profile_id=(requested_command#>>'{embedding_profile_ref,profile_id}')::uuid
    and revision=(requested_command#>>'{embedding_profile_ref,revision}')::bigint
    and profile_hash=requested_command#>>'{embedding_profile_ref,profile_hash}' and status='READY';
  acl_hash:=app_data_agent.u2_canonical_sha256(requested_command->'acl');
  base_document:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-base-revision@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
    ),
    'knowledge_base_id',(requested_command->>'operation_id')::uuid,'revision',1,
    'name',pg_catalog.btrim(requested_command->>'name'),
    'source_file_refs',requested_command->'source_file_refs',
    'embedding_profile_ref',requested_command->'embedding_profile_ref',
    'acl',requested_command->'acl','status','INDEXING','active_generation_ref',null,
    'created_by_principal_id',authority.principal_id,
    'created_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  base_document:=base_document||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(base_document)
  );
  generation_document:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-index-generation@1.0.0',
    'scope',base_document->'scope','generation_id',generation_id,'generation_revision',1,
    'knowledge_base_ref',pg_catalog.jsonb_build_object(
      'knowledge_base_id',base_document->'knowledge_base_id','revision',1,
      'revision_hash',base_document->'revision_hash'
    ),
    'source_file_refs',base_document->'source_file_refs',
    'embedding_profile_ref',base_document->'embedding_profile_ref','acl_hash',acl_hash,
    'state','INDEXING','chunk_count',0,
    'manifest_hash','sha256:0000000000000000000000000000000000000000000000000000000000000000',
    'checkpoint',null,'reason_code','INDEX_NOT_READY',
    'created_at',app_data_agent.knowledge_utc_millis(now_at),'completed_at',null
  );
  generation_document:=generation_document||pg_catalog.jsonb_build_object(
    'generation_hash',app_data_agent.u2_canonical_sha256(generation_document)
  );
  insert into app_data_agent.knowledge_base_revisions(
    app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash,status,
    profile_id,profile_revision,profile_hash,acl_hash,source_refs_json,revision_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (base_document->>'knowledge_base_id')::uuid,1,base_document->>'revision_hash','INDEXING',
    profile.profile_id,profile.revision,profile.profile_hash,acl_hash,
    base_document->'source_file_refs',base_document,now_at
  );
  insert into app_data_agent.knowledge_bases(
    app_id,tenant_id,environment,knowledge_base_id,current_revision,current_revision_hash,
    current_status,updated_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (base_document->>'knowledge_base_id')::uuid,1,base_document->>'revision_hash','INDEXING',now_at
  );
  insert into app_data_agent.knowledge_index_generations(
    app_id,tenant_id,environment,generation_id,generation_revision,generation_hash,
    knowledge_base_id,knowledge_base_revision,knowledge_base_revision_hash,state,
    manifest_hash,chunk_count,generation_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,generation_id,1,
    generation_document->>'generation_hash',(base_document->>'knowledge_base_id')::uuid,
    1,base_document->>'revision_hash','INDEXING',generation_document->>'manifest_hash',0,
    generation_document,now_at
  );
  perform app_data_agent.knowledge_enqueue_index_job(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    base_document,generation_document,requested_command->>'idempotency_key'
  );
  result_document:=pg_catalog.jsonb_build_object(
    'knowledge_base',base_document,'generation',generation_document
  );
  insert into app_data_agent.knowledge_idempotency(
    app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key,request_hash,
    result_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'CREATE',
    requested_command->>'idempotency_key',requested_command->>'request_hash',result_document,now_at
  );
  return result_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_RESOURCE_NOT_READY';
end
$function$;

create function app_data_agent.rebuild_knowledge_base(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; current_base app_data_agent.knowledge_base_revisions%rowtype;
  existing app_data_agent.knowledge_idempotency%rowtype; now_at timestamptz:=pg_catalog.clock_timestamp();
  base_document jsonb; generation_document jsonb; generation_id uuid:=pg_catalog.gen_random_uuid();
  result_document jsonb; next_revision bigint;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','operation_id','workspace_id','knowledge_base_ref','idempotency_key','request_hash'
    ]) or requested_command->>'schema_version'<>'knowledge-base-rebuild@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'knowledge_base_ref',array[
      'knowledge_base_id','revision','revision_hash'
    ])
  then raise exception using errcode='22023',message='KNOWLEDGE_BASE_REBUILD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command->>'workspace_id'<>authority.tenant_id::text then
    raise exception using errcode='42501',message='KNOWLEDGE_SCOPE_MISMATCH';
  end if;
  select * into existing from app_data_agent.knowledge_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and operation_kind='REBUILD'
    and idempotency_key=requested_command->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='KNOWLEDGE_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  select revision.* into strict current_base from app_data_agent.knowledge_base_revisions revision
  join app_data_agent.knowledge_bases pointer
    on pointer.app_id=revision.app_id and pointer.tenant_id=revision.tenant_id
    and pointer.environment=revision.environment and pointer.knowledge_base_id=revision.knowledge_base_id
    and pointer.current_revision=revision.revision and pointer.current_revision_hash=revision.revision_hash
  where revision.app_id=authority.app_id and revision.tenant_id=authority.tenant_id
    and revision.environment=authority.environment
    and revision.knowledge_base_id=(requested_command#>>'{knowledge_base_ref,knowledge_base_id}')::uuid
    and revision.revision=(requested_command#>>'{knowledge_base_ref,revision}')::bigint
    and revision.revision_hash=requested_command#>>'{knowledge_base_ref,revision_hash}'
    and revision.status='READY' for update of pointer;
  perform app_data_agent.knowledge_assert_source_refs(
    current_base.source_refs_json,authority.app_id,authority.tenant_id,
    authority.environment,authority.principal_id
  );
  next_revision:=current_base.revision+1;
  base_document:=current_base.revision_json||pg_catalog.jsonb_build_object(
    'revision',next_revision,'status','INDEXING','active_generation_ref',null,
    'created_by_principal_id',authority.principal_id,'created_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  base_document:=base_document-'revision_hash';
  base_document:=base_document||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(base_document)
  );
  generation_document:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-index-generation@1.0.0','scope',base_document->'scope',
    'generation_id',generation_id,'generation_revision',1,
    'knowledge_base_ref',pg_catalog.jsonb_build_object(
      'knowledge_base_id',base_document->'knowledge_base_id','revision',next_revision,
      'revision_hash',base_document->'revision_hash'
    ),
    'source_file_refs',base_document->'source_file_refs',
    'embedding_profile_ref',base_document->'embedding_profile_ref','acl_hash',current_base.acl_hash,
    'state','INDEXING','chunk_count',0,
    'manifest_hash','sha256:0000000000000000000000000000000000000000000000000000000000000000',
    'checkpoint',null,'reason_code','INDEX_NOT_READY',
    'created_at',app_data_agent.knowledge_utc_millis(now_at),'completed_at',null
  );
  generation_document:=generation_document||pg_catalog.jsonb_build_object(
    'generation_hash',app_data_agent.u2_canonical_sha256(generation_document)
  );
  insert into app_data_agent.knowledge_base_revisions(
    app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash,status,
    profile_id,profile_revision,profile_hash,acl_hash,source_refs_json,revision_json,created_at
  ) values (
    current_base.app_id,current_base.tenant_id,current_base.environment,current_base.knowledge_base_id,
    next_revision,base_document->>'revision_hash','INDEXING',current_base.profile_id,
    current_base.profile_revision,current_base.profile_hash,current_base.acl_hash,
    current_base.source_refs_json,base_document,now_at
  );
  insert into app_data_agent.knowledge_index_generations(
    app_id,tenant_id,environment,generation_id,generation_revision,generation_hash,
    knowledge_base_id,knowledge_base_revision,knowledge_base_revision_hash,state,
    manifest_hash,chunk_count,generation_json,created_at
  ) values (
    current_base.app_id,current_base.tenant_id,current_base.environment,generation_id,1,
    generation_document->>'generation_hash',current_base.knowledge_base_id,next_revision,
    base_document->>'revision_hash','INDEXING',generation_document->>'manifest_hash',0,
    generation_document,now_at
  );
  update app_data_agent.knowledge_bases set current_revision=next_revision,
    current_revision_hash=base_document->>'revision_hash',current_status='INDEXING',updated_at=now_at
  where app_id=current_base.app_id and tenant_id=current_base.tenant_id
    and environment=current_base.environment and knowledge_base_id=current_base.knowledge_base_id;
  perform app_data_agent.knowledge_enqueue_index_job(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    base_document,generation_document,requested_command->>'idempotency_key'
  );
  result_document:=pg_catalog.jsonb_build_object('knowledge_base',base_document,'generation',generation_document);
  insert into app_data_agent.knowledge_idempotency values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'REBUILD',
    requested_command->>'idempotency_key',requested_command->>'request_hash',result_document,now_at
  );
  return result_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_BASE_STALE';
end
$function$;

create function app_data_agent.list_knowledge_bases(requested_limit integer)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record;
begin
  if requested_limit not between 1 and 200 then
    raise exception using errcode='22023',message='KNOWLEDGE_LIST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  return coalesce((
    select pg_catalog.jsonb_agg(revision.revision_json order by pointer.updated_at desc,pointer.knowledge_base_id)
    from (
      select * from app_data_agent.knowledge_bases
      where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
      order by updated_at desc,knowledge_base_id limit requested_limit
    ) pointer
    join app_data_agent.knowledge_base_revisions revision
      on revision.app_id=pointer.app_id and revision.tenant_id=pointer.tenant_id
      and revision.environment=pointer.environment and revision.knowledge_base_id=pointer.knowledge_base_id
      and revision.revision=pointer.current_revision and revision.revision_hash=pointer.current_revision_hash
  ),'[]'::jsonb);
end
$function$;
