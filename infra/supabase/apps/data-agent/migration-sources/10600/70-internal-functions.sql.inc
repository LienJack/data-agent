-- ============================================================
-- 10600: Internal helper functions
-- ============================================================

create function app_data_agent.u6_verify_receipt_hash(
  p_domain_prefix text,
  p_receipt_id uuid,
  p_receipt_hash text,
  p_components jsonb
) returns boolean
language plpgsql
stable
called on null input
security definer
set search_path = ''
as $$
declare
  v_computed_hash text;
  v_concatenated text;
  v_component record;
begin
  if p_domain_prefix is null or p_receipt_id is null
    or p_receipt_hash is null or p_components is null
    or jsonb_typeof(p_components) <> 'array'
  then
    return false;
  end if;

  v_concatenated := p_domain_prefix || '\x00'::bytea || p_receipt_id::text;

  for v_component in
    select value
    from jsonb_array_elements(p_components)
  loop
    if jsonb_typeof(v_component.value) = 'null' then
      return false;
    end if;
    v_concatenated := v_concatenated || '\x00'::bytea || (v_component.value #>> '{}');
  end loop;

  v_computed_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_concatenated, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  return v_computed_hash = p_receipt_hash;
end;
$$;

-- ============================================================
-- 2. u6_cleanup_environment: Clean up all C2 records for an environment
--    Internal function, called by cleanup job only
-- ============================================================

create function app_data_agent.issue_coverage_derivation_receipt_internal(
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
  v_now timestamptz;
  v_input_hash text;
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
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_input_hash := v_coverage_input_hash;

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

  insert into app_data_agent.research_coverage_derivation_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    budget_receipt_id, budget_receipt_hash,
    version_frontier_json, version_frontier_hash,
    closure_refs_json, coverage_input_hash, kernel_version,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'coverage-derivation-receipt@1.0.0', v_input_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_version_frontier_json, v_version_frontier_hash,
    v_closure_refs_json, v_coverage_input_hash, v_kernel_version,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 4. issue_candidate_enumeration_receipt_internal: Internal Candidate issuer
--    Called from Stop Root RPC, no public GRANT
-- ============================================================

create function app_data_agent.issue_candidate_enumeration_receipt_internal(
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
  v_enumeration_universe_hash text;
  v_candidate_set_hash text;
  v_now timestamptz;
  v_input_hash text;
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

  v_now := pg_catalog.clock_timestamp();
  v_input_hash := v_candidate_set_hash;

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

  insert into app_data_agent.research_candidate_enumeration_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    coverage_receipt_id, coverage_receipt_hash,
    budget_receipt_id, budget_receipt_hash,
    enumerator_head_version, enumerator_version, eig_policy_version,
    enumerator_capability_id, enumerator_authority_epoch,
    enumerator_attestation_id, enumerator_attestation_hash,
    enumeration_universe_hash, candidate_set_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'candidate-enumeration-receipt@2.0.0', v_input_hash,
    v_coverage_receipt_id, v_coverage_receipt_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_enumerator_head_version, v_enumerator_version, v_eig_policy_version,
    v_enumerator_capability_id, v_enumerator_authority_epoch,
    v_enumerator_attestation_id, v_enumerator_attestation_hash,
    v_enumeration_universe_hash, v_candidate_set_hash,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 5. issue_stop_derivation_receipt_internal: Internal Stop issuer
--    Called from Stop Root RPC, no public GRANT
-- ============================================================

create function app_data_agent.issue_stop_derivation_receipt_internal(
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
  v_pre_stop_readiness_hash text;
  v_kernel_version text;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_decision text;
  v_decision_input_hash text;
  v_now timestamptz;
  v_input_hash text;
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

  v_now := pg_catalog.clock_timestamp();
  v_input_hash := v_decision_input_hash;

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

  insert into app_data_agent.research_stop_derivation_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    coverage_receipt_id, coverage_receipt_hash,
    candidate_receipt_id, candidate_receipt_hash,
    budget_receipt_id, budget_receipt_hash,
    pre_stop_readiness_hash, kernel_version,
    enumerator_version, eig_policy_version,
    decision, decision_input_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'research-stop-derivation-receipt@2.0.0', v_input_hash,
    v_coverage_receipt_id, v_coverage_receipt_hash,
    v_candidate_receipt_id, v_candidate_receipt_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_pre_stop_readiness_hash, v_kernel_version,
    v_enumerator_version, v_eig_policy_version,
    v_decision, v_decision_input_hash,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now
  ));
end;
$$;
