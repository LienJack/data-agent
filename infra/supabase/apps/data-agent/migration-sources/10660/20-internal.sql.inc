create function app_data_agent.reject_workspace_file_immutable_mutation()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='WORKSPACE_FILE_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger storage_retention_policy_revisions_immutable
before update or delete on app_data_agent.storage_retention_policy_revisions
for each row execute function app_data_agent.reject_workspace_file_immutable_mutation();
create trigger workspace_file_revisions_immutable
before update or delete on app_data_agent.workspace_file_revisions
for each row execute function app_data_agent.reject_workspace_file_immutable_mutation();
create trigger workspace_file_scan_receipts_immutable
before update or delete on app_data_agent.workspace_file_scan_receipts
for each row execute function app_data_agent.reject_workspace_file_immutable_mutation();
create trigger workspace_file_deletion_receipts_immutable
before update or delete on app_data_agent.workspace_file_deletion_receipts
for each row execute function app_data_agent.reject_workspace_file_immutable_mutation();
create trigger workspace_file_legal_holds_immutable
before update or delete on app_data_agent.workspace_file_legal_holds
for each row execute function app_data_agent.reject_workspace_file_immutable_mutation();
create trigger workspace_content_gc_receipts_immutable
before update or delete on app_data_agent.workspace_content_gc_receipts
for each row execute function app_data_agent.reject_workspace_file_immutable_mutation();
create trigger workspace_file_idempotency_immutable
before update or delete on app_data_agent.workspace_file_idempotency
for each row execute function app_data_agent.reject_workspace_file_immutable_mutation();

create function app_data_agent.workspace_file_utc_millis(value timestamptz)
returns text language sql immutable strict set search_path=''
as $function$
  select pg_catalog.to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$function$;

create function app_data_agent.workspace_file_scope_json(
  requested_app_id uuid,requested_tenant_id uuid,requested_environment text
)
returns jsonb language sql immutable set search_path=''
as $function$
  select pg_catalog.jsonb_build_object(
    'app_id',requested_app_id,'tenant_id',requested_tenant_id,
    'environment',requested_environment,'workspace_id',requested_tenant_id
  );
$function$;

create function app_data_agent.workspace_file_ref_json(
  requested_file_id uuid,requested_revision bigint,requested_revision_hash text
)
returns jsonb language sql immutable set search_path=''
as $function$
  select pg_catalog.jsonb_build_object(
    'file_id',requested_file_id,'revision',requested_revision,'revision_hash',requested_revision_hash
  );
$function$;

create function app_data_agent.workspace_file_default_retention_policy(
  requested_app_id uuid,requested_tenant_id uuid,requested_environment text,
  requested_principal_id uuid,requested_created_at timestamptz
)
returns app_data_agent.storage_retention_policy_revisions
language plpgsql security definer set search_path=''
as $function$
declare
  policy app_data_agent.storage_retention_policy_revisions%rowtype;
  default_policy_id constant uuid := '00000000-0000-4000-8000-00000000f601'::uuid;
  document jsonb;
begin
  select * into policy from app_data_agent.storage_retention_policy_revisions
  where app_id=requested_app_id and tenant_id=requested_tenant_id
    and environment=requested_environment and policy_id=default_policy_id
  order by revision desc limit 1;
  if found then return policy; end if;
  document:=pg_catalog.jsonb_build_object(
    'schema_version','storage-retention-policy-revision@1.0.0',
    'scope',app_data_agent.workspace_file_scope_json(
      requested_app_id,requested_tenant_id,requested_environment
    ),
    'policy_id',default_policy_id,'revision',1,'parent_ref',null,
    'quarantine_ttl_seconds',86400,'deleted_reference_ttl_seconds',0,
    'orphan_blob_ttl_seconds',86400,'backup_expiry_seconds',2592000,
    'legal_hold_enabled',true,'created_by_principal_id',requested_principal_id,
    'created_at',app_data_agent.workspace_file_utc_millis(requested_created_at)
  );
  document:=document||pg_catalog.jsonb_build_object(
    'policy_hash',app_data_agent.u2_canonical_sha256(document)
  );
  insert into app_data_agent.storage_retention_policy_revisions(
    app_id,tenant_id,environment,policy_id,revision,policy_hash,policy_json,created_at
  ) values (
    requested_app_id,requested_tenant_id,requested_environment,default_policy_id,1,
    document->>'policy_hash',document,requested_created_at
  ) returning * into policy;
  return policy;
end
$function$;

create function app_data_agent.workspace_file_build_revision(
  requested_scope jsonb,
  requested_file_id uuid,
  requested_revision bigint,
  requested_parent_ref jsonb,
  requested_owner_principal_id uuid,
  requested_visibility text,
  requested_session_id uuid,
  requested_original_filename text,
  requested_detected_mime text,
  requested_byte_size bigint,
  requested_blob_hash text,
  requested_status text,
  requested_scan_receipt_ref jsonb,
  requested_deletion_receipt_ref jsonb,
  requested_promoted_from_ref jsonb,
  requested_retention_policy_ref jsonb,
  requested_created_by_principal_id uuid,
  requested_created_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare document jsonb;
begin
  document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-file-revision@1.0.0','scope',requested_scope,
    'file_id',requested_file_id,'revision',requested_revision,'parent_ref',requested_parent_ref,
    'owner_principal_id',requested_owner_principal_id,'visibility',requested_visibility,
    'session_id',requested_session_id,'original_filename',requested_original_filename,
    'detected_mime',requested_detected_mime,'byte_size',requested_byte_size,
    'blob_hash',requested_blob_hash,'status',requested_status,
    'scan_receipt_ref',requested_scan_receipt_ref,
    'deletion_receipt_ref',requested_deletion_receipt_ref,
    'promoted_from_ref',requested_promoted_from_ref,
    'retention_policy_ref',requested_retention_policy_ref,
    'created_by_principal_id',requested_created_by_principal_id,
    'created_at',app_data_agent.workspace_file_utc_millis(requested_created_at)
  );
  return document||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(document)
  );
end
$function$;

create function app_data_agent.workspace_file_insert_revision(
  requested_revision jsonb
)
returns app_data_agent.workspace_file_revisions
language plpgsql security definer set search_path=''
as $function$
declare inserted app_data_agent.workspace_file_revisions%rowtype;
begin
  insert into app_data_agent.workspace_file_revisions(
    app_id,tenant_id,environment,file_id,revision,revision_hash,blob_hash,
    owner_principal_id,visibility,session_id,status,scan_receipt_id,deletion_receipt_id,
    revision_json,created_at
  ) values (
    (requested_revision#>>'{scope,app_id}')::uuid,
    (requested_revision#>>'{scope,tenant_id}')::uuid,
    requested_revision#>>'{scope,environment}',
    (requested_revision->>'file_id')::uuid,(requested_revision->>'revision')::bigint,
    requested_revision->>'revision_hash',requested_revision->>'blob_hash',
    (requested_revision->>'owner_principal_id')::uuid,requested_revision->>'visibility',
    case when requested_revision->'session_id'='null'::jsonb then null
      else (requested_revision->>'session_id')::uuid end,
    requested_revision->>'status',
    case when requested_revision->'scan_receipt_ref'='null'::jsonb then null
      else (requested_revision#>>'{scan_receipt_ref,receipt_id}')::uuid end,
    case when requested_revision->'deletion_receipt_ref'='null'::jsonb then null
      else (requested_revision#>>'{deletion_receipt_ref,receipt_id}')::uuid end,
    requested_revision,(requested_revision->>'created_at')::timestamptz
  ) returning * into inserted;
  return inserted;
end
$function$;

create function app_data_agent.workspace_file_exact_revision(
  requested_file_id uuid,requested_revision bigint,requested_revision_hash text,
  require_current boolean default true
)
returns app_data_agent.workspace_file_revisions
language plpgsql security definer set search_path=''
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
    and candidate.revision=requested_revision and candidate.revision_hash=requested_revision_hash
    and (not require_current or (
      current_file.current_revision=candidate.revision
      and current_file.current_revision_hash=candidate.revision_hash
    ));
  if not found then
    raise exception using errcode='P0002',message='WORKSPACE_FILE_NOT_FOUND';
  end if;
  return revision;
end
$function$;
