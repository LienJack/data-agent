create policy analysis_result_stages_rpc_lock on app_data_agent.analysis_result_stages
for update to data_agent_u6_rpc_owner
using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check(false);
