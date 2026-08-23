create function app_data_agent.load_workspace_file_for_scan(requested_lease jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  revision app_data_agent.workspace_file_revisions%rowtype; blob app_data_agent.workspace_content_blobs%rowtype;
begin
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id;
  if job.kind<>'FILE_SCAN'
    or job.input_json->>'kind'<>'FILE_SCAN'
    or job.input_json->'resource_refs'<>'[]'::jsonb
    or not app_data_agent.provider_json_object_has_exact_keys(job.input_json->'parameters',array[
      'file_id','revision','revision_hash'
    ]) then raise exception using errcode='22023',message='WORKSPACE_FILE_SCAN_JOB_INVALID'; end if;
  select candidate.* into strict revision from app_data_agent.workspace_file_revisions candidate
  join app_data_agent.workspace_files current_file
    on current_file.app_id=candidate.app_id and current_file.tenant_id=candidate.tenant_id
      and current_file.environment=candidate.environment and current_file.file_id=candidate.file_id
      and current_file.current_revision=candidate.revision
      and current_file.current_revision_hash=candidate.revision_hash
  where candidate.app_id=job.app_id and candidate.tenant_id=job.tenant_id
    and candidate.environment=job.environment
    and candidate.file_id=(job.input_json#>>'{parameters,file_id}')::uuid
    and candidate.revision=(job.input_json#>>'{parameters,revision}')::bigint
    and candidate.revision_hash=job.input_json#>>'{parameters,revision_hash}'
    and candidate.status='QUARANTINED' and candidate.owner_principal_id=job.principal_id;
  select * into strict blob from app_data_agent.workspace_content_blobs
  where app_id=revision.app_id and tenant_id=revision.tenant_id and environment=revision.environment
    and blob_hash=revision.blob_hash and status='AVAILABLE';
  return pg_catalog.jsonb_build_object(
    'file',revision.revision_json,'storage_key',blob.storage_key,
    'blob_hash',blob.blob_hash,'byte_size',blob.byte_size,'detected_mime',blob.detected_mime
  );
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='WORKSPACE_FILE_SCAN_TARGET_STALE';
end
$function$;

create or replace function app_data_agent.assert_job_artifact_references(
  requested_references jsonb,
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text
)
returns void language plpgsql security definer set search_path=''
as $function$
declare
  reference jsonb;
  reference_identity text;
  previous_identity text;
begin
  if pg_catalog.jsonb_typeof(requested_references)<>'array'
    or pg_catalog.jsonb_array_length(requested_references)>64
  then raise exception using errcode='22023',message='JOB_OUTPUT_REFERENCES_INVALID'; end if;
  for reference in select value from pg_catalog.jsonb_array_elements(requested_references) loop
    if reference ? 'artifact_type' then
      if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
      ]) or reference->>'app_id'<>requested_app_id::text
        or reference->>'tenant_id'<>requested_tenant_id::text
        or reference->>'environment'<>requested_environment
        or reference->>'artifact_id'<>(reference->>'artifact_id')::uuid::text
        or reference->>'run_id'<>(reference->>'run_id')::uuid::text
        or (reference->>'revision')::integer<1
        or reference->>'content_hash'!~'^sha256:[0-9a-f]{64}$'
        or not (
          exists (
            select 1 from app_data_agent.artifacts
            where app_id=requested_app_id and tenant_id=requested_tenant_id
              and environment=requested_environment and run_id=(reference->>'run_id')::uuid
              and artifact_id=(reference->>'artifact_id')::uuid and artifact_type=reference->>'artifact_type'
              and revision=(reference->>'revision')::integer and content_hash=reference->>'content_hash'
              and is_active
          ) or exists (
            select 1 from app_data_agent.artifact_export_receipts
            where app_id=requested_app_id and tenant_id=requested_tenant_id
              and environment=requested_environment and run_id=(reference->>'run_id')::uuid
              and receipt_id=(reference->>'artifact_id')::uuid
              and reference->>'artifact_type'='ArtifactExportReceipt'
              and receipt_revision=(reference->>'revision')::integer and receipt_hash=reference->>'content_hash'
          )
        )
      then raise exception using errcode='23503',message='JOB_ARTIFACT_NOT_COMMITTED'; end if;
      reference_identity:='ARTIFACT:'||pg_catalog.jsonb_build_array(
        reference->>'app_id',reference->>'tenant_id',reference->>'environment',reference->>'run_id',
        reference->>'artifact_id',reference->>'artifact_type',(reference->>'revision')::integer,
        reference->>'content_hash'
      )::text;
    else
      if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
        'schema_version','resource_kind','app_id','tenant_id','environment','resource_id',
        'resource_revision','resource_hash'
      ]) or reference->>'schema_version'<>'job-domain-output-reference@1.0.0'
        or reference->>'resource_kind'<>'WORKSPACE_FILE_SCAN_RECEIPT'
        or reference->>'app_id'<>requested_app_id::text
        or reference->>'tenant_id'<>requested_tenant_id::text
        or reference->>'environment'<>requested_environment
        or reference->>'resource_id'<>(reference->>'resource_id')::uuid::text
        or (reference->>'resource_revision')::integer<>1
        or reference->>'resource_hash'!~'^sha256:[0-9a-f]{64}$'
        or not exists (
          select 1 from app_data_agent.workspace_file_scan_receipts
          where app_id=requested_app_id and tenant_id=requested_tenant_id
            and environment=requested_environment
            and receipt_id=(reference->>'resource_id')::uuid
            and receipt_hash=reference->>'resource_hash'
        )
      then raise exception using errcode='23503',message='JOB_DOMAIN_OUTPUT_NOT_COMMITTED'; end if;
      reference_identity:='DOMAIN:'||pg_catalog.jsonb_build_array(
        reference->>'app_id',reference->>'tenant_id',reference->>'environment',
        reference->>'resource_kind',reference->>'resource_id',
        (reference->>'resource_revision')::integer,reference->>'resource_hash'
      )::text;
    end if;
    if previous_identity is not null and previous_identity>=reference_identity then
      raise exception using errcode='22023',message=case
        when previous_identity=reference_identity then 'JOB_OUTPUT_REFERENCE_DUPLICATE'
        else 'JOB_OUTPUT_REFERENCES_NOT_CANONICAL'
      end;
    end if;
    previous_identity:=reference_identity;
  end loop;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='JOB_OUTPUT_REFERENCES_INVALID';
end
$function$;

create function app_data_agent.commit_workspace_file_scan(
  requested_lease jsonb,requested_scan jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  source app_data_agent.workspace_file_revisions%rowtype; current_file app_data_agent.workspace_files%rowtype;
  blob app_data_agent.workspace_content_blobs%rowtype; receipt_id uuid:=pg_catalog.gen_random_uuid();
  now_at timestamptz:=pg_catalog.clock_timestamp(); receipt_document jsonb; revision_document jsonb;
  scan_ref jsonb; terminal_status text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_scan,array[
    'schema_version','file_ref','blob_hash','byte_size','scanner','verdict','malware_name',
    'credential_match_count','content_policy_findings'
  ]) or requested_scan->>'schema_version'<>'workspace-file-scan-commit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_scan->'file_ref',array[
      'file_id','revision','revision_hash'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_scan->'scanner',array[
      'engine','engine_version','signature_version','signature_observed_at','policy_version'
    ]) or requested_scan#>>'{scanner,engine}'<>'CLAMAV'
    or requested_scan->>'verdict' not in ('CLEAN','MALICIOUS','CREDENTIAL_MATCH','POLICY_BLOCKED')
    or requested_scan->>'blob_hash'!~'^sha256:[0-9a-f]{64}$'
    or (requested_scan->>'byte_size')::bigint not between 1 and 26214400
    or (requested_scan->>'credential_match_count')::bigint not between 0 and 10000
    or pg_catalog.jsonb_typeof(requested_scan->'content_policy_findings')<>'array'
    or app_data_agent.contains_potential_plaintext_secret(requested_scan-'credential_match_count')
  then raise exception using errcode='22023',message='WORKSPACE_FILE_SCAN_CONTRACT_INVALID'; end if;
  if (requested_scan->>'verdict'='CLEAN' and (
      requested_scan->'malware_name'<>'null'::jsonb
      or (requested_scan->>'credential_match_count')::bigint<>0
      or pg_catalog.jsonb_array_length(requested_scan->'content_policy_findings')<>0
    )) or (requested_scan->>'verdict'='MALICIOUS' and requested_scan->'malware_name'='null'::jsonb)
    or (requested_scan->>'verdict'='CREDENTIAL_MATCH' and (requested_scan->>'credential_match_count')::bigint<1)
    or (requested_scan->>'verdict'='POLICY_BLOCKED' and pg_catalog.jsonb_array_length(requested_scan->'content_policy_findings')<1)
  then raise exception using errcode='22023',message='WORKSPACE_FILE_SCAN_VERDICT_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id;
  if job.kind<>'FILE_SCAN' or job.input_json->'parameters'<>pg_catalog.jsonb_build_object(
    'file_id',requested_scan#>>'{file_ref,file_id}',
    'revision',(requested_scan#>>'{file_ref,revision}')::bigint,
    'revision_hash',requested_scan#>>'{file_ref,revision_hash}'
  ) then raise exception using errcode='22023',message='WORKSPACE_FILE_SCAN_JOB_INVALID'; end if;
  select * into strict current_file from app_data_agent.workspace_files
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and file_id=(requested_scan#>>'{file_ref,file_id}')::uuid for update;
  select * into strict source from app_data_agent.workspace_file_revisions
  where app_id=current_file.app_id and tenant_id=current_file.tenant_id and environment=current_file.environment
    and file_id=current_file.file_id and revision=current_file.current_revision
    and revision_hash=current_file.current_revision_hash for share;
  select * into strict blob from app_data_agent.workspace_content_blobs
  where app_id=source.app_id and tenant_id=source.tenant_id and environment=source.environment
    and blob_hash=source.blob_hash for share;
  if source.status<>'QUARANTINED' or source.owner_principal_id<>job.principal_id
    or source.file_id<>(requested_scan#>>'{file_ref,file_id}')::uuid
    or source.revision<>(requested_scan#>>'{file_ref,revision}')::bigint
    or source.revision_hash<>requested_scan#>>'{file_ref,revision_hash}'
    or blob.blob_hash<>requested_scan->>'blob_hash'
    or blob.byte_size<>(requested_scan->>'byte_size')::bigint
  then raise exception using errcode='40001',message='WORKSPACE_FILE_SCAN_TARGET_STALE'; end if;
  receipt_document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-scan-receipt@1.0.0','receipt_id',receipt_id,
    'scope',source.revision_json->'scope',
    'file_ref',app_data_agent.workspace_file_ref_json(source.file_id,source.revision,source.revision_hash),
    'blob_hash',source.blob_hash,'byte_size',blob.byte_size,'job_id',job.job_id,
    'attempt_id',attempt.attempt_id,'worker_fence',attempt.worker_fence,
    'scanner',requested_scan->'scanner','verdict',requested_scan->>'verdict',
    'malware_name',requested_scan->'malware_name',
    'credential_match_count',(requested_scan->>'credential_match_count')::bigint,
    'content_policy_findings',requested_scan->'content_policy_findings',
    'scanned_at',app_data_agent.workspace_file_utc_millis(now_at)
  );
  receipt_document:=receipt_document||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt_document)
  );
  insert into app_data_agent.workspace_file_scan_receipts(
    app_id,tenant_id,environment,receipt_id,file_id,file_revision,file_revision_hash,blob_hash,
    job_id,attempt_id,worker_fence,verdict,receipt_hash,receipt_json,scanned_at
  ) values (
    source.app_id,source.tenant_id,source.environment,receipt_id,source.file_id,source.revision,
    source.revision_hash,source.blob_hash,job.job_id,attempt.attempt_id,attempt.worker_fence,
    requested_scan->>'verdict',receipt_document->>'receipt_hash',receipt_document,now_at
  );
  scan_ref:=pg_catalog.jsonb_build_object(
    'receipt_id',receipt_id,'receipt_hash',receipt_document->>'receipt_hash',
    'verdict',requested_scan->>'verdict'
  );
  terminal_status:=case when requested_scan->>'verdict'='CLEAN' then 'READY' else 'REJECTED' end;
  revision_document:=app_data_agent.workspace_file_build_revision(
    source.revision_json->'scope',source.file_id,source.revision+1,
    app_data_agent.workspace_file_ref_json(source.file_id,source.revision,source.revision_hash),
    source.owner_principal_id,source.visibility,source.session_id,
    source.revision_json->>'original_filename',source.revision_json->>'detected_mime',
    (source.revision_json->>'byte_size')::bigint,source.blob_hash,terminal_status,scan_ref,null,
    source.revision_json->'promoted_from_ref',source.revision_json->'retention_policy_ref',
    job.principal_id,now_at
  );
  perform app_data_agent.workspace_file_insert_revision(revision_document);
  update app_data_agent.workspace_files set current_revision=source.revision+1,
    current_revision_hash=revision_document->>'revision_hash',current_status=terminal_status,updated_at=now_at
  where app_id=source.app_id and tenant_id=source.tenant_id and environment=source.environment
    and file_id=source.file_id;
  return pg_catalog.jsonb_build_object('scan_receipt',receipt_document,'revision',revision_document);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or no_data_found then
  raise exception using errcode='22023',message='WORKSPACE_FILE_SCAN_CONTRACT_INVALID';
end
$function$;

create or replace function app_data_agent.enqueue_job(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  existing_job app_data_agent.jobs%rowtype;
  created_job app_data_agent.jobs%rowtype;
  handler_revision text;
  job_id uuid := pg_catalog.gen_random_uuid();
  accepted_at timestamptz := pg_catalog.clock_timestamp();
  receipt_document jsonb;
  receipt_hash text;
  disposition text := 'CREATED';
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','scope','kind','idempotency_key','input','priority','max_attempts',
    'cancel_policy','request_hash'
  ]) or requested_command->>'schema_version'<>'job-submit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'scope',array[
      'app_id','tenant_id','environment'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'input',array[
      'schema_version','kind','resource_refs','parameters'
    ]) or requested_command->'input'->>'schema_version'<>'job-input@1.0.0'
    or requested_command->>'kind'<>requested_command->'input'->>'kind'
    or requested_command->>'kind' not in (
      'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT','SEMANTIC_INDUCTION',
      'METRIC_IMPORT','DATALINK_REBUILD','FILE_SCAN'
    ) or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then raise exception using errcode='22023',message='JOB_SUBMISSION_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then raise exception using errcode='42501',message='JOB_SCOPE_MISMATCH'; end if;
  perform app_data_agent.assert_job_artifact_references(
    requested_command->'input'->'resource_refs',authority.app_id,authority.tenant_id,authority.environment
  );
  if pg_catalog.length(requested_command->>'idempotency_key') not between 8 and 128
    or requested_command->>'idempotency_key'!~'^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or (requested_command->>'priority')::integer not between 0 and 100
    or (requested_command->>'max_attempts')::integer not between 1 and 10
    or requested_command->>'cancel_policy' not in ('COOPERATIVE','NOT_SUPPORTED')
    or pg_catalog.jsonb_typeof(requested_command->'input'->'resource_refs')<>'array'
    or pg_catalog.jsonb_array_length(requested_command->'input'->'resource_refs')>64
    or pg_catalog.jsonb_typeof(requested_command->'input'->'parameters')<>'object'
    or (requested_command->>'kind'='FILE_SCAN' and (
      requested_command->'input'->'resource_refs'<>'[]'::jsonb
      or not app_data_agent.provider_json_object_has_exact_keys(
        requested_command->'input'->'parameters',array['file_id','revision','revision_hash']
      ) or requested_command#>>'{input,parameters,revision_hash}'!~'^sha256:[0-9a-f]{64}$'
    ))
  then raise exception using errcode='22023',message='JOB_SUBMISSION_CONTRACT_INVALID'; end if;
  select * into existing_job from app_data_agent.jobs
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and idempotency_key=requested_command->>'idempotency_key'
  for share;
  if found then
    if existing_job.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='JOB_IDEMPOTENCY_CONFLICT'; end if;
    disposition:='REPLAYED';job_id:=existing_job.job_id;accepted_at:=existing_job.created_at;
  else
    select revision.handler_revision into strict handler_revision
    from app_data_agent.job_handler_revisions revision
    where revision.kind=requested_command->>'kind'
    order by revision.registered_at desc,revision.handler_revision desc limit 1;
    receipt_document:=pg_catalog.jsonb_build_object(
      'schema_version','job-submission-receipt@1.0.0','disposition','CREATED',
      'scope',requested_command->'scope','principal_id',authority.principal_id,'job_id',job_id,
      'kind',requested_command->>'kind','request_hash',requested_command->>'request_hash',
      'status','QUEUED','accepted_at',app_data_agent.job_utc_millis(accepted_at)
    );
    receipt_hash:=app_data_agent.u2_canonical_sha256(receipt_document);
    receipt_document:=receipt_document||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash);
    insert into app_data_agent.jobs(
      app_id,tenant_id,environment,principal_id,job_id,kind,handler_revision,idempotency_key,
      request_hash,input_json,priority,max_attempts,cancel_policy,status,
      submission_receipt_hash,submission_receipt_json,created_at,updated_at
    ) values (
      authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,job_id,
      requested_command->>'kind',handler_revision,requested_command->>'idempotency_key',
      requested_command->>'request_hash',requested_command->'input',
      (requested_command->>'priority')::integer,(requested_command->>'max_attempts')::integer,
      requested_command->>'cancel_policy','QUEUED',receipt_hash,receipt_document,accepted_at,accepted_at
    ) returning * into created_job;
    perform app_data_agent.job_append_event(created_job,'JOB_QUEUED',pg_catalog.jsonb_build_object(
      'request_hash',created_job.request_hash,'handler_revision',created_job.handler_revision
    ));
  end if;
  receipt_document:=pg_catalog.jsonb_build_object(
    'schema_version','job-submission-receipt@1.0.0','disposition',disposition,
    'scope',requested_command->'scope','principal_id',authority.principal_id,'job_id',job_id,
    'kind',requested_command->>'kind','request_hash',requested_command->>'request_hash',
    'status','QUEUED','accepted_at',app_data_agent.job_utc_millis(accepted_at)
  );
  return receipt_document||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt_document)
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='JOB_SUBMISSION_CONTRACT_INVALID';
end
$function$;

create or replace function app_data_agent.build_requested_optional_resource_bindings(request jsonb)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare authority record; candidate record; current_file app_data_agent.workspace_files%rowtype;
  revision app_data_agent.workspace_file_revisions%rowtype; bindings jsonb:='[]'::jsonb; binding jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  for candidate in
    with overridden as (
      select kind.resource_kind,'OVERRIDE'::text as source,null::jsonb as mention_id,item.document
      from (values ('files','FILE'),('knowledge','KNOWLEDGE'),('mcp_servers','MCP_SERVER'),('skills','SKILL'))
        kind(selection_name,resource_kind)
      cross join lateral pg_catalog.jsonb_array_elements(case
        when request#>>array['overrides',kind.selection_name,'mode']='RESOURCE_IDS'
          then request#>array['overrides',kind.selection_name,'resources'] else '[]'::jsonb end) item(document)
    ), mentioned as (
      select mention.document->>'resource_kind' as resource_kind,'MENTION'::text as source,
        mention.document->'mention_id' as mention_id,mention.document
      from pg_catalog.jsonb_array_elements(request->'mentions') mention(document)
    ) select * from (select * from overridden union all select * from mentioned) all_candidates
      order by resource_kind,document->>'resource_id',source,mention_id
  loop
    current_file:=null;revision:=null;
    if candidate.resource_kind='FILE' then
      select file_record.* into current_file from app_data_agent.workspace_files file_record
      where file_record.app_id=authority.app_id and file_record.tenant_id=authority.tenant_id
        and file_record.environment=authority.environment
        and file_record.file_id=(candidate.document->>'resource_id')::uuid;
      if found then
        select file_revision.* into revision
        from app_data_agent.workspace_file_revisions file_revision
        where file_revision.app_id=current_file.app_id
          and file_revision.tenant_id=current_file.tenant_id
          and file_revision.environment=current_file.environment
          and file_revision.file_id=current_file.file_id
          and file_revision.revision=(candidate.document->>'expected_revision')::bigint
          and file_revision.revision_hash=current_file.current_revision_hash
          and file_revision.revision=current_file.current_revision and file_revision.status='READY'
          and (file_revision.visibility='WORKSPACE' or file_revision.owner_principal_id=authority.principal_id);
      end if;
    end if;
    binding:=pg_catalog.jsonb_build_object(
      'resource_kind',candidate.resource_kind,'mention_id',candidate.mention_id,
      'requested_resource_id',candidate.document->'resource_id',
      'requested_revision',(candidate.document->>'expected_revision')::bigint,
      'effective_resource',case when revision.file_id is null then null else pg_catalog.jsonb_build_object(
        'resource_id',revision.file_id,'resource_revision',revision.revision,'resource_hash',revision.revision_hash
      ) end,
      'source',candidate.source,
      'availability',case when revision.file_id is null then 'UNAVAILABLE' else 'AVAILABLE' end,
      'unavailable_reason',case when revision.file_id is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN' else null end
    );
    bindings:=bindings||pg_catalog.jsonb_build_array(binding);
  end loop;
  return bindings;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;

create or replace function app_data_agent.build_inherited_optional_resource_bindings(
  request jsonb,defaults_document jsonb
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare authority record; candidate record; current_file app_data_agent.workspace_files%rowtype;
  revision app_data_agent.workspace_file_revisions%rowtype; bindings jsonb:='[]'::jsonb; binding jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  for candidate in
    select kind.resource_kind,item.document as reference
    from (values ('files','FILE'),('knowledge','KNOWLEDGE'),('mcp_servers','MCP_SERVER'),('skills','SKILL'))
      kind(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when request#>>array['overrides',kind.selection_name,'mode']='INHERIT_DEFAULT'
        and pg_catalog.jsonb_typeof(defaults_document->kind.selection_name)='array'
        then defaults_document->kind.selection_name else '[]'::jsonb end) item(document)
    order by kind.resource_kind,item.document->>'resource_id'
  loop
    current_file:=null;revision:=null;
    if candidate.resource_kind='FILE' then
      select * into current_file from app_data_agent.workspace_files
      where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
        and file_id=(candidate.reference->>'resource_id')::uuid;
      if found then
        select file_revision.* into revision
        from app_data_agent.workspace_file_revisions file_revision
        where file_revision.app_id=current_file.app_id
          and file_revision.tenant_id=current_file.tenant_id
          and file_revision.environment=current_file.environment
          and file_revision.file_id=current_file.file_id
          and file_revision.revision=(candidate.reference->>'resource_revision')::bigint
          and file_revision.revision_hash=candidate.reference->>'resource_hash'
          and current_file.current_revision=file_revision.revision
          and current_file.current_revision_hash=file_revision.revision_hash
          and file_revision.status='READY'
          and (file_revision.visibility='WORKSPACE' or file_revision.owner_principal_id=authority.principal_id);
      end if;
    end if;
    binding:=pg_catalog.jsonb_build_object(
      'resource_kind',candidate.resource_kind,'mention_id',null,
      'requested_resource_id',candidate.reference->'resource_id',
      'requested_revision',(candidate.reference->>'resource_revision')::bigint,
      'effective_resource',case when revision.file_id is null then null else pg_catalog.jsonb_build_object(
        'resource_id',revision.file_id,'resource_revision',revision.revision,'resource_hash',revision.revision_hash
      ) end,'source','DEFAULT',
      'availability',case when revision.file_id is null then 'UNAVAILABLE' else 'AVAILABLE' end,
      'unavailable_reason',case when revision.file_id is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN' else null end
    );
    bindings:=bindings||pg_catalog.jsonb_build_array(binding);
  end loop;
  return bindings;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;
