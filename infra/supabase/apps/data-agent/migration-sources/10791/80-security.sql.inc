alter function app_data_agent.load_falcon24_semantic_authority_closure(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.load_falcon24_semantic_authority_closure(jsonb)
  from public;
grant execute on function app_data_agent.load_falcon24_semantic_authority_closure(jsonb)
  to data_agent_backend;
