alter function app_data_agent.claim_falcon24_acceptance_run(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_acceptance_campaign(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_acceptance_trace(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_campaign(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_falcon24_run_execution_policy(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_pending_failed_run()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_run_delivery_attempt_limit(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.assert_provider_active_worker_lease(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_campaign_run(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_trace_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_acceptance_run(jsonb)
  owner to data_agent_u6_rpc_owner;

grant select on table app_data_agent.workspace_run_bindings,
  app_data_agent.effective_run_config_receipts to data_agent_u6_rpc_owner;
grant select on table app_data_agent.commands
  to data_agent_provider_invocation_rpc_owner;
grant execute on function app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)
  to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.resolve_falcon24_run_execution_policy(uuid)
  to data_agent_provider_invocation_rpc_owner;
create policy falcon24_acceptance_submit_fence_binding_select
  on app_data_agent.workspace_run_bindings for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
create policy falcon24_acceptance_submit_fence_config_select
  on app_data_agent.effective_run_config_receipts for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
create policy falcon24_provider_worker_lease_commands_select
  on app_data_agent.commands for select to data_agent_provider_invocation_rpc_owner
  using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));

revoke all on function app_data_agent.claim_falcon24_acceptance_run(jsonb),
  app_data_agent.hold_falcon24_acceptance_campaign(jsonb),
  app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb),
  app_data_agent.stage_falcon24_acceptance_trace(jsonb),
  app_data_agent.load_falcon24_acceptance_campaign(jsonb),
  app_data_agent.resolve_falcon24_run_execution_policy(uuid),
  app_data_agent.load_falcon24_pending_failed_run(),
  app_data_agent.resolve_run_delivery_attempt_limit(uuid),
  app_data_agent.load_falcon24_acceptance_campaign_run(jsonb),
  app_data_agent.load_falcon24_acceptance_trace_gate(jsonb),
  app_data_agent.claim_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.record_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.complete_falcon24_acceptance_run(jsonb) from public;

revoke all on function app_data_agent.resolve_run_delivery_attempt_limit(uuid)
  from data_agent_backend;

revoke all on function app_data_agent.assert_provider_active_worker_lease(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
grant execute on function app_data_agent.assert_provider_active_worker_lease(jsonb)
  to data_agent_u19_team_owner;

grant execute on function app_data_agent.claim_falcon24_acceptance_run(jsonb),
  app_data_agent.hold_falcon24_acceptance_campaign(jsonb),
  app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb),
  app_data_agent.stage_falcon24_acceptance_trace(jsonb),
  app_data_agent.load_falcon24_acceptance_campaign(jsonb),
  app_data_agent.resolve_falcon24_run_execution_policy(uuid),
  app_data_agent.load_falcon24_pending_failed_run(),
  app_data_agent.load_falcon24_acceptance_campaign_run(jsonb),
  app_data_agent.load_falcon24_acceptance_trace_gate(jsonb),
  app_data_agent.claim_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.record_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.complete_falcon24_acceptance_run(jsonb) to data_agent_backend;
