do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'storage_retention_policy_revisions','workspace_content_blobs','workspace_files',
    'workspace_file_revisions','workspace_file_scan_receipts','workspace_file_deletion_receipts',
    'workspace_file_legal_holds','workspace_content_gc_receipts','workspace_file_idempotency'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u6_file_owner',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_u6_file_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      relation_name||'_u6_owner_all',relation_name
    );
  end loop;
end
$rls$;

alter function app_data_agent.reject_workspace_file_immutable_mutation() owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_utc_millis(timestamptz) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_scope_json(uuid,uuid,text) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_ref_json(uuid,bigint,text) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_default_retention_policy(uuid,uuid,text,uuid,timestamptz) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_build_revision(jsonb,uuid,bigint,jsonb,uuid,text,uuid,text,text,bigint,text,text,jsonb,jsonb,jsonb,jsonb,uuid,timestamptz) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_insert_revision(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.workspace_file_exact_revision(uuid,bigint,text,boolean) owner to data_agent_u6_file_owner;
alter function app_data_agent.commit_workspace_file_upload(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.list_workspace_files(uuid,integer) owner to data_agent_u6_file_owner;
alter function app_data_agent.get_workspace_file(uuid,bigint,text) owner to data_agent_u6_file_owner;
alter function app_data_agent.resolve_workspace_file_download(uuid,bigint,text) owner to data_agent_u6_file_owner;
alter function app_data_agent.promote_workspace_file(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.delete_workspace_file(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.set_workspace_file_legal_hold(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.load_workspace_file_for_scan(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.commit_workspace_file_scan(jsonb,jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.update_storage_retention_policy(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.evaluate_workspace_content_gc(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.commit_workspace_content_gc(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.classify_workspace_content_orphan(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.build_requested_optional_resource_bindings(jsonb) owner to data_agent_u6_file_owner;
alter function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb) owner to data_agent_u6_file_owner;

grant usage on schema app_data_agent,platform to data_agent_u6_file_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.assert_job_active_lease(jsonb),
  app_data_agent.job_append_event(app_data_agent.jobs,text,jsonb)
to data_agent_u6_file_owner;
grant select on app_data_agent.jobs,app_data_agent.job_attempts to data_agent_u6_file_owner;
grant select on app_data_agent.workspace_file_scan_receipts to data_agent_u10_job_owner;

create policy jobs_u6_file_select on app_data_agent.jobs
  as permissive for select to data_agent_u6_file_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy job_attempts_u6_file_select on app_data_agent.job_attempts
  as permissive for select to data_agent_u6_file_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_file_scan_receipts_u10_job_select
  on app_data_agent.workspace_file_scan_receipts
  as permissive for select to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.storage_retention_policy_revisions,
  app_data_agent.workspace_content_blobs,app_data_agent.workspace_files,
  app_data_agent.workspace_file_revisions,app_data_agent.workspace_file_scan_receipts,
  app_data_agent.workspace_file_deletion_receipts,app_data_agent.workspace_file_legal_holds,
  app_data_agent.workspace_content_gc_receipts,app_data_agent.workspace_file_idempotency
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function
  app_data_agent.commit_workspace_file_upload(jsonb),
  app_data_agent.list_workspace_files(uuid,integer),
  app_data_agent.get_workspace_file(uuid,bigint,text),
  app_data_agent.resolve_workspace_file_download(uuid,bigint,text),
  app_data_agent.promote_workspace_file(jsonb),
  app_data_agent.delete_workspace_file(jsonb),
  app_data_agent.set_workspace_file_legal_hold(jsonb),
  app_data_agent.load_workspace_file_for_scan(jsonb),
  app_data_agent.commit_workspace_file_scan(jsonb,jsonb),
  app_data_agent.update_storage_retention_policy(jsonb),
  app_data_agent.evaluate_workspace_content_gc(jsonb),
  app_data_agent.commit_workspace_content_gc(jsonb)
  ,app_data_agent.classify_workspace_content_orphan(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  app_data_agent.commit_workspace_file_upload(jsonb),
  app_data_agent.list_workspace_files(uuid,integer),
  app_data_agent.get_workspace_file(uuid,bigint,text),
  app_data_agent.resolve_workspace_file_download(uuid,bigint,text),
  app_data_agent.promote_workspace_file(jsonb),
  app_data_agent.delete_workspace_file(jsonb),
  app_data_agent.set_workspace_file_legal_hold(jsonb),
  app_data_agent.load_workspace_file_for_scan(jsonb),
  app_data_agent.commit_workspace_file_scan(jsonb,jsonb),
  app_data_agent.update_storage_retention_policy(jsonb),
  app_data_agent.evaluate_workspace_content_gc(jsonb),
  app_data_agent.commit_workspace_content_gc(jsonb)
  ,app_data_agent.classify_workspace_content_orphan(jsonb)
to data_agent_backend;

grant execute on function
  app_data_agent.build_requested_optional_resource_bindings(jsonb),
  app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
to data_agent_effective_config_rpc_owner;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'storage_retention_policy_revisions','workspace_content_blobs','workspace_files',
    'workspace_file_revisions','workspace_file_scan_receipts','workspace_file_deletion_receipts',
    'workspace_file_legal_holds','workspace_content_gc_receipts','workspace_file_idempotency'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u6_file_owner')
    ) then raise exception using errcode='P0001',message='WORKSPACE_FILES_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u6_file_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u6_file_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='WORKSPACE_FILES_OWNER_FLAGS_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='FILE_SCAN' and handler_revision='file-scan-handler@1.0.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception using errcode='P0001',message='WORKSPACE_FILES_JOB_HANDLER_MISSING'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.workspace_files','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_workspace_file_upload(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_workspace_file_scan(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.update_storage_retention_policy(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.evaluate_workspace_content_gc(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_workspace_content_gc(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.classify_workspace_content_orphan(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.get_workspace_file(uuid,bigint,text)','EXECUTE')
  then raise exception using errcode='P0001',message='WORKSPACE_FILES_GRANT_POSTCONDITION_FAILED'; end if;
  if not exists (select 1 from storage.buckets where id='data-agent-artifacts' and not public) then
    raise exception using errcode='P0001',message='WORKSPACE_FILES_PRIVATE_BUCKET_MISSING';
  end if;
end
$postconditions$;
