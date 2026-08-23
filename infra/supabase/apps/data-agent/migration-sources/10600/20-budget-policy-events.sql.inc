-- ============================================================
-- 10600: Budget policy, enumerator, event, and step tables
-- ============================================================

create table app_data_agent.research_budget_policy_versions (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  tenant_policy_version bigint not null
    check (tenant_policy_version between 1 and 9007199254740991),
  limits_json jsonb not null,
  top_up_allowed boolean not null default false,
  tenant_policy_hash text not null
    check (tenant_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  provision_operation_id uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, tenant_policy_version)
);

-- 2. research_budget_policy_heads: mutable current head
create table app_data_agent.research_budget_policy_heads (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  current_tenant_policy_version bigint not null
    check (current_tenant_policy_version between 1 and 9007199254740991),
  current_tenant_policy_hash text not null
    check (current_tenant_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  head_version bigint not null
    check (head_version between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment)
);

-- 3. research_enumerator_versions: immutable version
create table app_data_agent.research_enumerator_versions (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  enumerator_version bigint not null
    check (enumerator_version between 1 and 9007199254740991),
  eig_policy_version bigint not null
    check (eig_policy_version between 1 and 9007199254740991),
  input_schema_version text not null,
  implementation_digest text not null
    check (implementation_digest ~ '^sha256:[0-9a-f]{64}$'),
  enumerator_version_hash text not null
    check (enumerator_version_hash ~ '^sha256:[0-9a-f]{64}$'),
  provision_operation_id uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, enumerator_version)
);

-- 4. research_enumerator_version_heads: mutable current head
create table app_data_agent.research_enumerator_version_heads (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  current_enumerator_version bigint not null
    check (current_enumerator_version between 1 and 9007199254740991),
  current_enumerator_version_hash text not null
    check (current_enumerator_version_hash ~ '^sha256:[0-9a-f]{64}$'),
  head_version bigint not null
    check (head_version between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment)
);

-- 5. research_budget_events: append event
create table app_data_agent.research_budget_events (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  budget_epoch bigint not null
    check (budget_epoch between 0 and 9007199254740991),
  budget_event_seq bigint not null
    check (budget_event_seq between 0 and 9007199254740991),
  event_kind text not null
    check (event_kind in (
      'RESERVE', 'RELEASE', 'CONSUME', 'EXPIRY', 'TOP_UP',
      'EPOCH_ADVANCE', 'ADJUST', 'CANCEL', 'BUDGET_RESET'
    )),
  source_operation_kind text not null
    check (source_operation_kind in (
      'STEP', 'RESOURCE', 'ADMIN', 'POLICY', 'RECOVERY', 'EPOCH'
    )),
  source_operation_id uuid not null,
  reservation_id uuid,
  logical_step_id uuid,
  actual_before_json jsonb not null,
  actual_after_json jsonb not null,
  hold_before_json jsonb,
  hold_after_json jsonb,
  uncertainty_before_json jsonb,
  uncertainty_after_json jsonb,
  previous_event_hash text,
  event_hash text not null
    check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq),
  unique (app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq, event_hash)
);

-- 6. research_step_operations: append operation
create table app_data_agent.research_step_operations (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  step_operation_id uuid not null,
  run_id uuid not null,
  budget_epoch bigint not null
    check (budget_epoch between 0 and 9007199254740991),
  logical_step_id uuid not null,
  parent_logical_step_id uuid,
  step_seq bigint not null
    check (step_seq between 0 and 9007199254740991),
  step_kind text not null
    check (step_kind in (
      'PLAN', 'QUERY', 'EVIDENCE', 'CLAIM', 'ASSESSMENT',
      'COVERAGE', 'STOP', 'REPORT', 'CLARIFICATION', 'REPLAN'
    )),
  step_input_hash text not null
    check (step_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  outbox_id uuid not null,
  attempt_id uuid not null,
  worker_fence bigint not null
    check (worker_fence between 0 and 9007199254740991),
  budget_event_seq bigint not null
    check (budget_event_seq between 0 and 9007199254740991),
  budget_event_hash text not null
    check (budget_event_hash ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  idempotency_key text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, step_operation_id),
  unique (app_id, tenant_id, environment, run_id, idempotency_key),
  unique (app_id, tenant_id, environment, run_id, budget_epoch, logical_step_id)
);

-- 7. research_budget_ledger_receipts: common Receipt
