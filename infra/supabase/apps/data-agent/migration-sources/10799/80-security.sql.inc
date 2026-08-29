alter table app_data_agent.falcon24_llm_execution_certification_stage
  owner to data_agent_u6_data_owner;
alter function app_data_agent.falcon24_llm_execution_stage_state_fence()
  owner to data_agent_u6_data_owner;
alter function app_data_agent.stage_falcon24_llm_execution_certification(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_llm_execution_certification_stage(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.reject_falcon24_llm_execution_certification_stage(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_e7_recovery_context(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority_pre_e7(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.list_provider_execution_profiles_pre_e7()
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.list_provider_execution_profiles()
  owner to data_agent_provider_invocation_rpc_owner;

create policy falcon24_llm_execution_stage_rpc
on app_data_agent.falcon24_llm_execution_certification_stage for all
to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));
create policy falcon24_llm_execution_stage_provider_select
on app_data_agent.falcon24_llm_execution_certification_stage for select
to data_agent_provider_invocation_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_e7_certification_artifact_insert_rpc
on app_data_agent.artifacts for insert to data_agent_u6_rpc_owner
with check(artifact_type='ModelCertificationReceipt' and not is_active
  and platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e7_certification_artifact_update_rpc
on app_data_agent.artifacts for update to data_agent_u6_rpc_owner
using(artifact_type='ModelCertificationReceipt' and not is_active
  and platform.backend_context_matches(app_id,tenant_id,environment,true))
with check(artifact_type='ModelCertificationReceipt' and is_active
  and platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e7_current_authority_provider_select
on app_data_agent.falcon24_current_authority_epoch for select
to data_agent_provider_invocation_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_e7_model_catalog_stage_select
on app_data_agent.model_catalog_entries for select to data_agent_u6_rpc_owner
using(app_id=(select app_id from platform.current_backend_authority(false))
  and environment=(select environment from platform.current_backend_authority(false)));
create policy falcon24_e7_model_catalog_stage_lock
on app_data_agent.model_catalog_entries for update to data_agent_u6_rpc_owner
using(app_id=(select app_id from platform.current_backend_authority(false))
  and environment=(select environment from platform.current_backend_authority(false)))
with check(app_id=(select app_id from platform.current_backend_authority(true))
  and environment=(select environment from platform.current_backend_authority(true)));
create policy falcon24_e7_model_config_stage_select
on app_data_agent.model_config_versions for select to data_agent_u6_rpc_owner
using(app_id=(select app_id from platform.current_backend_authority(false))
  and environment=(select environment from platform.current_backend_authority(false)));
create policy falcon24_e7_model_config_stage_lock
on app_data_agent.model_config_versions for update to data_agent_u6_rpc_owner
using(app_id=(select app_id from platform.current_backend_authority(false))
  and environment=(select environment from platform.current_backend_authority(false)))
with check(app_id=(select app_id from platform.current_backend_authority(true))
  and environment=(select environment from platform.current_backend_authority(true)));

grant select,insert,update on table
  app_data_agent.falcon24_llm_execution_certification_stage to data_agent_u6_rpc_owner;
grant select on table app_data_agent.falcon24_llm_execution_certification_stage,
  app_data_agent.falcon24_current_authority_epoch to data_agent_provider_invocation_rpc_owner;
grant insert on table app_data_agent.artifacts to data_agent_u6_rpc_owner;
grant update(is_active) on table app_data_agent.artifacts to data_agent_u6_rpc_owner;
grant select on table app_data_agent.model_catalog_entries,
  app_data_agent.model_config_versions,platform.deployment_mappings,
  app_data_agent.runs,app_data_agent.run_events to data_agent_u6_rpc_owner;
grant update on table app_data_agent.model_catalog_entries,
  app_data_agent.model_config_versions to data_agent_u6_rpc_owner;
grant update on table platform.deployment_mappings to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.lock_owned_run_fence(uuid)
  to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.activate_falcon24_authority_pre_e7(jsonb),
  app_data_agent.list_provider_execution_profiles_pre_e7()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.stage_falcon24_llm_execution_certification(jsonb),
  app_data_agent.load_falcon24_llm_execution_certification_stage(uuid),
  app_data_agent.reject_falcon24_llm_execution_certification_stage(jsonb),
  app_data_agent.load_falcon24_e7_recovery_context(uuid),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.list_provider_execution_profiles()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function app_data_agent.stage_falcon24_llm_execution_certification(jsonb),
  app_data_agent.load_falcon24_llm_execution_certification_stage(uuid),
  app_data_agent.reject_falcon24_llm_execution_certification_stage(jsonb),
  app_data_agent.load_falcon24_e7_recovery_context(uuid),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.list_provider_execution_profiles() to data_agent_backend;
