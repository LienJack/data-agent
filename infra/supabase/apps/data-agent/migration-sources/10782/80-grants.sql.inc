alter function app_data_agent.commit_falcon24_analysis_publication(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.commit_falcon24_analysis_publication(jsonb) from public;
grant execute on function app_data_agent.commit_falcon24_analysis_publication(jsonb)
  to data_agent_backend;
revoke execute on function app_data_agent.commit_e1_analysis_publication(jsonb)
  from public,data_agent_backend;
