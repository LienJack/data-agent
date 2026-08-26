alter function app_data_agent.falcon24_ui_trace_gate_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_acceptance_trace(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.falcon24_ui_trace_gate_fence()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;
revoke all on function app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;

grant execute on function app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb),
  app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)
  to data_agent_backend;
