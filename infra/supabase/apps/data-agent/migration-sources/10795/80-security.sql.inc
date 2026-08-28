alter function app_data_agent.hold_falcon24_authority_staging_session(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.hold_falcon24_authority_staging_session(jsonb)
  from public;
grant execute on function app_data_agent.hold_falcon24_authority_staging_session(jsonb)
  to data_agent_backend;
