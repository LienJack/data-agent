grant usage on schema app_data_agent to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])
  to data_agent_u6_rpc_owner;
