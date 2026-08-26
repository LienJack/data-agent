create function app_data_agent.falcon24_e1_gate_attempt_history_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='FALCON24_E1_GATE_ATTEMPT_IMMUTABLE';
end
$function$;

create trigger falcon24_e1_gate_attempt_history_immutable
before update or delete on app_data_agent.falcon24_e1_gate_attempt_history
for each row execute function app_data_agent.falcon24_e1_gate_attempt_history_immutable();

create function app_data_agent.falcon24_e1_qualification_slot_attempt_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare expected_attempt_id uuid;qualification_attempt_id uuid;
begin
  if old.claim_fence_consumed_at is null and new.claim_fence_consumed_at is not null then
    begin
      expected_attempt_id:=pg_catalog.current_setting(
        'data_agent.falcon24_gate_attempt_id',true)::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='FALCON24_E1_GATE_ATTEMPT_FENCE_INVALID';
    end;
    select qualification.attempt_id into qualification_attempt_id
    from app_data_agent.falcon24_qualifications qualification
    where qualification.app_id=new.app_id and qualification.tenant_id=new.tenant_id
      and qualification.environment=new.environment and qualification.principal_id=new.principal_id
      and qualification.qualification_id=new.qualification_id;
    if expected_attempt_id is null or expected_attempt_id is distinct from qualification_attempt_id
    then raise exception using errcode='55000',message='FALCON24_E1_GATE_ATTEMPT_MISMATCH'; end if;
  end if;
  if old.status<>'VERIFIED' and new.status='VERIFIED' and not exists(
    select 1 from app_data_agent.falcon24_e1_ui_receipts qa_receipt
    join app_data_agent.falcon24_e1_ui_receipts trace_receipt
      on trace_receipt.app_id=qa_receipt.app_id and trace_receipt.tenant_id=qa_receipt.tenant_id
      and trace_receipt.environment=qa_receipt.environment
      and trace_receipt.run_id=qa_receipt.run_id
      and trace_receipt.viewport_width=qa_receipt.viewport_width
      and trace_receipt.receipt_kind='TRACE_UI'
      and trace_receipt.baseline_id=qa_receipt.baseline_id
      and trace_receipt.baseline_hash=qa_receipt.baseline_hash
      and trace_receipt.activation_attempt_id=qa_receipt.activation_attempt_id
    where qa_receipt.app_id=new.app_id and qa_receipt.tenant_id=new.tenant_id
      and qa_receipt.environment=new.environment and qa_receipt.run_id=new.run_id
      and qa_receipt.receipt_kind='QA_E2E'
      and qa_receipt.baseline_id=(select qualification.authority_baseline_id
        from app_data_agent.falcon24_qualifications qualification
        where qualification.app_id=new.app_id and qualification.tenant_id=new.tenant_id
          and qualification.environment=new.environment
          and qualification.principal_id=new.principal_id
          and qualification.qualification_id=new.qualification_id))
  then raise exception using errcode='55000',message='FALCON24_E1_UI_RECEIPT_PAIR_REQUIRED'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_campaign_run_attempt_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare expected_attempt_id uuid;campaign_attempt_id uuid;
begin
  if old.claim_fence_consumed_at is null and new.claim_fence_consumed_at is not null then
    begin
      expected_attempt_id:=pg_catalog.current_setting(
        'data_agent.falcon24_gate_attempt_id',true)::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='FALCON24_E1_GATE_ATTEMPT_FENCE_INVALID';
    end;
    select campaign.attempt_id into campaign_attempt_id
    from app_data_agent.falcon24_acceptance_campaigns campaign
    where campaign.app_id=new.app_id and campaign.tenant_id=new.tenant_id
      and campaign.environment=new.environment and campaign.principal_id=new.principal_id
      and campaign.campaign_id=new.campaign_id;
    if expected_attempt_id is null or expected_attempt_id is distinct from campaign_attempt_id
    then raise exception using errcode='55000',message='FALCON24_E1_GATE_ATTEMPT_MISMATCH'; end if;
  end if;
  if old.status<>'VERIFIED' and new.status='VERIFIED' and not exists(
    select 1 from app_data_agent.falcon24_e1_ui_receipts qa_receipt
    join app_data_agent.falcon24_e1_ui_receipts trace_receipt
      on trace_receipt.app_id=qa_receipt.app_id and trace_receipt.tenant_id=qa_receipt.tenant_id
      and trace_receipt.environment=qa_receipt.environment
      and trace_receipt.run_id=qa_receipt.run_id
      and trace_receipt.viewport_width=qa_receipt.viewport_width
      and trace_receipt.receipt_kind='TRACE_UI'
      and trace_receipt.baseline_id=qa_receipt.baseline_id
      and trace_receipt.baseline_hash=qa_receipt.baseline_hash
      and trace_receipt.activation_attempt_id=qa_receipt.activation_attempt_id
    where qa_receipt.app_id=new.app_id and qa_receipt.tenant_id=new.tenant_id
      and qa_receipt.environment=new.environment and qa_receipt.run_id=new.run_id
      and qa_receipt.receipt_kind='QA_E2E'
      and qa_receipt.baseline_id=(select campaign.authority_baseline_id
        from app_data_agent.falcon24_acceptance_campaigns campaign
        where campaign.app_id=new.app_id and campaign.tenant_id=new.tenant_id
          and campaign.environment=new.environment and campaign.principal_id=new.principal_id
          and campaign.campaign_id=new.campaign_id))
  then raise exception using errcode='55000',message='FALCON24_E1_UI_RECEIPT_PAIR_REQUIRED'; end if;
  return new;
end
$function$;

-- PostgreSQL executes triggers with the same timing/event in name order. Keep the
-- E1 authority fence ahead of legacy row-shape fences so callers receive the
-- E1 attempt/UI-pair rejection before any retained compatibility rejection.
create trigger falcon24_000_e1_qualification_slot_attempt_fence
before update on app_data_agent.falcon24_qualification_slots
for each row execute function app_data_agent.falcon24_e1_qualification_slot_attempt_fence();
create trigger falcon24_000_e1_campaign_run_attempt_fence
before update on app_data_agent.falcon24_acceptance_campaign_runs
for each row execute function app_data_agent.falcon24_e1_campaign_run_attempt_fence();

alter table app_data_agent.falcon24_e1_gate_attempt_history owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_gate_attempt_history_immutable()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_qualification_slot_attempt_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_campaign_run_attempt_fence()
  owner to data_agent_u6_rpc_owner;

revoke all on table app_data_agent.falcon24_e1_gate_attempt_history from public;
revoke all on function app_data_agent.falcon24_e1_gate_attempt_history_immutable(),
  app_data_agent.falcon24_e1_qualification_slot_attempt_fence(),
  app_data_agent.falcon24_e1_campaign_run_attempt_fence() from public;
revoke all on table app_data_agent.falcon24_e1_gate_attempt_history from data_agent_backend;
revoke all on function app_data_agent.falcon24_e1_gate_attempt_history_immutable(),
  app_data_agent.falcon24_e1_qualification_slot_attempt_fence(),
  app_data_agent.falcon24_e1_campaign_run_attempt_fence() from data_agent_backend;
