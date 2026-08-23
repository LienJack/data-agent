-- ============================================================
-- 10610: Rollback authorization and receipt tables
-- ============================================================

-- ============================================================
-- 29. semantic_rollback_authorization: aggregated rollback quorum receipt
-- Exact from/to/current tuple/digest; nonce single-use
-- ============================================================
create table semantic.semantic_rollback_authorization (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  authorization_id uuid not null,
  packet_id uuid not null,
  from_release_id uuid not null,
  from_release_generation bigint not null,
  to_release_id uuid not null,
  to_release_generation bigint not null,
  current_release_id uuid not null,
  current_release_generation bigint not null,
  authorization_digest text not null
    check (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  decision_set_digest text not null
    check (decision_set_digest ~ '^sha256:[0-9a-f]{64}$'),
  nonce uuid not null,
  expires_at timestamptz not null,
  is_consumed boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  consumed_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, authorization_id),
  unique (app_id, tenant_id, environment, semantic_domain, nonce),
  foreign key (app_id, tenant_id, environment, semantic_domain, packet_id)
    references semantic.semantic_review_task (app_id, tenant_id, environment, semantic_domain, packet_id)
);

-- ============================================================
-- 30. semantic_rollback_receipt: rollback authorization and result
-- Append-only; from/to/reason/decision-set digest
-- ============================================================
create table semantic.semantic_rollback_receipt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  receipt_id uuid not null,
  authorization_id uuid not null,
  from_release_id uuid not null,
  from_release_generation bigint not null,
  to_release_id uuid not null,
  to_release_generation bigint not null,
  rollback_reason text not null,
  decision_set_digest text not null
    check (decision_set_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_digest text not null
    check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, receipt_id),
  unique (app_id, tenant_id, environment, semantic_domain, receipt_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, authorization_id)
    references semantic.semantic_rollback_authorization (app_id, tenant_id, environment, semantic_domain, authorization_id)
);
