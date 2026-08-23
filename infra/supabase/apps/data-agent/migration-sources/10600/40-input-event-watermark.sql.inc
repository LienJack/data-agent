-- ============================================================
-- 10600: Input event watermark tables
-- ============================================================

create table app_data_agent.research_input_event_heads (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  next_event_seq bigint not null
    check (next_event_seq between 0 and 9007199254740991),
  head_event_hash text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id)
);

-- 13. research_input_events: append event
create table app_data_agent.research_input_events (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  event_seq bigint not null
    check (event_seq between 0 and 9007199254740991),
  event_kind text not null
    check (event_kind in (
      'BRIEF_ASSIGNED', 'HYPOTHESIS_SET', 'EVIDENCE_PLAN',
      'QUERY_EVIDENCE', 'CLAIM_ASSESSED', 'COVERAGE_DERIVED',
      'STOP_DECIDED', 'REPORT_READY', 'REVOCATION',
      'CLARIFICATION', 'REPLAN_REQUESTED', 'BUDGET_EVENT',
      'RESOURCE_INVOCATION'
    )),
  subject_identity text not null,
  subject_hash text not null
    check (subject_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_operation_kind text not null
    check (source_operation_kind in (
      'RESEARCH_KERNEL', 'AUTHORITY_RPC', 'WORKER', 'SYSTEM', 'ADMIN'
    )),
  source_operation_id uuid not null,
  previous_event_hash text,
  event_hash text not null
    check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, event_seq),
  unique (app_id, tenant_id, environment, run_id, event_seq, event_hash)
);

-- 14. research_input_event_watermark_receipts: common Receipt
create table app_data_agent.research_input_event_watermark_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_event_seq bigint not null
    check (observed_event_seq between 0 and 9007199254740991),
  observed_head_hash text not null
    check (observed_head_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_input_closure_hash text not null
    check (certificate_input_closure_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_ref_json jsonb not null,
  certificate_artifact_id uuid not null,
  certificate_artifact_type text not null
    check (certificate_artifact_type = 'ReportReadyCertificate'),
  certificate_revision integer not null,
  certificate_content_hash text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);

-- 15. research_backend_artifact_commit_operations: append operation
