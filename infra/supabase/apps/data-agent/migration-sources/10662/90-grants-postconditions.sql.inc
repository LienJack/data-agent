alter function app_data_agent.reject_semantic_induction_immutable_mutation() owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_assert_source(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_assert_request(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_utc_millis(timestamptz) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_assert_base_release(jsonb,uuid,uuid,text) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_stable_object_id(text) owner to data_agent_u11_induction_owner;
alter function app_data_agent.register_semantic_induction_source(text,jsonb,jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.load_semantic_induction_target(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.record_semantic_induction_rejection(jsonb,jsonb) owner to data_agent_u11_induction_owner;

grant usage on schema app_data_agent,platform,semantic,catalog to data_agent_u11_induction_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.assert_job_active_lease(jsonb),
  semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)
to data_agent_u11_induction_owner;
grant select on app_data_agent.jobs,app_data_agent.job_attempts,
  app_data_agent.knowledge_base_revisions,app_data_agent.knowledge_index_generations,
  app_data_agent.knowledge_chunks,app_data_agent.knowledge_projection_receipts,
  catalog.schema_scan_run,catalog.physical_schema_snapshot,semantic.semantic_source_release,
  semantic.semantic_active_pointer
to data_agent_u11_induction_owner;

create policy jobs_u11_induction_select on app_data_agent.jobs
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy job_attempts_u11_induction_select on app_data_agent.job_attempts
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_revisions_u11_induction_select on app_data_agent.knowledge_base_revisions
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_generations_u11_induction_select on app_data_agent.knowledge_index_generations
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_chunks_u11_induction_select on app_data_agent.knowledge_chunks
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_projection_u11_induction_select on app_data_agent.knowledge_projection_receipts
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy schema_scan_u11_induction_select on catalog.schema_scan_run
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy schema_snapshot_u11_induction_select on catalog.physical_schema_snapshot
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_release_u11_induction_select on semantic.semantic_source_release
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_active_pointer_u11_induction_select on semantic.semantic_active_pointer
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

grant select on app_data_agent.semantic_induction_receipts to data_agent_u15_knowledge_owner;
create policy semantic_induction_receipts_u15_job_output_select on app_data_agent.semantic_induction_receipts
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.semantic_induction_source_packages,
  app_data_agent.semantic_induction_proposals,app_data_agent.semantic_impact_plans,
  app_data_agent.semantic_metric_dry_run_receipts,app_data_agent.semantic_induction_receipts
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  app_data_agent.register_semantic_induction_source(text,jsonb,jsonb),
  app_data_agent.load_semantic_induction_target(jsonb),
  app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb),
  app_data_agent.record_semantic_induction_rejection(jsonb,jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  app_data_agent.reject_semantic_induction_immutable_mutation(),
  app_data_agent.semantic_induction_assert_source(jsonb),
  app_data_agent.semantic_induction_assert_request(jsonb),
  app_data_agent.semantic_induction_assert_base_release(jsonb,uuid,uuid,text),
  app_data_agent.semantic_induction_utc_millis(timestamptz),
  app_data_agent.semantic_induction_stable_object_id(text)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function
  app_data_agent.reject_semantic_induction_immutable_mutation(),
  app_data_agent.semantic_induction_assert_source(jsonb),
  app_data_agent.semantic_induction_assert_request(jsonb),
  app_data_agent.semantic_induction_assert_base_release(jsonb,uuid,uuid,text),
  app_data_agent.semantic_induction_utc_millis(timestamptz),
  app_data_agent.semantic_induction_stable_object_id(text)
to data_agent_u11_induction_owner;
grant execute on function
  app_data_agent.register_semantic_induction_source(text,jsonb,jsonb),
  app_data_agent.load_semantic_induction_target(jsonb),
  app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb),
  app_data_agent.record_semantic_induction_rejection(jsonb,jsonb)
to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'semantic_induction_source_packages','semantic_induction_proposals','semantic_impact_plans',
    'semantic_metric_dry_run_receipts','semantic_induction_receipts'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u11_induction_owner')
    ) then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u11_induction_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u11_induction_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_OWNER_FLAGS_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='SEMANTIC_INDUCTION' and handler_revision='semantic-induction-handler@1.1.0'
      and enabled and dependencies_ready and output_receipt_required
  ) or not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='METRIC_IMPORT' and handler_revision='metric-import-handler@1.1.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_JOB_HANDLERS_MISSING'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.semantic_induction_receipts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_semantic_induction_target(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.record_semantic_induction_rejection(jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.register_semantic_induction_source(text,jsonb,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_GRANT_POSTCONDITION_FAILED'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.proname in (
        'register_semantic_induction_source','load_semantic_induction_target',
        'commit_semantic_induction_candidate','record_semantic_induction_rejection'
      ) and (not procedure.prosecdef or not procedure.proconfig @> array['search_path=""']::text[])
  ) then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_RPC_SECURITY_UNSAFE'; end if;
end
$postconditions$;
