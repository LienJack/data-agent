alter function app_data_agent.reject_knowledge_immutable_mutation() owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.knowledge_utc_millis(timestamptz) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.knowledge_assert_source_refs(jsonb,uuid,uuid,text,uuid) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.knowledge_enqueue_index_job(uuid,uuid,text,uuid,jsonb,jsonb,text) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.knowledge_build_resource_binding(uuid,uuid,text,uuid,uuid,bigint,text,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.register_knowledge_embedding_profile(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.list_knowledge_embedding_profiles(integer) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.create_knowledge_base(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.rebuild_knowledge_base(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.list_knowledge_bases(integer) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.load_knowledge_index_target(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.commit_knowledge_blocked_projection(jsonb,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.stage_knowledge_generation(jsonb,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.load_knowledge_search_snapshot(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.commit_knowledge_query_projection(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text) owner to data_agent_u15_knowledge_owner;

grant usage on schema app_data_agent,platform to data_agent_u15_knowledge_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.assert_job_active_lease(jsonb),
  app_data_agent.job_append_event(app_data_agent.jobs,text,jsonb)
to data_agent_u15_knowledge_owner;
grant select,insert,update on app_data_agent.jobs to data_agent_u15_knowledge_owner;
grant select on app_data_agent.job_attempts,
  app_data_agent.workspace_files,app_data_agent.workspace_file_revisions,
  app_data_agent.workspace_content_blobs
to data_agent_u15_knowledge_owner;

create policy jobs_u15_knowledge_all on app_data_agent.jobs
  as permissive for all to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_attempts_u15_knowledge_select on app_data_agent.job_attempts
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_files_u15_knowledge_select on app_data_agent.workspace_files
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_file_revisions_u15_knowledge_select on app_data_agent.workspace_file_revisions
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_content_blobs_u15_knowledge_select on app_data_agent.workspace_content_blobs
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

grant select on app_data_agent.knowledge_index_generations to data_agent_u10_job_owner;
create policy knowledge_generations_u10_job_select on app_data_agent.knowledge_index_generations
  as permissive for select to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

grant execute on function
  app_data_agent.knowledge_build_resource_binding(uuid,uuid,text,uuid,uuid,bigint,text,jsonb)
to data_agent_u6_file_owner;
grant execute on function
  app_data_agent.knowledge_assert_source_refs(jsonb,uuid,uuid,text,uuid),
  platform.backend_context_matches(uuid,uuid,text,boolean)
to data_agent_effective_config_rpc_owner;
grant select on app_data_agent.knowledge_embedding_profile_revisions,
  app_data_agent.knowledge_bases,app_data_agent.knowledge_base_revisions,
  app_data_agent.knowledge_index_generations
to data_agent_effective_config_rpc_owner;
grant update on app_data_agent.knowledge_bases to data_agent_effective_config_rpc_owner;
create policy knowledge_profiles_effective_select on app_data_agent.knowledge_embedding_profile_revisions
  as permissive for select to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_bases_effective_select on app_data_agent.knowledge_bases
  as permissive for select to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_bases_effective_update on app_data_agent.knowledge_bases
  as permissive for update to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (false);
create policy knowledge_base_revisions_effective_select on app_data_agent.knowledge_base_revisions
  as permissive for select to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_generations_effective_select on app_data_agent.knowledge_index_generations
  as permissive for select to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.knowledge_embedding_profile_revisions,
  app_data_agent.knowledge_bases,app_data_agent.knowledge_base_revisions,
  app_data_agent.knowledge_index_generations,app_data_agent.knowledge_projection_receipts,
  app_data_agent.knowledge_chunks,app_data_agent.knowledge_retrieval_receipts,
  app_data_agent.knowledge_idempotency
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function
  app_data_agent.register_knowledge_embedding_profile(jsonb),
  app_data_agent.list_knowledge_embedding_profiles(integer),
  app_data_agent.create_knowledge_base(jsonb),
  app_data_agent.rebuild_knowledge_base(jsonb),
  app_data_agent.list_knowledge_bases(integer),
  app_data_agent.load_knowledge_index_target(jsonb),
  app_data_agent.commit_knowledge_blocked_projection(jsonb,jsonb),
  app_data_agent.stage_knowledge_generation(jsonb,jsonb),
  app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb),
  app_data_agent.load_knowledge_search_snapshot(jsonb),
  app_data_agent.commit_knowledge_query_projection(jsonb),
  app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text)
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  app_data_agent.register_knowledge_embedding_profile(jsonb),
  app_data_agent.list_knowledge_embedding_profiles(integer),
  app_data_agent.create_knowledge_base(jsonb),
  app_data_agent.rebuild_knowledge_base(jsonb),
  app_data_agent.list_knowledge_bases(integer),
  app_data_agent.load_knowledge_index_target(jsonb),
  app_data_agent.commit_knowledge_blocked_projection(jsonb,jsonb),
  app_data_agent.stage_knowledge_generation(jsonb,jsonb),
  app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb),
  app_data_agent.load_knowledge_search_snapshot(jsonb),
  app_data_agent.commit_knowledge_query_projection(jsonb),
  app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text)
to data_agent_backend;

grant execute on function
  app_data_agent.build_requested_optional_resource_bindings(jsonb),
  app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
to data_agent_effective_config_rpc_owner;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'knowledge_embedding_profile_revisions','knowledge_bases','knowledge_base_revisions',
    'knowledge_index_generations','knowledge_projection_receipts','knowledge_chunks',
    'knowledge_retrieval_receipts','knowledge_idempotency'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u15_knowledge_owner')
    ) then raise exception using errcode='P0001',message='KNOWLEDGE_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u15_knowledge_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u15_knowledge_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='KNOWLEDGE_OWNER_FLAGS_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='KNOWLEDGE_INDEX' and handler_revision='knowledge-index-handler@1.0.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception using errcode='P0001',message='KNOWLEDGE_JOB_HANDLER_MISSING'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.knowledge_bases','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.create_knowledge_base(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.list_knowledge_bases(integer)','EXECUTE')
  then raise exception using errcode='P0001',message='KNOWLEDGE_GRANT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
