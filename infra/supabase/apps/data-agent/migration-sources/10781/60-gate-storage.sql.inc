alter table app_data_agent.falcon24_qualification_slots
  drop constraint falcon24_qualification_slot_trace_binding_check,
  drop constraint falcon24_qualification_slot_ui_trace_binding_check,
  drop constraint falcon24_qualification_slot_reclamation_binding_check,
  add constraint falcon24_qualification_slot_trace_binding_check check(
    trace_gate_receipt is null or (
      trace_closure_hash is not null
      and pg_catalog.jsonb_typeof(trace_gate_receipt)='object'
      and ((authority_epoch='E1'
          and trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-gate-receipt@2.0.0')
        or (authority_epoch<>'E1'
          and trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-gate-receipt@3.0.0'
          and trace_gate_receipt->>'authority_epoch'=authority_epoch))
      and trace_gate_receipt->>'campaign_id'=qualification_id
      and trace_gate_receipt->>'run_id'=run_id::text
      and trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and trace_gate_receipt->>'receipt_hash'=trace_gate_receipt_hash
      and trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_ui_trace_binding_check check(
    ui_trace_gate_receipt is null or (
      trace_gate_receipt is not null
      and ((authority_epoch='E1'
          and ui_trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-ui-gate-receipt@1.0.0')
        or (authority_epoch<>'E1'
          and ui_trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-ui-gate-receipt@2.0.0'
          and ui_trace_gate_receipt->>'authority_epoch'=authority_epoch))
      and ui_trace_gate_receipt->>'campaign_id'=qualification_id
      and ui_trace_gate_receipt->>'run_id'=run_id::text
      and ui_trace_gate_receipt->>'workspace_id'=tenant_id::text
      and ui_trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and ui_trace_gate_receipt->>'receipt_hash'=ui_trace_gate_receipt_hash
      and ui_trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(ui_trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_reclamation_binding_check check(
    sandbox_reclamation_receipt is null or (
      ((authority_epoch='E1'
          and sandbox_reclamation_receipt->>'schema_version'=
            'falcon24-sandbox-reclamation-receipt@2.0.0')
        or (authority_epoch<>'E1'
          and sandbox_reclamation_receipt->>'schema_version'=
            'falcon24-sandbox-reclamation-receipt@3.0.0'
          and sandbox_reclamation_receipt->>'authority_epoch'=authority_epoch))
      and sandbox_reclamation_receipt->>'campaign_id'=qualification_id
      and sandbox_reclamation_receipt->>'run_id'=run_id::text
      and sandbox_reclamation_receipt->>'receipt_hash'=sandbox_reclamation_hash
      and sandbox_reclamation_hash=
        app_data_agent.u2_canonical_sha256(sandbox_reclamation_receipt-'receipt_hash')));

alter table app_data_agent.falcon24_acceptance_campaign_runs
  drop constraint falcon24_acceptance_campaign_runs_trace_gate_binding_check,
  drop constraint falcon24_acceptance_campaign_runs_ui_trace_gate_check,
  drop constraint falcon24_acceptance_campaign_runs_reclamation_binding_check,
  add constraint falcon24_campaign_run_trace_gate_binding_check check(
    trace_gate_receipt is null or (
      pg_catalog.jsonb_typeof(trace_gate_receipt)='object'
      and ((authority_epoch='E1'
          and trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-gate-receipt@2.0.0')
        or (authority_epoch<>'E1'
          and trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-gate-receipt@3.0.0'
          and trace_gate_receipt->>'authority_epoch'=authority_epoch))
      and trace_gate_receipt->>'campaign_id'=campaign_id
      and trace_gate_receipt->>'run_id'=run_id::text
      and trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and trace_gate_receipt->>'receipt_hash'=trace_gate_receipt_hash
      and trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_campaign_run_ui_trace_gate_check check(
    (ui_trace_gate_receipt_hash is null)=(ui_trace_gate_receipt is null)
    and (ui_trace_gate_receipt_hash is null
      or ui_trace_gate_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (ui_trace_gate_receipt is null or (
      trace_closure_hash is not null and trace_gate_receipt_hash is not null
      and trace_gate_receipt is not null
      and pg_catalog.jsonb_typeof(ui_trace_gate_receipt)='object'
      and ((authority_epoch='E1'
          and ui_trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-ui-gate-receipt@1.0.0')
        or (authority_epoch<>'E1'
          and ui_trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-ui-gate-receipt@2.0.0'
          and ui_trace_gate_receipt->>'authority_epoch'=authority_epoch))
      and ui_trace_gate_receipt->>'campaign_id'=campaign_id
      and ui_trace_gate_receipt->>'run_id'=run_id::text
      and ui_trace_gate_receipt->>'workspace_id'=tenant_id::text
      and ui_trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and ui_trace_gate_receipt->>'receipt_hash'=ui_trace_gate_receipt_hash
      and ui_trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(ui_trace_gate_receipt-'receipt_hash')))
    and (sandbox_reclamation_claim_hash is null or ui_trace_gate_receipt is not null)
    and (sandbox_reclamation_hash is null or ui_trace_gate_receipt is not null)
    and (status<>'VERIFIED' or ui_trace_gate_receipt is not null)),
  add constraint falcon24_campaign_run_reclamation_binding_check check(
    sandbox_reclamation_receipt is null or (
      ((authority_epoch='E1'
          and sandbox_reclamation_receipt->>'schema_version'=
            'falcon24-sandbox-reclamation-receipt@2.0.0')
        or (authority_epoch<>'E1'
          and sandbox_reclamation_receipt->>'schema_version'=
            'falcon24-sandbox-reclamation-receipt@3.0.0'
          and sandbox_reclamation_receipt->>'authority_epoch'=authority_epoch))
      and sandbox_reclamation_receipt->>'campaign_id'=campaign_id
      and sandbox_reclamation_receipt->>'run_id'=run_id::text
      and sandbox_reclamation_receipt->>'receipt_hash'=sandbox_reclamation_hash
      and sandbox_reclamation_hash=
        app_data_agent.u2_canonical_sha256(sandbox_reclamation_receipt-'receipt_hash')));
