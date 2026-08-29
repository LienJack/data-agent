alter table app_data_agent.falcon24_finalization_failure_receipts
  owner to data_agent_u6_data_owner;
alter function app_data_agent.reject_falcon24_finalization_failure_mutation()
  owner to data_agent_u6_data_owner;
alter function app_data_agent.load_falcon24_finalization_failure(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_finalization_failure(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority_pre_e10(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;

create policy falcon24_finalization_failure_rpc
on app_data_agent.falcon24_finalization_failure_receipts for all
to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));

grant select,insert,update on table app_data_agent.falcon24_finalization_failure_receipts
  to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.resolve_current_provider_execution_certification(jsonb)
  to data_agent_u6_rpc_owner;

revoke all on function
  app_data_agent.reject_falcon24_finalization_failure_mutation(),
  app_data_agent.activate_falcon24_authority_pre_e10(jsonb),
  app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function
  app_data_agent.load_falcon24_finalization_failure(uuid),
  app_data_agent.record_falcon24_finalization_failure(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function
  app_data_agent.load_falcon24_finalization_failure(uuid),
  app_data_agent.record_falcon24_finalization_failure(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)
  to data_agent_backend;
