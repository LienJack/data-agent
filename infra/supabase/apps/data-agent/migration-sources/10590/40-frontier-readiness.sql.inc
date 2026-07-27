create table app_data_agent.research_version_frontiers (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  frontier_kind text not null
    check (frontier_kind in ('SEMANTIC', 'SCHEMA', 'DATA', 'POLICY', 'IDENTITY')),
  frontier_value_json jsonb not null
    check (pg_catalog.jsonb_typeof(frontier_value_json) = 'object'),
  frontier_value_hash text not null check (frontier_value_hash ~ '^sha256:[0-9a-f]{64}$'),
  frontier_version bigint not null check (frontier_version between 0 and 9007199254740991),
  authority_epoch bigint not null check (authority_epoch between 0 and 9007199254740991),
  event_seq bigint not null check (event_seq between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, frontier_kind),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict not deferrable
);

create table app_data_agent.research_frontier_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  frontier_kind text not null
    check (frontier_kind in ('SEMANTIC', 'SCHEMA', 'DATA', 'POLICY', 'IDENTITY')),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_frontier_version bigint
    check (expected_frontier_version is null or expected_frontier_version between 0 and 9007199254740991),
  expected_frontier_hash text
    check (expected_frontier_hash is null or expected_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  requested_frontier_hash text not null check (requested_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('COMMITTED', 'REJECTED')),
  committed_frontier_version bigint
    check (committed_frontier_version is null or committed_frontier_version between 0 and 9007199254740991),
  committed_frontier_hash text
    check (committed_frontier_hash is null or committed_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  event_seq bigint check (event_seq is null or event_seq between 1 and 9007199254740991),
  cascaded_revocation_operation_id uuid,
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  completed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (
    app_id, tenant_id, environment, run_id, principal_id, frontier_kind, idempotency_key
  ),
  check (
    (
      outcome = 'COMMITTED'
      and committed_frontier_version is not null
      and committed_frontier_hash is not null
      and event_seq is not null
      and error_code is null
    )
    or (
      outcome = 'REJECTED'
      and committed_frontier_version is null
      and committed_frontier_hash is null
      and event_seq is null
      and cascaded_revocation_operation_id is null
      and error_code is not null
    )
  )
);

create table app_data_agent.research_frontier_events (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  event_seq bigint not null check (event_seq between 1 and 9007199254740991),
  operation_id uuid not null,
  frontier_kind text not null
    check (frontier_kind in ('SEMANTIC', 'SCHEMA', 'DATA', 'POLICY', 'IDENTITY')),
  event_kind text not null check (event_kind in ('INITIALIZED', 'ADVANCED')),
  owner_principal_id uuid not null,
  old_frontier_version bigint
    check (old_frontier_version is null or old_frontier_version between 0 and 9007199254740991),
  old_frontier_hash text
    check (old_frontier_hash is null or old_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  new_frontier_version bigint not null check (new_frontier_version between 0 and 9007199254740991),
  new_frontier_hash text not null check (new_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, event_seq),
  unique (app_id, tenant_id, environment, operation_id),
  foreign key (app_id, tenant_id, environment, operation_id)
    references app_data_agent.research_frontier_operations (
      app_id, tenant_id, environment, operation_id
    )
    on delete restrict not deferrable,
  check (
    (event_kind = 'INITIALIZED' and old_frontier_version is null and old_frontier_hash is null)
    or (event_kind = 'ADVANCED' and old_frontier_version is not null and old_frontier_hash is not null)
  )
);

create table app_data_agent.current_report_readiness (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  state text not null check (state in ('CURRENT', 'REVOKED')),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  certificate_identity text not null check (pg_catalog.length(certificate_identity) between 1 and 4096),
  certificate_semantic_hash text not null
    check (certificate_semantic_hash ~ '^sha256:[0-9a-f]{64}$'),
  report_ref jsonb not null check (pg_catalog.jsonb_typeof(report_ref) = 'object'),
  report_identity text not null check (pg_catalog.length(report_identity) between 1 and 4096),
  semantic_frontier_version bigint not null check (semantic_frontier_version >= 0),
  semantic_frontier_hash text not null check (semantic_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  schema_frontier_version bigint not null check (schema_frontier_version >= 0),
  schema_frontier_hash text not null check (schema_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  data_frontier_version bigint not null check (data_frontier_version >= 0),
  data_frontier_hash text not null check (data_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_frontier_version bigint not null check (policy_frontier_version >= 0),
  policy_frontier_hash text not null check (policy_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  identity_frontier_version bigint not null check (identity_frontier_version >= 0),
  identity_frontier_hash text not null check (identity_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  frontier_hash text not null check (frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch between 0 and 9007199254740991),
  readiness_version bigint not null check (readiness_version between 0 and 9007199254740991),
  revocation_seq bigint not null default 0 check (revocation_seq between 0 and 9007199254740991),
  revocation_receipt_ref jsonb,
  published_at timestamptz not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict not deferrable,
  check (
    (state = 'CURRENT' and revocation_receipt_ref is null and revoked_at is null)
    or (
      state = 'REVOKED'
      and pg_catalog.jsonb_typeof(revocation_receipt_ref) = 'object'
      and revoked_at is not null
      and revocation_seq >= 1
    )
  )
);

create table app_data_agent.research_readiness_publications (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  publication_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  report_ref jsonb not null check (pg_catalog.jsonb_typeof(report_ref) = 'object'),
  expected_readiness_version bigint
    check (expected_readiness_version is null or expected_readiness_version >= 0),
  committed_readiness_version bigint not null check (committed_readiness_version >= 0),
  frontier_hash text not null check (frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  outcome text not null default 'CURRENT_PUBLISHED' check (outcome = 'CURRENT_PUBLISHED'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, publication_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key)
);

create table app_data_agent.research_domain_terminals (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  terminal_id uuid not null,
  terminal text not null
    check (terminal in ('READY', 'STALE', 'PARTIAL', 'NEEDS_MORE_RESEARCH', 'INCONCLUSIVE')),
  authority_kind text not null
    check (authority_kind in ('CURRENT_READINESS', 'REVOCATION_CONSUMPTION', 'RESEARCH_STOP')),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  domain_reason_codes jsonb not null
    check (pg_catalog.jsonb_typeof(domain_reason_codes) = 'array'),
  certificate_ref jsonb,
  revocation_receipt_ref jsonb,
  stop_decision_ref jsonb,
  coverage_ref jsonb,
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id),
  unique (app_id, tenant_id, environment, terminal_id),
  check (
    (terminal = 'READY' and authority_kind = 'CURRENT_READINESS'
      and certificate_ref is not null and revocation_receipt_ref is null and stop_decision_ref is null)
    or (terminal = 'STALE' and authority_kind = 'REVOCATION_CONSUMPTION'
      and certificate_ref is null and revocation_receipt_ref is not null and stop_decision_ref is null)
    or (terminal in ('PARTIAL', 'NEEDS_MORE_RESEARCH', 'INCONCLUSIVE')
      and authority_kind = 'RESEARCH_STOP'
      and certificate_ref is null and revocation_receipt_ref is null
      and stop_decision_ref is not null and coverage_ref is not null)
  )
);

create table app_data_agent.research_readiness_consumptions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  consumption_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  purpose text not null check (purpose in ('DOMAIN_TERMINAL', 'REPORT_READ')),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  report_ref jsonb not null check (pg_catalog.jsonb_typeof(report_ref) = 'object'),
  readiness_version bigint not null check (readiness_version >= 0),
  revocation_seq bigint not null check (revocation_seq >= 0),
  frontier_hash text not null check (frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  outcome text not null
    check (outcome in ('READY_COMMITTED', 'STALE_COMMITTED', 'GRANT_ISSUED')),
  terminal_id uuid,
  grant_id uuid,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, consumption_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, purpose, idempotency_key),
  check (
    (purpose = 'DOMAIN_TERMINAL' and outcome in ('READY_COMMITTED', 'STALE_COMMITTED')
      and terminal_id is not null and grant_id is null)
    or (purpose = 'REPORT_READ' and outcome = 'GRANT_ISSUED'
      and terminal_id is null and grant_id is not null)
  )
);

create table app_data_agent.research_stop_terminal_commits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  commit_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  stop_decision_ref jsonb not null check (pg_catalog.jsonb_typeof(stop_decision_ref) = 'object'),
  coverage_ref jsonb not null check (pg_catalog.jsonb_typeof(coverage_ref) = 'object'),
  terminal_id uuid not null,
  outcome text not null default 'COMMITTED' check (outcome = 'COMMITTED'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, commit_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, terminal_id)
    references app_data_agent.research_domain_terminals (
      app_id, tenant_id, environment, terminal_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_revocation_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  run_id uuid not null,
  owner_principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  trigger_kind text not null check (trigger_kind in ('SERVICE_REQUEST', 'FRONTIER_ADVANCE')),
  source_operation_id uuid not null,
  reason text not null check (
    reason in (
      'EVIDENCE_REVOKED', 'CERTIFICATE_TAMPERED',
      'SEMANTIC_REVISION_CHANGED', 'SCHEMA_REVISION_CHANGED',
      'DATA_SNAPSHOT_STALE', 'POLICY_CHANGED', 'IDENTITY_AUTHORITY_CHANGED'
    )
  ),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  observed_frontier_hash text not null check (observed_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  state text not null check (state in ('REQUESTED', 'COMMITTED', 'FAILED')),
  receipt_ref jsonb,
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  completed_at timestamptz,
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, run_id, owner_principal_id, idempotency_key),
  check (
    (trigger_kind = 'SERVICE_REQUEST' and reason in ('EVIDENCE_REVOKED', 'CERTIFICATE_TAMPERED'))
    or (trigger_kind = 'FRONTIER_ADVANCE'
      and reason not in ('EVIDENCE_REVOKED', 'CERTIFICATE_TAMPERED'))
  ),
  check (
    (state = 'REQUESTED' and receipt_ref is null and error_code is null and completed_at is null)
    or (state = 'COMMITTED' and receipt_ref is not null and error_code is null and completed_at is not null)
    or (state = 'FAILED' and receipt_ref is null and error_code is not null and completed_at is not null)
  )
);

create table app_data_agent.report_read_grants (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  grant_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  issue_input_hash text not null check (issue_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  report_ref jsonb not null check (pg_catalog.jsonb_typeof(report_ref) = 'object'),
  response_wire jsonb not null check (pg_catalog.jsonb_typeof(response_wire) = 'object'),
  response_wire_hash text not null check (response_wire_hash ~ '^sha256:[0-9a-f]{64}$'),
  issue_readiness_version bigint not null check (issue_readiness_version >= 0),
  issue_revocation_seq bigint not null check (issue_revocation_seq >= 0),
  issue_frontier_hash text not null check (issue_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  state text not null check (state in ('ISSUED', 'CONSUMED', 'RESPONDED', 'EXPIRED', 'REVOKED')),
  expires_at timestamptz not null,
  consume_idempotency_key text,
  consume_input_hash text
    check (consume_input_hash is null or consume_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  consumed_at timestamptz,
  response_idempotency_key text,
  response_input_hash text
    check (response_input_hash is null or response_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  responded_at timestamptz,
  terminal_from_status text check (terminal_from_status is null or terminal_from_status in ('ISSUED', 'CONSUMED')),
  expired_at timestamptz,
  revoked_at timestamptz,
  issued_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, grant_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  check (
    (state = 'ISSUED' and consume_idempotency_key is null and consume_input_hash is null
      and consumed_at is null and response_idempotency_key is null and response_input_hash is null
      and responded_at is null and terminal_from_status is null and expired_at is null and revoked_at is null)
    or (state = 'CONSUMED' and consume_idempotency_key is not null and consume_input_hash is not null
      and consumed_at is not null and response_idempotency_key is null and response_input_hash is null
      and responded_at is null and terminal_from_status is null and expired_at is null and revoked_at is null)
    or (state = 'RESPONDED' and consume_idempotency_key is not null and consume_input_hash is not null
      and consumed_at is not null and response_idempotency_key is not null and response_input_hash is not null
      and responded_at is not null and terminal_from_status is null and expired_at is null and revoked_at is null)
    or (state = 'EXPIRED' and terminal_from_status is not null and expired_at is not null
      and responded_at is null and revoked_at is null)
    or (state = 'REVOKED' and terminal_from_status is not null and revoked_at is not null
      and responded_at is null and expired_at is null)
  )
);

create table app_data_agent.report_read_grant_expiration_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  grant_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_state text not null check (expected_state in ('ISSUED', 'CONSUMED')),
  source_state text not null check (source_state in ('ISSUED', 'CONSUMED')),
  outcome text not null default 'EXPIRED' check (outcome = 'EXPIRED'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, grant_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, grant_id)
    references app_data_agent.report_read_grants (app_id, tenant_id, environment, grant_id)
    on delete restrict not deferrable
);

create table app_data_agent.research_release_decision_commits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  decision_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  candidate_input_hash text not null check (candidate_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision_hash text not null check (decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision text not null default 'GO' check (decision = 'GO'),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  readiness_version bigint not null check (readiness_version >= 0),
  revocation_seq bigint not null check (revocation_seq >= 0),
  frontier_hash text not null check (frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  evidence_refs jsonb not null check (pg_catalog.jsonb_typeof(evidence_refs) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, decision_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key)
);
