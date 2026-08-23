alter table app_data_agent.semantic_binding_impact_receipts owner to data_agent_u11_induction_owner;
alter function app_data_agent.reject_semantic_binding_impact_mutation() owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_binding_impact_exact_keys(jsonb,text[]) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_binding_impact_uuid_v8(text) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_binding_impact_utc_millis(timestamptz) owner to data_agent_u11_induction_owner;
alter function app_data_agent.load_semantic_binding_impact_authority(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.commit_semantic_binding_impact(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.get_semantic_binding_impact(jsonb) owner to data_agent_u11_induction_owner;

grant usage on schema app_data_agent,platform,semantic,catalog to data_agent_u11_induction_owner;
grant execute on function platform.current_backend_authority(boolean),platform.canonical_sha256(jsonb),
  platform.backend_context_matches(uuid,uuid,text,boolean),app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)
to data_agent_u11_induction_owner;
grant select on catalog.schema_drift_event,semantic.semantic_source_release,semantic.semantic_active_pointer,
  semantic.initial_semantic_release_sets,semantic.initial_semantic_release_package_bindings,
  semantic.ontology_package_candidates to data_agent_u11_induction_owner;

create policy semantic_binding_impact_receipts_u11_all on app_data_agent.semantic_binding_impact_receipts
  for all to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy schema_drift_event_u11_binding_select on catalog.schema_drift_event
  for select to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy initial_release_set_u11_binding_select on semantic.initial_semantic_release_sets
  for select to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy initial_release_binding_u11_binding_select on semantic.initial_semantic_release_package_bindings
  for select to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy ontology_package_u11_binding_select on semantic.ontology_package_candidates
  for select to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.semantic_binding_impact_receipts from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.reject_semantic_binding_impact_mutation(),
  app_data_agent.semantic_binding_impact_exact_keys(jsonb,text[]),app_data_agent.semantic_binding_impact_uuid_v8(text),
  app_data_agent.semantic_binding_impact_utc_millis(timestamptz),
  app_data_agent.load_semantic_binding_impact_authority(jsonb),app_data_agent.commit_semantic_binding_impact(jsonb),
  app_data_agent.get_semantic_binding_impact(jsonb) from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_semantic_binding_impact_authority(jsonb),
  app_data_agent.commit_semantic_binding_impact(jsonb),app_data_agent.get_semantic_binding_impact(jsonb)
to data_agent_backend;

do $postconditions$
begin
  if not exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
      on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname='semantic_binding_impact_receipts' and relation.relrowsecurity and relation.relforcerowsecurity
      and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u11_induction_owner'))
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_RLS_OR_OWNER_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.semantic_binding_impact_receipts','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_semantic_binding_impact_authority(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_semantic_binding_impact(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.get_semantic_binding_impact(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_GRANT_UNSAFE'; end if;
  if exists(select 1 from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid=procedure.pronamespace where namespace.nspname='app_data_agent'
    and procedure.proname in ('load_semantic_binding_impact_authority','commit_semantic_binding_impact','get_semantic_binding_impact')
    and (not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_RPC_SECURITY_UNSAFE'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.load_semantic_binding_impact_authority_v1(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.load_semantic_binding_impact_authority_v2(jsonb)') is not null
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_COMPATIBILITY_RPC_UNSAFE'; end if;
end
$postconditions$;
