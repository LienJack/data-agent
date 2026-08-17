create function app_data_agent.load_knowledge_search_snapshot(requested_request jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; base app_data_agent.knowledge_base_revisions%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype;
  profile app_data_agent.knowledge_embedding_profile_revisions%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_request,array[
      'schema_version','knowledge_base_ref','generation_ref','query','limit'
    ]) or requested_request->>'schema_version'<>'knowledge-debug-search-request@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_request->'knowledge_base_ref',array[
      'knowledge_base_id','revision','revision_hash'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_request->'generation_ref',array[
      'generation_id','generation_revision','generation_hash'
    ]) or pg_catalog.length(pg_catalog.btrim(requested_request->>'query')) not between 1 and 4000
    or (requested_request->>'limit')::integer not between 1 and 20
  then raise exception using errcode='22023',message='KNOWLEDGE_SEARCH_REQUEST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select revision.* into strict base from app_data_agent.knowledge_base_revisions revision
  join app_data_agent.knowledge_bases pointer
    on pointer.app_id=revision.app_id and pointer.tenant_id=revision.tenant_id
    and pointer.environment=revision.environment and pointer.knowledge_base_id=revision.knowledge_base_id
    and pointer.current_revision=revision.revision and pointer.current_revision_hash=revision.revision_hash
  where revision.app_id=authority.app_id and revision.tenant_id=authority.tenant_id
    and revision.environment=authority.environment
    and revision.knowledge_base_id=(requested_request#>>'{knowledge_base_ref,knowledge_base_id}')::uuid
    and revision.revision=(requested_request#>>'{knowledge_base_ref,revision}')::bigint
    and revision.revision_hash=requested_request#>>'{knowledge_base_ref,revision_hash}'
    and revision.status='READY'
    and (revision.revision_json#>>'{acl,visibility}'='WORKSPACE' or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(revision.revision_json#>'{acl,principal_ids}') item
      where item=authority.principal_id::text
    ));
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and generation_id=(requested_request#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_request#>>'{generation_ref,generation_revision}')::bigint
    and generation_hash=requested_request#>>'{generation_ref,generation_hash}' and state='READY'
    and generation_id=(base.revision_json#>>'{active_generation_ref,generation_id}')::uuid;
  select * into strict profile from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and profile_id=base.profile_id and revision=base.profile_revision
    and profile_hash=base.profile_hash and status='READY';
  perform app_data_agent.knowledge_assert_source_refs(
    base.source_refs_json,authority.app_id,authority.tenant_id,
    authority.environment,authority.principal_id
  );
  return pg_catalog.jsonb_build_object(
    'knowledge_base',base.revision_json,'generation',generation.generation_json,
    'embedding_profile',profile.profile_json,
    'principal_id',authority.principal_id
  );
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='55000',message='KNOWLEDGE_INDEX_NOT_READY';
end
$function$;

create function app_data_agent.commit_knowledge_query_projection(requested_receipt jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; generation app_data_agent.knowledge_index_generations%rowtype;
  existing app_data_agent.knowledge_projection_receipts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_receipt,array[
      'schema_version','receipt_id','scope','knowledge_base_ref','generation_ref','classification',
      'provider','projection_policy_version','pii_finding_count','credential_finding_count',
      'prompt_injection_detected','decision','payload_hash','projected_at','receipt_hash'
    ]) or requested_receipt->>'schema_version'<>'knowledge-query-projection-receipt@1.0.0'
    or requested_receipt->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(requested_receipt-'receipt_hash')
    or requested_receipt->>'decision'<>'ALLOW'
    or requested_receipt->>'classification' not in ('PUBLIC','INTERNAL')
    or (requested_receipt->>'pii_finding_count')::bigint<>0
    or (requested_receipt->>'credential_finding_count')::bigint<>0
    or (requested_receipt->>'prompt_injection_detected')::boolean
  then raise exception using errcode='22023',message='KNOWLEDGE_QUERY_PROJECTION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_receipt->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then raise exception using errcode='42501',message='KNOWLEDGE_SCOPE_MISMATCH'; end if;
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and generation_id=(requested_receipt#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_receipt#>>'{generation_ref,generation_revision}')::bigint
    and generation_hash=requested_receipt#>>'{generation_ref,generation_hash}' and state='READY'
    and knowledge_base_id=(requested_receipt#>>'{knowledge_base_ref,knowledge_base_id}')::uuid;
  select * into existing from app_data_agent.knowledge_projection_receipts
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and receipt_id=(requested_receipt->>'receipt_id')::uuid;
  if found then
    if existing.receipt_hash<>requested_receipt->>'receipt_hash' then
      raise exception using errcode='23505',message='KNOWLEDGE_QUERY_PROJECTION_REPLAY_CONFLICT'; end if;
    return existing.receipt_json;
  end if;
  insert into app_data_agent.knowledge_projection_receipts(
    app_id,tenant_id,environment,receipt_id,knowledge_base_id,generation_id,projection_kind,
    chunk_id,decision,receipt_hash,receipt_json,projected_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (requested_receipt->>'receipt_id')::uuid,generation.knowledge_base_id,generation.generation_id,
    'QUERY',null,'ALLOW',requested_receipt->>'receipt_hash',requested_receipt,
    (requested_receipt->>'projected_at')::timestamptz
  );
  return requested_receipt;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='55000',message='KNOWLEDGE_INDEX_NOT_READY';
end
$function$;

create function app_data_agent.commit_knowledge_retrieval(
  requested_request jsonb,requested_candidates jsonb,requested_query_hash text,
  requested_query_projection_hash text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; base app_data_agent.knowledge_base_revisions%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype; candidate jsonb;
  chunk app_data_agent.knowledge_chunks%rowtype; hit jsonb; hits jsonb:='[]'::jsonb;
  receipt jsonb; now_at timestamptz:=pg_catalog.clock_timestamp(); receipt_id uuid:=pg_catalog.gen_random_uuid();
begin
  if requested_query_hash!~'^sha256:[0-9a-f]{64}$'
    or requested_query_projection_hash!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(requested_candidates)<>'array'
    or pg_catalog.jsonb_array_length(requested_candidates)>50
  then raise exception using errcode='22023',message='KNOWLEDGE_RETRIEVAL_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select revision.* into strict base from app_data_agent.knowledge_base_revisions revision
  join app_data_agent.knowledge_bases pointer
    on pointer.app_id=revision.app_id and pointer.tenant_id=revision.tenant_id
    and pointer.environment=revision.environment and pointer.knowledge_base_id=revision.knowledge_base_id
    and pointer.current_revision=revision.revision and pointer.current_revision_hash=revision.revision_hash
  where revision.app_id=authority.app_id and revision.tenant_id=authority.tenant_id
    and revision.environment=authority.environment
    and revision.knowledge_base_id=(requested_request#>>'{knowledge_base_ref,knowledge_base_id}')::uuid
    and revision.revision=(requested_request#>>'{knowledge_base_ref,revision}')::bigint
    and revision.revision_hash=requested_request#>>'{knowledge_base_ref,revision_hash}'
    and revision.status='READY'
    and (revision.revision_json#>>'{acl,visibility}'='WORKSPACE' or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(revision.revision_json#>'{acl,principal_ids}') item
      where item=authority.principal_id::text
    ));
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and generation_id=(requested_request#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_request#>>'{generation_ref,generation_revision}')::bigint
    and generation_hash=requested_request#>>'{generation_ref,generation_hash}' and state='READY';
  if not exists (
    select 1 from app_data_agent.knowledge_projection_receipts projection
    where projection.app_id=base.app_id and projection.tenant_id=base.tenant_id
      and projection.environment=base.environment and projection.generation_id=generation.generation_id
      and projection.projection_kind='QUERY' and projection.decision='ALLOW'
      and projection.receipt_hash=requested_query_projection_hash
  ) then raise exception using errcode='23503',message='KNOWLEDGE_QUERY_PROJECTION_NOT_COMMITTED'; end if;
  perform app_data_agent.knowledge_assert_source_refs(
    base.source_refs_json,authority.app_id,authority.tenant_id,
    authority.environment,authority.principal_id
  );
  for candidate in select value from pg_catalog.jsonb_array_elements(requested_candidates) loop
    if not app_data_agent.provider_json_object_has_exact_keys(candidate,array['chunk_id','score'])
      or (candidate->>'score')::double precision not between -1 and 1
    then raise exception using errcode='22023',message='KNOWLEDGE_RETRIEVAL_CANDIDATE_INVALID'; end if;
    select * into strict chunk from app_data_agent.knowledge_chunks
    where app_id=generation.app_id and tenant_id=generation.tenant_id and environment=generation.environment
      and generation_id=generation.generation_id and chunk_id=(candidate->>'chunk_id')::uuid;
    hit:=pg_catalog.jsonb_build_object(
      'schema_version','knowledge-evidence-hit@1.0.0','scope',base.revision_json->'scope',
      'knowledge_base_ref',requested_request->'knowledge_base_ref',
      'generation_ref',requested_request->'generation_ref',
      'chunk_ref',pg_catalog.jsonb_build_object('chunk_id',chunk.chunk_id,'chunk_hash',chunk.chunk_hash),
      'source_file_ref',chunk.chunk_json->'source_file_ref',
      'score',(candidate->>'score')::double precision,
      'query_projection_receipt_hash',requested_query_projection_hash,'acl_decision','ALLOW',
      'citation',pg_catalog.jsonb_build_object(
        'start_byte',chunk.start_byte,'end_byte',chunk.end_byte,
        'excerpt_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(chunk.normalized_text))
      )
    );
    hit:=hit||pg_catalog.jsonb_build_object('evidence_hash',app_data_agent.u2_canonical_sha256(hit));
    hits:=hits||pg_catalog.jsonb_build_array(hit);
  end loop;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-retrieval-receipt@1.0.0','receipt_id',receipt_id,
    'scope',base.revision_json->'scope','knowledge_base_ref',requested_request->'knowledge_base_ref',
    'generation_ref',requested_request->'generation_ref','checkpoint',generation.generation_json->'checkpoint',
    'query_hash',requested_query_hash,'query_projection_receipt_hash',requested_query_projection_hash,
    'principal_id',authority.principal_id,'hits',hits,
    'retrieved_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  insert into app_data_agent.knowledge_retrieval_receipts(
    app_id,tenant_id,environment,receipt_id,principal_id,knowledge_base_id,generation_id,
    generation_hash,query_hash,receipt_hash,receipt_json,retrieved_at
  ) values (
    base.app_id,base.tenant_id,base.environment,receipt_id,authority.principal_id,
    base.knowledge_base_id,generation.generation_id,generation.generation_hash,requested_query_hash,
    receipt->>'receipt_hash',receipt,now_at
  );
  return receipt;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_AUTHORITY_CHANGED';
end
$function$;
