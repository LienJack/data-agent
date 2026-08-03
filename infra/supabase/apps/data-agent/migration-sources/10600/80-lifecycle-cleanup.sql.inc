-- ============================================================
-- 10600: Lifecycle cleanup
-- ============================================================

create function app_data_agent.u6_cleanup_environment(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_deleted_records bigint;
  v_total_deleted bigint := 0;
  v_deleted_tables text[];
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Child-first cleanup: companion tables first, then parent tables

  -- 1. Companion tables
  delete from app_data_agent.research_stop_derivation_ref_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_candidate_enumeration_ref_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_candidate_attestation_ref_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_coverage_derivation_ref_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_budget_ledger_input_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 2. Watermark receipts
  delete from app_data_agent.research_input_event_watermark_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 3. Stop receipts
  delete from app_data_agent.research_stop_derivation_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 4. Candidate receipts
  delete from app_data_agent.research_candidate_enumeration_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 5. Attestations
  delete from app_data_agent.research_candidate_enumerator_attestations
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 6. Coverage receipts
  delete from app_data_agent.research_coverage_derivation_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 7. Budget ledger receipts
  delete from app_data_agent.research_budget_ledger_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 8. Backend artifact commit operations
  delete from app_data_agent.research_backend_artifact_commit_operations
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 9. Input events
  delete from app_data_agent.research_input_events
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 10. Input event heads
  delete from app_data_agent.research_input_event_heads
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 11. Step operations
  delete from app_data_agent.research_step_operations
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 12. Budget events
  delete from app_data_agent.research_budget_events
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 13. Budget policy heads / versions
  delete from app_data_agent.research_budget_policy_heads
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_budget_policy_versions
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 14. Enumerator version heads / versions
  delete from app_data_agent.research_enumerator_version_heads
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_enumerator_versions
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'total_deleted', v_total_deleted,
    'environment', s_environment
  ));
end;
$$;

-- ============================================================
-- 3. issue_coverage_derivation_receipt_internal: Internal Coverage issuer
--    Called from Stop Root RPC, no public GRANT
-- ============================================================

