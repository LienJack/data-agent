alter function app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;
grant execute on function app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)
  to data_agent_backend;
