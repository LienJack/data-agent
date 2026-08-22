grant usage on schema semantic,app_data_agent,platform,extensions to data_agent_u5_self_publish_owner;
grant select,insert on semantic.semantic_candidate_self_publish_idempotency
  to data_agent_u5_self_publish_owner;
grant select,update on semantic.semantic_candidate,
  semantic.semantic_active_pointer,semantic.semantic_runtime_activation
  to data_agent_u5_self_publish_owner;
grant select on semantic.semantic_candidate_revision,semantic.semantic_source_revision,
  semantic.semantic_dependency_pointer,semantic.semantic_domain_registry
  to data_agent_u5_self_publish_owner;
grant select,insert on semantic.semantic_review_task,semantic.semantic_review_decision,
  semantic.semantic_publish_attempt,semantic.semantic_source_release,
  semantic.semantic_executable_projection,semantic.semantic_relationship_projection,
  semantic.semantic_runtime_restriction_projection
  to data_agent_u5_self_publish_owner;
grant insert on app_data_agent.knowledge_semantic_usage_references,app_data_agent.audit_log
  to data_agent_u5_self_publish_owner;

grant execute on function semantic.assert_explorer_scope(uuid,uuid,text,uuid,text),
  semantic.lock_semantic_authority_fence(uuid,uuid,text,text),
  semantic.commit_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid,uuid,jsonb),
  semantic.bind_semantic_graph_release(uuid,uuid,text,uuid,text,uuid,uuid),
  semantic.semantic_sha256(text,jsonb),platform.canonical_sha256(jsonb),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.runtime_canonical_json(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
  to data_agent_u5_self_publish_owner;

create policy semantic_candidate_self_publish_owner_scope
  on semantic.semantic_candidate_self_publish_idempotency for all
  to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_candidate_scope on semantic.semantic_candidate
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_revision_scope on semantic.semantic_candidate_revision
  for select to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_source_scope on semantic.semantic_source_revision
  for select to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_pointer_scope on semantic.semantic_active_pointer
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_activation_scope on semantic.semantic_runtime_activation
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_dependency_scope on semantic.semantic_dependency_pointer
  for select to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_domain_scope on semantic.semantic_domain_registry
  for select to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_review_task_scope on semantic.semantic_review_task
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_decision_scope on semantic.semantic_review_decision
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_attempt_scope on semantic.semantic_publish_attempt
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_release_scope on semantic.semantic_source_release
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_executable_scope on semantic.semantic_executable_projection
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_relationship_scope on semantic.semantic_relationship_projection
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_restriction_scope
  on semantic.semantic_runtime_restriction_projection for all
  to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_usage_scope
  on app_data_agent.knowledge_semantic_usage_references for insert
  to data_agent_u5_self_publish_owner
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_audit_scope on app_data_agent.audit_log
  for insert to data_agent_u5_self_publish_owner
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));

grant select on semantic.semantic_graph_projection,
  semantic.semantic_source_release_graph_projection,
  semantic.semantic_executable_projection
to data_agent_u12_context_owner;
create policy semantic_graph_projection_u12_select on semantic.semantic_graph_projection
  for select to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_release_graph_projection_u12_select on semantic.semantic_source_release_graph_projection
  for select to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_executable_projection_u12_select on semantic.semantic_executable_projection
  for select to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

alter function semantic.self_review_and_publish_semantic_candidate(jsonb)
  owner to data_agent_u5_self_publish_owner;
alter function app_data_agent.resolved_context_metric_projection_initial(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_ontology_projection_initial(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_relationship_projection_initial(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_ontology_projection(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_relationship_projection(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;

revoke all on semantic.semantic_candidate_self_publish_idempotency
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function semantic.self_review_and_publish_semantic_candidate(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function semantic.self_review_and_publish_semantic_candidate(jsonb) to data_agent_backend;

do $postconditions$
begin
  if not (select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation where relation.oid=
      'semantic.semantic_candidate_self_publish_idempotency'::regclass)
    or pg_catalog.has_table_privilege(
      'data_agent_backend','semantic.semantic_candidate_self_publish_idempotency','SELECT,INSERT,UPDATE,DELETE'
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','semantic.self_review_and_publish_semantic_candidate(jsonb)','EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon','semantic.self_review_and_publish_semantic_candidate(jsonb)','EXECUTE'
    )
    or exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u5_self_publish_owner'
      and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole
        or rolreplication or rolbypassrls))
    or not pg_catalog.has_table_privilege(
      'data_agent_u5_self_publish_owner','semantic.semantic_active_pointer','SELECT,UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_backend','semantic.semantic_candidate_self_publish_idempotency','SELECT,INSERT,UPDATE,DELETE'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_HARDENING_FAILED'; end if;
end
$postconditions$;
