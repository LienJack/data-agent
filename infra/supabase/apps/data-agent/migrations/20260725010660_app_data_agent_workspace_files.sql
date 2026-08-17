-- workspace_files_migration_checksum: sha256:3808e5827f6f65bebdd490f501953b8be1a9fac3c4a11c62e3cc0e37510c6557
-- ============================================================
-- 10660: Workspace File and Content Authority
-- Content-addressed bytes, immutable ACL revisions, U10 FILE_SCAN.
-- No data import, Falcon execution, Provider invocation, or billing.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='WORKSPACE_FILES_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='WORKSPACE_FILES_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010659_app_data_agent_job_center'
  ) then raise exception using errcode='P0001',message='WORKSPACE_FILES_BASELINE_10659_MISSING'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.assert_job_active_lease(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
    or pg_catalog.to_regprocedure('platform.current_backend_authority(boolean)') is null
  then raise exception using errcode='P0001',message='WORKSPACE_FILES_AUTHORITY_PREREQUISITE_MISSING'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u6_file_owner') then
    create role data_agent_u6_file_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
alter table app_data_agent.job_handler_revisions
  drop constraint job_handler_revisions_kind_check;
alter table app_data_agent.job_handler_revisions
  add constraint job_handler_revisions_kind_check check (kind in (
    'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT','SEMANTIC_INDUCTION',
    'METRIC_IMPORT','DATALINK_REBUILD','FILE_SCAN'
  ));
alter table app_data_agent.jobs drop constraint jobs_kind_check;
alter table app_data_agent.jobs add constraint jobs_kind_check check (kind in (
  'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT','SEMANTIC_INDUCTION',
  'METRIC_IMPORT','DATALINK_REBUILD','FILE_SCAN'
));

insert into app_data_agent.job_handler_revisions(
  kind,handler_revision,enabled,dependencies_ready,output_receipt_required
) values ('FILE_SCAN','file-scan-handler@1.0.0',true,true,true);

create table app_data_agent.storage_retention_policy_revisions (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  policy_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_json jsonb not null check (pg_catalog.jsonb_typeof(policy_json)='object'),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,policy_id,revision),
  unique (app_id,tenant_id,environment,policy_id,revision,policy_hash)
);

create table app_data_agent.workspace_content_blobs (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  blob_hash text not null check (blob_hash ~ '^sha256:[0-9a-f]{64}$'),
  storage_key text not null check (length(storage_key) between 1 and 512),
  byte_size bigint not null check (byte_size between 1 and 26214400),
  detected_mime text not null check (detected_mime ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'),
  active_reference_count bigint not null check (active_reference_count between 0 and 9007199254740991),
  status text not null check (status in ('AVAILABLE','GC_PENDING','DELETED')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,blob_hash),
  unique (app_id,tenant_id,environment,storage_key)
);

create table app_data_agent.workspace_files (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  file_id uuid not null,
  owner_principal_id uuid not null,
  current_revision bigint not null check (current_revision between 1 and 9007199254740991),
  current_revision_hash text not null check (current_revision_hash ~ '^sha256:[0-9a-f]{64}$'),
  current_status text not null check (current_status in ('QUARANTINED','READY','REJECTED','DELETED')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,file_id)
);

create table app_data_agent.workspace_file_revisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  file_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  revision_hash text not null check (revision_hash ~ '^sha256:[0-9a-f]{64}$'),
  blob_hash text not null,
  owner_principal_id uuid not null,
  visibility text not null check (visibility in ('SESSION','WORKSPACE')),
  session_id uuid,
  status text not null check (status in ('QUARANTINED','READY','REJECTED','DELETED')),
  scan_receipt_id uuid,
  deletion_receipt_id uuid,
  revision_json jsonb not null check (pg_catalog.jsonb_typeof(revision_json)='object'),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,file_id,revision),
  unique (app_id,tenant_id,environment,file_id,revision,revision_hash),
  foreign key (app_id,tenant_id,environment,file_id)
    references app_data_agent.workspace_files(app_id,tenant_id,environment,file_id) deferrable initially deferred,
  foreign key (app_id,tenant_id,environment,blob_hash)
    references app_data_agent.workspace_content_blobs(app_id,tenant_id,environment,blob_hash),
  check ((visibility='SESSION' and session_id is not null) or (visibility='WORKSPACE' and session_id is null))
);

create table app_data_agent.workspace_file_scan_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  file_id uuid not null,
  file_revision bigint not null,
  file_revision_hash text not null,
  blob_hash text not null,
  job_id uuid not null,
  attempt_id uuid not null,
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  verdict text not null check (verdict in ('CLEAN','MALICIOUS','CREDENTIAL_MATCH','POLICY_BLOCKED')),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  scanned_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,file_id,file_revision),
  foreign key (app_id,tenant_id,environment,file_id,file_revision,file_revision_hash)
    references app_data_agent.workspace_file_revisions(app_id,tenant_id,environment,file_id,revision,revision_hash),
  foreign key (app_id,tenant_id,environment,attempt_id)
    references app_data_agent.job_attempts(app_id,tenant_id,environment,attempt_id)
);

create table app_data_agent.workspace_file_deletion_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  operation_id uuid not null,
  file_id uuid not null,
  file_revision bigint not null,
  file_revision_hash text not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  access_revoked_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,operation_id),
  foreign key (app_id,tenant_id,environment,file_id,file_revision,file_revision_hash)
    references app_data_agent.workspace_file_revisions(app_id,tenant_id,environment,file_id,revision,revision_hash)
);

create table app_data_agent.workspace_file_legal_holds (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  file_id uuid not null,
  hold_revision bigint not null check (hold_revision between 1 and 9007199254740991),
  active boolean not null,
  operation_id uuid not null,
  principal_id uuid not null,
  reason_code text not null check (reason_code in ('LEGAL_REQUEST','SECURITY_INCIDENT','AUDIT_PRESERVATION','RELEASED')),
  hold_hash text not null check (hold_hash ~ '^sha256:[0-9a-f]{64}$'),
  hold_json jsonb not null check (pg_catalog.jsonb_typeof(hold_json)='object'),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,file_id,hold_revision),
  unique (app_id,tenant_id,environment,operation_id)
);

create table app_data_agent.workspace_content_gc_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  operation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  blob_hash text not null,
  status text not null check (status in ('ELIGIBLE','DELETED','HELD')),
  parent_receipt_id uuid,
  parent_receipt_hash text check (parent_receipt_hash is null or parent_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  active_reference_count bigint not null check (active_reference_count between 0 and 9007199254740991),
  legal_hold_active boolean not null,
  retention_expires_at timestamptz not null,
  backup_expires_at timestamptz not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  evaluated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,principal_id,idempotency_key,status),
  unique (app_id,tenant_id,environment,parent_receipt_id),
  check ((status='DELETED')=(parent_receipt_id is not null and parent_receipt_hash is not null))
);

create table app_data_agent.workspace_file_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  principal_id uuid not null,
  operation_kind text not null check (operation_kind in (
    'UPLOAD','PROMOTE','DELETE','LEGAL_HOLD','RETENTION_POLICY'
  )),
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  file_id uuid not null,
  revision bigint not null,
  result_json jsonb not null,
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key)
);

create index workspace_files_owner_status_idx on app_data_agent.workspace_files(
  app_id,tenant_id,environment,owner_principal_id,current_status,updated_at desc,file_id
);
create index workspace_file_revisions_blob_idx on app_data_agent.workspace_file_revisions(
  app_id,tenant_id,environment,blob_hash,status
);
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
create or replace function app_data_agent.claim_job_work(
  requested_worker_id text,
  requested_handlers jsonb,
  requested_lease_duration_ms integer
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  job app_data_agent.jobs%rowtype;
  attempt_id uuid := pg_catalog.gen_random_uuid();
  now_at timestamptz := pg_catalog.clock_timestamp();
  expires_at timestamptz;
  lease_document jsonb;
  lease_hash text;
begin
  if requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_duration_ms not between 5000 and 900000
    or pg_catalog.jsonb_typeof(requested_handlers)<>'array'
    or pg_catalog.jsonb_array_length(requested_handlers) not between 1 and 7
  then raise exception using errcode='22023',message='JOB_CLAIM_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if not exists (
    select 1 from app_data_agent.job_worker_heartbeats heartbeat
    where heartbeat.app_id=authority.app_id and heartbeat.tenant_id=authority.tenant_id
      and heartbeat.environment=authority.environment and heartbeat.worker_id=requested_worker_id
      and heartbeat.expires_at>now_at and heartbeat.handlers_json=requested_handlers
  ) then
    raise exception using errcode='55000',message='JOB_WORKER_HEARTBEAT_STALE';
  end if;
  select candidate.* into job from app_data_agent.jobs candidate
  join app_data_agent.job_handler_revisions revision
    on revision.kind=candidate.kind and revision.handler_revision=candidate.handler_revision
  where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
    and candidate.environment=authority.environment and candidate.principal_id=authority.principal_id
    and candidate.status in ('QUEUED','RETRY_WAIT')
    and (candidate.next_attempt_at is null or candidate.next_attempt_at<=now_at)
    and candidate.attempt_count<candidate.max_attempts and revision.enabled and revision.dependencies_ready
    and exists (
      select 1 from pg_catalog.jsonb_array_elements(requested_handlers) handler
      where handler->>'kind'=candidate.kind
        and handler->>'handler_revision'=candidate.handler_revision
        and app_data_agent.provider_json_object_has_exact_keys(handler,array['kind','handler_revision'])
    )
  order by candidate.priority desc,candidate.created_at,candidate.job_id
  for update of candidate skip locked limit 1;
  if not found then return null; end if;
  expires_at := now_at+pg_catalog.make_interval(secs=>requested_lease_duration_ms::double precision/1000.0);
  update app_data_agent.jobs set
    status='LEASED',attempt_count=attempt_count+1,worker_fence=worker_fence+1,
    next_attempt_at=null,updated_at=now_at
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id
  returning * into job;
  lease_document := pg_catalog.jsonb_build_object(
    'schema_version','job-work-lease@1.0.0',
    'scope',pg_catalog.jsonb_build_object('app_id',job.app_id,'tenant_id',job.tenant_id,'environment',job.environment),
    'principal_id',job.principal_id,'job_id',job.job_id,'kind',job.kind,'request_hash',job.request_hash,
    'input',job.input_json,'attempt_id',attempt_id,'attempt_no',job.attempt_count,
    'delivery_attempt_no',1,'worker_id',requested_worker_id,'lease_token',job.worker_fence,
    'worker_fence',job.worker_fence,'lease_duration_ms',requested_lease_duration_ms,
    'expires_at',app_data_agent.job_utc_millis(expires_at),'handler_revision',job.handler_revision
  );
  lease_hash := app_data_agent.u2_canonical_sha256(lease_document);
  lease_document := lease_document||pg_catalog.jsonb_build_object('lease_hash',lease_hash);
  insert into app_data_agent.job_attempts(
    app_id,tenant_id,environment,job_id,request_hash,attempt_id,attempt_no,delivery_attempt_no,
    worker_id,lease_token,worker_fence,handler_revision,lease_hash,lease_json,status,lease_expires_at
  ) values (
    job.app_id,job.tenant_id,job.environment,job.job_id,job.request_hash,attempt_id,job.attempt_count,1,
    requested_worker_id,job.worker_fence,job.worker_fence,job.handler_revision,lease_hash,lease_document,
    'LEASED',expires_at
  );
  perform app_data_agent.job_append_event(job,'JOB_LEASED',pg_catalog.jsonb_build_object(
    'attempt_id',attempt_id,'worker_fence',job.worker_fence,'handler_revision',job.handler_revision
  ));
  return lease_document;
end
$function$;

create or replace function app_data_agent.publish_job_worker_heartbeat(requested_heartbeat jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.job_worker_heartbeats%rowtype; kinds text[];
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_heartbeat,array[
    'schema_version','heartbeat_id','scope','worker_id','handlers','capacity',
    'observed_at','expires_at','heartbeat_hash'
  ]) or requested_heartbeat->>'schema_version'<>'job-worker-heartbeat@1.0.0'
    or requested_heartbeat->>'heartbeat_hash'<>app_data_agent.u2_canonical_sha256(requested_heartbeat-'heartbeat_hash')
    or pg_catalog.jsonb_typeof(requested_heartbeat->'handlers')<>'array'
    or pg_catalog.jsonb_array_length(requested_heartbeat->'handlers') not between 1 and 7
    or (requested_heartbeat->>'capacity')::integer not between 1 and 64
    or (requested_heartbeat->>'expires_at')::timestamptz<=(requested_heartbeat->>'observed_at')::timestamptz
    or app_data_agent.contains_potential_plaintext_secret(requested_heartbeat)
  then raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_heartbeat->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then raise exception using errcode='42501',message='JOB_SCOPE_MISMATCH'; end if;
  select pg_catalog.array_agg(handler->>'kind' order by handler->>'kind') into kinds
  from pg_catalog.jsonb_array_elements(requested_heartbeat->'handlers') handler
  where app_data_agent.provider_json_object_has_exact_keys(handler,array['kind','handler_revision'])
    and exists (
      select 1 from app_data_agent.job_handler_revisions revision
      where revision.kind=handler->>'kind' and revision.handler_revision=handler->>'handler_revision'
    );
  if coalesce(pg_catalog.array_length(kinds,1),0)<>pg_catalog.jsonb_array_length(requested_heartbeat->'handlers')
    or (select pg_catalog.count(distinct item) from pg_catalog.unnest(kinds) item)<>pg_catalog.array_length(kinds,1)
    or requested_heartbeat->'handlers'<>(
      select pg_catalog.jsonb_agg(handler order by handler->>'kind')
      from pg_catalog.jsonb_array_elements(requested_heartbeat->'handlers') handler
    )
  then raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID'; end if;
  select * into existing from app_data_agent.job_worker_heartbeats heartbeat
  where heartbeat.app_id=authority.app_id and heartbeat.tenant_id=authority.tenant_id
    and heartbeat.environment=authority.environment
    and heartbeat.heartbeat_id=(requested_heartbeat->>'heartbeat_id')::uuid;
  if found then
    if existing.heartbeat_hash<>requested_heartbeat->>'heartbeat_hash' then
      raise exception using errcode='23505',message='JOB_WORKER_HEARTBEAT_REPLAY_CONFLICT';
    end if;
    return existing.heartbeat_json;
  end if;
  insert into app_data_agent.job_worker_heartbeats(
    app_id,tenant_id,environment,heartbeat_id,worker_id,handler_kinds,handlers_json,
    capacity,heartbeat_hash,heartbeat_json,observed_at,expires_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (requested_heartbeat->>'heartbeat_id')::uuid,requested_heartbeat->>'worker_id',kinds,
    requested_heartbeat->'handlers',(requested_heartbeat->>'capacity')::integer,
    requested_heartbeat->>'heartbeat_hash',requested_heartbeat,
    (requested_heartbeat->>'observed_at')::timestamptz,(requested_heartbeat->>'expires_at')::timestamptz
  );
  return requested_heartbeat;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID';
end
$function$;
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
do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'storage_retention_policy_revisions','workspace_content_blobs','workspace_files',
    'workspace_file_revisions','workspace_file_scan_receipts','workspace_file_deletion_receipts',
    'workspace_file_legal_holds','workspace_content_gc_receipts','workspace_file_idempotency'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u6_file_owner',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_u6_file_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      relation_name||'_u6_owner_all',relation_name
    );
  end loop;
end
$rls$;

alter function app_data_agent.reject_workspace_file_immutable_mutation() owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_utc_millis(timestamptz) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_scope_json(uuid,uuid,text) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_ref_json(uuid,bigint,text) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_default_retention_policy(uuid,uuid,text,uuid,timestamptz) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_build_revision(jsonb,uuid,bigint,jsonb,uuid,text,uuid,text,text,bigint,text,text,jsonb,jsonb,jsonb,jsonb,uuid,timestamptz) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_insert_revision(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_exact_revision(uuid,bigint,text,boolean) owner to data_agent_u6_file_owner;
alter function app_data_agent.commit_workspace_file_upload(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.list_workspace_files(uuid,integer) owner to data_agent_u6_file_owner;
alter function app_data_agent.get_workspace_file(uuid,bigint,text) owner to data_agent_u6_file_owner;
alter function app_data_agent.resolve_workspace_file_download(uuid,bigint,text) owner to data_agent_u6_file_owner;
alter function app_data_agent.promote_workspace_file(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.delete_workspace_file(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.set_workspace_file_legal_hold(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.load_workspace_file_for_scan(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.commit_workspace_file_scan(jsonb,jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.update_storage_retention_policy(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.evaluate_workspace_content_gc(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.commit_workspace_content_gc(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.classify_workspace_content_orphan(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.build_requested_optional_resource_bindings(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb) owner to data_agent_u6_file_owner;

grant usage on schema app_data_agent,platform to data_agent_u6_file_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.assert_job_active_lease(jsonb),
  app_data_agent.job_append_event(app_data_agent.jobs,text,jsonb)
to data_agent_u6_file_owner;
grant select on app_data_agent.jobs,app_data_agent.job_attempts to data_agent_u6_file_owner;
grant select on app_data_agent.workspace_file_scan_receipts to data_agent_u10_job_owner;

create policy jobs_u6_file_select on app_data_agent.jobs
  as permissive for select to data_agent_u6_file_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy job_attempts_u6_file_select on app_data_agent.job_attempts
  as permissive for select to data_agent_u6_file_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_file_scan_receipts_u10_job_select
  on app_data_agent.workspace_file_scan_receipts
  as permissive for select to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.storage_retention_policy_revisions,
  app_data_agent.workspace_content_blobs,app_data_agent.workspace_files,
  app_data_agent.workspace_file_revisions,app_data_agent.workspace_file_scan_receipts,
  app_data_agent.workspace_file_deletion_receipts,app_data_agent.workspace_file_legal_holds,
  app_data_agent.workspace_content_gc_receipts,app_data_agent.workspace_file_idempotency
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function
  app_data_agent.commit_workspace_file_upload(jsonb),
  app_data_agent.list_workspace_files(uuid,integer),
  app_data_agent.get_workspace_file(uuid,bigint,text),
  app_data_agent.resolve_workspace_file_download(uuid,bigint,text),
  app_data_agent.promote_workspace_file(jsonb),
  app_data_agent.delete_workspace_file(jsonb),
  app_data_agent.set_workspace_file_legal_hold(jsonb),
  app_data_agent.load_workspace_file_for_scan(jsonb),
  app_data_agent.commit_workspace_file_scan(jsonb,jsonb),
  app_data_agent.update_storage_retention_policy(jsonb),
  app_data_agent.evaluate_workspace_content_gc(jsonb),
  app_data_agent.commit_workspace_content_gc(jsonb)
  ,app_data_agent.classify_workspace_content_orphan(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  app_data_agent.commit_workspace_file_upload(jsonb),
  app_data_agent.list_workspace_files(uuid,integer),
  app_data_agent.get_workspace_file(uuid,bigint,text),
  app_data_agent.resolve_workspace_file_download(uuid,bigint,text),
  app_data_agent.promote_workspace_file(jsonb),
  app_data_agent.delete_workspace_file(jsonb),
  app_data_agent.set_workspace_file_legal_hold(jsonb),
  app_data_agent.load_workspace_file_for_scan(jsonb),
  app_data_agent.commit_workspace_file_scan(jsonb,jsonb),
  app_data_agent.update_storage_retention_policy(jsonb),
  app_data_agent.evaluate_workspace_content_gc(jsonb),
  app_data_agent.commit_workspace_content_gc(jsonb)
  ,app_data_agent.classify_workspace_content_orphan(jsonb)
to data_agent_backend;

grant execute on function
  app_data_agent.build_requested_optional_resource_bindings(jsonb),
  app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
to data_agent_effective_config_rpc_owner;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'storage_retention_policy_revisions','workspace_content_blobs','workspace_files',
    'workspace_file_revisions','workspace_file_scan_receipts','workspace_file_deletion_receipts',
    'workspace_file_legal_holds','workspace_content_gc_receipts','workspace_file_idempotency'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u6_file_owner')
    ) then raise exception using errcode='P0001',message='WORKSPACE_FILES_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u6_file_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u6_file_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='WORKSPACE_FILES_OWNER_FLAGS_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='FILE_SCAN' and handler_revision='file-scan-handler@1.0.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception using errcode='P0001',message='WORKSPACE_FILES_JOB_HANDLER_MISSING'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.workspace_files','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_workspace_file_upload(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_workspace_file_scan(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.update_storage_retention_policy(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.evaluate_workspace_content_gc(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_workspace_content_gc(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.classify_workspace_content_orphan(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.get_workspace_file(uuid,bigint,text)','EXECUTE')
  then raise exception using errcode='P0001',message='WORKSPACE_FILES_GRANT_POSTCONDITION_FAILED'; end if;
  if not exists (select 1 from storage.buckets where id='data-agent-artifacts' and not public) then
    raise exception using errcode='P0001',message='WORKSPACE_FILES_PRIVATE_BUCKET_MISSING';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010660_app_data_agent_workspace_files',
  'sha256:3808e5827f6f65bebdd490f501953b8be1a9fac3c4a11c62e3cc0e37510c6557'
);

commit;
