create function app_data_agent.update_storage_retention_policy(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  current_policy app_data_agent.storage_retention_policy_revisions%rowtype;
  existing app_data_agent.workspace_file_idempotency%rowtype;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  next_revision bigint;
  document jsonb;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','operation_id','workspace_id','expected_policy_ref',
    'quarantine_ttl_seconds','deleted_reference_ttl_seconds','orphan_blob_ttl_seconds',
    'backup_expiry_seconds','legal_hold_enabled','idempotency_key','request_hash'
  ]) or requested_command->>'schema_version'<>'storage-retention-policy-update@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command->'expected_policy_ref',array['policy_id','policy_revision','policy_hash']
    )
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(
      requested_command-'request_hash'
    )
    or (requested_command->'expected_policy_ref'->>'policy_hash')!~'^sha256:[0-9a-f]{64}$'
    or (requested_command->>'quarantine_ttl_seconds')::bigint not between 1 and 31536000
    or (requested_command->>'deleted_reference_ttl_seconds')::bigint not between 0 and 31536000
    or (requested_command->>'orphan_blob_ttl_seconds')::bigint not between 1 and 31536000
    or (requested_command->>'backup_expiry_seconds')::bigint not between 1 and 315360000
    or pg_catalog.length(requested_command->>'idempotency_key') not between 8 and 128
    or requested_command->>'idempotency_key'!~'^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  then raise exception using errcode='22023',message='STORAGE_RETENTION_POLICY_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if authority.membership_role<>'owner'
    or (requested_command->>'workspace_id')::uuid<>authority.tenant_id
  then raise exception using errcode='42501',message='STORAGE_RETENTION_POLICY_DENIED'; end if;
  select * into existing from app_data_agent.workspace_file_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id
    and environment=authority.environment and principal_id=authority.principal_id
    and operation_kind='RETENTION_POLICY'
    and idempotency_key=requested_command->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='WORKSPACE_FILE_IDEMPOTENCY_CONFLICT';
    end if;
    return existing.result_json;
  end if;
  perform app_data_agent.workspace_file_default_retention_policy(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,now_at
  );
  select * into strict current_policy
  from app_data_agent.storage_retention_policy_revisions policy
  where policy.app_id=authority.app_id and policy.tenant_id=authority.tenant_id
    and policy.environment=authority.environment
    and policy.policy_id=(requested_command->'expected_policy_ref'->>'policy_id')::uuid
  order by policy.revision desc limit 1 for update;
  if current_policy.revision<>(requested_command->'expected_policy_ref'->>'policy_revision')::bigint
    or current_policy.policy_hash<>requested_command->'expected_policy_ref'->>'policy_hash'
  then raise exception using errcode='40001',message='STORAGE_RETENTION_POLICY_REVISION_STALE'; end if;
  next_revision:=current_policy.revision+1;
  document:=pg_catalog.jsonb_build_object(
    'schema_version','storage-retention-policy-revision@1.0.0',
    'scope',app_data_agent.workspace_file_scope_json(
      authority.app_id,authority.tenant_id,authority.environment
    ),'policy_id',current_policy.policy_id,'revision',next_revision,
    'parent_ref',pg_catalog.jsonb_build_object(
      'policy_id',current_policy.policy_id,'policy_revision',current_policy.revision,
      'policy_hash',current_policy.policy_hash
    ),'quarantine_ttl_seconds',(requested_command->>'quarantine_ttl_seconds')::bigint,
    'deleted_reference_ttl_seconds',(requested_command->>'deleted_reference_ttl_seconds')::bigint,
    'orphan_blob_ttl_seconds',(requested_command->>'orphan_blob_ttl_seconds')::bigint,
    'backup_expiry_seconds',(requested_command->>'backup_expiry_seconds')::bigint,
    'legal_hold_enabled',(requested_command->>'legal_hold_enabled')::boolean,
    'created_by_principal_id',authority.principal_id,
    'created_at',app_data_agent.workspace_file_utc_millis(now_at)
  );
  document:=document||pg_catalog.jsonb_build_object(
    'policy_hash',app_data_agent.u2_canonical_sha256(document)
  );
  insert into app_data_agent.storage_retention_policy_revisions(
    app_id,tenant_id,environment,policy_id,revision,policy_hash,policy_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,current_policy.policy_id,
    next_revision,document->>'policy_hash',document,now_at
  );
  insert into app_data_agent.workspace_file_idempotency(
    app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key,request_hash,
    file_id,revision,result_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    'RETENTION_POLICY',requested_command->>'idempotency_key',requested_command->>'request_hash',
    current_policy.policy_id,next_revision,document,now_at
  );
  return document;
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',message='STORAGE_RETENTION_POLICY_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.evaluate_workspace_content_gc(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  blob app_data_agent.workspace_content_blobs%rowtype;
  existing app_data_agent.workspace_content_gc_receipts%rowtype;
  receipt_id uuid:=pg_catalog.gen_random_uuid();
  now_at timestamptz:=pg_catalog.clock_timestamp();
  hold_active boolean;
  retention_expires timestamptz;
  backup_expires timestamptz;
  disposition text;
  document jsonb;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','operation_id','workspace_id','blob_hash','idempotency_key','request_hash'
  ]) or requested_command->>'schema_version'<>'workspace-content-gc-evaluate@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or requested_command->>'blob_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.length(requested_command->>'idempotency_key') not between 8 and 128
    or requested_command->>'idempotency_key'!~'^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then raise exception using errcode='22023',message='WORKSPACE_CONTENT_GC_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if authority.membership_role<>'owner'
    or (requested_command->>'workspace_id')::uuid<>authority.tenant_id
  then raise exception using errcode='42501',message='WORKSPACE_CONTENT_GC_DENIED'; end if;
  select * into existing from app_data_agent.workspace_content_gc_receipts
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and idempotency_key=requested_command->>'idempotency_key'
    and parent_receipt_id is null;
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='WORKSPACE_FILE_IDEMPOTENCY_CONFLICT';
    end if;
    select * into strict blob from app_data_agent.workspace_content_blobs
    where app_id=existing.app_id and tenant_id=existing.tenant_id and environment=existing.environment
      and blob_hash=existing.blob_hash;
    return pg_catalog.jsonb_build_object(
      'receipt',existing.receipt_json,
      'deletion_authority',case when existing.status='ELIGIBLE' then pg_catalog.jsonb_build_object(
        'storage_key',blob.storage_key,'blob_hash',blob.blob_hash
      ) else null end
    );
  end if;
  select * into strict blob from app_data_agent.workspace_content_blobs
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and blob_hash=requested_command->>'blob_hash' for update;
  if blob.status<>'AVAILABLE' then
    raise exception using errcode='40001',message='WORKSPACE_CONTENT_GC_STATE_STALE';
  end if;
  select coalesce(pg_catalog.bool_or(latest.active),false) into hold_active
  from (
    select distinct on (hold.file_id) hold.file_id,hold.active
    from app_data_agent.workspace_file_legal_holds hold
    where hold.app_id=blob.app_id and hold.tenant_id=blob.tenant_id and hold.environment=blob.environment
      and exists (
        select 1 from app_data_agent.workspace_file_revisions revision
        where revision.app_id=hold.app_id and revision.tenant_id=hold.tenant_id
          and revision.environment=hold.environment and revision.file_id=hold.file_id
          and revision.blob_hash=blob.blob_hash
      )
    order by hold.file_id,hold.hold_revision desc
  ) latest;
  select
    coalesce(pg_catalog.max(
      deletion.access_revoked_at+pg_catalog.make_interval(
        secs=>(policy.policy_json->>'deleted_reference_ttl_seconds')::double precision
      )
    ),blob.created_at),
    coalesce(pg_catalog.max((deletion.receipt_json->>'backup_expires_at')::timestamptz),blob.created_at)
  into retention_expires,backup_expires
  from app_data_agent.workspace_file_deletion_receipts deletion
  join app_data_agent.workspace_file_revisions revision
    on revision.app_id=deletion.app_id and revision.tenant_id=deletion.tenant_id
      and revision.environment=deletion.environment and revision.file_id=deletion.file_id
      and revision.revision=deletion.file_revision and revision.revision_hash=deletion.file_revision_hash
  join app_data_agent.storage_retention_policy_revisions policy
    on policy.app_id=revision.app_id and policy.tenant_id=revision.tenant_id
      and policy.environment=revision.environment
      and policy.policy_id=(revision.revision_json#>>'{retention_policy_ref,policy_id}')::uuid
      and policy.revision=(revision.revision_json#>>'{retention_policy_ref,policy_revision}')::bigint
      and policy.policy_hash=revision.revision_json#>>'{retention_policy_ref,policy_hash}'
  where deletion.app_id=blob.app_id and deletion.tenant_id=blob.tenant_id
    and deletion.environment=blob.environment and revision.blob_hash=blob.blob_hash;
  disposition:=case when blob.active_reference_count=0 and not hold_active
    and retention_expires<=now_at and backup_expires<=now_at then 'ELIGIBLE' else 'HELD' end;
  document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-content-gc-receipt@1.0.0','receipt_id',receipt_id,
    'operation_id',(requested_command->>'operation_id')::uuid,
    'scope',app_data_agent.workspace_file_scope_json(
      authority.app_id,authority.tenant_id,authority.environment
    ),'blob_hash',blob.blob_hash,'status',disposition,'parent_receipt_ref',null,
    'active_reference_count',blob.active_reference_count,'legal_hold_active',hold_active,
    'retention_expires_at',app_data_agent.workspace_file_utc_millis(retention_expires),
    'backup_expires_at',app_data_agent.workspace_file_utc_millis(backup_expires),
    'evaluated_at',app_data_agent.workspace_file_utc_millis(now_at)
  );
  document:=document||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(document)
  );
  insert into app_data_agent.workspace_content_gc_receipts(
    app_id,tenant_id,environment,receipt_id,operation_id,principal_id,idempotency_key,request_hash,
    blob_hash,status,parent_receipt_id,parent_receipt_hash,active_reference_count,legal_hold_active,
    retention_expires_at,backup_expires_at,receipt_hash,receipt_json,evaluated_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,receipt_id,
    (requested_command->>'operation_id')::uuid,authority.principal_id,
    requested_command->>'idempotency_key',requested_command->>'request_hash',blob.blob_hash,
    disposition,null,null,blob.active_reference_count,hold_active,retention_expires,backup_expires,
    document->>'receipt_hash',document,now_at
  );
  if disposition='ELIGIBLE' then
    update app_data_agent.workspace_content_blobs set status='GC_PENDING',updated_at=now_at
    where app_id=blob.app_id and tenant_id=blob.tenant_id and environment=blob.environment
      and blob_hash=blob.blob_hash;
  end if;
  return pg_catalog.jsonb_build_object(
    'receipt',document,
    'deletion_authority',case when disposition='ELIGIBLE' then pg_catalog.jsonb_build_object(
      'storage_key',blob.storage_key,'blob_hash',blob.blob_hash
    ) else null end
  );
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or no_data_found then
  raise exception using errcode='22023',message='WORKSPACE_CONTENT_GC_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.commit_workspace_content_gc(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  parent app_data_agent.workspace_content_gc_receipts%rowtype;
  existing app_data_agent.workspace_content_gc_receipts%rowtype;
  blob app_data_agent.workspace_content_blobs%rowtype;
  receipt_id uuid:=pg_catalog.gen_random_uuid();
  now_at timestamptz:=pg_catalog.clock_timestamp();
  document jsonb;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','workspace_id','receipt_id','receipt_hash','blob_hash'
  ]) or requested_command->>'schema_version'<>'workspace-content-gc-commit@1.0.0'
    or requested_command->>'receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or requested_command->>'blob_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='WORKSPACE_CONTENT_GC_COMMIT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if authority.membership_role<>'owner'
    or (requested_command->>'workspace_id')::uuid<>authority.tenant_id
  then raise exception using errcode='42501',message='WORKSPACE_CONTENT_GC_DENIED'; end if;
  select parent_candidate.* into strict parent
  from app_data_agent.workspace_content_gc_receipts parent_candidate
  where parent_candidate.app_id=authority.app_id
    and parent_candidate.tenant_id=authority.tenant_id
    and parent_candidate.environment=authority.environment
    and parent_candidate.receipt_id=(requested_command->>'receipt_id')::uuid
    and parent_candidate.receipt_hash=requested_command->>'receipt_hash'
    and parent_candidate.blob_hash=requested_command->>'blob_hash'
    and parent_candidate.status='ELIGIBLE' and parent_candidate.parent_receipt_id is null;
  select child.* into existing from app_data_agent.workspace_content_gc_receipts child
  where child.app_id=parent.app_id and child.tenant_id=parent.tenant_id
    and child.environment=parent.environment and child.parent_receipt_id=parent.receipt_id;
  if found then return existing.receipt_json; end if;
  select * into strict blob from app_data_agent.workspace_content_blobs
  where app_id=parent.app_id and tenant_id=parent.tenant_id and environment=parent.environment
    and blob_hash=parent.blob_hash for update;
  if blob.status<>'GC_PENDING' or blob.active_reference_count<>0 then
    raise exception using errcode='40001',message='WORKSPACE_CONTENT_GC_STATE_STALE';
  end if;
  document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-content-gc-receipt@1.0.0','receipt_id',receipt_id,
    'operation_id',parent.operation_id,
    'scope',parent.receipt_json->'scope','blob_hash',parent.blob_hash,'status','DELETED',
    'parent_receipt_ref',pg_catalog.jsonb_build_object(
      'receipt_id',parent.receipt_id,'receipt_hash',parent.receipt_hash
    ),'active_reference_count',0,'legal_hold_active',false,
    'retention_expires_at',app_data_agent.workspace_file_utc_millis(parent.retention_expires_at),
    'backup_expires_at',app_data_agent.workspace_file_utc_millis(parent.backup_expires_at),
    'evaluated_at',app_data_agent.workspace_file_utc_millis(now_at)
  );
  document:=document||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(document)
  );
  insert into app_data_agent.workspace_content_gc_receipts(
    app_id,tenant_id,environment,receipt_id,operation_id,principal_id,idempotency_key,request_hash,
    blob_hash,status,parent_receipt_id,parent_receipt_hash,active_reference_count,legal_hold_active,
    retention_expires_at,backup_expires_at,receipt_hash,receipt_json,evaluated_at
  ) values (
    parent.app_id,parent.tenant_id,parent.environment,receipt_id,parent.operation_id,parent.principal_id,
    parent.idempotency_key,parent.request_hash,parent.blob_hash,'DELETED',parent.receipt_id,parent.receipt_hash,
    0,false,parent.retention_expires_at,parent.backup_expires_at,document->>'receipt_hash',document,now_at
  );
  update app_data_agent.workspace_content_blobs set status='DELETED',updated_at=now_at
  where app_id=blob.app_id and tenant_id=blob.tenant_id and environment=blob.environment
    and blob_hash=blob.blob_hash;
  return document;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or no_data_found then
  raise exception using errcode='22023',message='WORKSPACE_CONTENT_GC_COMMIT_INVALID';
end
$function$;

create function app_data_agent.classify_workspace_content_orphan(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  checked_at timestamptz:=pg_catalog.clock_timestamp();
  observed_at timestamptz;
  orphan_ttl bigint:=86400;
  is_authorized boolean;
  expected_prefix text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','workspace_id','storage_key','blob_hash','observed_at'
  ]) or requested_command->>'schema_version'<>'workspace-content-orphan-check@1.0.0'
    or requested_command->>'blob_hash'!~'^sha256:[0-9a-f]{64}$'
    or requested_command->>'storage_key'!~'^workspace-content/v1/[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9._-]+/[0-9a-f]{2}/[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='WORKSPACE_CONTENT_ORPHAN_CHECK_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if authority.membership_role<>'owner'
    or (requested_command->>'workspace_id')::uuid<>authority.tenant_id
  then raise exception using errcode='42501',message='WORKSPACE_CONTENT_ORPHAN_CHECK_DENIED'; end if;
  observed_at:=(requested_command->>'observed_at')::timestamptz;
  if observed_at>checked_at then
    raise exception using errcode='22023',message='WORKSPACE_CONTENT_ORPHAN_CHECK_INVALID';
  end if;
  expected_prefix:=pg_catalog.format(
    'workspace-content/v1/%s/%s/%s/',authority.app_id,authority.tenant_id,authority.environment
  );
  if pg_catalog.strpos(requested_command->>'storage_key',expected_prefix)<>1
    or pg_catalog.right(requested_command->>'storage_key',64)<>
      pg_catalog.substr(requested_command->>'blob_hash',8)
  then raise exception using errcode='22023',message='WORKSPACE_CONTENT_ORPHAN_CHECK_INVALID'; end if;
  select coalesce(
    (select (policy.policy_json->>'orphan_blob_ttl_seconds')::bigint
     from app_data_agent.storage_retention_policy_revisions policy
     where policy.app_id=authority.app_id and policy.tenant_id=authority.tenant_id
       and policy.environment=authority.environment
       and policy.policy_id='00000000-0000-4000-8000-00000000f601'::uuid
     order by policy.revision desc limit 1),86400
  ) into orphan_ttl;
  select exists(
    select 1 from app_data_agent.workspace_content_blobs blob
    where blob.app_id=authority.app_id and blob.tenant_id=authority.tenant_id
      and blob.environment=authority.environment
      and blob.storage_key=requested_command->>'storage_key'
      and blob.blob_hash=requested_command->>'blob_hash'
  ) into is_authorized;
  return pg_catalog.jsonb_build_object(
    'schema_version','workspace-content-orphan-check-result@1.0.0',
    'storage_key',requested_command->>'storage_key','blob_hash',requested_command->>'blob_hash',
    'authorized',is_authorized,'orphan_ttl_seconds',orphan_ttl,
    'observed_at',app_data_agent.workspace_file_utc_millis(observed_at),
    'checked_at',app_data_agent.workspace_file_utc_millis(checked_at)
  );
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or no_data_found then
  raise exception using errcode='22023',message='WORKSPACE_CONTENT_ORPHAN_CHECK_INVALID';
end
$function$;
