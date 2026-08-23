-- ============================================================
-- 10600: Resource/Invocation functions for C2a derivation layer
-- ============================================================

-- ============================================================
-- 1. begin_research_step: Begin a research step
--    Creates step operation, advances budget epoch, ties to outbox/attempt
-- ============================================================
create function app_data_agent.begin_research_step(
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
  v_step_operation_id uuid;
  v_budget_epoch bigint;
  v_logical_step_id uuid;
  v_parent_logical_step_id uuid;
  v_step_seq bigint;
  v_step_kind text;
  v_step_input_hash text;
  v_outbox_id uuid;
  v_attempt_id uuid;
  v_worker_fence bigint;
  v_principal_id uuid;
  v_idempotency_key text;
  v_head record;
  v_existing record;
  v_now timestamptz;
  v_budget_event_seq bigint;
  v_budget_event_hash text;
  v_attempt record;
  v_outbox record;
  v_run record;
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
    v_step_operation_id := (cmd #>> '{step_operation_id}')::uuid;
    v_budget_epoch := (cmd #>> '{budget_epoch}')::bigint;
    v_logical_step_id := (cmd #>> '{logical_step_id}')::uuid;
    v_parent_logical_step_id := (cmd #>> '{parent_logical_step_id}')::uuid;
    v_step_seq := (cmd #>> '{step_seq}')::bigint;
    v_step_kind := cmd #>> '{step_kind}';
    v_step_input_hash := cmd #>> '{step_input_hash}';
    v_outbox_id := (cmd #>> '{outbox_id}')::uuid;
    v_attempt_id := (cmd #>> '{attempt_id}')::uuid;
    v_worker_fence := (cmd #>> '{worker_fence}')::bigint;
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_step_operation_id is null
    or v_budget_epoch is null or v_logical_step_id is null
    or v_step_seq is null or v_step_kind is null
    or v_step_input_hash is null
    or v_outbox_id is null or v_attempt_id is null
    or v_worker_fence is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  if v_step_kind not in (
    'PLAN', 'QUERY', 'EVIDENCE', 'CLAIM', 'ASSESSMENT',
    'COVERAGE', 'STOP', 'REPORT', 'CLARIFICATION', 'REPLAN'
  ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_STEP_KIND'));
  end if;

  -- Check idempotency
  select step_operation_id, committed_at
  into v_existing
  from app_data_agent.research_step_operations as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'step_operation_id', v_existing.step_operation_id,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Lock run
  select run.*
  into v_run
  from app_data_agent.runs as run
  where run.app_id = s_app_id
    and run.tenant_id = s_environment
    and run.environment = s_environment
    and run.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RUN_NOT_FOUND'));
  end if;

  -- Lock outbox and attempt
  select outbox.*
  into v_outbox
  from app_data_agent.outbox as outbox
  where outbox.app_id = s_app_id
    and outbox.tenant_id = s_tenant_id
    and outbox.environment = s_environment
    and outbox.outbox_id = v_outbox_id
    and outbox.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'OUTBOX_NOT_FOUND'));
  end if;

  select attempt.*
  into v_attempt
  from app_data_agent.run_attempts as attempt
  where attempt.app_id = s_app_id
    and attempt.tenant_id = s_tenant_id
    and attempt.environment = s_environment
    and attempt.attempt_id = v_attempt_id
    and attempt.outbox_id = v_outbox_id
    and attempt.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ATTEMPT_NOT_FOUND'));
  end if;

  if v_attempt.worker_fence <> v_worker_fence then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'WORKER_FENCE_MISMATCH'));
  end if;

  -- Lock resource run head
  select head.*
  into v_head
  from app_data_agent.research_resource_run_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RESOURCE_HEAD_NOT_FOUND'));
  end if;

  if v_head.budget_epoch <> v_budget_epoch then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_MISMATCH'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_budget_event_seq := v_head.next_budget_event_seq;
  v_budget_event_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-event@1.0.0' || '\x00'::bytea ||
        v_run_id::text || '\x00'::bytea ||
        v_budget_epoch::text || '\x00'::bytea ||
        v_budget_event_seq::text || '\x00'::bytea ||
        'RESERVE' || '\x00'::bytea ||
        'STEP' || '\x00'::bytea ||
        v_step_operation_id::text || '\x00'::bytea ||
        v_head.last_budget_event_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert step operation
  insert into app_data_agent.research_step_operations (
    app_id, tenant_id, environment, step_operation_id,
    run_id, budget_epoch, logical_step_id, parent_logical_step_id,
    step_seq, step_kind, step_input_hash,
    outbox_id, attempt_id, worker_fence,
    budget_event_seq, budget_event_hash,
    principal_id, idempotency_key,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_step_operation_id,
    v_run_id, v_budget_epoch, v_logical_step_id, v_parent_logical_step_id,
    v_step_seq, v_step_kind, v_step_input_hash,
    v_outbox_id, v_attempt_id, v_worker_fence,
    v_budget_event_seq, v_budget_event_hash,
    v_principal_id, v_idempotency_key,
    v_now
  );

  -- Update resource run head
  update app_data_agent.research_resource_run_heads as head
  set
    next_step_seq = v_step_seq + 1,
    next_budget_event_seq = v_budget_event_seq + 1,
    last_budget_event_hash = v_budget_event_hash
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'step_operation_id', v_step_operation_id,
    'budget_event_seq', v_budget_event_seq,
    'budget_event_hash', v_budget_event_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 2. issue_input_event_watermark_receipt_internal: Issue Input Event Watermark Receipt
--    Internal function, called from Root RPCs only
-- ============================================================
create function app_data_agent.issue_input_event_watermark_receipt_internal(
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
  v_observed_event_seq bigint;
  v_observed_head_hash text;
  v_certificate_input_closure_hash text;
  v_certificate_ref_json jsonb;
  v_certificate_artifact_id uuid;
  v_certificate_artifact_type text;
  v_certificate_revision integer;
  v_certificate_content_hash text;
  v_now timestamptz;
  v_input_hash text;
  v_head record;
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
    v_observed_event_seq := (cmd #>> '{observed_event_seq}')::bigint;
    v_observed_head_hash := cmd #>> '{observed_head_hash}';
    v_certificate_input_closure_hash := cmd #>> '{certificate_input_closure_hash}';
    v_certificate_ref_json := cmd #> '{certificate_ref}';
    v_certificate_artifact_id := (cmd #>> '{certificate_ref,artifact_id}')::uuid;
    v_certificate_artifact_type := cmd #>> '{certificate_ref,artifact_type}';
    v_certificate_revision := (cmd #>> '{certificate_ref,revision}')::integer;
    v_certificate_content_hash := cmd #>> '{certificate_ref,content_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_observed_event_seq is null or v_observed_head_hash is null
    or v_certificate_input_closure_hash is null
    or v_certificate_ref_json is null or v_certificate_artifact_id is null
    or v_certificate_artifact_type is null or v_certificate_revision is null
    or v_certificate_content_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Verify input event head
  select head.*
  into v_head
  from app_data_agent.research_input_event_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INPUT_EVENT_HEAD_NOT_FOUND'));
  end if;

  if v_head.head_event_hash <> v_observed_head_hash then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'HEAD_HASH_MISMATCH'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_input_hash := v_certificate_input_closure_hash;

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-input-event-watermark-receipt@1.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_observed_event_seq::text || '\x00'::bytea ||
        v_observed_head_hash || '\x00'::bytea ||
        v_certificate_input_closure_hash || '\x00'::bytea ||
        v_certificate_artifact_id::text || '\x00'::bytea ||
        v_certificate_artifact_type || '\x00'::bytea ||
        v_certificate_revision::text || '\x00'::bytea ||
        v_certificate_content_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert watermark receipt
  insert into app_data_agent.research_input_event_watermark_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    observed_event_seq, observed_head_hash, certificate_input_closure_hash,
    certificate_ref_json, certificate_artifact_id,
    certificate_artifact_type, certificate_revision, certificate_content_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'input-event-watermark-receipt@1.0.0', v_input_hash,
    v_observed_event_seq, v_observed_head_hash, v_certificate_input_closure_hash,
    v_certificate_ref_json, v_certificate_artifact_id,
    v_certificate_artifact_type, v_certificate_revision, v_certificate_content_hash,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;
