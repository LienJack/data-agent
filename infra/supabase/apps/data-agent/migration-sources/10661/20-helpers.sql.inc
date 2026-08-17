create function app_data_agent.knowledge_utc_millis(value timestamptz)
returns text language sql immutable parallel safe set search_path=''
as $function$
  select pg_catalog.to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;

create function app_data_agent.knowledge_assert_source_refs(
  requested_refs jsonb, requested_app_id uuid, requested_tenant_id uuid,
  requested_environment text, requested_principal_id uuid
)
returns void language plpgsql stable security definer set search_path=''
as $function$
declare item jsonb; previous text; identity text; resolved_file_id uuid;
begin
  if pg_catalog.jsonb_typeof(requested_refs)<>'array'
    or pg_catalog.jsonb_array_length(requested_refs) not between 1 and 128
  then raise exception using errcode='22023',message='KNOWLEDGE_SOURCE_REFERENCES_INVALID'; end if;
  for item in select value from pg_catalog.jsonb_array_elements(requested_refs) loop
    if not app_data_agent.provider_json_object_has_exact_keys(item,array['file_id','revision','revision_hash'])
      or item->>'revision_hash'!~'^sha256:[0-9a-f]{64}$'
    then raise exception using errcode='22023',message='KNOWLEDGE_SOURCE_REFERENCES_INVALID'; end if;
    identity:=pg_catalog.jsonb_build_array(
      item->>'file_id',(item->>'revision')::bigint,item->>'revision_hash'
    )::text;
    if previous is not null and previous>=identity then
      raise exception using errcode='22023',message='KNOWLEDGE_SOURCE_REFERENCES_NOT_CANONICAL';
    end if;
    previous:=identity;
    select revision.file_id into strict resolved_file_id
    from app_data_agent.workspace_file_revisions revision
    join app_data_agent.workspace_files file_record
      on file_record.app_id=revision.app_id and file_record.tenant_id=revision.tenant_id
      and file_record.environment=revision.environment and file_record.file_id=revision.file_id
      and file_record.current_revision=revision.revision
      and file_record.current_revision_hash=revision.revision_hash
    where revision.app_id=requested_app_id and revision.tenant_id=requested_tenant_id
      and revision.environment=requested_environment
      and revision.file_id=(item->>'file_id')::uuid
      and revision.revision=(item->>'revision')::bigint
      and revision.revision_hash=item->>'revision_hash'
      and revision.status='READY'
      and (revision.visibility='WORKSPACE' or revision.owner_principal_id=requested_principal_id);
  end loop;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_SOURCE_NOT_READY';
end
$function$;

create function app_data_agent.knowledge_enqueue_index_job(
  requested_app_id uuid, requested_tenant_id uuid, requested_environment text,
  requested_principal_id uuid, base_document jsonb, generation_document jsonb,
  idempotency_key text
)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare job_id uuid:=pg_catalog.gen_random_uuid(); now_at timestamptz:=pg_catalog.clock_timestamp();
  input_document jsonb; request_hash text; receipt jsonb; job_row app_data_agent.jobs%rowtype;
begin
  input_document:=pg_catalog.jsonb_build_object(
    'schema_version','job-input@1.0.0','kind','KNOWLEDGE_INDEX','resource_refs','[]'::jsonb,
    'parameters',pg_catalog.jsonb_build_object(
      'knowledge_base_id',base_document->>'knowledge_base_id',
      'revision',(base_document->>'revision')::bigint,
      'revision_hash',base_document->>'revision_hash',
      'generation_id',generation_document->>'generation_id'
    )
  );
  request_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'schema_version','job-submit@1.0.0','scope',base_document->'scope','kind','KNOWLEDGE_INDEX',
    'idempotency_key',idempotency_key,'input',input_document,'priority',50,'max_attempts',3,
    'cancel_policy','COOPERATIVE'
  ));
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','job-submission-receipt@1.0.0','disposition','CREATED',
    'scope',base_document->'scope','principal_id',requested_principal_id,'job_id',job_id,
    'kind','KNOWLEDGE_INDEX','request_hash',request_hash,'status','QUEUED',
    'accepted_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  insert into app_data_agent.jobs(
    app_id,tenant_id,environment,principal_id,job_id,kind,handler_revision,idempotency_key,
    request_hash,input_json,priority,max_attempts,cancel_policy,status,
    submission_receipt_hash,submission_receipt_json,created_at,updated_at
  ) values (
    requested_app_id,requested_tenant_id,requested_environment,requested_principal_id,job_id,
    'KNOWLEDGE_INDEX','knowledge-index-handler@1.0.0',idempotency_key,request_hash,input_document,
    50,3,'COOPERATIVE','QUEUED',receipt->>'receipt_hash',receipt,now_at,now_at
  ) returning * into job_row;
  perform app_data_agent.job_append_event(job_row,'JOB_QUEUED',pg_catalog.jsonb_build_object(
    'request_hash',request_hash,'handler_revision','knowledge-index-handler@1.0.0'
  ));
  return job_id;
end
$function$;

create function app_data_agent.knowledge_build_resource_binding(
  requested_app_id uuid, requested_tenant_id uuid, requested_environment text,
  requested_principal_id uuid, requested_resource_id uuid, requested_revision bigint,
  requested_source text, requested_mention_id jsonb
)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare resolved_revision app_data_agent.knowledge_base_revisions%rowtype;
  resolved_generation app_data_agent.knowledge_index_generations%rowtype;
  is_current boolean:=false;
begin
  select revision.* into resolved_revision
  from app_data_agent.knowledge_bases base
  join app_data_agent.knowledge_base_revisions revision
    on revision.app_id=base.app_id and revision.tenant_id=base.tenant_id
    and revision.environment=base.environment
    and revision.knowledge_base_id=base.knowledge_base_id
    and revision.revision=base.current_revision
    and revision.revision_hash=base.current_revision_hash
  join app_data_agent.knowledge_embedding_profile_revisions profile
    on profile.app_id=revision.app_id and profile.tenant_id=revision.tenant_id
    and profile.environment=revision.environment and profile.profile_id=revision.profile_id
    and profile.revision=revision.profile_revision and profile.profile_hash=revision.profile_hash
    and profile.status='READY'
  where base.app_id=requested_app_id and base.tenant_id=requested_tenant_id
    and base.environment=requested_environment and base.knowledge_base_id=requested_resource_id
    and base.current_revision=requested_revision and base.current_status='READY'
    and revision.status='READY';
  if found then
    select generation.* into resolved_generation
    from app_data_agent.knowledge_index_generations generation
    where generation.app_id=resolved_revision.app_id
      and generation.tenant_id=resolved_revision.tenant_id
      and generation.environment=resolved_revision.environment
      and generation.knowledge_base_id=resolved_revision.knowledge_base_id
      and generation.generation_id=(resolved_revision.revision_json#>>'{active_generation_ref,generation_id}')::uuid
      and generation.generation_revision=(resolved_revision.revision_json#>>'{active_generation_ref,generation_revision}')::bigint
      and generation.generation_hash=resolved_revision.revision_json#>>'{active_generation_ref,generation_hash}'
      and generation.state='READY'
    limit 1;
    is_current:=found and not exists (
      select 1 from pg_catalog.jsonb_array_elements(resolved_revision.source_refs_json) source_ref
      where not exists (
        select 1 from app_data_agent.workspace_files file_record
        join app_data_agent.workspace_file_revisions file_revision
          on file_revision.app_id=file_record.app_id and file_revision.tenant_id=file_record.tenant_id
          and file_revision.environment=file_record.environment and file_revision.file_id=file_record.file_id
          and file_revision.revision=file_record.current_revision
          and file_revision.revision_hash=file_record.current_revision_hash
        where file_record.app_id=requested_app_id and file_record.tenant_id=requested_tenant_id
          and file_record.environment=requested_environment
          and file_record.file_id=(source_ref->>'file_id')::uuid
          and file_revision.revision=(source_ref->>'revision')::bigint
          and file_revision.revision_hash=source_ref->>'revision_hash'
          and file_revision.status='READY'
          and (file_revision.visibility='WORKSPACE' or file_revision.owner_principal_id=requested_principal_id)
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'resource_kind','KNOWLEDGE','mention_id',requested_mention_id,
    'requested_resource_id',requested_resource_id,'requested_revision',requested_revision,
    'effective_resource',case when is_current then pg_catalog.jsonb_build_object(
      'resource_id',resolved_revision.knowledge_base_id,'resource_revision',resolved_revision.revision,
      'resource_hash',resolved_revision.revision_hash
    ) else null end,
    'source',requested_source,'availability',case when is_current then 'AVAILABLE' else 'UNAVAILABLE' end,
    'unavailable_reason',case when is_current then null else 'RESOURCE_NOT_FOUND_OR_FORBIDDEN' end
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;
