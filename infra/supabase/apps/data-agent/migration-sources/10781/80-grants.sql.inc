alter function app_data_agent.falcon24_authority_epoch_is_canonical(text)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_authority_binding_document(
  app_data_agent.falcon24_current_authority_epoch) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_activation_attempt_document(
  app_data_agent.falcon24_authority_activation_attempts) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_authority_staging_session(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_authority_staging_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_authority_baseline(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_authority_activation_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_authority_activation_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_falcon24_ui_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_ui_receipts(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_archive_historical_gate_attempt(
  uuid,uuid,text,uuid,text) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_gate_current_authority_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_slot_attempt_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_campaign_run_attempt_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_gate_attempt_history_immutable()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_authority_staging_session_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_authority_activation_attempt_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_authority_baseline_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_current_authority_successor_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_bind_current_authority()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_bind_artifact_to_run()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_binding_immutable()
  owner to data_agent_u6_rpc_owner;

revoke all on table
  app_data_agent.falcon24_authority_staging_sessions,
  app_data_agent.falcon24_authority_staging_receipts,
  app_data_agent.falcon24_authority_baselines,
  app_data_agent.falcon24_authority_activation_attempts,
  app_data_agent.falcon24_current_authority_epoch,
  app_data_agent.falcon24_ui_receipts,
  app_data_agent.falcon24_gate_attempt_history,
  app_data_agent.falcon24_analysis_publications,
  app_data_agent.falcon24_analysis_publication_artifacts,
  app_data_agent.falcon24_analysis_publication_current,
  app_data_agent.falcon24_analysis_publication_outbox from public,data_agent_backend;

grant select,insert,update on table
  app_data_agent.falcon24_authority_staging_sessions,
  app_data_agent.falcon24_authority_staging_receipts,
  app_data_agent.falcon24_authority_baselines,
  app_data_agent.falcon24_authority_activation_attempts,
  app_data_agent.falcon24_current_authority_epoch,
  app_data_agent.falcon24_ui_receipts,
  app_data_agent.falcon24_gate_attempt_history,
  app_data_agent.falcon24_analysis_publications,
  app_data_agent.falcon24_analysis_publication_artifacts,
  app_data_agent.falcon24_analysis_publication_current,
  app_data_agent.falcon24_analysis_publication_outbox to data_agent_u6_rpc_owner;

revoke all on function
  app_data_agent.begin_falcon24_authority_staging_session(jsonb),
  app_data_agent.record_falcon24_authority_staging_receipt(jsonb),
  app_data_agent.stage_falcon24_authority_baseline(jsonb),
  app_data_agent.begin_falcon24_authority_activation_attempt(jsonb),
  app_data_agent.hold_falcon24_authority_activation_attempt(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.load_falcon24_current_authority_epoch(),
  app_data_agent.load_falcon24_run_authority_binding(jsonb),
  app_data_agent.commit_falcon24_ui_receipt(jsonb),
  app_data_agent.load_falcon24_ui_receipts(jsonb) from public;
grant execute on function
  app_data_agent.begin_falcon24_authority_staging_session(jsonb),
  app_data_agent.record_falcon24_authority_staging_receipt(jsonb),
  app_data_agent.stage_falcon24_authority_baseline(jsonb),
  app_data_agent.begin_falcon24_authority_activation_attempt(jsonb),
  app_data_agent.hold_falcon24_authority_activation_attempt(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.load_falcon24_current_authority_epoch(),
  app_data_agent.load_falcon24_run_authority_binding(jsonb),
  app_data_agent.commit_falcon24_ui_receipt(jsonb),
  app_data_agent.load_falcon24_ui_receipts(jsonb) to data_agent_backend;

revoke execute on function app_data_agent.begin_falcon24_e1_staging_session(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.record_falcon24_e1_staging_receipt(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.stage_falcon24_e1_authority_baseline(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.begin_falcon24_e1_activation_attempt(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.hold_falcon24_e1_activation_attempt(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.activate_falcon24_e1_authority(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.commit_e1_analysis_publication(jsonb)
  from public,data_agent_backend;

revoke all on function
  app_data_agent.falcon24_authority_staging_session_state_fence(),
  app_data_agent.falcon24_authority_activation_attempt_state_fence(),
  app_data_agent.falcon24_authority_baseline_state_fence(),
  app_data_agent.falcon24_current_authority_successor_fence(),
  app_data_agent.falcon24_bind_current_authority(),
  app_data_agent.falcon24_bind_artifact_to_run(),
  app_data_agent.falcon24_binding_immutable(),
  app_data_agent.falcon24_archive_historical_gate_attempt(uuid,uuid,text,uuid,text),
  app_data_agent.falcon24_gate_current_authority_fence(),
  app_data_agent.falcon24_qualification_slot_attempt_fence(),
  app_data_agent.falcon24_campaign_run_attempt_fence(),
  app_data_agent.falcon24_gate_attempt_history_immutable()
from public,data_agent_backend;
