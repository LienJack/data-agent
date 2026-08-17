create function app_data_agent.commit_workspace_file_upload(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  existing app_data_agent.workspace_file_idempotency%rowtype;
  policy app_data_agent.storage_retention_policy_revisions%rowtype;
  blob app_data_agent.workspace_content_blobs%rowtype;
  revision_document jsonb;
  scope_document jsonb;
  retention_ref jsonb;
  observed jsonb;
  upload_intent jsonb;
  operation_id uuid;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  expected_storage_key text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','operation_id','workspace_id','intent','observed_content','request_hash'
  ]) or requested_command->>'schema_version'<>'workspace-file-upload-commit@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'intent',array[
      'schema_version','original_filename','visibility','session_id','idempotency_key'
    ]) or requested_command#>>'{intent,schema_version}'<>'workspace-file-upload-intent@1.0.0'
    or requested_command#>>'{intent,visibility}'<>'SESSION'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'observed_content',array[
      'blob_hash','byte_size','detected_mime','storage_key'
    ]) or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then raise exception using errcode='22023',message='WORKSPACE_FILE_UPLOAD_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  operation_id:=(requested_command->>'operation_id')::uuid;
  upload_intent:=requested_command->'intent'; observed:=requested_command->'observed_content';
  if (requested_command->>'workspace_id')::uuid<>authority.tenant_id
    or pg_catalog.length(upload_intent->>'idempotency_key') not between 8 and 128
    or upload_intent->>'idempotency_key'!~'^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or pg_catalog.length(upload_intent->>'original_filename') not between 1 and 255
    or upload_intent->>'original_filename' in ('.','..')
    or upload_intent->>'original_filename' like '%/%'
    or pg_catalog.strpos(upload_intent->>'original_filename',pg_catalog.chr(92))>0
    or upload_intent->>'original_filename'~'[[:cntrl:]]'
    or observed->>'blob_hash'!~'^sha256:[0-9a-f]{64}$'
    or (observed->>'byte_size')::bigint not between 1 and 26214400
    or observed->>'detected_mime'!~'^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
  then raise exception using errcode='22023',message='WORKSPACE_FILE_UPLOAD_CONTRACT_INVALID'; end if;
  expected_storage_key:=pg_catalog.format(
    'workspace-content/v1/%s/%s/%s/%s/%s',authority.app_id,authority.tenant_id,
    authority.environment,pg_catalog.substr(observed->>'blob_hash',8,2),
    pg_catalog.substr(observed->>'blob_hash',8)
  );
  if observed->>'storage_key'<>expected_storage_key then
    raise exception using errcode='22023',message='WORKSPACE_FILE_STORAGE_KEY_INVALID';
  end if;
  select * into existing from app_data_agent.workspace_file_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and operation_kind='UPLOAD'
    and idempotency_key=upload_intent->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='WORKSPACE_FILE_IDEMPOTENCY_CONFLICT';
    end if;
    return existing.result_json;
  end if;
  policy:=app_data_agent.workspace_file_default_retention_policy(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,now_at
  );
  insert into app_data_agent.workspace_content_blobs(
    app_id,tenant_id,environment,blob_hash,storage_key,byte_size,detected_mime,
    active_reference_count,status,created_at,updated_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,observed->>'blob_hash',
    observed->>'storage_key',(observed->>'byte_size')::bigint,observed->>'detected_mime',
    1,'AVAILABLE',now_at,now_at
  ) on conflict (app_id,tenant_id,environment,blob_hash) do update set
    active_reference_count=app_data_agent.workspace_content_blobs.active_reference_count+1,
    updated_at=excluded.updated_at
  where app_data_agent.workspace_content_blobs.storage_key=excluded.storage_key
    and app_data_agent.workspace_content_blobs.byte_size=excluded.byte_size
    and app_data_agent.workspace_content_blobs.detected_mime=excluded.detected_mime
    and app_data_agent.workspace_content_blobs.status='AVAILABLE'
  returning * into blob;
  if not found then raise exception using errcode='23505',message='WORKSPACE_FILE_BLOB_CONFLICT'; end if;
  scope_document:=app_data_agent.workspace_file_scope_json(
    authority.app_id,authority.tenant_id,authority.environment
  );
  retention_ref:=pg_catalog.jsonb_build_object(
    'policy_id',policy.policy_id,'policy_revision',policy.revision,'policy_hash',policy.policy_hash
  );
  revision_document:=app_data_agent.workspace_file_build_revision(
    scope_document,operation_id,1,null,authority.principal_id,'SESSION',
    (upload_intent->>'session_id')::uuid,upload_intent->>'original_filename',blob.detected_mime,blob.byte_size,
    blob.blob_hash,'QUARANTINED',null,null,null,retention_ref,authority.principal_id,now_at
  );
  insert into app_data_agent.workspace_files(
    app_id,tenant_id,environment,file_id,owner_principal_id,current_revision,
    current_revision_hash,current_status,created_at,updated_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,operation_id,authority.principal_id,
    1,revision_document->>'revision_hash','QUARANTINED',now_at,now_at
  );
  perform app_data_agent.workspace_file_insert_revision(revision_document);
  insert into app_data_agent.workspace_file_idempotency(
    app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key,request_hash,
    file_id,revision,result_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'UPLOAD',
    upload_intent->>'idempotency_key',requested_command->>'request_hash',operation_id,1,revision_document,now_at
  );
  return revision_document;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='WORKSPACE_FILE_UPLOAD_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.list_workspace_files(
  requested_session_id uuid default null,requested_limit integer default 100
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; result jsonb;
begin
  if requested_limit not between 1 and 200 then
    raise exception using errcode='22023',message='WORKSPACE_FILE_LIST_CONTRACT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(bounded.revision_json order by bounded.updated_at desc,bounded.file_id),'[]'::jsonb)
  into result from (
    select revision.revision_json,current_file.updated_at,current_file.file_id
    from app_data_agent.workspace_files current_file
    join app_data_agent.workspace_file_revisions revision
      on revision.app_id=current_file.app_id and revision.tenant_id=current_file.tenant_id
        and revision.environment=current_file.environment and revision.file_id=current_file.file_id
        and revision.revision=current_file.current_revision
    where current_file.app_id=authority.app_id and current_file.tenant_id=authority.tenant_id
      and current_file.environment=authority.environment
      and (revision.visibility='WORKSPACE' or revision.owner_principal_id=authority.principal_id)
      and (requested_session_id is null or revision.session_id=requested_session_id)
    order by current_file.updated_at desc,current_file.file_id
    limit requested_limit
  ) bounded;
  return result;
end
$function$;

create function app_data_agent.get_workspace_file(
  requested_file_id uuid,requested_revision bigint default null,requested_revision_hash text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; revision app_data_agent.workspace_file_revisions%rowtype;
begin
  select * into strict authority from platform.current_backend_authority(false);
  select candidate.* into revision from app_data_agent.workspace_file_revisions candidate
  join app_data_agent.workspace_files current_file
    on current_file.app_id=candidate.app_id and current_file.tenant_id=candidate.tenant_id
      and current_file.environment=candidate.environment and current_file.file_id=candidate.file_id
  where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
    and candidate.environment=authority.environment and candidate.file_id=requested_file_id
    and candidate.revision=coalesce(requested_revision,current_file.current_revision)
    and (requested_revision_hash is null or candidate.revision_hash=requested_revision_hash)
    and (candidate.visibility='WORKSPACE' or candidate.owner_principal_id=authority.principal_id);
  return case when found then revision.revision_json else null end;
end
$function$;

create function app_data_agent.resolve_workspace_file_download(
  requested_file_id uuid,requested_revision bigint,requested_revision_hash text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; revision app_data_agent.workspace_file_revisions%rowtype; blob app_data_agent.workspace_content_blobs%rowtype;
begin
  select * into strict authority from platform.current_backend_authority(false);
  revision:=app_data_agent.workspace_file_exact_revision(
    requested_file_id,requested_revision,requested_revision_hash,true
  );
  if revision.status<>'READY'
    or not (revision.visibility='WORKSPACE' or revision.owner_principal_id=authority.principal_id)
  then raise exception using errcode='42501',message='WORKSPACE_FILE_NOT_AVAILABLE'; end if;
  select * into strict blob from app_data_agent.workspace_content_blobs
  where app_id=revision.app_id and tenant_id=revision.tenant_id and environment=revision.environment
    and blob_hash=revision.blob_hash and status='AVAILABLE';
  return pg_catalog.jsonb_build_object(
    'file',revision.revision_json,'storage_key',blob.storage_key,
    'blob_hash',blob.blob_hash,'byte_size',blob.byte_size,'detected_mime',blob.detected_mime
  );
exception when no_data_found then
  raise exception using errcode='P0002',message='WORKSPACE_FILE_NOT_AVAILABLE';
end
$function$;

create function app_data_agent.promote_workspace_file(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.workspace_file_idempotency%rowtype;
  current_file app_data_agent.workspace_files%rowtype; source app_data_agent.workspace_file_revisions%rowtype;
  revision_document jsonb; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','operation_id','workspace_id','file_ref','idempotency_key','request_hash'
  ]) or requested_command->>'schema_version'<>'workspace-file-promote@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'file_ref',array[
      'file_id','revision','revision_hash'
    ]) then raise exception using errcode='22023',message='WORKSPACE_FILE_PROMOTE_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if (requested_command->>'workspace_id')::uuid<>authority.tenant_id then
    raise exception using errcode='42501',message='WORKSPACE_FILE_SCOPE_MISMATCH';
  end if;
  select * into existing from app_data_agent.workspace_file_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and operation_kind='PROMOTE'
    and idempotency_key=requested_command->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='WORKSPACE_FILE_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  select * into strict current_file from app_data_agent.workspace_files
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and file_id=(requested_command#>>'{file_ref,file_id}')::uuid for update;
  select * into strict source from app_data_agent.workspace_file_revisions
  where app_id=current_file.app_id and tenant_id=current_file.tenant_id and environment=current_file.environment
    and file_id=current_file.file_id and revision=(requested_command#>>'{file_ref,revision}')::bigint
    and revision_hash=requested_command#>>'{file_ref,revision_hash}' for share;
  if source.revision<>current_file.current_revision or source.revision_hash<>current_file.current_revision_hash
    or source.owner_principal_id<>authority.principal_id or source.visibility<>'SESSION' or source.status<>'READY'
  then raise exception using errcode='40001',message='WORKSPACE_FILE_REVISION_STALE'; end if;
  revision_document:=app_data_agent.workspace_file_build_revision(
    source.revision_json->'scope',source.file_id,source.revision+1,
    app_data_agent.workspace_file_ref_json(source.file_id,source.revision,source.revision_hash),
    source.owner_principal_id,'WORKSPACE',null,source.revision_json->>'original_filename',
    source.revision_json->>'detected_mime',(source.revision_json->>'byte_size')::bigint,
    source.blob_hash,'READY',source.revision_json->'scan_receipt_ref',null,
    app_data_agent.workspace_file_ref_json(source.file_id,source.revision,source.revision_hash)
      ||pg_catalog.jsonb_build_object('blob_hash',source.blob_hash),
    source.revision_json->'retention_policy_ref',authority.principal_id,now_at
  );
  perform app_data_agent.workspace_file_insert_revision(revision_document);
  update app_data_agent.workspace_files set current_revision=source.revision+1,
    current_revision_hash=revision_document->>'revision_hash',current_status='READY',updated_at=now_at
  where app_id=current_file.app_id and tenant_id=current_file.tenant_id and environment=current_file.environment
    and file_id=current_file.file_id;
  insert into app_data_agent.workspace_file_idempotency(
    app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key,request_hash,
    file_id,revision,result_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'PROMOTE',
    requested_command->>'idempotency_key',requested_command->>'request_hash',source.file_id,
    source.revision+1,revision_document,now_at
  );
  return revision_document;
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',message='WORKSPACE_FILE_PROMOTE_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.delete_workspace_file(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.workspace_file_idempotency%rowtype;
  current_file app_data_agent.workspace_files%rowtype; source app_data_agent.workspace_file_revisions%rowtype;
  blob app_data_agent.workspace_content_blobs%rowtype; hold_active boolean; remaining bigint;
  policy app_data_agent.storage_retention_policy_revisions%rowtype;
  deletion_document jsonb; revision_document jsonb; deletion_ref jsonb;
  now_at timestamptz:=pg_catalog.clock_timestamp(); receipt_id uuid:=pg_catalog.gen_random_uuid();
  blob_status text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','operation_id','workspace_id','file_ref','idempotency_key','request_hash'
  ]) or requested_command->>'schema_version'<>'workspace-file-delete@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'file_ref',array[
      'file_id','revision','revision_hash'
    ]) then raise exception using errcode='22023',message='WORKSPACE_FILE_DELETE_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if (requested_command->>'workspace_id')::uuid<>authority.tenant_id then
    raise exception using errcode='42501',message='WORKSPACE_FILE_SCOPE_MISMATCH'; end if;
  select * into existing from app_data_agent.workspace_file_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and operation_kind='DELETE'
    and idempotency_key=requested_command->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='WORKSPACE_FILE_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  select * into strict current_file from app_data_agent.workspace_files
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and file_id=(requested_command#>>'{file_ref,file_id}')::uuid for update;
  select * into strict source from app_data_agent.workspace_file_revisions
  where app_id=current_file.app_id and tenant_id=current_file.tenant_id and environment=current_file.environment
    and file_id=current_file.file_id and revision=current_file.current_revision
    and revision_hash=current_file.current_revision_hash for share;
  if source.owner_principal_id<>authority.principal_id and authority.membership_role<>'owner' then
    raise exception using errcode='42501',message='WORKSPACE_FILE_NOT_FOUND';
  end if;
  if source.revision<>(requested_command#>>'{file_ref,revision}')::bigint
    or source.revision_hash<>requested_command#>>'{file_ref,revision_hash}' or source.status='DELETED'
  then raise exception using errcode='40001',message='WORKSPACE_FILE_REVISION_STALE'; end if;
  select * into strict blob from app_data_agent.workspace_content_blobs
  where app_id=source.app_id and tenant_id=source.tenant_id and environment=source.environment
    and blob_hash=source.blob_hash for update;
  select * into strict policy from app_data_agent.storage_retention_policy_revisions
  where app_id=source.app_id and tenant_id=source.tenant_id and environment=source.environment
    and policy_id=(source.revision_json#>>'{retention_policy_ref,policy_id}')::uuid
    and revision=(source.revision_json#>>'{retention_policy_ref,policy_revision}')::bigint
    and policy_hash=source.revision_json#>>'{retention_policy_ref,policy_hash}';
  select coalesce((select active from app_data_agent.workspace_file_legal_holds
    where app_id=source.app_id and tenant_id=source.tenant_id and environment=source.environment
      and file_id=source.file_id order by hold_revision desc limit 1),false) into hold_active;
  remaining:=greatest(blob.active_reference_count-1,0::bigint);
  blob_status:=case when hold_active then 'RETAINED_BY_LEGAL_HOLD'
    when remaining>0 then 'RETAINED_BY_REFERENCE' else 'RETAINED_BY_POLICY' end;
  deletion_document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-deletion-receipt@1.0.0','receipt_id',receipt_id,
    'operation_id',(requested_command->>'operation_id')::uuid,'scope',source.revision_json->'scope',
    'file_ref',app_data_agent.workspace_file_ref_json(source.file_id,source.revision,source.revision_hash),
    'blob_hash',source.blob_hash,'deleted_by_principal_id',authority.principal_id,
    'access_revoked_at',app_data_agent.workspace_file_utc_millis(now_at),
    'legal_hold_active',hold_active,'remaining_active_references',remaining,
    'blob_deletion_status',blob_status,
    'backup_expires_at',app_data_agent.workspace_file_utc_millis(
      now_at+pg_catalog.make_interval(secs=>(policy.policy_json->>'backup_expiry_seconds')::double precision)
    )
  );
  deletion_document:=deletion_document||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(deletion_document)
  );
  insert into app_data_agent.workspace_file_deletion_receipts(
    app_id,tenant_id,environment,receipt_id,operation_id,file_id,file_revision,file_revision_hash,
    receipt_hash,receipt_json,access_revoked_at
  ) values (
    source.app_id,source.tenant_id,source.environment,receipt_id,
    (requested_command->>'operation_id')::uuid,source.file_id,source.revision,source.revision_hash,
    deletion_document->>'receipt_hash',deletion_document,now_at
  );
  deletion_ref:=pg_catalog.jsonb_build_object(
    'receipt_id',receipt_id,'receipt_hash',deletion_document->>'receipt_hash'
  );
  revision_document:=app_data_agent.workspace_file_build_revision(
    source.revision_json->'scope',source.file_id,source.revision+1,
    app_data_agent.workspace_file_ref_json(source.file_id,source.revision,source.revision_hash),
    source.owner_principal_id,source.visibility,source.session_id,
    source.revision_json->>'original_filename',source.revision_json->>'detected_mime',
    (source.revision_json->>'byte_size')::bigint,source.blob_hash,'DELETED',
    source.revision_json->'scan_receipt_ref',deletion_ref,source.revision_json->'promoted_from_ref',
    source.revision_json->'retention_policy_ref',authority.principal_id,now_at
  );
  perform app_data_agent.workspace_file_insert_revision(revision_document);
  update app_data_agent.workspace_files set current_revision=source.revision+1,
    current_revision_hash=revision_document->>'revision_hash',current_status='DELETED',updated_at=now_at
  where app_id=source.app_id and tenant_id=source.tenant_id and environment=source.environment
    and file_id=source.file_id;
  update app_data_agent.workspace_content_blobs set active_reference_count=remaining,
    updated_at=now_at
  where app_id=blob.app_id and tenant_id=blob.tenant_id and environment=blob.environment
    and blob_hash=blob.blob_hash;
  insert into app_data_agent.workspace_file_idempotency(
    app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key,request_hash,
    file_id,revision,result_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'DELETE',
    requested_command->>'idempotency_key',requested_command->>'request_hash',source.file_id,
    source.revision+1,pg_catalog.jsonb_build_object(
      'revision',revision_document,'deletion_receipt',deletion_document
    ),now_at
  );
  return pg_catalog.jsonb_build_object('revision',revision_document,'deletion_receipt',deletion_document);
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',message='WORKSPACE_FILE_DELETE_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.set_workspace_file_legal_hold(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; current_file app_data_agent.workspace_files%rowtype;
  current_revision app_data_agent.workspace_file_revisions%rowtype;
  blob app_data_agent.workspace_content_blobs%rowtype;
  existing app_data_agent.workspace_file_idempotency%rowtype; document jsonb;
  now_at timestamptz:=pg_catalog.clock_timestamp(); next_revision bigint;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','operation_id','workspace_id','file_id','active','reason_code',
    'idempotency_key','request_hash'
  ]) or requested_command->>'schema_version'<>'workspace-file-legal-hold@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or requested_command->>'reason_code' not in (
      'LEGAL_REQUEST','SECURITY_INCIDENT','AUDIT_PRESERVATION','RELEASED'
    ) or ((requested_command->>'active')::boolean and requested_command->>'reason_code'='RELEASED')
      or (not (requested_command->>'active')::boolean and requested_command->>'reason_code'<>'RELEASED')
    or pg_catalog.length(requested_command->>'idempotency_key') not between 8 and 128
    or requested_command->>'idempotency_key'!~'^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  then raise exception using errcode='22023',message='WORKSPACE_FILE_LEGAL_HOLD_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if authority.membership_role<>'owner' or (requested_command->>'workspace_id')::uuid<>authority.tenant_id then
    raise exception using errcode='42501',message='WORKSPACE_FILE_LEGAL_HOLD_DENIED'; end if;
  select * into existing from app_data_agent.workspace_file_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and operation_kind='LEGAL_HOLD'
    and idempotency_key=requested_command->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='WORKSPACE_FILE_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  select * into strict current_file from app_data_agent.workspace_files
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and file_id=(requested_command->>'file_id')::uuid for update;
  select * into strict current_revision from app_data_agent.workspace_file_revisions
  where app_id=current_file.app_id and tenant_id=current_file.tenant_id
    and environment=current_file.environment and file_id=current_file.file_id
    and revision=current_file.current_revision and revision_hash=current_file.current_revision_hash;
  select * into strict blob from app_data_agent.workspace_content_blobs
  where app_id=current_revision.app_id and tenant_id=current_revision.tenant_id
    and environment=current_revision.environment and blob_hash=current_revision.blob_hash for update;
  if (requested_command->>'active')::boolean and blob.status<>'AVAILABLE' then
    raise exception using errcode='40001',message='WORKSPACE_CONTENT_GC_ALREADY_COMMITTED';
  end if;
  select coalesce(pg_catalog.max(hold_revision),0)+1 into next_revision
  from app_data_agent.workspace_file_legal_holds
  where app_id=current_file.app_id and tenant_id=current_file.tenant_id
    and environment=current_file.environment and file_id=current_file.file_id;
  document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-legal-hold-receipt@1.0.0',
    'scope',app_data_agent.workspace_file_scope_json(
      authority.app_id,authority.tenant_id,authority.environment
    ),'file_id',current_file.file_id,'hold_revision',next_revision,
    'active',(requested_command->>'active')::boolean,'operation_id',(requested_command->>'operation_id')::uuid,
    'principal_id',authority.principal_id,'reason_code',requested_command->>'reason_code',
    'created_at',app_data_agent.workspace_file_utc_millis(now_at)
  );
  document:=document||pg_catalog.jsonb_build_object('hold_hash',app_data_agent.u2_canonical_sha256(document));
  insert into app_data_agent.workspace_file_legal_holds(
    app_id,tenant_id,environment,file_id,hold_revision,active,operation_id,principal_id,
    reason_code,hold_hash,hold_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,current_file.file_id,next_revision,
    (requested_command->>'active')::boolean,(requested_command->>'operation_id')::uuid,
    authority.principal_id,requested_command->>'reason_code',document->>'hold_hash',document,now_at
  );
  insert into app_data_agent.workspace_file_idempotency(
    app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key,request_hash,
    file_id,revision,result_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'LEGAL_HOLD',
    requested_command->>'idempotency_key',requested_command->>'request_hash',current_file.file_id,
    current_file.current_revision,document,now_at
  );
  return document;
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',message='WORKSPACE_FILE_LEGAL_HOLD_CONTRACT_INVALID';
end
$function$;
