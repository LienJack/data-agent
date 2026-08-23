-- ============================================================
-- 10610: RLS, policy, ACL, and owner assignments for semantic schema
-- ============================================================

-- ============================================================
-- Part 1: Owner assignments for all 31 semantic tables
-- ============================================================

alter table semantic.semantic_domain_registry owner to data_agent_u6_data_owner;
alter table semantic.semantic_domain_bootstrap owner to data_agent_u6_data_owner;
alter table semantic.semantic_authority_fence owner to data_agent_u6_data_owner;
alter table semantic.semantic_reviewer_policy_revision owner to data_agent_u6_data_owner;
alter table semantic.semantic_reviewer_assignment owner to data_agent_u6_data_owner;
alter table semantic.semantic_reviewer_policy_pointer owner to data_agent_u6_data_owner;
alter table semantic.semantic_catalog_fence owner to data_agent_u6_data_owner;
alter table semantic.semantic_dependency_pointer owner to data_agent_u6_data_owner;
alter table semantic.semantic_source_revision owner to data_agent_u6_data_owner;
alter table semantic.semantic_candidate owner to data_agent_u6_data_owner;
alter table semantic.semantic_candidate_revision owner to data_agent_u6_data_owner;
alter table semantic.semantic_validation_receipt owner to data_agent_u6_data_owner;
alter table semantic.semantic_review_task owner to data_agent_u6_data_owner;
alter table semantic.semantic_review_decision owner to data_agent_u6_data_owner;
alter table semantic.semantic_publish_attempt owner to data_agent_u6_data_owner;
alter table semantic.semantic_source_release owner to data_agent_u6_data_owner;
alter table semantic.semantic_executable_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_relationship_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_runtime_restriction_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_descriptive_contribution_profile_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_active_pointer owner to data_agent_u6_data_owner;
alter table semantic.semantic_grounding_issuer_draft owner to data_agent_u6_data_owner;
alter table semantic.semantic_runtime_projection_binding owner to data_agent_u6_data_owner;
alter table semantic.semantic_runtime_activation owner to data_agent_u6_data_owner;
alter table semantic.semantic_legacy_equivalence_attempt owner to data_agent_u6_data_owner;
alter table semantic.semantic_legacy_compatible_mirror owner to data_agent_u6_data_owner;
alter table semantic.semantic_legacy_equivalence_receipt owner to data_agent_u6_data_owner;
alter table semantic.semantic_legacy_closure_authorization owner to data_agent_u6_data_owner;
alter table semantic.semantic_rollback_authorization owner to data_agent_u6_data_owner;
alter table semantic.semantic_rollback_receipt owner to data_agent_u6_data_owner;
alter table semantic.semantic_outbox owner to data_agent_u6_data_owner;

-- ============================================================
-- Part 2: Enable RLS + FORCE RLS for all 31 semantic tables
-- ============================================================

alter table semantic.semantic_domain_registry enable row level security;
alter table semantic.semantic_domain_registry force row level security;

alter table semantic.semantic_domain_bootstrap enable row level security;
alter table semantic.semantic_domain_bootstrap force row level security;

alter table semantic.semantic_authority_fence enable row level security;
alter table semantic.semantic_authority_fence force row level security;

alter table semantic.semantic_reviewer_policy_revision enable row level security;
alter table semantic.semantic_reviewer_policy_revision force row level security;

alter table semantic.semantic_reviewer_assignment enable row level security;
alter table semantic.semantic_reviewer_assignment force row level security;

alter table semantic.semantic_reviewer_policy_pointer enable row level security;
alter table semantic.semantic_reviewer_policy_pointer force row level security;

alter table semantic.semantic_catalog_fence enable row level security;
alter table semantic.semantic_catalog_fence force row level security;

alter table semantic.semantic_dependency_pointer enable row level security;
alter table semantic.semantic_dependency_pointer force row level security;

alter table semantic.semantic_source_revision enable row level security;
alter table semantic.semantic_source_revision force row level security;

alter table semantic.semantic_candidate enable row level security;
alter table semantic.semantic_candidate force row level security;

alter table semantic.semantic_candidate_revision enable row level security;
alter table semantic.semantic_candidate_revision force row level security;

alter table semantic.semantic_validation_receipt enable row level security;
alter table semantic.semantic_validation_receipt force row level security;

alter table semantic.semantic_review_task enable row level security;
alter table semantic.semantic_review_task force row level security;

alter table semantic.semantic_review_decision enable row level security;
alter table semantic.semantic_review_decision force row level security;

alter table semantic.semantic_publish_attempt enable row level security;
alter table semantic.semantic_publish_attempt force row level security;

alter table semantic.semantic_source_release enable row level security;
alter table semantic.semantic_source_release force row level security;

alter table semantic.semantic_executable_projection enable row level security;
alter table semantic.semantic_executable_projection force row level security;

alter table semantic.semantic_relationship_projection enable row level security;
alter table semantic.semantic_relationship_projection force row level security;

alter table semantic.semantic_runtime_restriction_projection enable row level security;
alter table semantic.semantic_runtime_restriction_projection force row level security;

alter table semantic.semantic_descriptive_contribution_profile_projection enable row level security;
alter table semantic.semantic_descriptive_contribution_profile_projection force row level security;

alter table semantic.semantic_active_pointer enable row level security;
alter table semantic.semantic_active_pointer force row level security;

alter table semantic.semantic_grounding_issuer_draft enable row level security;
alter table semantic.semantic_grounding_issuer_draft force row level security;

alter table semantic.semantic_runtime_projection_binding enable row level security;
alter table semantic.semantic_runtime_projection_binding force row level security;

alter table semantic.semantic_runtime_activation enable row level security;
alter table semantic.semantic_runtime_activation force row level security;

alter table semantic.semantic_legacy_equivalence_attempt enable row level security;
alter table semantic.semantic_legacy_equivalence_attempt force row level security;

alter table semantic.semantic_legacy_compatible_mirror enable row level security;
alter table semantic.semantic_legacy_compatible_mirror force row level security;

alter table semantic.semantic_legacy_equivalence_receipt enable row level security;
alter table semantic.semantic_legacy_equivalence_receipt force row level security;

alter table semantic.semantic_legacy_closure_authorization enable row level security;
alter table semantic.semantic_legacy_closure_authorization force row level security;

alter table semantic.semantic_rollback_authorization enable row level security;
alter table semantic.semantic_rollback_authorization force row level security;

alter table semantic.semantic_rollback_receipt enable row level security;
alter table semantic.semantic_rollback_receipt force row level security;

alter table semantic.semantic_outbox enable row level security;
alter table semantic.semantic_outbox force row level security;

-- ============================================================
-- Part 3: RLS policies for semantic tables
-- App/Tenant/Environment/SemanticDomain isolation
-- ============================================================

-- Example RLS policy for semantic_domain_registry
create policy semantic_domain_registry_tenant_isolation
  on semantic.semantic_domain_registry
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

-- Example RLS policy for semantic_authority_fence
create policy semantic_authority_fence_tenant_isolation
  on semantic.semantic_authority_fence
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Part 4: Function grants
-- ============================================================

-- Grant EXECUTE on internal functions to appropriate roles
grant execute on function semantic.lock_semantic_authority_fence(uuid, uuid, text, text) to data_agent_u6_rpc_owner;
grant execute on function semantic.lock_packet(uuid, uuid, text, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function semantic.verify_current_review_policy(uuid, uuid, text, text, bigint, text) to data_agent_u6_rpc_owner;
grant execute on function semantic.semantic_sha256(text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function semantic.assert_review_packet_open(uuid, uuid, text, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function semantic.verify_principal_not_excluded(text, jsonb) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on decision RPC to A2 Human Reviewer role
grant execute on function semantic.record_review_decision(uuid, uuid, text, text, uuid, text, text, text, text) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on publish RPC to A8 Publisher role
grant execute on function semantic.prepare_publish_attempt(uuid, uuid, text, text, uuid, uuid, text, bigint, bigint, bigint, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function semantic.commit_publish_attempt(uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on rollback RPC to A8 Publisher role
grant execute on function semantic.execute_rollback(uuid, uuid, text, text, uuid, uuid, text) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on bootstrap RPC to A3 Admin role
grant execute on function semantic.bootstrap_domain(
  uuid, uuid, text, text, uuid, text, text, text, text, text, text, jsonb, text, jsonb, text, text, text, uuid, timestamptz
) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on lifecycle cleanup functions
grant execute on function semantic.expire_stale_review_packets(uuid, uuid, text, text, integer) to data_agent_u6_rpc_owner;
grant execute on function semantic.expire_stale_publish_attempts(uuid, uuid, text, text, integer) to data_agent_u6_rpc_owner;
grant execute on function semantic.expire_stale_bootstrap_packets(uuid, uuid, text, text, integer) to data_agent_u6_rpc_owner;

-- ============================================================
-- Part 5: Schema USAGE grants
-- ============================================================
do $semantic_roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_web_role') then
    create role data_agent_u6_web_role
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_worker_role') then
    create role data_agent_u6_worker_role
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
end
$semantic_roles$;

grant usage on schema semantic to data_agent_u6_rpc_owner;
grant usage on schema semantic to data_agent_u6_web_role;
grant usage on schema semantic to data_agent_u6_worker_role;
