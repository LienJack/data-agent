-- ============================================================
-- 10600: Stop Root RPCs
-- ============================================================

drop function if exists app_data_agent.commit_research_stop_terminal(jsonb);
create or replace function app_data_agent.commit_research_stop_terminal(
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
  v_stop_receipt_id uuid;
  v_stop_receipt_hash text;
  v_terminal_decision text;
  v_principal_id uuid;
  v_idempotency_key text;
  v_stop_receipt record;
  v_existing record;
  v_now timestamptz;
  v_terminal text;
  v_reason_code text;
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
    v_stop_receipt_id := (cmd #>> '{stop_receipt_id}')::uuid;
    v_stop_receipt_hash := cmd #>> '{stop_receipt_hash}';
    v_terminal_decision := cmd #>> '{terminal_decision}';
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_stop_receipt_id is null or v_stop_receipt_hash is null
    or v_terminal_decision is null or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Resolve terminal and reason code from decision
  case v_terminal_decision
    when 'STOP_PARTIAL' then
      v_terminal := 'PARTIAL';
      v_reason_code := 'EVIDENCE_PARTIAL';
    when 'STOP_NEEDS_MORE_RESEARCH' then
      v_terminal := 'NEEDS_MORE_RESEARCH';
      v_reason_code := 'EVIDENCE_COVERAGE_INSUFFICIENT';
    when 'STOP_INCONCLUSIVE' then
      v_terminal := 'INCONCLUSIVE';
      v_reason_code := 'ANALYSIS_INCONCLUSIVE';
    else
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_TERMINAL_DECISION'));
  end case;

  -- Check idempotency
  select terminal.*
  into v_existing
  from app_data_agent.research_domain_terminals as terminal
  where terminal.app_id = s_app_id
    and terminal.tenant_id = s_tenant_id
    and terminal.environment = s_environment
    and terminal.run_id = v_run_id
    and terminal.authority_kind = 'RESEARCH_STOP';
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'run_id', v_run_id,
      'terminal', v_existing.terminal,
      'reason_code', v_existing.reason_code,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Verify stop receipt exists and hash matches
  select receipt.*
  into v_stop_receipt
  from app_data_agent.research_stop_derivation_receipts as receipt
  where receipt.app_id = s_app_id
    and receipt.tenant_id = s_tenant_id
    and receipt.environment = s_environment
    and receipt.run_id = v_run_id
    and receipt.receipt_id = v_stop_receipt_id
    and receipt.receipt_hash = v_stop_receipt_hash;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'STOP_RECEIPT_NOT_FOUND'));
  end if;

  -- Verify decision matches
  if v_stop_receipt.decision <> v_terminal_decision then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'DECISION_MISMATCH'));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Insert stop terminal commit
  insert into app_data_agent.research_stop_terminal_commits (
    app_id, tenant_id, environment, run_id, commit_id, operation_json,
    stop_derivation_receipt_id, stop_derivation_receipt_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id,
    extensions.gen_random_uuid(),
    jsonb_build_object(
      'protocol_version', 'research-stop-terminal-commit@2.0.0',
      'payload', jsonb_build_object(
        'terminal', v_terminal,
        'reason_code', v_reason_code,
        'stop_receipt_id', v_stop_receipt_id,
        'stop_receipt_hash', v_stop_receipt_hash,
        'principal_id', v_principal_id
      )
    ),
    v_stop_receipt_id, v_stop_receipt_hash,
    v_now
  );

  -- Insert domain terminal
  insert into app_data_agent.research_domain_terminals (
    app_id, tenant_id, environment, run_id, terminal_id,
    authority_kind, terminal, reason_code,
    operation_json,
    stop_derivation_receipt_id, stop_derivation_receipt_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id,
    extensions.gen_random_uuid(),
    'RESEARCH_STOP', v_terminal, v_reason_code,
    jsonb_build_object(
      'protocol_version', 'research-domain-terminal@2.0.0',
      'payload', jsonb_build_object(
        'terminal', v_terminal,
        'reason_code', v_reason_code,
        'stop_receipt_id', v_stop_receipt_id,
        'stop_receipt_hash', v_stop_receipt_hash,
        'principal_id', v_principal_id
      )
    ),
    v_stop_receipt_id, v_stop_receipt_hash,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'run_id', v_run_id,
    'terminal', v_terminal,
    'reason_code', v_reason_code,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 2. publish_current_readiness: Publish Current Readiness (CURRENT)
--    Validates frontier, certificate, and creates CURRENT readiness
-- ============================================================

create function app_data_agent.publish_current_readiness(
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
  v_readiness_publication_id uuid;
  v_certificate_ref_json jsonb;
  v_certificate_artifact_id uuid;
  v_certificate_artifact_type text;
  v_certificate_revision integer;
  v_certificate_content_hash text;
  v_principal_id uuid;
  v_idempotency_key text;
  v_frontier_hash text;
  v_existing_readiness record;
  v_now timestamptz;
  v_readiness_id uuid;
  v_publication_id uuid;
  v_certificate record;
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
    v_readiness_publication_id := (cmd #>> '{readiness_publication_id}')::uuid;
    v_certificate_ref_json := cmd #> '{certificate_ref}';
    v_certificate_artifact_id := (cmd #>> '{certificate_ref,artifact_id}')::uuid;
    v_certificate_artifact_type := cmd #>> '{certificate_ref,artifact_type}';
    v_certificate_revision := (cmd #>> '{certificate_ref,revision}')::integer;
    v_certificate_content_hash := cmd #>> '{certificate_ref,content_hash}';
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
    v_frontier_hash := cmd #>> '{frontier_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_readiness_publication_id is null
    or v_certificate_ref_json is null or v_certificate_artifact_id is null
    or v_certificate_artifact_type is null or v_certificate_revision is null
    or v_certificate_content_hash is null
    or v_principal_id is null or v_idempotency_key is null
    or v_frontier_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Lock current readiness for CAS
  select readiness.*
  into v_existing_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for update;

  -- Only ABSENT or REVOKED can become CURRENT
  if found and v_existing_readiness.state = 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ALREADY_CURRENT'));
  end if;

  -- Verify domain terminal is READY
  select terminal.*
  into v_head
  from app_data_agent.research_domain_terminals as terminal
  where terminal.app_id = s_app_id
    and terminal.tenant_id = s_tenant_id
    and terminal.environment = s_environment
    and terminal.run_id = v_run_id
    and terminal.terminal = 'READY';
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'NO_READY_TERMINAL'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_readiness_id := extensions.gen_random_uuid();
  v_publication_id := v_readiness_publication_id;

  -- Insert or update current readiness
  if not found then
    insert into app_data_agent.research_current_readiness (
      app_id, tenant_id, environment, run_id, readiness_id,
      state, certificate_ref_json, certificate_artifact_id,
      certificate_artifact_type, certificate_revision, certificate_content_hash,
      frontier_hash, authority_epoch, publication_id,
      committed_at, revoked_at
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_readiness_id,
      'CURRENT', v_certificate_ref_json, v_certificate_artifact_id,
      v_certificate_artifact_type, v_certificate_revision, v_certificate_content_hash,
      v_frontier_hash, 0, v_publication_id,
      v_now, null
    );
  else
    update app_data_agent.research_current_readiness as readiness
    set
      state = 'CURRENT',
      readiness_id = v_readiness_id,
      certificate_ref_json = v_certificate_ref_json,
      certificate_artifact_id = v_certificate_artifact_id,
      certificate_artifact_type = v_certificate_artifact_type,
      certificate_revision = v_certificate_revision,
      certificate_content_hash = v_certificate_content_hash,
      frontier_hash = v_frontier_hash,
      authority_epoch = v_existing_readiness.authority_epoch + 1,
      publication_id = v_publication_id,
      committed_at = v_now,
      revoked_at = null
    where readiness.app_id = s_app_id
      and readiness.tenant_id = s_tenant_id
      and readiness.environment = s_environment
      and readiness.run_id = v_run_id;
  end if;

  -- Insert readiness publication
  insert into app_data_agent.research_readiness_publications (
    app_id, tenant_id, environment, run_id, publication_id,
    readiness_id, state, certificate_ref_json, certificate_artifact_id,
    certificate_artifact_type, certificate_revision, certificate_content_hash,
    frontier_hash, authority_epoch, principal_id, idempotency_key,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_publication_id,
    v_readiness_id, 'CURRENT', v_certificate_ref_json, v_certificate_artifact_id,
    v_certificate_artifact_type, v_certificate_revision, v_certificate_content_hash,
    v_frontier_hash, 0, v_principal_id, v_idempotency_key,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'readiness_id', v_readiness_id,
    'publication_id', v_publication_id,
    'state', 'CURRENT',
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 3. consume_current_ready: Consume Current Readiness (DOMAIN_TERMINAL)
--    Validates CURRENT state, creates READY domain terminal, marks consumed
-- ============================================================

drop function if exists app_data_agent.consume_current_ready(jsonb);
create or replace function app_data_agent.consume_current_ready(
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
  v_consumption_id uuid;
  v_principal_id uuid;
  v_idempotency_key text;
  v_readiness record;
  v_existing_consumption record;
  v_now timestamptz;
  v_terminal_id uuid;
  v_certificate record;
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
    v_consumption_id := (cmd #>> '{consumption_id}')::uuid;
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_consumption_id is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Check for existing consumption
  select consumption.*
  into v_existing_consumption
  from app_data_agent.research_readiness_consumptions as consumption
  where consumption.app_id = s_app_id
    and consumption.tenant_id = s_tenant_id
    and consumption.environment = s_environment
    and consumption.run_id = v_run_id
    and consumption.principal_id = v_principal_id
    and consumption.idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'run_id', v_run_id,
      'terminal', 'READY',
      'committed_at', v_existing_consumption.committed_at,
      'created', false
    ));
  end if;

  -- Lock and verify current readiness
  select readiness.*
  into v_readiness
  from app_data_agent.current_report_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'NO_CURRENT_READINESS'));
  end if;
  if v_readiness.state <> 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'READINESS_NOT_CURRENT'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_terminal_id := extensions.gen_random_uuid();

  -- Insert domain terminal
  insert into app_data_agent.research_domain_terminals (
    app_id, tenant_id, environment, run_id, terminal_id,
    authority_kind, terminal, reason_code,
    operation_json,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_terminal_id,
    'CURRENT_READINESS', 'READY', 'RUN_READY',
    jsonb_build_object(
      'protocol_version', 'research-domain-terminal@2.0.0',
      'payload', jsonb_build_object(
        'terminal', 'READY',
        'reason_code', 'RUN_READY',
        'principal_id', v_principal_id,
        'readiness_id', v_readiness.readiness_id
      )
    ),
    v_now
  );

  -- Insert consumption
  insert into app_data_agent.research_readiness_consumptions (
    app_id, tenant_id, environment, run_id, consumption_id,
    readiness_id, terminal_id,
    principal_id, idempotency_key,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_consumption_id,
    v_readiness.readiness_id, v_terminal_id,
    v_principal_id, v_idempotency_key,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'run_id', v_run_id,
    'terminal', 'READY',
    'terminal_id', v_terminal_id,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 4. grant_issue: Issue a Report Read Grant
-- ============================================================
