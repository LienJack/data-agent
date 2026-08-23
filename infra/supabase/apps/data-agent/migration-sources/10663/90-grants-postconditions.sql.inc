alter table app_data_agent.resolved_context_receipts owner to data_agent_u12_context_owner;
alter function app_data_agent.reject_resolved_context_mutation() owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_exact_keys(jsonb,text[]) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_uuid_v8_from_hash(text) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_package_key_hash(jsonb) owner to data_agent_u12_context_owner;
alter function app_data_agent.assert_resolved_context_request(jsonb) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_ontology_projection(uuid,uuid,text,text,uuid) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_relationship_projection(uuid,uuid,text,text,uuid) owner to data_agent_u12_context_owner;
alter function app_data_agent.load_resolved_context_authority_snapshot(jsonb) owner to data_agent_u12_context_owner;
alter function app_data_agent.commit_resolved_context_package(jsonb) owner to data_agent_u12_context_owner;
alter function app_data_agent.assert_resolved_context_integrity() owner to data_agent_u12_context_owner;

grant usage on schema app_data_agent,platform,semantic,catalog to data_agent_u12_context_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.builtin_effective_config_policy(text)
to data_agent_u12_context_owner;
grant select on app_data_agent.workspace_run_defaults,app_data_agent.workspace_run_default_revisions,
  app_data_agent.model_catalog_entries,app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_config_context_receipts,app_data_agent.run_attempts,app_data_agent.outbox,
  app_data_agent.workspace_run_bindings,app_data_agent.qa_messages,app_data_agent.run_events,
  semantic.semantic_source_release,semantic.semantic_active_pointer,
  semantic.initial_semantic_release_sets,semantic.initial_semantic_release_package_bindings,
  semantic.ontology_package_candidates
to data_agent_u12_context_owner;

create policy workspace_run_defaults_u12_select on app_data_agent.workspace_run_defaults
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_run_default_revisions_u12_select on app_data_agent.workspace_run_default_revisions
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy effective_run_config_u12_select on app_data_agent.effective_run_config_receipts
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy effective_context_receipt_u12_select on app_data_agent.effective_config_context_receipts
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy run_attempt_u12_select on app_data_agent.run_attempts
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy outbox_u12_select on app_data_agent.outbox
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_run_binding_u12_select on app_data_agent.workspace_run_bindings
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy qa_message_u12_select on app_data_agent.qa_messages
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy run_event_u12_select on app_data_agent.run_events
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_release_u12_select on semantic.semantic_source_release
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_pointer_u12_select on semantic.semantic_active_pointer
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy initial_release_set_u12_select on semantic.initial_semantic_release_sets
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy initial_release_binding_u12_select on semantic.initial_semantic_release_package_bindings
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy ontology_package_u12_select on semantic.ontology_package_candidates
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.resolved_context_receipts from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.resolved_context_exact_keys(jsonb,text[]),
  app_data_agent.resolved_context_uuid_v8_from_hash(text),
  app_data_agent.resolved_context_package_key_hash(jsonb),
  app_data_agent.assert_resolved_context_request(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.load_resolved_context_authority_snapshot(jsonb),
  app_data_agent.commit_resolved_context_package(jsonb) from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_resolved_context_authority_snapshot(jsonb),
  app_data_agent.commit_resolved_context_package(jsonb) to data_agent_backend;

do $postconditions$
begin
  if not exists (
    select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent' and relation.relname='resolved_context_receipts'
      and relation.relrowsecurity and relation.relforcerowsecurity
      and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u12_context_owner')
  ) then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_FORCE_RLS_OR_OWNER_MISSING'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u12_context_owner'
    and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
    and not rolreplication and not rolinherit and not rolbypassrls)
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_OWNER_FLAGS_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.resolved_context_receipts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_resolved_context_authority_snapshot(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_resolved_context_package(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_GRANT_POSTCONDITION_FAILED'; end if;
  if exists (select 1 from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.proname in (
      'load_resolved_context_authority_snapshot','commit_resolved_context_package')
      and (not procedure.prosecdef or not procedure.proconfig @> array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_RPC_SECURITY_UNSAFE'; end if;
end
$postconditions$;
