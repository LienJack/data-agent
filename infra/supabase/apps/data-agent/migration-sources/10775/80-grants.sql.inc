alter table app_data_agent.falcon24_e1_staging_sessions owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_e1_staging_receipts owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_authority_baselines owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_e1_activation_attempts owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_current_authority_epoch owner to data_agent_u6_rpc_owner;

alter function app_data_agent.begin_falcon24_e1_staging_session(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_e1_staging_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_e1_authority_baseline(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_activation_attempt_document(
  app_data_agent.falcon24_e1_activation_attempts) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_binding_document(
  app_data_agent.falcon24_current_authority_epoch) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_e1_activation_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_e1_activation_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_e1_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_current_authority_epoch()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_bind_current_authority()
  owner to postgres;
alter function app_data_agent.falcon24_e1_bind_artifact_to_run()
  owner to postgres;
alter function app_data_agent.falcon24_e1_binding_immutable()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_run_authority_binding(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_staging_session_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_baseline_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_activation_attempt_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_immutable_row_fence()
  owner to data_agent_u6_rpc_owner;

revoke all on table app_data_agent.falcon24_e1_staging_sessions,
  app_data_agent.falcon24_e1_staging_receipts,app_data_agent.falcon24_authority_baselines,
  app_data_agent.falcon24_e1_activation_attempts,
  app_data_agent.falcon24_current_authority_epoch
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

revoke all on function app_data_agent.begin_falcon24_e1_staging_session(jsonb),
  app_data_agent.record_falcon24_e1_staging_receipt(jsonb),
  app_data_agent.stage_falcon24_e1_authority_baseline(jsonb),
  app_data_agent.begin_falcon24_e1_activation_attempt(jsonb),
  app_data_agent.hold_falcon24_e1_activation_attempt(jsonb),
  app_data_agent.activate_falcon24_e1_authority(jsonb),
  app_data_agent.load_falcon24_current_authority_epoch(),
  app_data_agent.load_falcon24_run_authority_binding(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;

revoke all on function app_data_agent.falcon24_e1_runtime_surface_is_empty(),
  app_data_agent.falcon24_e1_activation_attempt_document(
    app_data_agent.falcon24_e1_activation_attempts),
  app_data_agent.falcon24_e1_binding_document(
    app_data_agent.falcon24_current_authority_epoch),
  app_data_agent.falcon24_e1_bind_current_authority(),
  app_data_agent.falcon24_e1_bind_artifact_to_run(),
  app_data_agent.falcon24_e1_binding_immutable(),
  app_data_agent.falcon24_e1_staging_session_state_fence(),
  app_data_agent.falcon24_e1_baseline_state_fence(),
  app_data_agent.falcon24_e1_activation_attempt_state_fence(),
  app_data_agent.falcon24_e1_immutable_row_fence()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function app_data_agent.falcon24_e1_runtime_surface_is_empty()
  to data_agent_u6_rpc_owner;

grant execute on function app_data_agent.begin_falcon24_e1_staging_session(jsonb),
  app_data_agent.record_falcon24_e1_staging_receipt(jsonb),
  app_data_agent.stage_falcon24_e1_authority_baseline(jsonb),
  app_data_agent.begin_falcon24_e1_activation_attempt(jsonb),
  app_data_agent.hold_falcon24_e1_activation_attempt(jsonb),
  app_data_agent.activate_falcon24_e1_authority(jsonb),
  app_data_agent.load_falcon24_current_authority_epoch(),
  app_data_agent.load_falcon24_run_authority_binding(jsonb)
  to data_agent_backend;
