alter function app_data_agent.activate_falcon24_authority_pre_retained(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_diagnostic_e4_history(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_diagnostic_e4_history(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_qualification_e4_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_qualification(jsonb)
  owner to data_agent_u6_rpc_owner;

create policy semantic_retained_release_select_rpc on semantic.semantic_source_release
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_executable_select_rpc on semantic.semantic_executable_projection
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_relationship_select_rpc on semantic.semantic_relationship_projection
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_restriction_select_rpc
on semantic.semantic_runtime_restriction_projection for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_graph_select_rpc on semantic.semantic_graph_projection
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_graph_binding_select_rpc
on semantic.semantic_source_release_graph_projection for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

grant select on table semantic.semantic_source_release,semantic.semantic_executable_projection,
  semantic.semantic_relationship_projection,semantic.semantic_runtime_restriction_projection,
  semantic.semantic_graph_projection,semantic.semantic_source_release_graph_projection
  to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.activate_falcon24_authority_pre_retained(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_diagnostic_e4_history(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.complete_falcon24_diagnostic_e4_history(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_qualification_e4_diagnostic(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function app_data_agent.activate_falcon24_authority(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_diagnostic(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.complete_falcon24_diagnostic(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_qualification(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.begin_falcon24_diagnostic(jsonb),
  app_data_agent.complete_falcon24_diagnostic(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb) to data_agent_backend;
