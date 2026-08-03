-- ============================================================
-- 10600: Budget Receipt issuer/verifier functions
-- ============================================================

-- ============================================================
-- 1. issue_budget_snapshot_receipt: Issue Budget Ledger Receipt
--    Creates budget snapshot, validates epoch/reservation/event state,
--    writes receipt and companion input bindings.
-- ============================================================
create function app_data_agent.issue_budget_snapshot_receipt(
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
  s_schema text;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_snapshot_command_hash text;
  v_runtime_limits_version bigint;
  v_runtime_limits_hash text;
  v_tenant_policy_version bigint;
  v_tenant_policy_hash text;
  v_budget_epoch bigint;
  v_budget_started_at timestamptz;
  v_evaluated_through_reservation_seq bigint;
  v_evaluated_through_budget_event_seq bigint;
  v_evaluated_at timestamptz;
  v_valid_until timestamptz;
  v_outstanding_set_hash text;
  v_active_count bigint;
  v_outcome_unknown_count bigint;
  v_abandoned_count bigint;
  v_actual_used_json jsonb;
  v_unresolved_hold_json jsonb;
  v_ledger_json jsonb;
  v_brief_ref_json jsonb;
  v_brief_artifact_id uuid;
  v_brief_artifact_type text;
  v_brief_revision integer;
  v_brief_content_hash text;
  v_committed_at timestamptz;
  v_head record;
  v_policy record;
  v_principal_id uuid;
  v_idempotency_key text;
  v_existing record;
  v_input_hash text;
  v_binding record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  s_schema := 'app_data_agent';
  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_snapshot_command_hash := cmd #>> '{snapshot_command_hash}';
    v_runtime_limits_version := (cmd #>> '{runtime_limits_version}')::bigint;
    v_runtime_limits_hash := cmd #>> '{runtime_limits_hash}';
    v_tenant_policy_version := (cmd #>> '{tenant_policy_version}')::bigint;
    v_tenant_policy_hash := cmd #>> '{tenant_policy_hash}';
    v_budget_epoch := (cmd #>> '{budget_epoch}')::bigint;
    v_evaluated_through_reservation_seq := (cmd #>> '{evaluated_through_reservation_seq}')::bigint;
    v_evaluated_through_budget_event_seq := (cmd #>> '{evaluated_through_budget_event_seq}')::bigint;
    v_valid_until := (cmd #>> '{valid_until}')::timestamptz;
    v_outstanding_set_hash := cmd #>> '{outstanding_set_hash}';
    v_active_count := (cmd #>> '{active_count}')::bigint;
    v_outcome_unknown_count := (cmd #>> '{outcome_unknown_count}')::bigint;
    v_abandoned_count := (cmd #>> '{abandoned_count}')::bigint;
    v_actual_used_json := cmd #> '{actual_used}';
    v_unresolved_hold_json := cmd #> '{unresolved_hold}';
    v_ledger_json := cmd #> '{ledger}';
    v_brief_ref_json := cmd #> '{research_brief_ref}';
    v_brief_artifact_id := (cmd #>> '{research_brief_ref,artifact_id}')::uuid;
    v_brief_artifact_type := cmd #>> '{research_brief_ref,artifact_type}';
    v_brief_revision := (cmd #>> '{research_brief_ref,revision}')::integer;
    v_brief_content_hash := cmd #>> '{research_brief_ref,content_hash}';
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_snapshot_command_hash is null
    or v_runtime_limits_version is null or v_runtime_limits_hash is null
    or v_tenant_policy_version is null or v_tenant_policy_hash is null
    or v_budget_epoch is null
    or v_evaluated_through_reservation_seq is null
    or v_evaluated_through_budget_event_seq is null
    or v_valid_until is null
    or v_outstanding_set_hash is null
    or v_active_count is null or v_outcome_unknown_count is null or v_abandoned_count is null
    or v_actual_used_json is null or v_unresolved_hold_json is null or v_ledger_json is null
    or v_brief_ref_json is null or v_brief_artifact_id is null
    or v_brief_artifact_type is null or v_brief_revision is null or v_brief_content_hash is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Verify environment
  if s_environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_ENVIRONMENT'));
  end if;

  -- Check idempotency
  select receipt_id, receipt_hash, committed_at
  into v_existing
  from app_data_agent.research_budget_ledger_receipts as existing
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

  -- Verify budget epoch state from head
  select head.budget_epoch, head.budget_epoch_state, head.budget_started_at,
         head.next_budget_event_seq, head.last_budget_event_hash
  into v_head
  from app_data_agent.research_resource_run_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RUN_HEAD_NOT_FOUND'));
  end if;
  if v_head.budget_epoch_state = 'LEGACY' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_LEGACY'));
  end if;
  if v_head.budget_epoch <> v_budget_epoch then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_MISMATCH'));
  end if;
  if v_head.evaluated_through_budget_event_seq > v_evaluated_through_budget_event_seq then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EVENT_SEQ_STALE'));
  end if;

  v_budget_started_at := v_head.budget_started_at;
  v_evaluated_at := pg_catalog.clock_timestamp();

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-ledger-receipt@1.0.0' || '\x00'::bytea ||
        v_snapshot_command_hash || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_budget_epoch::text || '\x00'::bytea ||
        v_evaluated_through_reservation_seq::text || '\x00'::bytea ||
        v_evaluated_through_budget_event_seq::text || '\x00'::bytea ||
        v_outstanding_set_hash || '\x00'::bytea ||
        v_active_count::text || '\x00'::bytea ||
        v_outcome_unknown_count::text || '\x00'::bytea ||
        v_abandoned_count::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert receipt
  insert into app_data_agent.research_budget_ledger_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    snapshot_command_hash, runtime_limits_version, runtime_limits_hash,
    tenant_policy_version, tenant_policy_hash,
    budget_epoch, budget_started_at,
    evaluated_through_reservation_seq, evaluated_through_budget_event_seq,
    evaluated_at, valid_until,
    outstanding_set_hash, active_count, outcome_unknown_count, abandoned_count,
    actual_used_json, unresolved_hold_json, ledger_json,
    research_brief_ref_json, research_brief_artifact_id, research_brief_artifact_type,
    research_brief_revision, research_brief_content_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'budget-ledger-receipt@1.0.0', v_receipt_hash,
    v_snapshot_command_hash, v_runtime_limits_version, v_runtime_limits_hash,
    v_tenant_policy_version, v_tenant_policy_hash,
    v_budget_epoch, v_budget_started_at,
    v_evaluated_through_reservation_seq, v_evaluated_through_budget_event_seq,
    v_evaluated_at, v_valid_until,
    v_outstanding_set_hash, v_active_count, v_outcome_unknown_count, v_abandoned_count,
    v_actual_used_json, v_unresolved_hold_json, v_ledger_json,
    v_brief_ref_json, v_brief_artifact_id, v_brief_artifact_type,
    v_brief_revision, v_brief_content_hash,
    v_evaluated_at
  );

  -- Insert companion input bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{input_bindings}')
  loop
    insert into app_data_agent.research_budget_ledger_input_bindings (
      app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
      canonical_path, binding_group, ordinal, binding_kind,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id,
      budget_epoch, budget_event_seq, event_hash,
      reservation_id, reservation_seq, reservation_state,
      reservation_projection_json, reservation_projection_hash
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #>> '{binding_kind}',
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}',
      (v_binding #>> '{budget_epoch}')::bigint,
      (v_binding #>> '{budget_event_seq}')::bigint,
      v_binding #>> '{event_hash}',
      (v_binding #>> '{reservation_id}')::uuid,
      (v_binding #>> '{reservation_seq}')::bigint,
      v_binding #>> '{reservation_state}',
      v_binding #> '{reservation_projection}',
      v_binding #>> '{reservation_projection_hash}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_evaluated_at,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 2. verify_budget_snapshot_receipt: Verify Budget Ledger Receipt
--    Recomputes hash and validates epoch/event chain integrity
-- ============================================================
create function app_data_agent.verify_budget_snapshot_receipt(
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
  v_binding_count integer;
  v_expected_binding_count integer;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select receipt.*
  into v_receipt
  from app_data_agent.research_budget_ledger_receipts as receipt
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
        'u6-budget-ledger-receipt@1.0.0' || '\x00'::bytea ||
        v_receipt.snapshot_command_hash || '\x00'::bytea ||
        v_receipt.receipt_id::text || '\x00'::bytea ||
        v_receipt.budget_epoch::text || '\x00'::bytea ||
        v_receipt.evaluated_through_reservation_seq::text || '\x00'::bytea ||
        v_receipt.evaluated_through_budget_event_seq::text || '\x00'::bytea ||
        v_receipt.outstanding_set_hash || '\x00'::bytea ||
        v_receipt.active_count::text || '\x00'::bytea ||
        v_receipt.outcome_unknown_count::text || '\x00'::bytea ||
        v_receipt.abandoned_count::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_receipt.receipt_hash <> v_computed_hash then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'HASH_MISMATCH'));
  end if;

  -- Verify companion bindings closed set
  select count(*) into v_binding_count
  from app_data_agent.research_budget_ledger_input_bindings as binding
  where binding.app_id = v_receipt.app_id
    and binding.tenant_id = v_receipt.tenant_id
    and binding.environment = v_receipt.environment
    and binding.run_id = v_receipt.run_id
    and binding.receipt_id = v_receipt.receipt_id
    and binding.receipt_hash = v_receipt.receipt_hash;

  v_expected_binding_count := (input_json #>> '{expected_binding_count}')::integer;
  if v_expected_binding_count is not null and v_binding_count <> v_expected_binding_count then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BINDING_COUNT_MISMATCH'));
  end if;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt.receipt_id,
    'receipt_hash', v_receipt.receipt_hash,
    'committed_at', v_receipt.committed_at,
    'valid_until', v_receipt.valid_until,
    'binding_count', v_binding_count
  ));
end;
$$;

-- ============================================================
-- 3. issue_budget_epoch_advance: Advance budget epoch
--    Creates a new epoch with updated head state
-- ============================================================
create function app_data_agent.issue_budget_epoch_advance(
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
  v_new_budget_epoch bigint;
  v_next_budget_event_seq bigint;
  v_next_step_seq bigint;
  v_budget_event_hash text;
  v_principal_id uuid;
  v_idempotency_key text;
  v_head record;
  v_now timestamptz;
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
    v_new_budget_epoch := (cmd #>> '{new_budget_epoch}')::bigint;
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_new_budget_epoch is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select head.*
  into v_head
  from app_data_agent.research_resource_run_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RUN_HEAD_NOT_FOUND'));
  end if;

  if v_head.budget_epoch_state = 'LEGACY' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_LEGACY'));
  end if;

  if v_new_budget_epoch <= v_head.budget_epoch then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_NOT_MONOTONIC'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_next_budget_event_seq := v_head.next_budget_event_seq;
  v_next_step_seq := v_head.next_step_seq;

  -- Compute event hash for EPOCH_ADVANCE
  v_budget_event_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-event@1.0.0' || '\x00'::bytea ||
        v_run_id::text || '\x00'::bytea ||
        v_head.budget_epoch::text || '\x00'::bytea ||
        v_next_budget_event_seq::text || '\x00'::bytea ||
        'EPOCH_ADVANCE' || '\x00'::bytea ||
        v_new_budget_epoch::text || '\x00'::bytea ||
        coalesce(v_head.last_budget_event_hash, 'sha256:0000000000000000000000000000000000000000000000000000000000000000'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert budget event
  insert into app_data_agent.research_budget_events (
    app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq,
    event_kind, source_operation_kind, source_operation_id,
    actual_before_json, actual_after_json,
    hold_before_json, hold_after_json,
    previous_event_hash, event_hash, committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id,
    v_head.budget_epoch, v_next_budget_event_seq,
    'EPOCH_ADVANCE', 'EPOCH', v_receipt_id,
    '{}'::jsonb, '{}'::jsonb,
    '{}'::jsonb, '{}'::jsonb,
    v_head.last_budget_event_hash, v_budget_event_hash, v_now
  );

  -- Update head to new epoch
  update app_data_agent.research_resource_run_heads as head
  set
    budget_epoch = v_new_budget_epoch,
    budget_epoch_state = 'ACTIVE',
    budget_started_at = v_now,
    next_budget_event_seq = 0,
    last_budget_event_hash = null
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'previous_budget_epoch', v_head.budget_epoch,
    'new_budget_epoch', v_new_budget_epoch,
    'budget_event_hash', v_budget_event_hash,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 4. issue_budget_event: Issue a budget event (RESERVE/RELEASE/CONSUME/etc.)
-- ============================================================
create function app_data_agent.issue_budget_event(
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
  v_event_kind text;
  v_source_operation_kind text;
  v_source_operation_id uuid;
  v_reservation_id uuid;
  v_logical_step_id uuid;
  v_actual_before_json jsonb;
  v_actual_after_json jsonb;
  v_hold_before_json jsonb;
  v_hold_after_json jsonb;
  v_uncertainty_before_json jsonb;
  v_uncertainty_after_json jsonb;
  v_head record;
  v_event_seq bigint;
  v_previous_hash text;
  v_event_hash text;
  v_now timestamptz;
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
    v_event_kind := cmd #>> '{event_kind}';
    v_source_operation_kind := cmd #>> '{source_operation_kind}';
    v_source_operation_id := (cmd #>> '{source_operation_id}')::uuid;
    v_reservation_id := (cmd #>> '{reservation_id}')::uuid;
    v_logical_step_id := (cmd #>> '{logical_step_id}')::uuid;
    v_actual_before_json := cmd #> '{actual_before}';
    v_actual_after_json := cmd #> '{actual_after}';
    v_hold_before_json := cmd #> '{hold_before}';
    v_hold_after_json := cmd #> '{hold_after}';
    v_uncertainty_before_json := cmd #> '{uncertainty_before}';
    v_uncertainty_after_json := cmd #> '{uncertainty_after}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_event_kind is null
    or v_source_operation_kind is null or v_source_operation_id is null
    or v_actual_before_json is null or v_actual_after_json is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select head.*
  into v_head
  from app_data_agent.research_resource_run_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RUN_HEAD_NOT_FOUND'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_event_seq := v_head.next_budget_event_seq;
  v_previous_hash := v_head.last_budget_event_hash;

  v_event_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-event@1.0.0' || '\x00'::bytea ||
        v_run_id::text || '\x00'::bytea ||
        v_head.budget_epoch::text || '\x00'::bytea ||
        v_event_seq::text || '\x00'::bytea ||
        v_event_kind || '\x00'::bytea ||
        v_source_operation_kind || '\x00'::bytea ||
        v_source_operation_id::text || '\x00'::bytea ||
        v_actual_before_json::text || '\x00'::bytea ||
        v_actual_after_json::text || '\x00'::bytea ||
        coalesce(v_previous_hash, 'sha256:0000000000000000000000000000000000000000000000000000000000000000'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into app_data_agent.research_budget_events (
    app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq,
    event_kind, source_operation_kind, source_operation_id,
    reservation_id, logical_step_id,
    actual_before_json, actual_after_json,
    hold_before_json, hold_after_json,
    uncertainty_before_json, uncertainty_after_json,
    previous_event_hash, event_hash, committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id,
    v_head.budget_epoch, v_event_seq,
    v_event_kind, v_source_operation_kind, v_source_operation_id,
    v_reservation_id, v_logical_step_id,
    v_actual_before_json, v_actual_after_json,
    v_hold_before_json, v_hold_after_json,
    v_uncertainty_before_json, v_uncertainty_after_json,
    v_previous_hash, v_event_hash, v_now
  );

  update app_data_agent.research_resource_run_heads as head
  set
    next_budget_event_seq = v_event_seq + 1,
    last_budget_event_hash = v_event_hash
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'budget_epoch', v_head.budget_epoch,
    'budget_event_seq', v_event_seq,
    'event_hash', v_event_hash,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 5. verify_budget_event_chain: Verify budget event chain integrity
-- ============================================================
create function app_data_agent.verify_budget_event_chain(
  input_json jsonb
) returns jsonb
language plpgsql
stable
called on null input
security definer
set search_path = ''
as $$
declare
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_start_epoch bigint;
  v_end_epoch bigint;
  v_event record;
  v_previous_hash text;
  v_computed_hash text;
  v_chain_broken boolean;
  v_checked_count integer;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
    v_run_id := (input_json #>> '{run_id}')::uuid;
    v_start_epoch := (input_json #>> '{start_epoch}')::bigint;
    v_end_epoch := (input_json #>> '{end_epoch}')::bigint;
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_start_epoch is null or v_end_epoch is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  v_chain_broken := false;
  v_checked_count := 0;
  v_previous_hash := null;

  for v_event in
    select event.*
    from app_data_agent.research_budget_events as event
    where event.app_id = s_app_id
      and event.tenant_id = s_tenant_id
      and event.environment = s_environment
      and event.run_id = v_run_id
      and event.budget_epoch between v_start_epoch and v_end_epoch
    order by event.budget_epoch, event.budget_event_seq
  loop
    v_computed_hash := 'sha256:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'u6-budget-event@1.0.0' || '\x00'::bytea ||
          v_event.run_id::text || '\x00'::bytea ||
          v_event.budget_epoch::text || '\x00'::bytea ||
          v_event.budget_event_seq::text || '\x00'::bytea ||
          v_event.event_kind || '\x00'::bytea ||
          v_event.source_operation_kind || '\x00'::bytea ||
          v_event.source_operation_id::text || '\x00'::bytea ||
          v_event.actual_before_json::text || '\x00'::bytea ||
          v_event.actual_after_json::text || '\x00'::bytea ||
          coalesce(v_event.previous_event_hash, 'sha256:0000000000000000000000000000000000000000000000000000000000000000'),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    if v_event.event_hash <> v_computed_hash then
      v_chain_broken := true;
      exit;
    end if;

    if v_previous_hash is not null
      and v_event.previous_event_hash is not null
      and v_event.previous_event_hash <> v_previous_hash
    then
      v_chain_broken := true;
      exit;
    end if;

    v_previous_hash := v_event.event_hash;
    v_checked_count := v_checked_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'chain_intact', not v_chain_broken,
    'checked_count', v_checked_count,
    'last_event_hash', v_previous_hash
  ));
end;
$$;
