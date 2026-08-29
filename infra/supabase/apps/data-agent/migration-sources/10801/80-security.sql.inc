alter function app_data_agent.activate_falcon24_authority_pre_e9(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_current_provider_execution_certification(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;

revoke all on function
  app_data_agent.activate_falcon24_authority_pre_e9(jsonb),
  app_data_agent.resolve_current_provider_execution_certification(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.activate_falcon24_authority(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.resolve_current_provider_execution_certification(jsonb)
  to data_agent_backend;
