alter table app_data_agent.falcon24_qualifications owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_qualification_slots owner to data_agent_u6_rpc_owner;

alter function app_data_agent.load_falcon24_qualification(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_qualification_slot(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_qualification(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_qualification_slot(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.accept_falcon24_qualification_run_with_config(
  jsonb,jsonb,jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_falcon24_qualification_submit_outcome(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_qualification(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_qualification_result(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_qualification_trace(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_qualification_ui_trace(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_falcon24_run_execution_policy(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_qualification_pending_failed_run()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_reclamation_receipt_valid(
  jsonb,text,uuid,text,text) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_qualification_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_qualification_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_qualification_forced_cleanup(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_falcon24_qualification_forced_cleanup(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_repair_evidence_present(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_qualification_slot(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_acceptance_campaign(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_slot_state_fence()
  owner to data_agent_u6_rpc_owner;

grant select on table app_data_agent.run_attempts,app_data_agent.run_events,
  app_data_agent.artifacts,app_data_agent.provider_invocation_intents
  to data_agent_u6_rpc_owner;
create policy falcon24_qualification_run_attempt_select
  on app_data_agent.run_attempts for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_qualification_run_event_select
  on app_data_agent.run_events for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_qualification_artifact_select
  on app_data_agent.artifacts for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_qualification_provider_invocation_select
  on app_data_agent.provider_invocation_intents for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);

revoke all on function
  app_data_agent.load_falcon24_qualification(jsonb),
  app_data_agent.load_falcon24_qualification_slot(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb),
  app_data_agent.claim_falcon24_qualification_slot(jsonb),
  app_data_agent.accept_falcon24_qualification_run_with_config(
    jsonb,jsonb,jsonb),
  app_data_agent.resolve_falcon24_qualification_submit_outcome(jsonb),
  app_data_agent.hold_falcon24_qualification(jsonb),
  app_data_agent.stage_falcon24_qualification_result(jsonb),
  app_data_agent.stage_falcon24_qualification_trace(jsonb),
  app_data_agent.stage_falcon24_qualification_ui_trace(jsonb),
  app_data_agent.load_falcon24_qualification_pending_failed_run(),
  app_data_agent.claim_falcon24_qualification_sandbox_reclamation(jsonb),
  app_data_agent.record_falcon24_qualification_sandbox_reclamation(jsonb),
  app_data_agent.claim_falcon24_qualification_forced_cleanup(jsonb),
  app_data_agent.resolve_falcon24_qualification_forced_cleanup(jsonb),
  app_data_agent.complete_falcon24_qualification_slot(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;

revoke all on function
  app_data_agent.falcon24_qualification_reclamation_receipt_valid(jsonb,text,uuid,text,text),
  app_data_agent.falcon24_qualification_repair_evidence_present(uuid),
  app_data_agent.falcon24_qualification_state_fence(),
  app_data_agent.falcon24_qualification_slot_state_fence()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function
  app_data_agent.load_falcon24_qualification(jsonb),
  app_data_agent.load_falcon24_qualification_slot(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb),
  app_data_agent.claim_falcon24_qualification_slot(jsonb),
  app_data_agent.accept_falcon24_qualification_run_with_config(
    jsonb,jsonb,jsonb),
  app_data_agent.resolve_falcon24_qualification_submit_outcome(jsonb),
  app_data_agent.hold_falcon24_qualification(jsonb),
  app_data_agent.stage_falcon24_qualification_result(jsonb),
  app_data_agent.stage_falcon24_qualification_trace(jsonb),
  app_data_agent.stage_falcon24_qualification_ui_trace(jsonb),
  app_data_agent.load_falcon24_qualification_pending_failed_run(),
  app_data_agent.claim_falcon24_qualification_sandbox_reclamation(jsonb),
  app_data_agent.record_falcon24_qualification_sandbox_reclamation(jsonb),
  app_data_agent.claim_falcon24_qualification_forced_cleanup(jsonb),
  app_data_agent.resolve_falcon24_qualification_forced_cleanup(jsonb),
  app_data_agent.complete_falcon24_qualification_slot(jsonb)
  to data_agent_backend;
