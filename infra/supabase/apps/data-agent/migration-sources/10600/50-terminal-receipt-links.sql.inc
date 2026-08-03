-- ============================================================
-- 10600: Backend artifact commit operations table
-- ============================================================

create table app_data_agent.research_backend_artifact_commit_operations (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  operation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null,
  commit_mode text not null
    check (commit_mode in ('CREATE', 'UPDATE', 'REVISE', 'SEAL', 'PUBLISH', 'REVOKE')),
  command_hash text not null
    check (command_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_active_revision integer not null,
  worker_fence bigint not null
    check (worker_fence between 0 and 9007199254740991),
  adopted_legacy boolean not null default false,
  committed_artifact_ref_json jsonb not null,
  committed_artifact_id uuid not null,
  committed_artifact_type text not null,
  committed_revision integer not null,
  committed_content_hash text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, run_id, idempotency_key)
);
