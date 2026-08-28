alter function semantic.commit_semantic_successor_smoke(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.commit_semantic_successor_smoke(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function semantic.commit_semantic_successor_smoke(jsonb)
  to data_agent_backend;
