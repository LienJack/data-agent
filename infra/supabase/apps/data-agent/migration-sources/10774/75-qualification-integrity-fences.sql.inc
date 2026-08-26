alter table app_data_agent.falcon24_qualification_slots
  add constraint falcon24_qualification_slot_result_binding_check check(
    result_document is null or result_hash=app_data_agent.u2_canonical_sha256(result_document)),
  add constraint falcon24_qualification_slot_trace_binding_check check(
    trace_gate_receipt is null or (
      trace_closure_hash is not null
      and trace_gate_receipt->>'schema_version'='falcon24-resolution-trace-gate-receipt@2.0.0'
      and trace_gate_receipt->>'campaign_id'=qualification_id
      and trace_gate_receipt->>'run_id'=run_id::text
      and trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and trace_gate_receipt->>'receipt_hash'=trace_gate_receipt_hash
      and trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_ui_trace_binding_check check(
    ui_trace_gate_receipt is null or (
      trace_gate_receipt is not null
      and ui_trace_gate_receipt->>'schema_version'=
        'falcon24-resolution-trace-ui-gate-receipt@1.0.0'
      and ui_trace_gate_receipt->>'campaign_id'=qualification_id
      and ui_trace_gate_receipt->>'run_id'=run_id::text
      and ui_trace_gate_receipt->>'workspace_id'=tenant_id::text
      and ui_trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and ui_trace_gate_receipt->>'receipt_hash'=ui_trace_gate_receipt_hash
      and ui_trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(ui_trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_reclamation_binding_check check(
    sandbox_reclamation_receipt is null or (
      sandbox_reclamation_receipt->>'campaign_id'=qualification_id
      and sandbox_reclamation_receipt->>'run_id'=run_id::text
      and sandbox_reclamation_receipt->>'receipt_hash'=sandbox_reclamation_hash
      and sandbox_reclamation_hash=
        app_data_agent.u2_canonical_sha256(sandbox_reclamation_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_forced_cleanup_binding_check check(
    forced_cleanup_receipt is null or (
      status='HOLD' and forced_cleanup_claim_hash is not null
      and forced_cleanup_receipt->>'campaign_id'=qualification_id
      and forced_cleanup_receipt->>'run_id'=run_id::text
      and forced_cleanup_receipt->>'receipt_hash'=forced_cleanup_receipt_hash
      and forced_cleanup_receipt_hash=
        app_data_agent.u2_canonical_sha256(forced_cleanup_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_forced_cleanup_state_check check(
    forced_cleanup_claim_hash is null or status='HOLD');

create function app_data_agent.falcon24_qualification_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if old.status='HOLD' and new is distinct from old then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD';
  end if;
  if old.status='PASSED' and new is distinct from old then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ALREADY_PASSED';
  end if;
  if (old.status='READY' and new.status not in('READY','RUNNING','HOLD'))
    or (old.status='RUNNING' and new.status not in('RUNNING','READY','PASSED','HOLD'))
    or new.next_slot_ordinal<old.next_slot_ordinal
    or new.next_slot_ordinal>old.next_slot_ordinal+1
    or (new.next_slot_ordinal<>old.next_slot_ordinal
      and not (old.status='RUNNING' and new.status in('READY','PASSED')))
    or (new.status='HOLD' and old.status<>'HOLD' and (
      new.first_failure_run_id is null or new.first_failure_layer is null
      or new.first_failure_code is null))
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if old.first_failure_run_id is not null and (
    new.first_failure_run_id is distinct from old.first_failure_run_id
    or new.first_failure_layer is distinct from old.first_failure_layer
    or new.first_failure_code is distinct from old.first_failure_code)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD_REPLAY_MISMATCH'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_qualification_slot_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if (old.status='PLANNED' and new.status not in('PLANNED','CLAIMED','HOLD'))
    or (old.status='CLAIMED' and new.status not in('CLAIMED','VERIFIED','HOLD'))
    or (old.status in('VERIFIED','HOLD') and new.status<>old.status)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if old.claim_fence_hash is not null and (
    new.claim_fence_hash is distinct from old.claim_fence_hash
    or (old.claim_fence_consumed_at is not null
      and new.claim_fence_consumed_at is distinct from old.claim_fence_consumed_at))
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_MISMATCH'; end if;
  if old.result_hash is not null and (
      new.result_hash is distinct from old.result_hash
      or new.result_document is distinct from old.result_document)
    or old.trace_gate_receipt_hash is not null and (
      new.trace_closure_hash is distinct from old.trace_closure_hash
      or new.trace_gate_receipt_hash is distinct from old.trace_gate_receipt_hash
      or new.trace_gate_receipt is distinct from old.trace_gate_receipt)
    or old.ui_trace_gate_receipt_hash is not null and (
      new.ui_trace_gate_receipt_hash is distinct from old.ui_trace_gate_receipt_hash
      or new.ui_trace_gate_receipt is distinct from old.ui_trace_gate_receipt)
    or old.sandbox_reclamation_hash is not null and (
      new.sandbox_reclamation_hash is distinct from old.sandbox_reclamation_hash
      or new.sandbox_reclamation_receipt is distinct from old.sandbox_reclamation_receipt)
    or old.forced_cleanup_resolved_at is not null and new is distinct from old
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
  if (new.sandbox_reclamation_claim_hash is not null or new.status='VERIFIED')
    and (new.result_document is null or new.trace_gate_receipt is null
      or new.ui_trace_gate_receipt is null)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_UI_TRACE_REQUIRED'; end if;
  return new;
end
$function$;

create trigger falcon24_qualifications_state_fence
before update on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_qualification_state_fence();
create trigger falcon24_qualification_slots_state_fence
before update on app_data_agent.falcon24_qualification_slots
for each row execute function app_data_agent.falcon24_qualification_slot_state_fence();
