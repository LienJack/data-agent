-- ============================================================
-- 10622: Exact Candidate writer privileges and RLS
-- ============================================================

-- Foreign-key checks execute under relation-owner security context and require
-- namespace resolution. The data owner remains NOLOGIN/NOBYPASSRLS.
grant usage on schema semantic to data_agent_u6_data_owner;
grant usage on schema platform to data_agent_u6_rpc_owner;
grant usage on schema app_data_agent to data_agent_u6_rpc_owner;
grant execute on function platform.backend_context_matches(uuid, uuid, text, boolean)
  to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.contains_potential_plaintext_secret(jsonb, text)
  to data_agent_u6_rpc_owner;

-- Tighten the two broad policies installed by 10610 to the transaction-local
-- server authority context used by the Candidate writer.
alter policy semantic_domain_registry_tenant_isolation
  on semantic.semantic_domain_registry
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

alter policy semantic_authority_fence_tenant_isolation
  on semantic.semantic_authority_fence
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );

create policy semantic_active_pointer_candidate_scope_policy
  on semantic.semantic_active_pointer
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_source_revision_candidate_scope_policy
  on semantic.semantic_source_revision
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_candidate_draft_scope_policy
  on semantic.semantic_candidate
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
    and candidate_status = 'DRAFT'
  );

create policy semantic_candidate_revision_draft_scope_policy
  on semantic.semantic_candidate_revision
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy audit_log_semantic_candidate_rpc_insert
  on app_data_agent.audit_log
  for insert
  to data_agent_u6_rpc_owner
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(
      pg_catalog.current_setting('data_agent.principal_id', true),
      ''
    )::uuid
    and action = 'SEMANTIC_CANDIDATE_DRAFT_CREATED'
    and resource_type = 'semantic_candidate'
  );

grant select, update on table semantic.semantic_domain_registry to data_agent_u6_rpc_owner;
grant select, update on table semantic.semantic_authority_fence to data_agent_u6_rpc_owner;
grant select, update on table semantic.semantic_active_pointer to data_agent_u6_rpc_owner;
grant select, insert, update on table semantic.semantic_source_revision to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_candidate to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_candidate_revision to data_agent_u6_rpc_owner;
grant select, insert, update on table semantic.semantic_candidate_draft_idempotency
  to data_agent_u6_rpc_owner;
grant insert on table app_data_agent.audit_log to data_agent_u6_rpc_owner;

revoke all on table semantic.semantic_domain_registry from data_agent_backend;
revoke all on table semantic.semantic_authority_fence from data_agent_backend;
revoke all on table semantic.semantic_active_pointer from data_agent_backend;
revoke all on table semantic.semantic_source_revision from data_agent_backend;
revoke all on table semantic.semantic_candidate from data_agent_backend;
revoke all on table semantic.semantic_candidate_revision from data_agent_backend;
revoke all on table semantic.semantic_candidate_draft_idempotency from data_agent_backend;
