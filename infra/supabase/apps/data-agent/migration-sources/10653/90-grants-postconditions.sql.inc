alter table app_data_agent.workspace_run_defaults owner to data_agent_effective_config_rpc_owner;
alter table app_data_agent.workspace_run_default_revisions owner to data_agent_effective_config_rpc_owner;
alter table app_data_agent.effective_run_config_receipts owner to data_agent_effective_config_rpc_owner;
alter table app_data_agent.effective_run_config_resource_bindings owner to data_agent_effective_config_rpc_owner;
alter table app_data_agent.effective_config_context_receipts owner to data_agent_effective_config_rpc_owner;

alter function app_data_agent.reject_effective_config_authority_mutation()
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.u2_utf16_sort_key(text)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.u2_ecmascript_number(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.u2_contract_canonical_json(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.u2_canonical_sha256(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.guard_datasource_resource_version_update()
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.guard_workspace_run_defaults_update()
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.canonical_uuid_json_string_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.versioned_resource_reference_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.versioned_resource_array_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.builtin_effective_config_policy(text)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.requested_defaults_resource_reference_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.requested_defaults_resource_array_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.requested_resource_selection_is_valid(jsonb,boolean)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.workspace_run_defaults_document_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.effective_config_request_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_unavailable_singleton_resource_binding(jsonb,jsonb,text,text)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_optional_selection_evaluations(jsonb,jsonb,jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.update_workspace_run_defaults(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.get_workspace_run_defaults()
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_question_run_config_resolution(uuid,jsonb,uuid,jsonb,text,jsonb,jsonb,jsonb,jsonb,timestamptz,text,text,jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.load_effective_run_config(uuid,bigint,text,uuid)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)
  owner to data_agent_effective_config_rpc_owner;

-- The NOLOGIN owner receives read-only, exact-scope RLS visibility needed by
-- the resolver. Backend remains unable to read the five U2 authority tables.
create policy app_users_effective_config_owner_select
on app_data_agent.app_users for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy app_users_effective_config_owner_lock
on app_data_agent.app_users for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
) with check (false);
create policy workspaces_effective_config_owner_select
on app_data_agent.workspaces for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and workspace_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy workspaces_effective_config_owner_lock
on app_data_agent.workspaces for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and workspace_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy memberships_effective_config_owner_select
on app_data_agent.memberships for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy runs_effective_config_owner_select
on app_data_agent.runs for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy run_events_effective_config_owner_select
on app_data_agent.run_events for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy audit_log_effective_config_owner_select
on app_data_agent.audit_log for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy qa_conversations_effective_config_owner_select
on app_data_agent.qa_conversations for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy qa_conversations_effective_config_owner_update
on app_data_agent.qa_conversations for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
) with check (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy workspace_run_bindings_effective_config_owner_select
on app_data_agent.workspace_run_bindings for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy workspace_run_bindings_effective_config_owner_insert
on app_data_agent.workspace_run_bindings for insert to data_agent_effective_config_rpc_owner with check (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy qa_messages_effective_config_owner_select
on app_data_agent.qa_messages for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy qa_messages_effective_config_owner_insert
on app_data_agent.qa_messages for insert to data_agent_effective_config_rpc_owner with check (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy idempotency_effective_config_owner_select
on app_data_agent.idempotency_records for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy datasource_effective_config_owner_select
on app_data_agent.datasource_connections for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy datasource_effective_config_owner_lock
on app_data_agent.datasource_connections for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy model_catalog_effective_config_owner_select
on app_data_agent.model_catalog_entries for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy model_catalog_effective_config_owner_lock
on app_data_agent.model_catalog_entries for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy semantic_domain_effective_config_owner_select
on semantic.semantic_domain_registry for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy semantic_domain_effective_config_owner_lock
on semantic.semantic_domain_registry for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy semantic_pointer_effective_config_owner_select
on semantic.semantic_active_pointer for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy semantic_pointer_effective_config_owner_lock
on semantic.semantic_active_pointer for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy semantic_release_effective_config_owner_select
on semantic.semantic_source_release for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy semantic_release_effective_config_owner_lock
on semantic.semantic_source_release for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy schema_snapshot_effective_config_owner_select
on catalog.physical_schema_snapshot for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy schema_snapshot_effective_config_owner_lock
on catalog.physical_schema_snapshot for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy schema_scan_run_effective_config_owner_select
on catalog.schema_scan_run for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy run_attempts_effective_config_owner_select
on app_data_agent.run_attempts for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy run_attempts_effective_config_owner_lock
on app_data_agent.run_attempts for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy outbox_effective_config_owner_select
on app_data_agent.outbox for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy outbox_effective_config_owner_lock
on app_data_agent.outbox for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);

grant usage on schema app_data_agent, platform, semantic, catalog
  to data_agent_effective_config_rpc_owner;
grant select on table
  app_data_agent.app_users,
  app_data_agent.workspaces,
  app_data_agent.memberships,
  app_data_agent.runs,
  app_data_agent.run_events,
  app_data_agent.audit_log,
  app_data_agent.idempotency_records,
  app_data_agent.datasource_connections,
  app_data_agent.model_catalog_entries,
  app_data_agent.qa_conversations,
  app_data_agent.workspace_run_bindings,
  app_data_agent.qa_messages,
  app_data_agent.run_attempts,
  app_data_agent.outbox,
  semantic.semantic_domain_registry,
  semantic.semantic_active_pointer,
  semantic.semantic_source_release,
  catalog.physical_schema_snapshot,
  catalog.schema_scan_run
to data_agent_effective_config_rpc_owner;
-- PostgreSQL requires UPDATE privilege to acquire FOR SHARE row locks. No
-- UPDATE RLS policy is granted, so the owner still cannot mutate these rows.
grant update on table
  app_data_agent.app_users,
  app_data_agent.workspaces,
  app_data_agent.qa_conversations,
  app_data_agent.datasource_connections,
  app_data_agent.model_catalog_entries,
  app_data_agent.run_attempts,
  app_data_agent.outbox,
  semantic.semantic_domain_registry,
  semantic.semantic_active_pointer,
  semantic.semantic_source_release,
  catalog.physical_schema_snapshot
to data_agent_effective_config_rpc_owner;
grant select,insert,update on table app_data_agent.workspace_run_defaults
  to data_agent_effective_config_rpc_owner;
grant select,insert on table
  app_data_agent.workspace_run_default_revisions,
  app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_run_config_resource_bindings,
  app_data_agent.effective_config_context_receipts
to data_agent_effective_config_rpc_owner;
grant insert on table app_data_agent.workspace_run_bindings, app_data_agent.qa_messages
  to data_agent_effective_config_rpc_owner;

grant execute on function platform.current_backend_authority(boolean)
  to data_agent_effective_config_rpc_owner;
grant execute on function platform.canonical_sha256(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.attribution_canonical_json(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.u2_utf16_sort_key(text)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.u2_ecmascript_number(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.u2_contract_canonical_json(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.u2_canonical_sha256(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function platform.list_active_model_catalog(uuid,uuid)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.contains_potential_plaintext_secret(jsonb,text)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.runtime_canonical_sha256(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.runtime_iso_timestamp(timestamptz)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.lock_owned_run_fence(uuid)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_question_run_config_resolution(uuid,jsonb,uuid,jsonb,text,jsonb,jsonb,jsonb,jsonb,timestamptz,text,text,jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_unavailable_singleton_resource_binding(jsonb,jsonb,text,text)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_optional_selection_evaluations(jsonb,jsonb,jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.builtin_effective_config_policy(text)
  to data_agent_effective_config_rpc_owner;

revoke all on function app_data_agent.update_workspace_run_defaults(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.requested_defaults_resource_reference_is_valid(jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.requested_defaults_resource_array_is_valid(jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.build_unavailable_singleton_resource_binding(jsonb,jsonb,text,text)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.build_optional_selection_evaluations(jsonb,jsonb,jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.guard_datasource_resource_version_update()
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.get_workspace_run_defaults()
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.build_question_run_config_resolution(uuid,jsonb,uuid,jsonb,text,jsonb,jsonb,jsonb,jsonb,timestamptz,text,text,jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.load_effective_run_config(uuid,bigint,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)
  from public, anon, authenticated, service_role, data_agent_backend;

grant execute on function app_data_agent.update_workspace_run_defaults(jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.get_workspace_run_defaults()
  to data_agent_backend;
grant execute on function app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.load_effective_run_config(uuid,bigint,text,uuid)
  to data_agent_backend;
grant execute on function app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)
  to data_agent_backend;

do $postconditions$
declare
  relation_name text;
  function_record record;
begin
  if (select rolcanlogin from pg_catalog.pg_roles where rolname = 'data_agent_effective_config_rpc_owner')
    or (select rolsuper from pg_catalog.pg_roles where rolname = 'data_agent_effective_config_rpc_owner')
  then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_CONFIG_RPC_OWNER_UNSAFE';
  end if;

  foreach relation_name in array array[
    'workspace_run_defaults','workspace_run_default_revisions',
    'effective_run_config_receipts','effective_run_config_resource_bindings',
    'effective_config_context_receipts'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = relation_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'EFFECTIVE_CONFIG_TABLE_AUTHORITY_UNSAFE';
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'datasource_connections'
      and attribute.attname = 'resource_version'
      and attribute.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
      and attribute.attnotnull
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'datasource_connections'
      and trigger.tgname = 'zz_datasource_resource_version_guard'
      and not trigger.tgisinternal
  ) or pg_catalog.pg_get_functiondef(
    'app_data_agent.guard_datasource_resource_version_update()'::pg_catalog.regprocedure
  ) not like '%new.resource_version := old.resource_version + 1%'
  then
    raise exception using errcode = 'P0001', message = 'DATASOURCE_RESOURCE_VERSION_AUTHORITY_UNSAFE';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname in (
        'workspace_run_defaults','workspace_run_default_revisions',
        'effective_run_config_receipts','effective_run_config_resource_bindings',
        'effective_config_context_receipts'
      )
      and not attribute.attisdropped
      and attribute.attname ~ '(billing|price|credit|cost|settlement)'
  ) then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_CONFIG_COMMERCIAL_SURFACE_FORBIDDEN';
  end if;

  for function_record in
    select procedure.oid,procedure.prosecdef,
      pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
      procedure.proconfig,
      pg_catalog.format('%I.%I(%s)',namespace.nspname,procedure.proname,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)) as signature
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_data_agent'
      and procedure.proname in (
        'update_workspace_run_defaults','get_workspace_run_defaults',
        'accept_question_run_with_effective_config','resolve_semantic_bootstrap_job_config',
        'revalidate_effective_run_config_internal',
        'load_effective_run_config','consume_worker_effective_run_config'
      )
  loop
    if not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_effective_config_rpc_owner'
      or not ('search_path=""' = any(function_record.proconfig))
    then
      raise exception using errcode = 'P0001', message =
        'EFFECTIVE_CONFIG_SECURITY_DEFINER_UNSAFE:' || function_record.signature;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_CONFIG_FUNCTION_GRANTS_UNSAFE';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_data_agent'
      and procedure.proname = 'u2_canonical_sha256'
      and procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'data_agent_effective_config_rpc_owner'
      and 'search_path=""' = any(procedure.proconfig)
  ) or not pg_catalog.has_function_privilege(
    'data_agent_effective_config_rpc_owner',
    'app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_effective_config_rpc_owner',
    'app_data_agent.attribution_canonical_json(jsonb)','EXECUTE'
  ) or exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))
    ) as privilege
    where namespace.nspname = 'app_data_agent'
      and procedure.proname = 'u2_canonical_sha256'
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend','app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'U2_CANONICAL_HASH_AUTHORITY_UNSAFE';
  end if;
end
$postconditions$;
