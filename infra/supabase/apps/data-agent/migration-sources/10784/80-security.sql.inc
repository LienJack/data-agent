alter function app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_task_artifact(jsonb,jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_task_artifact(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;

revoke all on function app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)
  from public,data_agent_backend;
revoke all on function app_data_agent.commit_provider_task_artifact(jsonb,jsonb) from public;
revoke all on function app_data_agent.load_provider_task_artifact(jsonb) from public;
grant execute on function app_data_agent.commit_provider_task_artifact(jsonb,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.load_provider_task_artifact(jsonb)
  to data_agent_backend;

grant execute on function app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)
  to data_agent_provider_invocation_rpc_owner;
