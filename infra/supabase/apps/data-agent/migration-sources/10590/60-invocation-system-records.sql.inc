create table app_data_agent.research_invocation_request_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  invocation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  reservation_id uuid not null,
  request_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  canonical_request_digest text not null check (canonical_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_json jsonb not null check (pg_catalog.jsonb_typeof(request_json) = 'object'),
  outcome text not null check (outcome in ('STARTED', 'REJECTED')),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  completed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, invocation_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, request_id),
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    )
    on delete restrict not deferrable,
  check (
    (outcome = 'STARTED' and error_code is null)
    or (outcome = 'REJECTED' and error_code is not null)
  )
);

create table app_data_agent.research_invocation_commits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  invocation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  reservation_id uuid not null,
  reservation_seq bigint not null check (reservation_seq >= 1),
  resource_lease_id uuid not null,
  request_id uuid not null,
  attempt_id uuid not null,
  outbox_id uuid not null,
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  canonical_request_digest text not null check (canonical_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  state text not null check (
    state in ('AUTHORIZED', 'STARTED', 'OUTCOME_UNKNOWN', 'COMPLETED', 'FAILED')
  ),
  started_at timestamptz,
  outcome_unknown_hash text
    check (outcome_unknown_hash is null or outcome_unknown_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_ref jsonb,
  secure_execution_receipt_ref jsonb,
  outcome_usage_ref jsonb,
  error_code text,
  terminal_hash text check (terminal_hash is null or terminal_hash ~ '^sha256:[0-9a-f]{64}$'),
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, invocation_id),
  unique (
    app_id, tenant_id, environment, run_id, reservation_id, reservation_seq,
    resource_lease_id, invocation_id, request_id
  ),
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    )
    on delete restrict not deferrable,
  foreign key (
    app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence
  )
    references app_data_agent.run_attempts (
      app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence
    )
    on delete restrict not deferrable,
  check (
    (state = 'AUTHORIZED' and started_at is null and terminal_at is null)
    or (state = 'STARTED' and started_at is not null and terminal_at is null)
    or (state = 'OUTCOME_UNKNOWN' and started_at is not null
      and outcome_unknown_hash is not null and terminal_at is null)
    or (state = 'COMPLETED' and started_at is not null
      and result_ref is not null and outcome_usage_ref is not null
      and error_code is null and terminal_hash is not null and terminal_at is not null)
    or (state = 'FAILED' and error_code is not null and terminal_hash is not null
      and terminal_at is not null)
  )
);

create table app_data_agent.research_invocation_transition_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  transition_id uuid not null,
  invocation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition text not null check (
    transition in (
      'START', 'MARK_OUTCOME_UNKNOWN', 'ABORT_PREPARATION',
      'PREPARE_TERMINAL', 'COMMIT_TERMINAL'
    )
  ),
  source_state text not null,
  result_state text not null,
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, transition_id),
  unique (app_id, tenant_id, environment, invocation_id, transition_id),
  unique (app_id, tenant_id, environment, invocation_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, invocation_id)
    references app_data_agent.research_invocation_commits (
      app_id, tenant_id, environment, invocation_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_invocation_terminal_preparations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  preparation_id uuid not null,
  invocation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  state text not null check (state in ('PREPARING', 'PREPARED', 'COMMITTED', 'ABORTED', 'EXPIRED')),
  stage text not null check (
    stage in ('CLAIMED', 'ENCRYPTED', 'RECORDS_WRITTEN', 'COMMITTED', 'ABORTED')
  ),
  claim_token_hash text not null check (claim_token_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition_id uuid not null,
  terminal_input_commitment_json jsonb not null
    check (pg_catalog.jsonb_typeof(terminal_input_commitment_json) = 'object'),
  retention_policy_id uuid not null,
  retention_policy_version text not null,
  retention_policy_hash text not null check (retention_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  deletion_due_at timestamptz not null,
  expires_at timestamptz not null,
  result_ref jsonb,
  secure_execution_receipt_ref jsonb,
  outcome_usage_ref jsonb,
  committed_at timestamptz,
  primary key (app_id, tenant_id, environment, preparation_id),
  unique (app_id, tenant_id, environment, invocation_id, principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, invocation_id, transition_id),
  foreign key (app_id, tenant_id, environment, invocation_id)
    references app_data_agent.research_invocation_commits (
      app_id, tenant_id, environment, invocation_id
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, retention_policy_id, retention_policy_version, retention_policy_hash)
    references app_data_agent.research_result_retention_policies (
      app_id, tenant_id, environment, policy_id, policy_version, policy_hash
    )
    on delete restrict not deferrable,
  check (
    (state = 'COMMITTED' and stage = 'COMMITTED' and result_ref is not null
      and outcome_usage_ref is not null and committed_at is not null)
    or (state <> 'COMMITTED' and committed_at is null)
  )
);

create table app_data_agent.research_system_artifacts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  artifact_id uuid not null,
  artifact_type text not null default 'AgentDataProjectionReceipt'
    check (artifact_type = 'AgentDataProjectionReceipt'),
  revision integer not null default 1 check (revision = 1),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  reservation_id uuid not null,
  invocation_id uuid not null,
  request_profile_hash text not null check (request_profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  field_count bigint not null check (field_count between 0 and 9007199254740991),
  byte_count bigint not null check (byte_count between 0 and 9007199254740991),
  token_count bigint not null check (token_count between 0 and 9007199254740991),
  hmac_hash text not null check (hmac_hash ~ '^hmac-sha256:[0-9a-f]{64}$'),
  policy_ref jsonb not null check (pg_catalog.jsonb_typeof(policy_ref) = 'object'),
  payload_json jsonb not null check (pg_catalog.jsonb_typeof(payload_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, artifact_id, revision),
  unique (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
  ),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, invocation_id)
    references app_data_agent.research_invocation_commits (
      app_id, tenant_id, environment, invocation_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_system_record_identities (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_kind text not null check (
    record_kind in (
      'ADAPTER_TERMINATION_RECEIPT', 'INVOCATION_OUTCOME_USAGE',
      'TOOL_INVOCATION_PERMIT', 'MODEL_INVOCATION_RESULT',
      'SQL_INVOCATION_RESULT', 'TOOL_INVOCATION_RESULT',
      'SECURE_SQL_EXECUTION_RECEIPT'
    )
  ),
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  run_id uuid not null,
  principal_id uuid not null,
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  commit_id uuid not null,
  authority_epoch bigint not null check (authority_epoch >= 0),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id, tenant_id, environment, record_kind, record_id, record_version
  ),
  unique (
    app_id, tenant_id, environment, run_id, record_kind, record_id,
    record_version, content_hash, commit_id
  ),
  foreign key (app_id, tenant_id, environment, run_id, principal_id)
    references app_data_agent.runs (
      app_id, tenant_id, environment, run_id, principal_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_adapter_termination_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null default 'ADAPTER_TERMINATION_RECEIPT'
    check (record_kind = 'ADAPTER_TERMINATION_RECEIPT'),
  run_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  reservation_id uuid not null,
  resource_lease_id uuid not null,
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  canonical_request_digest text not null check (canonical_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  termination_digest text not null check (termination_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload_json jsonb not null check (pg_catalog.jsonb_typeof(payload_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, record_id),
  unique (app_id, tenant_id, environment, invocation_id, termination_digest),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, invocation_id)
    references app_data_agent.research_invocation_commits (
      app_id, tenant_id, environment, invocation_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_invocation_outcome_usage (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null default 'INVOCATION_OUTCOME_USAGE'
    check (record_kind = 'INVOCATION_OUTCOME_USAGE'),
  run_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  reservation_id uuid not null,
  resource_lease_id uuid not null,
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  outcome text not null check (outcome in ('COMPLETED', 'FAILED')),
  actual_json jsonb not null check (pg_catalog.jsonb_typeof(actual_json) = 'object'),
  completion_binding jsonb,
  error_code text,
  outcome_hash text not null check (outcome_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  primary key (app_id, tenant_id, environment, record_id),
  unique (app_id, tenant_id, environment, invocation_id, outcome_hash),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  check (
    (outcome = 'COMPLETED' and completion_binding is not null and error_code is null)
    or (outcome = 'FAILED' and completion_binding is null and error_code is not null)
  )
);

create table app_data_agent.research_tool_invocation_permits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null default 'TOOL_INVOCATION_PERMIT'
    check (record_kind = 'TOOL_INVOCATION_PERMIT'),
  run_id uuid not null,
  principal_id uuid not null,
  tool_name text not null check (pg_catalog.length(tool_name) between 1 and 2000),
  tool_version text not null check (pg_catalog.length(tool_version) between 1 and 128),
  arguments_schema_hash text not null check (arguments_schema_hash ~ '^sha256:[0-9a-f]{64}$'),
  arguments_hash text not null check (arguments_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_receipt_ref jsonb not null check (pg_catalog.jsonb_typeof(policy_receipt_ref) = 'object'),
  tool_policy_version text not null,
  tool_permit_policy_limit_hash text not null
    check (tool_permit_policy_limit_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  status text not null check (status in ('ACTIVE', 'REVOKED', 'EXPIRED')),
  revocation_seq bigint not null default 0 check (revocation_seq >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  expired_at timestamptz,
  primary key (app_id, tenant_id, environment, record_id),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  foreign key (
    app_id, tenant_id, environment, tool_policy_version, tool_permit_policy_limit_hash
  )
    references app_data_agent.research_tool_permit_policy_limits (
      app_id, tenant_id, environment, policy_version, policy_limit_hash
    )
    on delete restrict not deferrable,
  check (
    (status = 'ACTIVE' and revoked_at is null and expired_at is null)
    or (status = 'REVOKED' and revoked_at is not null and expired_at is null)
    or (status = 'EXPIRED' and revoked_at is null and expired_at is not null)
  )
);

create table app_data_agent.research_invocation_results (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null check (
    record_kind in ('MODEL_INVOCATION_RESULT', 'SQL_INVOCATION_RESULT', 'TOOL_INVOCATION_RESULT')
  ),
  run_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  reservation_id uuid not null,
  preparation_id uuid not null,
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  state text not null check (state in ('AVAILABLE', 'TOMBSTONED')),
  metadata_json jsonb,
  aad_json jsonb,
  aad_hash text not null check (aad_hash ~ '^sha256:[0-9a-f]{64}$'),
  blob_id uuid,
  digest text not null check (digest ~ '^sha256:[0-9a-f]{64}$'),
  byte_length bigint not null check (byte_length between 0 and 8388608),
  retention_policy_id uuid not null,
  retention_policy_version text not null,
  retention_policy_hash text not null check (retention_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  deletion_due_at timestamptz not null,
  tombstoned_at timestamptz,
  primary key (app_id, tenant_id, environment, record_id),
  unique (app_id, tenant_id, environment, invocation_id, record_kind),
  unique (app_id, tenant_id, environment, record_id, blob_id),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, preparation_id)
    references app_data_agent.research_invocation_terminal_preparations (
      app_id, tenant_id, environment, preparation_id
    )
    on delete restrict not deferrable,
  check (
    (state = 'AVAILABLE' and metadata_json is not null and aad_json is not null
      and blob_id is not null and tombstoned_at is null)
    or (state = 'TOMBSTONED' and metadata_json is null and aad_json is null
      and blob_id is null and tombstoned_at is not null)
  )
);

create table app_data_agent.research_secure_sql_execution_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null default 'SECURE_SQL_EXECUTION_RECEIPT'
    check (record_kind = 'SECURE_SQL_EXECUTION_RECEIPT'),
  run_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  result_record_id uuid not null,
  query_hash text not null check (query_hash ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_hash text not null check (snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  row_count bigint not null check (row_count between 0 and 9007199254740991),
  column_count bigint not null check (column_count between 1 and 256),
  result_digest text not null check (result_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload_json jsonb not null check (pg_catalog.jsonb_typeof(payload_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, record_id),
  unique (app_id, tenant_id, environment, invocation_id),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_invocation_result_blobs (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  blob_id uuid not null,
  invocation_id uuid not null,
  result_record_kind text not null check (
    result_record_kind in ('MODEL_INVOCATION_RESULT', 'SQL_INVOCATION_RESULT', 'TOOL_INVOCATION_RESULT')
  ),
  result_record_id uuid not null,
  preparation_id uuid not null,
  encryption_key_kind text not null default 'ENCRYPTION' check (encryption_key_kind = 'ENCRYPTION'),
  encryption_key_version text not null,
  ciphertext_base64url text not null,
  nonce_base64url text not null,
  tag_base64url text not null,
  encrypted_byte_length bigint not null check (encrypted_byte_length between 1 and 8388608),
  ciphertext_hash text not null check (ciphertext_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, blob_id),
  unique (app_id, tenant_id, environment, invocation_id, result_record_id),
  unique (app_id, tenant_id, environment, result_record_kind, result_record_id, blob_id),
  foreign key (app_id, tenant_id, environment, encryption_key_kind, encryption_key_version)
    references app_data_agent.research_result_key_versions (
      app_id, tenant_id, environment, key_kind, key_version
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_system_record_transition_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  transition_id uuid not null,
  record_kind text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition text not null check (
    transition in ('REVOKE', 'EXPIRE', 'TOMBSTONE', 'SUBJECT_ERASURE')
  ),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  erasure_request_id uuid,
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, transition_id),
  unique (
    app_id, tenant_id, environment, record_kind, record_id, principal_id, idempotency_key
  ),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  check (
    (transition = 'SUBJECT_ERASURE' and erasure_request_id is not null)
    or (transition <> 'SUBJECT_ERASURE' and erasure_request_id is null)
  )
);

create table app_data_agent.research_result_ciphertext_access_audits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  audit_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  attempted_capability_id_hash text not null
    check (attempted_capability_id_hash ~ '^sha256:[0-9a-f]{64}$'),
  attempted_result_identity_hash text not null
    check (attempted_result_identity_hash ~ '^sha256:[0-9a-f]{64}$'),
  resolution_stage text not null check (
    resolution_stage in ('CAPABILITY_UNRESOLVED', 'CAPABILITY_RESOLVED', 'RESULT_RESOLVED')
  ),
  capability_id uuid,
  authority_epoch bigint,
  resolved_record_kind text,
  resolved_record_id uuid,
  resolved_record_version integer,
  blob_id uuid,
  resolved_encryption_key_kind text,
  resolved_encryption_key_version text,
  access_reason text not null check (
    access_reason in ('INVOCATION_RETURN', 'IDEMPOTENT_REPLAY', 'AUTHORIZED_ANALYSIS')
  ),
  outcome text not null check (outcome in ('ALLOWED', 'DENIED', 'RATE_LIMITED')),
  denial_code text,
  retention_policy_version text not null,
  retention_policy_hash text not null check (retention_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  delete_after timestamptz not null,
  primary key (app_id, tenant_id, environment, audit_id),
  foreign key (app_id, tenant_id, environment, retention_policy_version, retention_policy_hash)
    references app_data_agent.research_result_access_audit_retention_policies (
      app_id, tenant_id, environment, policy_version, policy_hash
    )
    on delete restrict not deferrable,
  check (
    (resolution_stage = 'CAPABILITY_UNRESOLVED' and capability_id is null
      and authority_epoch is null and resolved_record_id is null and blob_id is null)
    or (resolution_stage = 'CAPABILITY_RESOLVED' and capability_id is not null
      and authority_epoch is not null and resolved_record_id is null and blob_id is null)
    or (resolution_stage = 'RESULT_RESOLVED' and capability_id is not null
      and authority_epoch is not null and resolved_record_kind is not null
      and resolved_record_id is not null and resolved_record_version = 1
      and blob_id is not null and resolved_encryption_key_kind = 'ENCRYPTION'
      and resolved_encryption_key_version is not null)
  ),
  check (
    (outcome = 'ALLOWED' and denial_code is null)
    or (outcome in ('DENIED', 'RATE_LIMITED') and denial_code is not null)
  )
);

create index research_result_ciphertext_access_audits_principal_time
on app_data_agent.research_result_ciphertext_access_audits (
  app_id, tenant_id, environment, principal_id, observed_at
);

create index research_result_ciphertext_access_audits_attempted_id_time
on app_data_agent.research_result_ciphertext_access_audits (
  app_id, tenant_id, environment, attempted_result_identity_hash, observed_at
);

create index research_result_ciphertext_access_audits_resolved_identity_time
on app_data_agent.research_result_ciphertext_access_audits (
  app_id, tenant_id, environment, resolved_record_kind, resolved_record_id, observed_at
)
where resolution_stage = 'RESULT_RESOLVED';
