create function app_data_agent.register_semantic_induction_source(
  requested_semantic_domain text, requested_source jsonb, requested_content jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.semantic_induction_source_packages%rowtype;
begin
  select * into authority from platform.current_backend_authority(true);
  perform app_data_agent.semantic_induction_assert_source(requested_source);
  if requested_source->>'source_kind' not in ('METRIC_EXCHANGE','FOUNDATIONAL_ONTOLOGY')
    or requested_semantic_domain!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_content,array[
      'metric_format','facts','metrics','dependencies'
    ])
    or pg_catalog.jsonb_typeof(requested_content->'facts')<>'array'
    or pg_catalog.jsonb_typeof(requested_content->'metrics')<>'array'
    or pg_catalog.jsonb_typeof(requested_content->'dependencies')<>'array'
    or (requested_source->>'source_kind'='METRIC_EXCHANGE')<>(requested_content->'metric_format'<>'null'::jsonb)
    or (requested_content->'metric_format'<>'null'::jsonb
      and requested_content->>'metric_format' not in ('OSI_METRIC_EXCHANGE','OSSIE_METRIC_EXCHANGE'))
    or (requested_source->>'source_kind'='METRIC_EXCHANGE' and (
      pg_catalog.jsonb_array_length(requested_content->'facts')<>0
      or pg_catalog.jsonb_array_length(requested_content->'metrics')=0
    ))
    or (requested_source->>'source_kind'='FOUNDATIONAL_ONTOLOGY' and (
      pg_catalog.jsonb_array_length(requested_content->'facts')=0
      or pg_catalog.jsonb_array_length(requested_content->'metrics')<>0
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(requested_content->'facts') fact(value)
        where fact.value->>'object_role'<>'ONTOLOGY_ALIGNMENT'
      )
    ))
    or requested_source#>>'{source_ref,resource_hash}'<>app_data_agent.u2_canonical_sha256(requested_content)
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_INVALID'; end if;
  select * into existing from app_data_agent.semantic_induction_source_packages
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and resource_id=(requested_source#>>'{source_ref,resource_id}')::uuid
    and resource_revision=(requested_source#>>'{source_ref,resource_revision}')::bigint;
  if found then
    if existing.resource_hash<>requested_source#>>'{source_ref,resource_hash}'
      or existing.content_json<>requested_content or existing.semantic_domain<>requested_semantic_domain
    then raise exception using errcode='23505',message='SEMANTIC_INDUCTION_SOURCE_CONFLICT'; end if;
    return requested_source->'source_ref';
  end if;
  insert into app_data_agent.semantic_induction_source_packages(
    app_id,tenant_id,environment,semantic_domain,source_kind,resource_id,resource_revision,
    resource_hash,content_json,registered_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,requested_semantic_domain,
    requested_source->>'source_kind',(requested_source#>>'{source_ref,resource_id}')::uuid,
    (requested_source#>>'{source_ref,resource_revision}')::bigint,
    requested_source#>>'{source_ref,resource_hash}',requested_content,pg_catalog.clock_timestamp()
  );
  return requested_source->'source_ref';
end
$function$;

create function app_data_agent.load_semantic_induction_target(requested_lease jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  request jsonb; source jsonb; source_content jsonb; sources jsonb:='[]'::jsonb;
  facts jsonb; chunks jsonb; package app_data_agent.semantic_induction_source_packages%rowtype;
  scan catalog.schema_scan_run%rowtype; snapshot catalog.physical_schema_snapshot%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype; generation app_data_agent.knowledge_index_generations%rowtype;
  previous_objects jsonb:='[]'::jsonb; dependencies jsonb:='[]'::jsonb;
begin
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id;
  if job.kind not in ('SEMANTIC_INDUCTION','METRIC_IMPORT')
    or job.input_json->>'kind'<>job.kind or job.input_json->'resource_refs'<>'[]'::jsonb
    or not app_data_agent.provider_json_object_has_exact_keys(job.input_json->'parameters',array['request'])
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_JOB_INVALID'; end if;
  request:=job.input_json#>'{parameters,request}';
  perform app_data_agent.semantic_induction_assert_request(request);
  perform app_data_agent.semantic_induction_assert_base_release(
    request,job.app_id,job.tenant_id,job.environment
  );
  if (job.kind='METRIC_IMPORT')<>(request->>'induction_kind'='METRIC_IMPORT') then
    raise exception using errcode='22023',message='SEMANTIC_INDUCTION_JOB_INVALID'; end if;
  for source in select value from pg_catalog.jsonb_array_elements(request->'sources') loop
    if source->>'source_kind'='PHYSICAL_SCHEMA' then
      select * into strict scan from catalog.schema_scan_run
      where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
        and snapshot_id=(source#>>'{source_ref,resource_id}')::uuid and terminal='SUCCEEDED'
        and snapshot_content_hash=source#>>'{source_ref,resource_hash}';
      if (source#>>'{source_ref,resource_revision}')::bigint<>1 then
        raise exception using errcode='40001',message='SEMANTIC_INDUCTION_SOURCE_STALE'; end if;
      select * into strict snapshot from catalog.physical_schema_snapshot
      where app_id=scan.app_id and tenant_id=scan.tenant_id and environment=scan.environment
        and datasource_id=scan.datasource_id and datasource_fingerprint=scan.datasource_fingerprint
        and snapshot_content_hash=scan.snapshot_content_hash;
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'namespace',request->>'semantic_domain','object_role','ENTITY',
        'name',relation.value#>>'{identity,relation_name}','aliases','[]'::jsonb,
        'mapping_identities',pg_catalog.jsonb_build_array('relation:'||(relation.value#>>'{identity,schema_name}')||'.'||(relation.value#>>'{identity,relation_name}')),
        'evidence_identities',pg_catalog.jsonb_build_array('physical-relation:'||(relation.value#>>'{identity,schema_name}')||'.'||(relation.value#>>'{identity,relation_name}')),
        'payload',pg_catalog.jsonb_build_object('schema_name',relation.value#>>'{identity,schema_name}','relation_name',relation.value#>>'{identity,relation_name}','relation_kind',relation.value->>'relation_kind')
      ) order by relation.value#>>'{identity,schema_name}',relation.value#>>'{identity,relation_name}'),'[]'::jsonb)
      into facts from pg_catalog.jsonb_array_elements(snapshot.content_payload->'relations') relation(value);
      source_content:=pg_catalog.jsonb_build_object(
        'source_ref',source->'source_ref','content_hash',snapshot.content_storage_digest,
        'metric_format',null,'facts',facts,'metrics','[]'::jsonb,'document_chunks','[]'::jsonb
      );
    elsif source->>'source_kind'='KNOWLEDGE_DOCUMENT' then
      select * into strict base from app_data_agent.knowledge_base_revisions
      where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
        and knowledge_base_id=(source#>>'{source_ref,resource_id}')::uuid
        and revision=(source#>>'{source_ref,resource_revision}')::bigint
        and revision_hash=source#>>'{source_ref,resource_hash}' and status='READY';
      select * into strict generation from app_data_agent.knowledge_index_generations
      where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
        and knowledge_base_id=base.knowledge_base_id and knowledge_base_revision=base.revision
        and knowledge_base_revision_hash=base.revision_hash and state='READY'
      order by generation_revision desc limit 1;
      if exists (
        select 1 from app_data_agent.knowledge_chunks chunk
        left join app_data_agent.knowledge_projection_receipts projection
          on projection.app_id=chunk.app_id and projection.tenant_id=chunk.tenant_id
          and projection.environment=chunk.environment
          and projection.generation_id=chunk.generation_id and projection.chunk_id=chunk.chunk_id
        where chunk.app_id=generation.app_id and chunk.tenant_id=generation.tenant_id
          and chunk.environment=generation.environment and chunk.generation_id=generation.generation_id
          and (
            projection.receipt_id is null or projection.decision<>'ALLOW'
            or projection.receipt_json->>'classification' not in ('PUBLIC','INTERNAL')
            or (projection.receipt_json->>'pii_finding_count')::bigint<>0
            or (projection.receipt_json->>'credential_finding_count')::bigint<>0
            or (projection.receipt_json->>'prompt_injection_detected')::boolean
            or pg_catalog.lower(chunk.normalized_text) ~
              '(^|[^a-z])(falcon|holdout|gold[ _-]?(sql|answer)|expected[ _-]?(sql|output|answer)|oracle[ _-]?feedback|test[ _-]?question)([^a-z]|$)'
          )
      ) then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_TAINTED'; end if;
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'chunk_id',chunk.chunk_id,'ordinal',chunk.ordinal,'text_hash',chunk.text_hash,
        'normalized_text',chunk.normalized_text
      ) order by chunk.ordinal),'[]'::jsonb) into chunks
      from app_data_agent.knowledge_chunks chunk
      where chunk.app_id=generation.app_id and chunk.tenant_id=generation.tenant_id
        and chunk.environment=generation.environment and chunk.generation_id=generation.generation_id;
      if pg_catalog.jsonb_array_length(chunks)=0 then
        raise exception using errcode='40001',message='SEMANTIC_INDUCTION_SOURCE_STALE'; end if;
      source_content:=pg_catalog.jsonb_build_object(
        'source_ref',source->'source_ref','content_hash',base.revision_hash,
        'metric_format',null,'facts','[]'::jsonb,'metrics','[]'::jsonb,'document_chunks',chunks
      );
    else
      select * into strict package from app_data_agent.semantic_induction_source_packages
      where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
        and semantic_domain=request->>'semantic_domain' and source_kind=source->>'source_kind'
        and resource_id=(source#>>'{source_ref,resource_id}')::uuid
        and resource_revision=(source#>>'{source_ref,resource_revision}')::bigint
        and resource_hash=source#>>'{source_ref,resource_hash}';
      source_content:=pg_catalog.jsonb_build_object(
        'source_ref',source->'source_ref','content_hash',package.resource_hash,
        'metric_format',package.content_json->'metric_format',
        'facts',package.content_json->'facts','metrics',package.content_json->'metrics',
        'document_chunks','[]'::jsonb
      );
      dependencies:=dependencies||(package.content_json->'dependencies');
    end if;
    sources:=sources||pg_catalog.jsonb_build_array(source_content);
  end loop;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'object_id',(object.value->>'object_id')::uuid,
    'object_kind',case object.value#>>'{material,object_role}'
      when 'DIMENSION' then 'DIMENSION' when 'METRIC' then 'METRIC'
      when 'RELATIONSHIP' then 'RELATIONSHIP' when 'FORMULA' then 'FORMULA' else 'ENTITY' end,
    'object_hash',object.value->>'identity_hash'
  ) order by object.value->>'object_id'),'[]'::jsonb) into previous_objects
  from (
    select proposal_json from app_data_agent.semantic_induction_proposals
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
      and semantic_domain=request->>'semantic_domain'
    order by committed_at desc limit 1
  ) previous, lateral pg_catalog.jsonb_array_elements(previous.proposal_json->'stable_objects') object(value);
  return pg_catalog.jsonb_build_object(
    'request',request,'sources',sources,'previous_objects',previous_objects,'dependencies',dependencies
  );
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='SEMANTIC_INDUCTION_SOURCE_STALE';
end
$function$;
