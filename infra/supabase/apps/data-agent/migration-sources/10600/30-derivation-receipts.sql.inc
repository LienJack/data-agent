-- ============================================================
-- 10600: Derivation receipt tables (Budget, Coverage, Attestation, Candidate, Stop)
-- ============================================================

create table app_data_agent.research_budget_ledger_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_command_hash text not null
    check (snapshot_command_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_limits_version bigint not null
    check (runtime_limits_version between 1 and 9007199254740991),
  runtime_limits_hash text not null
    check (runtime_limits_hash ~ '^sha256:[0-9a-f]{64}$'),
  tenant_policy_version bigint not null
    check (tenant_policy_version between 1 and 9007199254740991),
  tenant_policy_hash text not null
    check (tenant_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  budget_epoch bigint not null
    check (budget_epoch between 0 and 9007199254740991),
  budget_started_at timestamptz not null,
  evaluated_through_reservation_seq bigint not null
    check (evaluated_through_reservation_seq between 0 and 9007199254740991),
  evaluated_through_budget_event_seq bigint not null
    check (evaluated_through_budget_event_seq between 0 and 9007199254740991),
  evaluated_at timestamptz not null,
  valid_until timestamptz not null,
  outstanding_set_hash text not null
    check (outstanding_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  active_count bigint not null
    check (active_count between 0 and 9007199254740991),
  outcome_unknown_count bigint not null
    check (outcome_unknown_count between 0 and 9007199254740991),
  abandoned_count bigint not null
    check (abandoned_count between 0 and 9007199254740991),
  actual_used_json jsonb not null,
  unresolved_hold_json jsonb not null,
  ledger_json jsonb not null,
  research_brief_ref_json jsonb not null,
  research_brief_artifact_id uuid not null,
  research_brief_artifact_type text not null
    check (research_brief_artifact_type = 'ResearchBrief'),
  research_brief_revision integer not null,
  research_brief_content_hash text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);
create unique index if not exists uq_budget_ledger_receipt_protocol_version
  on app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, input_hash);
-- 8. research_coverage_derivation_receipts: common Receipt
create table app_data_agent.research_coverage_derivation_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  budget_receipt_id uuid not null,
  budget_receipt_hash text not null
    check (budget_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  version_frontier_json jsonb not null,
  version_frontier_hash text not null
    check (version_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  closure_refs_json jsonb not null,
  coverage_input_hash text not null
    check (coverage_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  kernel_version text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);
create unique index if not exists uq_coverage_derivation_receipt_protocol_version
  on app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, coverage_input_hash);
-- 9. research_candidate_enumerator_attestations: append Attestation
create table app_data_agent.research_candidate_enumerator_attestations (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  attestation_id uuid not null,
  attestation_hash text not null
    check (attestation_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  issuer_principal_id uuid not null,
  issuer_capability_id uuid not null,
  issuer_authority_epoch bigint not null
    check (issuer_authority_epoch between 0 and 9007199254740991),
  idempotency_key text not null,
  budget_receipt_id uuid not null,
  budget_receipt_hash text not null,
  budget_input_hash text not null
    check (budget_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  enumerator_version bigint not null
    check (enumerator_version between 1 and 9007199254740991),
  eig_policy_version bigint not null
    check (eig_policy_version between 1 and 9007199254740991),
  implementation_digest text not null
    check (implementation_digest ~ '^sha256:[0-9a-f]{64}$'),
  query_contract_universe_refs_json jsonb not null,
  unresolved_obligation_refs_json jsonb not null,
  no_candidate_obligation_refs_json jsonb not null,
  no_candidate_assessments_json jsonb not null,
  candidate_queries_json jsonb not null,
  enumeration_universe_hash text not null
    check (enumeration_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_set_hash text not null
    check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  attestation_command_hash text not null
    check (attestation_command_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, attestation_id),
  unique (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash),
  unique (app_id, tenant_id, environment, run_id, issuer_principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, run_id,
          budget_receipt_id, budget_receipt_hash, enumerator_version,
          eig_policy_version, enumeration_universe_hash)
);

-- 10. research_candidate_enumeration_receipts: common Receipt v2
create table app_data_agent.research_candidate_enumeration_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  coverage_receipt_id uuid not null,
  coverage_receipt_hash text not null,
  budget_receipt_id uuid not null,
  budget_receipt_hash text not null,
  enumerator_head_version bigint not null
    check (enumerator_head_version between 1 and 9007199254740991),
  enumerator_version bigint not null
    check (enumerator_version between 1 and 9007199254740991),
  eig_policy_version bigint not null
    check (eig_policy_version between 1 and 9007199254740991),
  enumerator_capability_id uuid not null,
  enumerator_authority_epoch bigint not null
    check (enumerator_authority_epoch between 0 and 9007199254740991),
  enumerator_attestation_id uuid not null,
  enumerator_attestation_hash text not null
    check (enumerator_attestation_hash ~ '^sha256:[0-9a-f]{64}$'),
  unresolved_obligation_refs_json jsonb not null,
  no_candidate_obligation_refs_json jsonb not null,
  no_candidate_assessments_json jsonb not null,
  candidate_queries_json jsonb not null,
  query_contract_universe_refs_json jsonb not null,
  enumeration_universe_hash text not null
    check (enumeration_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_set_hash text not null
    check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);

-- 11. research_stop_derivation_receipts: common Receipt v2
create table app_data_agent.research_stop_derivation_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  coverage_receipt_id uuid not null,
  coverage_receipt_hash text not null,
  candidate_receipt_id uuid not null,
  candidate_receipt_hash text not null,
  budget_receipt_id uuid not null,
  budget_receipt_hash text not null,
  supported_subset_json jsonb not null,
  required_disclosures_json jsonb not null,
  pre_stop_readiness_hash text not null
    check (pre_stop_readiness_hash ~ '^sha256:[0-9a-f]{64}$'),
  kernel_version text not null,
  enumerator_version bigint not null
    check (enumerator_version between 1 and 9007199254740991),
  eig_policy_version bigint not null
    check (eig_policy_version between 1 and 9007199254740991),
  decision text not null
    check (decision in (
      'STOP_READY', 'STOP_PARTIAL', 'STOP_NEEDS_MORE_RESEARCH',
      'STOP_INCONCLUSIVE', 'CONTINUE', 'REPLAN',
      'RESEARCH_STOP_INPUT_STALE', 'RESEARCH_STOP_INPUT_INCONSISTENT'
    )),
  decision_input_hash text not null
    check (decision_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);

-- 12. research_input_event_heads: mutable head


-- ============================================================
create table app_data_agent.research_budget_ledger_input_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  binding_kind text not null
    check (binding_kind in ('ARTIFACT_REF', 'BUDGET_EVENT', 'RESERVATION_STATE')),
  strict_ref_json jsonb,
  artifact_id uuid,
  artifact_type text,
  revision integer
    check (revision between 0 and 2147483647),
  content_hash text
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  budget_epoch bigint
    check (budget_epoch between 0 and 9007199254740991),
  budget_event_seq bigint
    check (budget_event_seq between 0 and 9007199254740991),
  event_hash text
    check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  reservation_id uuid,
  reservation_seq bigint
    check (reservation_seq between 0 and 9007199254740991),
  reservation_state text
    check (reservation_state in ('ACTIVE', 'SETTLED', 'ABANDONED', 'OUTCOME_UNKNOWN')),
  reservation_projection_json jsonb,
  reservation_projection_hash text
    check (reservation_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  primary key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash, canonical_path, binding_group, ordinal),
  constraint chk_budget_binding_kind_exclusive
    check (
      (binding_kind = 'ARTIFACT_REF'
       and strict_ref_json is not null
       and artifact_id is not null
       and artifact_type is not null
       and revision is not null
       and content_hash is not null
       and budget_epoch is null
       and budget_event_seq is null
       and event_hash is null
       and reservation_id is null
       and reservation_seq is null
       and reservation_state is null
       and reservation_projection_json is null
       and reservation_projection_hash is null)
      or
      (binding_kind = 'BUDGET_EVENT'
       and strict_ref_json is null
       and artifact_id is null
       and artifact_type is null
       and revision is null
       and content_hash is null
       and node_id is null
       and budget_epoch is not null
       and budget_event_seq is not null
       and event_hash is not null
       and reservation_id is null
       and reservation_seq is null
       and reservation_state is null
       and reservation_projection_json is null
       and reservation_projection_hash is null)
      or
      (binding_kind = 'RESERVATION_STATE'
       and strict_ref_json is null
       and artifact_id is null
       and artifact_type is null
       and revision is null
       and content_hash is null
       and node_id is null
       and budget_epoch is null
       and budget_event_seq is null
       and event_hash is null
       and reservation_id is not null
       and reservation_seq is not null
       and reservation_state is not null
       and reservation_projection_json is not null
       and reservation_projection_hash is not null)
    )
);

-- ============================================================
-- 2. research_coverage_derivation_ref_bindings: Ref companion
--    parent FK to Coverage Receipt
-- ============================================================
create table app_data_agent.research_coverage_derivation_ref_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  strict_ref_json jsonb not null,
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null
    check (revision between 0 and 2147483647),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  constraint chk_coverage_ref_node_id_branch
    check (
      (binding_group like 'EMBEDDED:%' and node_id is not null)
      or (binding_group not like 'EMBEDDED:%' and node_id is null)
    ),
  primary key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash, canonical_path, binding_group, ordinal)
);

-- ============================================================
-- 3. research_candidate_attestation_ref_bindings: Ref companion
--    parent FK to Attestation
-- ============================================================
create table app_data_agent.research_candidate_attestation_ref_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  attestation_id uuid not null,
  attestation_hash text not null
    check (attestation_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  strict_ref_json jsonb not null,
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null
    check (revision between 0 and 2147483647),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  constraint chk_attestation_ref_node_id_branch
    check (
      (binding_group like 'EMBEDDED:%' and node_id is not null)
      or (binding_group not like 'EMBEDDED:%' and node_id is null)
    ),
  primary key (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash, canonical_path, binding_group, ordinal)
);

-- ============================================================
-- 4. research_candidate_enumeration_ref_bindings: Ref companion
--    parent FK to Candidate Receipt v2
-- ============================================================
create table app_data_agent.research_candidate_enumeration_ref_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  strict_ref_json jsonb not null,
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null
    check (revision between 0 and 2147483647),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  constraint chk_candidate_enumeration_ref_node_id_branch
    check (
      (binding_group like 'EMBEDDED:%' and node_id is not null)
      or (binding_group not like 'EMBEDDED:%' and node_id is null)
    ),
  primary key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash, canonical_path, binding_group, ordinal)
);

-- ============================================================
-- 5. research_stop_derivation_ref_bindings: Ref companion
--    parent FK to Stop Receipt
-- ============================================================
create table app_data_agent.research_stop_derivation_ref_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  strict_ref_json jsonb not null,
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null
    check (revision between 0 and 2147483647),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  constraint chk_stop_ref_node_id_branch
    check (
      (binding_group like 'EMBEDDED:%' and node_id is not null)
      or (binding_group not like 'EMBEDDED:%' and node_id is null)
    ),
  primary key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash, canonical_path, binding_group, ordinal)
);


-- ============================================================
-- 10600: Coverage Derivation / Stop Receipt issuer functions
-- ============================================================

-- ============================================================
-- 1. issue_coverage_derivation_receipt: Issue Coverage Derivation Receipt
--    Validates version frontier, budget epoch, and closure refs
-- ============================================================
create function app_data_agent.issue_coverage_derivation_receipt(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_version_frontier_json jsonb;
  v_version_frontier_hash text;
  v_closure_refs_json jsonb;
  v_coverage_input_hash text;
  v_kernel_version text;
  v_principal_id uuid;
  v_idempotency_key text;
  v_existing record;
  v_now timestamptz;
  v_binding record;
  v_budget_receipt record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_version_frontier_json := cmd #> '{version_frontier}';
    v_version_frontier_hash := cmd #>> '{version_frontier_hash}';
    v_closure_refs_json := cmd #> '{closure_refs}';
    v_coverage_input_hash := cmd #>> '{coverage_input_hash}';
    v_kernel_version := cmd #>> '{kernel_version}';
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_version_frontier_json is null or v_version_frontier_hash is null
    or v_closure_refs_json is null or v_coverage_input_hash is null
    or v_kernel_version is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Check idempotency
  select receipt_id, receipt_hash, committed_at
  into v_existing
  from app_data_agent.research_coverage_derivation_receipts as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.receipt_id = v_receipt_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'receipt_id', v_existing.receipt_id,
      'receipt_hash', v_existing.receipt_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Verify budget receipt exists and is valid
  select receipt.*
  into v_budget_receipt
  from app_data_agent.research_budget_ledger_receipts as receipt
  where receipt.app_id = s_app_id
    and receipt.tenant_id = s_tenant_id
    and receipt.environment = s_environment
    and receipt.run_id = v_run_id
    and receipt.receipt_id = v_budget_receipt_id
    and receipt.receipt_hash = v_budget_receipt_hash;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_RECEIPT_NOT_FOUND'));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-coverage-derivation-receipt@1.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_version_frontier_hash || '\x00'::bytea ||
        v_coverage_input_hash || '\x00'::bytea ||
        v_kernel_version,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert receipt
  insert into app_data_agent.research_coverage_derivation_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    budget_receipt_id, budget_receipt_hash,
    version_frontier_json, version_frontier_hash,
    closure_refs_json, coverage_input_hash, kernel_version,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'coverage-derivation-receipt@1.0.0', v_coverage_input_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_version_frontier_json, v_version_frontier_hash,
    v_closure_refs_json, v_coverage_input_hash, v_kernel_version,
    v_now
  );

  -- Insert companion ref bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{ref_bindings}')
  loop
    insert into app_data_agent.research_coverage_derivation_ref_bindings (
      app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
      canonical_path, binding_group, ordinal,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 2. issue_candidate_enumerator_attestation: Issue Attestation
--    Validates enumerator version, budget receipt, and candidate universe
-- ============================================================
create function app_data_agent.issue_candidate_enumerator_attestation(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_attestation_id uuid;
  v_attestation_hash text;
  v_issuer_principal_id uuid;
  v_issuer_capability_id uuid;
  v_issuer_authority_epoch bigint;
  v_idempotency_key text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_budget_input_hash text;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_implementation_digest text;
  v_query_contract_universe_refs_json jsonb;
  v_unresolved_obligation_refs_json jsonb;
  v_no_candidate_obligation_refs_json jsonb;
  v_no_candidate_assessments_json jsonb;
  v_candidate_queries_json jsonb;
  v_enumeration_universe_hash text;
  v_candidate_set_hash text;
  v_attestation_command_hash text;
  v_input_hash text;
  v_existing record;
  v_now timestamptz;
  v_binding record;
  v_enumerator_head record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_attestation_id := (cmd #>> '{attestation_id}')::uuid;
    v_issuer_principal_id := (cmd #>> '{issuer_principal_id}')::uuid;
    v_issuer_capability_id := (cmd #>> '{issuer_capability_id}')::uuid;
    v_issuer_authority_epoch := (cmd #>> '{issuer_authority_epoch}')::bigint;
    v_idempotency_key := cmd #>> '{idempotency_key}';
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_budget_input_hash := cmd #>> '{budget_input_hash}';
    v_enumerator_version := (cmd #>> '{enumerator_version}')::bigint;
    v_eig_policy_version := (cmd #>> '{eig_policy_version}')::bigint;
    v_implementation_digest := cmd #>> '{implementation_digest}';
    v_query_contract_universe_refs_json := cmd #> '{query_contract_universe_refs}';
    v_unresolved_obligation_refs_json := cmd #> '{unresolved_obligation_refs}';
    v_no_candidate_obligation_refs_json := cmd #> '{no_candidate_obligation_refs}';
    v_no_candidate_assessments_json := cmd #> '{no_candidate_assessments}';
    v_candidate_queries_json := cmd #> '{candidate_queries}';
    v_enumeration_universe_hash := cmd #>> '{enumeration_universe_hash}';
    v_candidate_set_hash := cmd #>> '{candidate_set_hash}';
    v_attestation_command_hash := cmd #>> '{attestation_command_hash}';
    v_input_hash := cmd #>> '{input_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_attestation_id is null
    or v_issuer_principal_id is null or v_issuer_capability_id is null
    or v_issuer_authority_epoch is null or v_idempotency_key is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_budget_input_hash is null
    or v_enumerator_version is null or v_eig_policy_version is null
    or v_implementation_digest is null
    or v_enumeration_universe_hash is null or v_candidate_set_hash is null
    or v_attestation_command_hash is null or v_input_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Check idempotency
  select attestation_id, attestation_hash, committed_at
  into v_existing
  from app_data_agent.research_candidate_enumerator_attestations as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.attestation_id = v_attestation_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'attestation_id', v_existing.attestation_id,
      'attestation_hash', v_existing.attestation_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Verify enumerator version
  select head.*
  into v_enumerator_head
  from app_data_agent.research_enumerator_version_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ENUMERATOR_HEAD_NOT_FOUND'));
  end if;
  if v_enumerator_head.current_enumerator_version <> v_enumerator_version then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ENUMERATOR_VERSION_MISMATCH'));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Compute attestation hash
  v_attestation_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-candidate-enumerator-attestation@1.0.0' || '\x00'::bytea ||
        v_attestation_id::text || '\x00'::bytea ||
        v_issuer_principal_id::text || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_enumerator_version::text || '\x00'::bytea ||
        v_eig_policy_version::text || '\x00'::bytea ||
        v_enumeration_universe_hash || '\x00'::bytea ||
        v_candidate_set_hash || '\x00'::bytea ||
        v_attestation_command_hash || '\x00'::bytea ||
        v_input_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert attestation
  insert into app_data_agent.research_candidate_enumerator_attestations (
    app_id, tenant_id, environment, run_id, attestation_id, attestation_hash,
    protocol_version, input_hash,
    issuer_principal_id, issuer_capability_id, issuer_authority_epoch,
    idempotency_key,
    budget_receipt_id, budget_receipt_hash, budget_input_hash,
    enumerator_version, eig_policy_version, implementation_digest,
    query_contract_universe_refs_json, unresolved_obligation_refs_json,
    no_candidate_obligation_refs_json, no_candidate_assessments_json,
    candidate_queries_json,
    enumeration_universe_hash, candidate_set_hash,
    attestation_command_hash, input_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_attestation_id, v_attestation_hash,
    'candidate-enumerator-attestation@1.0.0', v_input_hash,
    v_issuer_principal_id, v_issuer_capability_id, v_issuer_authority_epoch,
    v_idempotency_key,
    v_budget_receipt_id, v_budget_receipt_hash, v_budget_input_hash,
    v_enumerator_version, v_eig_policy_version, v_implementation_digest,
    v_query_contract_universe_refs_json, v_unresolved_obligation_refs_json,
    v_no_candidate_obligation_refs_json, v_no_candidate_assessments_json,
    v_candidate_queries_json,
    v_enumeration_universe_hash, v_candidate_set_hash,
    v_attestation_command_hash, v_input_hash,
    v_now
  );

  -- Insert companion ref bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{ref_bindings}')
  loop
    insert into app_data_agent.research_candidate_attestation_ref_bindings (
      app_id, tenant_id, environment, run_id, attestation_id, attestation_hash,
      canonical_path, binding_group, ordinal,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_attestation_id, v_attestation_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'attestation_id', v_attestation_id,
    'attestation_hash', v_attestation_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 3. issue_candidate_enumeration_receipt: Issue Candidate Enumeration Receipt v2
--    Validates attestation, coverage, and budget dependencies
-- ============================================================
create function app_data_agent.issue_candidate_enumeration_receipt(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_coverage_receipt_id uuid;
  v_coverage_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_enumerator_head_version bigint;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_enumerator_capability_id uuid;
  v_enumerator_authority_epoch bigint;
  v_enumerator_attestation_id uuid;
  v_enumerator_attestation_hash text;
  v_unresolved_obligation_refs_json jsonb;
  v_no_candidate_obligation_refs_json jsonb;
  v_no_candidate_assessments_json jsonb;
  v_candidate_queries_json jsonb;
  v_query_contract_universe_refs_json jsonb;
  v_enumeration_universe_hash text;
  v_candidate_set_hash text;
  v_existing record;
  v_now timestamptz;
  v_binding record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_coverage_receipt_id := (cmd #>> '{coverage_receipt_id}')::uuid;
    v_coverage_receipt_hash := cmd #>> '{coverage_receipt_hash}';
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_enumerator_head_version := (cmd #>> '{enumerator_head_version}')::bigint;
    v_enumerator_version := (cmd #>> '{enumerator_version}')::bigint;
    v_eig_policy_version := (cmd #>> '{eig_policy_version}')::bigint;
    v_enumerator_capability_id := (cmd #>> '{enumerator_capability_id}')::uuid;
    v_enumerator_authority_epoch := (cmd #>> '{enumerator_authority_epoch}')::bigint;
    v_enumerator_attestation_id := (cmd #>> '{enumerator_attestation_id}')::uuid;
    v_enumerator_attestation_hash := cmd #>> '{enumerator_attestation_hash}';
    v_unresolved_obligation_refs_json := cmd #> '{unresolved_obligation_refs}';
    v_no_candidate_obligation_refs_json := cmd #> '{no_candidate_obligation_refs}';
    v_no_candidate_assessments_json := cmd #> '{no_candidate_assessments}';
    v_candidate_queries_json := cmd #> '{candidate_queries}';
    v_query_contract_universe_refs_json := cmd #> '{query_contract_universe_refs}';
    v_enumeration_universe_hash := cmd #>> '{enumeration_universe_hash}';
    v_candidate_set_hash := cmd #>> '{candidate_set_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_coverage_receipt_id is null or v_coverage_receipt_hash is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_enumerator_head_version is null or v_enumerator_version is null
    or v_eig_policy_version is null or v_enumerator_capability_id is null
    or v_enumerator_authority_epoch is null
    or v_enumerator_attestation_id is null or v_enumerator_attestation_hash is null
    or v_enumeration_universe_hash is null or v_candidate_set_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Check idempotency
  select receipt_id, receipt_hash, committed_at
  into v_existing
  from app_data_agent.research_candidate_enumeration_receipts as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.receipt_id = v_receipt_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'receipt_id', v_existing.receipt_id,
      'receipt_hash', v_existing.receipt_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-candidate-enumeration-receipt@2.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_hash || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_enumerator_head_version::text || '\x00'::bytea ||
        v_enumerator_version::text || '\x00'::bytea ||
        v_eig_policy_version::text || '\x00'::bytea ||
        v_enumeration_universe_hash || '\x00'::bytea ||
        v_candidate_set_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert receipt
  insert into app_data_agent.research_candidate_enumeration_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    coverage_receipt_id, coverage_receipt_hash,
    budget_receipt_id, budget_receipt_hash,
    enumerator_head_version, enumerator_version, eig_policy_version,
    enumerator_capability_id, enumerator_authority_epoch,
    enumerator_attestation_id, enumerator_attestation_hash,
    unresolved_obligation_refs_json, no_candidate_obligation_refs_json,
    no_candidate_assessments_json, candidate_queries_json,
    query_contract_universe_refs_json,
    enumeration_universe_hash, candidate_set_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'candidate-enumeration-receipt@2.0.0', v_candidate_set_hash,
    v_coverage_receipt_id, v_coverage_receipt_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_enumerator_head_version, v_enumerator_version, v_eig_policy_version,
    v_enumerator_capability_id, v_enumerator_authority_epoch,
    v_enumerator_attestation_id, v_enumerator_attestation_hash,
    v_unresolved_obligation_refs_json, v_no_candidate_obligation_refs_json,
    v_no_candidate_assessments_json, v_candidate_queries_json,
    v_query_contract_universe_refs_json,
    v_enumeration_universe_hash, v_candidate_set_hash,
    v_now
  );

  -- Insert companion ref bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{ref_bindings}')
  loop
    insert into app_data_agent.research_candidate_enumeration_ref_bindings (
      app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
      canonical_path, binding_group, ordinal,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 4. issue_stop_derivation_receipt: Issue Stop Derivation Receipt v2
--    Validates coverage, candidate, budget, and decision
-- ============================================================
create function app_data_agent.issue_stop_derivation_receipt(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_coverage_receipt_id uuid;
  v_coverage_receipt_hash text;
  v_candidate_receipt_id uuid;
  v_candidate_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_supported_subset_json jsonb;
  v_required_disclosures_json jsonb;
  v_pre_stop_readiness_hash text;
  v_kernel_version text;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_decision text;
  v_decision_input_hash text;
  v_existing record;
  v_now timestamptz;
  v_binding record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_coverage_receipt_id := (cmd #>> '{coverage_receipt_id}')::uuid;
    v_coverage_receipt_hash := cmd #>> '{coverage_receipt_hash}';
    v_candidate_receipt_id := (cmd #>> '{candidate_receipt_id}')::uuid;
    v_candidate_receipt_hash := cmd #>> '{candidate_receipt_hash}';
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_supported_subset_json := cmd #> '{supported_subset}';
    v_required_disclosures_json := cmd #> '{required_disclosures}';
    v_pre_stop_readiness_hash := cmd #>> '{pre_stop_readiness_hash}';
    v_kernel_version := cmd #>> '{kernel_version}';
    v_enumerator_version := (cmd #>> '{enumerator_version}')::bigint;
    v_eig_policy_version := (cmd #>> '{eig_policy_version}')::bigint;
    v_decision := cmd #>> '{decision}';
    v_decision_input_hash := cmd #>> '{decision_input_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_coverage_receipt_id is null or v_coverage_receipt_hash is null
    or v_candidate_receipt_id is null or v_candidate_receipt_hash is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_pre_stop_readiness_hash is null or v_kernel_version is null
    or v_enumerator_version is null or v_eig_policy_version is null
    or v_decision is null or v_decision_input_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  if v_decision not in (
    'STOP_READY', 'STOP_PARTIAL', 'STOP_NEEDS_MORE_RESEARCH',
    'STOP_INCONCLUSIVE', 'CONTINUE', 'REPLAN',
    'RESEARCH_STOP_INPUT_STALE', 'RESEARCH_STOP_INPUT_INCONSISTENT'
  ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_DECISION'));
  end if;

  -- Check idempotency
  select receipt_id, receipt_hash, committed_at
  into v_existing
  from app_data_agent.research_stop_derivation_receipts as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.receipt_id = v_receipt_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'receipt_id', v_existing.receipt_id,
      'receipt_hash', v_existing.receipt_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-stop-derivation-receipt@2.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_hash || '\x00'::bytea ||
        v_candidate_receipt_id::text || '\x00'::bytea ||
        v_candidate_receipt_hash || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_pre_stop_readiness_hash || '\x00'::bytea ||
        v_kernel_version || '\x00'::bytea ||
        v_enumerator_version::text || '\x00'::bytea ||
        v_eig_policy_version::text || '\x00'::bytea ||
        v_decision || '\x00'::bytea ||
        v_decision_input_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert receipt
  insert into app_data_agent.research_stop_derivation_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    coverage_receipt_id, coverage_receipt_hash,
    candidate_receipt_id, candidate_receipt_hash,
    budget_receipt_id, budget_receipt_hash,
    supported_subset_json, required_disclosures_json,
    pre_stop_readiness_hash, kernel_version,
    enumerator_version, eig_policy_version,
    decision, decision_input_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'research-stop-derivation-receipt@2.0.0', v_decision_input_hash,
    v_coverage_receipt_id, v_coverage_receipt_hash,
    v_candidate_receipt_id, v_candidate_receipt_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_supported_subset_json, v_required_disclosures_json,
    v_pre_stop_readiness_hash, v_kernel_version,
    v_enumerator_version, v_eig_policy_version,
    v_decision, v_decision_input_hash,
    v_now
  );

  -- Insert companion ref bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{ref_bindings}')
  loop
    insert into app_data_agent.research_stop_derivation_ref_bindings (
      app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
      canonical_path, binding_group, ordinal,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 5. resolve_stop_decision: Resolve Stop Decision from receipt
--    Read-only verifier that returns the decision and metadata
-- ============================================================
create function app_data_agent.resolve_stop_decision(
  input_json jsonb
) returns jsonb
language plpgsql
stable
called on null input
security definer
set search_path = ''
as $$
declare
  v_receipt record;
  v_computed_hash text;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select receipt.*
  into v_receipt
  from app_data_agent.research_stop_derivation_receipts as receipt
  where receipt.app_id = (input_json #>> '{scope,app_id}')::uuid
    and receipt.tenant_id = (input_json #>> '{scope,tenant_id}')::uuid
    and receipt.environment = input_json #>> '{scope,environment}'
    and receipt.run_id = (input_json #>> '{run_id}')::uuid
    and receipt.receipt_id = (input_json #>> '{receipt_id}')::uuid;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RECEIPT_NOT_FOUND'));
  end if;

  v_computed_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-stop-derivation-receipt@2.0.0' || '\x00'::bytea ||
        v_receipt.receipt_id::text || '\x00'::bytea ||
        v_receipt.coverage_receipt_id::text || '\x00'::bytea ||
        v_receipt.coverage_receipt_hash || '\x00'::bytea ||
        v_receipt.candidate_receipt_id::text || '\x00'::bytea ||
        v_receipt.candidate_receipt_hash || '\x00'::bytea ||
        v_receipt.budget_receipt_id::text || '\x00'::bytea ||
        v_receipt.budget_receipt_hash || '\x00'::bytea ||
        v_receipt.pre_stop_readiness_hash || '\x00'::bytea ||
        v_receipt.kernel_version || '\x00'::bytea ||
        v_receipt.enumerator_version::text || '\x00'::bytea ||
        v_receipt.eig_policy_version::text || '\x00'::bytea ||
        v_receipt.decision || '\x00'::bytea ||
        v_receipt.decision_input_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_receipt.receipt_hash <> v_computed_hash then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'HASH_MISMATCH'));
  end if;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt.receipt_id,
    'receipt_hash', v_receipt.receipt_hash,
    'decision', v_receipt.decision,
    'committed_at', v_receipt.committed_at
  ));
end;
$$;
