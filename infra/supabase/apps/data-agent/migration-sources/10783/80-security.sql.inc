alter table semantic.semantic_successor_release_stage owner to data_agent_u6_data_owner;
alter table semantic.semantic_successor_projection_stage owner to data_agent_u6_data_owner;
alter table semantic.semantic_successor_stage_receipt owner to data_agent_u6_data_owner;

alter table semantic.semantic_successor_release_stage enable row level security;
alter table semantic.semantic_successor_release_stage force row level security;
alter table semantic.semantic_successor_projection_stage enable row level security;
alter table semantic.semantic_successor_projection_stage force row level security;
alter table semantic.semantic_successor_stage_receipt enable row level security;
alter table semantic.semantic_successor_stage_receipt force row level security;

create policy semantic_successor_release_stage_rpc
on semantic.semantic_successor_release_stage for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_projection_stage_rpc
on semantic.semantic_successor_projection_stage for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_stage_receipt_rpc
on semantic.semantic_successor_stage_receipt for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

create policy semantic_successor_publish_attempt_rpc on semantic.semantic_publish_attempt
for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_candidate_rpc on semantic.semantic_candidate
for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_review_task_rpc on semantic.semantic_review_task
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_review_task_lock_rpc on semantic.semantic_review_task
for update to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_source_revision_rpc on semantic.semantic_source_revision
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_dependency_rpc on semantic.semantic_dependency_pointer
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_dependency_lock_rpc on semantic.semantic_dependency_pointer
for update to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_release_insert_rpc on semantic.semantic_source_release
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_executable_insert_rpc on semantic.semantic_executable_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_relationship_insert_rpc on semantic.semantic_relationship_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_restriction_insert_rpc
on semantic.semantic_runtime_restriction_projection for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

create policy semantic_successor_graph_insert_rpc on semantic.semantic_graph_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_graph_node_insert_rpc on semantic.semantic_graph_node_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_graph_edge_insert_rpc on semantic.semantic_graph_edge_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_graph_binding_insert_rpc
on semantic.semantic_source_release_graph_projection for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_outbox_insert_rpc on semantic.semantic_outbox
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_pointer_update_rpc on semantic.semantic_active_pointer
for update to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_runtime_rpc on semantic.semantic_runtime_activation
for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

create policy semantic_successor_workspace_defaults_rpc
on app_data_agent.workspace_run_defaults for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy semantic_successor_workspace_default_revisions_rpc
on app_data_agent.workspace_run_default_revisions for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));

grant select,insert,update on table
  semantic.semantic_successor_release_stage,
  semantic.semantic_successor_projection_stage,
  semantic.semantic_successor_stage_receipt to data_agent_u6_rpc_owner;
grant select,insert,update on table
  semantic.semantic_publish_attempt,semantic.semantic_candidate,
  semantic.semantic_active_pointer,semantic.semantic_runtime_activation to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_source_revision to data_agent_u6_rpc_owner;
grant select,update on table
  semantic.semantic_review_task,semantic.semantic_dependency_pointer
  to data_agent_u6_rpc_owner;
grant insert on table
  semantic.semantic_source_release,semantic.semantic_executable_projection,
  semantic.semantic_relationship_projection,semantic.semantic_runtime_restriction_projection,
  semantic.semantic_graph_projection,semantic.semantic_graph_node_projection,
  semantic.semantic_graph_edge_projection,semantic.semantic_source_release_graph_projection,
  semantic.semantic_outbox to data_agent_u6_rpc_owner;
grant select,insert,update on table app_data_agent.workspace_run_defaults
  to data_agent_u6_rpc_owner;
grant select,insert,update on table app_data_agent.workspace_run_default_revisions
  to data_agent_u6_rpc_owner;

alter function semantic.semantic_successor_stage_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function semantic.semantic_successor_receipt_immutable()
  owner to data_agent_u6_rpc_owner;
alter function semantic.semantic_formal_history_immutable()
  owner to data_agent_u6_rpc_owner;
alter function semantic.record_semantic_successor_stage(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.load_semantic_successor_stage(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.load_promoted_semantic_successor_release(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.commit_semantic_successor_smoke(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
  owner to data_agent_u6_rpc_owner;

grant execute on function semantic.lock_semantic_authority_fence(uuid,uuid,text,text),
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.runtime_iso_timestamp(timestamptz)
to data_agent_u6_rpc_owner;

revoke all on table
  semantic.semantic_successor_release_stage,
  semantic.semantic_successor_projection_stage,
  semantic.semantic_successor_stage_receipt
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  semantic.semantic_successor_stage_state_fence(),
  semantic.semantic_successor_receipt_immutable(),
  semantic.semantic_formal_history_immutable(),
  semantic.record_semantic_successor_stage(jsonb),
  semantic.load_semantic_successor_stage(jsonb),
  semantic.load_promoted_semantic_successor_release(jsonb),
  semantic.commit_semantic_successor_smoke(jsonb),
  app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
revoke execute on function app_data_agent.activate_falcon24_authority(jsonb)
from data_agent_backend;
grant execute on function
  semantic.record_semantic_successor_stage(jsonb),
  semantic.load_semantic_successor_stage(jsonb),
  semantic.load_promoted_semantic_successor_release(jsonb),
  semantic.commit_semantic_successor_smoke(jsonb),
  app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
to data_agent_backend;
