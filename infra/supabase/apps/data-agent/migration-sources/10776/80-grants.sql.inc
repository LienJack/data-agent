alter table app_data_agent.e1_analysis_publications owner to data_agent_u6_rpc_owner;
alter table app_data_agent.e1_analysis_publication_artifacts owner to data_agent_u6_rpc_owner;
alter table app_data_agent.e1_analysis_publication_current owner to data_agent_u6_rpc_owner;
alter table app_data_agent.e1_analysis_publication_outbox owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_e1_analysis_publication(jsonb) owner to data_agent_u6_rpc_owner;

alter table app_data_agent.e1_analysis_publications enable row level security;
alter table app_data_agent.e1_analysis_publications force row level security;
alter table app_data_agent.e1_analysis_publication_artifacts enable row level security;
alter table app_data_agent.e1_analysis_publication_artifacts force row level security;
alter table app_data_agent.e1_analysis_publication_current enable row level security;
alter table app_data_agent.e1_analysis_publication_current force row level security;
alter table app_data_agent.e1_analysis_publication_outbox enable row level security;
alter table app_data_agent.e1_analysis_publication_outbox force row level security;

revoke all on table app_data_agent.e1_analysis_publications,
  app_data_agent.e1_analysis_publication_artifacts,
  app_data_agent.e1_analysis_publication_current,
  app_data_agent.e1_analysis_publication_outbox from public;
grant select,insert on table app_data_agent.e1_analysis_publications,
  app_data_agent.e1_analysis_publication_artifacts,
  app_data_agent.e1_analysis_publication_current,
  app_data_agent.e1_analysis_publication_outbox to data_agent_u6_rpc_owner;

create policy e1_analysis_publications_rpc on app_data_agent.e1_analysis_publications
  for select to data_agent_u6_rpc_owner
  using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy e1_analysis_publications_rpc_insert on app_data_agent.e1_analysis_publications
  for insert to data_agent_u6_rpc_owner
  with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy e1_analysis_publication_artifacts_rpc on app_data_agent.e1_analysis_publication_artifacts
  for select to data_agent_u6_rpc_owner
  using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy e1_analysis_publication_artifacts_rpc_insert on app_data_agent.e1_analysis_publication_artifacts
  for insert to data_agent_u6_rpc_owner
  with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy e1_analysis_publication_current_rpc on app_data_agent.e1_analysis_publication_current
  for select to data_agent_u6_rpc_owner
  using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy e1_analysis_publication_current_rpc_insert on app_data_agent.e1_analysis_publication_current
  for insert to data_agent_u6_rpc_owner
  with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy e1_analysis_publication_outbox_rpc on app_data_agent.e1_analysis_publication_outbox
  for select to data_agent_u6_rpc_owner
  using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy e1_analysis_publication_outbox_rpc_insert on app_data_agent.e1_analysis_publication_outbox
  for insert to data_agent_u6_rpc_owner
  with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));

revoke all on function app_data_agent.commit_e1_analysis_publication(jsonb) from public;
grant execute on function app_data_agent.commit_e1_analysis_publication(jsonb) to data_agent_backend;
