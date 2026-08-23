-- ============================================================
-- 10610: Runtime activation table
-- ============================================================

-- ============================================================
-- 24. semantic_runtime_activation: per-domain resolver and legacy contract state
-- mode = LEGACY | SHADOW | PUBLISHED_ONLY
-- activation_generation, rollback_window_status = OPEN | CLOSED
-- legacy_contract_status = AVAILABLE | CLOSED
-- ============================================================
create table semantic.semantic_runtime_activation (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  runtime_mode text not null default 'LEGACY'
    check (runtime_mode in ('LEGACY', 'SHADOW', 'PUBLISHED_ONLY')),
  activation_generation bigint not null default 1
    check (activation_generation between 1 and 9007199254740991),
  rollback_window_status text not null default 'OPEN'
    check (rollback_window_status in ('OPEN', 'CLOSED')),
  legacy_contract_status text not null default 'AVAILABLE'
    check (legacy_contract_status in ('AVAILABLE', 'CLOSED')),
  current_release_id uuid,
  current_release_generation bigint not null default 0
    check (current_release_generation between 0 and 9007199254740991),
  last_governance_readiness_receipt_digest text
    check (last_governance_readiness_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  closure_authorization_digest text
    check (closure_authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain)
);
