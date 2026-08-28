alter function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
  to data_agent_backend;
