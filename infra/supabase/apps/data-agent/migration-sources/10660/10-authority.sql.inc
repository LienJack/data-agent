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
