alter function app_data_agent.conversation_context_summary_document_is_valid(jsonb,uuid,uuid,text)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_task_artifact(jsonb,jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_task_artifact(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;

revoke all on function app_data_agent.conversation_context_summary_document_is_valid(
  jsonb,uuid,uuid,text) from public,data_agent_backend;
grant execute on function app_data_agent.conversation_context_summary_document_is_valid(
  jsonb,uuid,uuid,text) to data_agent_provider_invocation_rpc_owner;
grant execute on function app_data_agent.u6_uuid_v5(uuid,bytea)
  to data_agent_provider_invocation_rpc_owner;

drop policy if exists provider_invocation_conversation_summary_rpc_insert
  on app_data_agent.artifacts;
create policy provider_invocation_conversation_summary_rpc_insert
on app_data_agent.artifacts for insert to data_agent_provider_invocation_rpc_owner
with check (
  artifact_type='ConversationContextSummary'
  and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true)
);
