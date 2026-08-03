-- ============================================================
-- 10600: RLS, Policy, ACL, and Owner assignments
-- ============================================================

-- ============================================================
-- Part 1: Owner assignments for all 20 new tables
-- ============================================================

alter table app_data_agent.research_budget_policy_versions owner to data_agent_u6_data_owner;
alter table app_data_agent.research_budget_policy_heads owner to data_agent_u6_data_owner;
alter table app_data_agent.research_enumerator_versions owner to data_agent_u6_data_owner;
alter table app_data_agent.research_enumerator_version_heads owner to data_agent_u6_data_owner;
alter table app_data_agent.research_budget_events owner to data_agent_u6_data_owner;
alter table app_data_agent.research_step_operations owner to data_agent_u6_data_owner;
alter table app_data_agent.research_budget_ledger_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_coverage_derivation_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_candidate_enumerator_attestations owner to data_agent_u6_data_owner;
alter table app_data_agent.research_candidate_enumeration_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_stop_derivation_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_input_event_heads owner to data_agent_u6_data_owner;
alter table app_data_agent.research_input_events owner to data_agent_u6_data_owner;
alter table app_data_agent.research_input_event_watermark_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_backend_artifact_commit_operations owner to data_agent_u6_data_owner;
alter table app_data_agent.research_budget_ledger_input_bindings owner to data_agent_u6_data_owner;
alter table app_data_agent.research_coverage_derivation_ref_bindings owner to data_agent_u6_data_owner;
alter table app_data_agent.research_candidate_attestation_ref_bindings owner to data_agent_u6_data_owner;
alter table app_data_agent.research_candidate_enumeration_ref_bindings owner to data_agent_u6_data_owner;
alter table app_data_agent.research_stop_derivation_ref_bindings owner to data_agent_u6_data_owner;

-- ============================================================
-- Part 2: Enable RLS + FORCE RLS for all 20 new tables
-- ============================================================

alter table app_data_agent.research_budget_policy_versions enable row level security;
alter table app_data_agent.research_budget_policy_versions force row level security;

alter table app_data_agent.research_budget_policy_heads enable row level security;
alter table app_data_agent.research_budget_policy_heads force row level security;

alter table app_data_agent.research_enumerator_versions enable row level security;
alter table app_data_agent.research_enumerator_versions force row level security;

alter table app_data_agent.research_enumerator_version_heads enable row level security;
alter table app_data_agent.research_enumerator_version_heads force row level security;

alter table app_data_agent.research_budget_events enable row level security;
alter table app_data_agent.research_budget_events force row level security;

alter table app_data_agent.research_step_operations enable row level security;
alter table app_data_agent.research_step_operations force row level security;

alter table app_data_agent.research_budget_ledger_receipts enable row level security;
alter table app_data_agent.research_budget_ledger_receipts force row level security;

alter table app_data_agent.research_coverage_derivation_receipts enable row level security;
alter table app_data_agent.research_coverage_derivation_receipts force row level security;

alter table app_data_agent.research_candidate_enumerator_attestations enable row level security;
alter table app_data_agent.research_candidate_enumerator_attestations force row level security;

alter table app_data_agent.research_candidate_enumeration_receipts enable row level security;
alter table app_data_agent.research_candidate_enumeration_receipts force row level security;

alter table app_data_agent.research_stop_derivation_receipts enable row level security;
alter table app_data_agent.research_stop_derivation_receipts force row level security;

alter table app_data_agent.research_input_event_heads enable row level security;
alter table app_data_agent.research_input_event_heads force row level security;

alter table app_data_agent.research_input_events enable row level security;
alter table app_data_agent.research_input_events force row level security;

alter table app_data_agent.research_input_event_watermark_receipts enable row level security;
alter table app_data_agent.research_input_event_watermark_receipts force row level security;

alter table app_data_agent.research_backend_artifact_commit_operations enable row level security;
alter table app_data_agent.research_backend_artifact_commit_operations force row level security;

alter table app_data_agent.research_budget_ledger_input_bindings enable row level security;
alter table app_data_agent.research_budget_ledger_input_bindings force row level security;

alter table app_data_agent.research_coverage_derivation_ref_bindings enable row level security;
alter table app_data_agent.research_coverage_derivation_ref_bindings force row level security;

alter table app_data_agent.research_candidate_attestation_ref_bindings enable row level security;
alter table app_data_agent.research_candidate_attestation_ref_bindings force row level security;

alter table app_data_agent.research_candidate_enumeration_ref_bindings enable row level security;
alter table app_data_agent.research_candidate_enumeration_ref_bindings force row level security;

alter table app_data_agent.research_stop_derivation_ref_bindings enable row level security;
alter table app_data_agent.research_stop_derivation_ref_bindings force row level security;

-- ============================================================
-- Part 3: RLS policies for each table
-- ============================================================

-- Common pattern for immutable tables (append-only):
-- - data_owner: full access (owner bypasses RLS)
-- - rpc_owner: SELECT, INSERT
-- - cleanup_owner: SELECT, DELETE
-- - provisioner_owner: SELECT, INSERT (for head tables)

-- 1. research_budget_policy_versions (immutable)
create policy budget_policy_versions_rpc_select
  on app_data_agent.research_budget_policy_versions for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_policy_versions_rpc_insert
  on app_data_agent.research_budget_policy_versions for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_policy_versions_cleanup_delete
  on app_data_agent.research_budget_policy_versions for delete
  to data_agent_u6_cleanup_owner using (true);
create policy budget_policy_versions_provisioner_insert
  on app_data_agent.research_budget_policy_versions for insert
  to data_agent_u6_provisioner_owner with check (true);

-- 2. research_budget_policy_heads (mutable head)
create policy budget_policy_heads_rpc_select
  on app_data_agent.research_budget_policy_heads for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_policy_heads_rpc_insert
  on app_data_agent.research_budget_policy_heads for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_policy_heads_rpc_update
  on app_data_agent.research_budget_policy_heads for update
  to data_agent_u6_rpc_owner using (true) with check (true);
create policy budget_policy_heads_cleanup_delete
  on app_data_agent.research_budget_policy_heads for delete
  to data_agent_u6_cleanup_owner using (true);
create policy budget_policy_heads_provisioner_insert
  on app_data_agent.research_budget_policy_heads for insert
  to data_agent_u6_provisioner_owner with check (true);
create policy budget_policy_heads_provisioner_update
  on app_data_agent.research_budget_policy_heads for update
  to data_agent_u6_provisioner_owner using (true) with check (true);

-- 3. research_enumerator_versions (immutable)
create policy enumerator_versions_rpc_select
  on app_data_agent.research_enumerator_versions for select
  to data_agent_u6_rpc_owner using (true);
create policy enumerator_versions_rpc_insert
  on app_data_agent.research_enumerator_versions for insert
  to data_agent_u6_rpc_owner with check (true);
create policy enumerator_versions_cleanup_delete
  on app_data_agent.research_enumerator_versions for delete
  to data_agent_u6_cleanup_owner using (true);
create policy enumerator_versions_provisioner_insert
  on app_data_agent.research_enumerator_versions for insert
  to data_agent_u6_provisioner_owner with check (true);

-- 4. research_enumerator_version_heads (mutable head)
create policy enumerator_version_heads_rpc_select
  on app_data_agent.research_enumerator_version_heads for select
  to data_agent_u6_rpc_owner using (true);
create policy enumerator_version_heads_rpc_insert
  on app_data_agent.research_enumerator_version_heads for insert
  to data_agent_u6_rpc_owner with check (true);
create policy enumerator_version_heads_rpc_update
  on app_data_agent.research_enumerator_version_heads for update
  to data_agent_u6_rpc_owner using (true) with check (true);
create policy enumerator_version_heads_cleanup_delete
  on app_data_agent.research_enumerator_version_heads for delete
  to data_agent_u6_cleanup_owner using (true);
create policy enumerator_version_heads_provisioner_insert
  on app_data_agent.research_enumerator_version_heads for insert
  to data_agent_u6_provisioner_owner with check (true);
create policy enumerator_version_heads_provisioner_update
  on app_data_agent.research_enumerator_version_heads for update
  to data_agent_u6_provisioner_owner using (true) with check (true);

-- 5. research_budget_events (immutable)
create policy budget_events_rpc_select
  on app_data_agent.research_budget_events for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_events_rpc_insert
  on app_data_agent.research_budget_events for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_events_cleanup_delete
  on app_data_agent.research_budget_events for delete
  to data_agent_u6_cleanup_owner using (true);

-- 6. research_step_operations (immutable)
create policy step_operations_rpc_select
  on app_data_agent.research_step_operations for select
  to data_agent_u6_rpc_owner using (true);
create policy step_operations_rpc_insert
  on app_data_agent.research_step_operations for insert
  to data_agent_u6_rpc_owner with check (true);
create policy step_operations_cleanup_delete
  on app_data_agent.research_step_operations for delete
  to data_agent_u6_cleanup_owner using (true);

-- 7. research_budget_ledger_receipts (immutable receipt)
create policy budget_ledger_receipts_rpc_select
  on app_data_agent.research_budget_ledger_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_ledger_receipts_rpc_insert
  on app_data_agent.research_budget_ledger_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_ledger_receipts_cleanup_delete
  on app_data_agent.research_budget_ledger_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 8. research_coverage_derivation_receipts (immutable receipt)
create policy coverage_receipts_rpc_select
  on app_data_agent.research_coverage_derivation_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy coverage_receipts_rpc_insert
  on app_data_agent.research_coverage_derivation_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy coverage_receipts_cleanup_delete
  on app_data_agent.research_coverage_derivation_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 9. research_candidate_enumerator_attestations (immutable)
create policy attestations_rpc_select
  on app_data_agent.research_candidate_enumerator_attestations for select
  to data_agent_u6_rpc_owner using (true);
create policy attestations_rpc_insert
  on app_data_agent.research_candidate_enumerator_attestations for insert
  to data_agent_u6_rpc_owner with check (true);
create policy attestations_cleanup_delete
  on app_data_agent.research_candidate_enumerator_attestations for delete
  to data_agent_u6_cleanup_owner using (true);

-- 10. research_candidate_enumeration_receipts (immutable receipt v2)
create policy candidate_receipts_rpc_select
  on app_data_agent.research_candidate_enumeration_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy candidate_receipts_rpc_insert
  on app_data_agent.research_candidate_enumeration_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy candidate_receipts_cleanup_delete
  on app_data_agent.research_candidate_enumeration_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 11. research_stop_derivation_receipts (immutable receipt v2)
create policy stop_receipts_rpc_select
  on app_data_agent.research_stop_derivation_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy stop_receipts_rpc_insert
  on app_data_agent.research_stop_derivation_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy stop_receipts_cleanup_delete
  on app_data_agent.research_stop_derivation_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 12. research_input_event_heads (mutable head)
create policy input_event_heads_rpc_select
  on app_data_agent.research_input_event_heads for select
  to data_agent_u6_rpc_owner using (true);
create policy input_event_heads_rpc_insert
  on app_data_agent.research_input_event_heads for insert
  to data_agent_u6_rpc_owner with check (true);
create policy input_event_heads_rpc_update
  on app_data_agent.research_input_event_heads for update
  to data_agent_u6_rpc_owner using (true) with check (true);
create policy input_event_heads_cleanup_delete
  on app_data_agent.research_input_event_heads for delete
  to data_agent_u6_cleanup_owner using (true);

-- 13. research_input_events (immutable)
create policy input_events_rpc_select
  on app_data_agent.research_input_events for select
  to data_agent_u6_rpc_owner using (true);
create policy input_events_rpc_insert
  on app_data_agent.research_input_events for insert
  to data_agent_u6_rpc_owner with check (true);
create policy input_events_cleanup_delete
  on app_data_agent.research_input_events for delete
  to data_agent_u6_cleanup_owner using (true);

-- 14. research_input_event_watermark_receipts (immutable receipt)
create policy watermark_receipts_rpc_select
  on app_data_agent.research_input_event_watermark_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy watermark_receipts_rpc_insert
  on app_data_agent.research_input_event_watermark_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy watermark_receipts_cleanup_delete
  on app_data_agent.research_input_event_watermark_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 15. research_backend_artifact_commit_operations (immutable)
create policy backend_artifact_ops_rpc_select
  on app_data_agent.research_backend_artifact_commit_operations for select
  to data_agent_u6_rpc_owner using (true);
create policy backend_artifact_ops_rpc_insert
  on app_data_agent.research_backend_artifact_commit_operations for insert
  to data_agent_u6_rpc_owner with check (true);
create policy backend_artifact_ops_cleanup_delete
  on app_data_agent.research_backend_artifact_commit_operations for delete
  to data_agent_u6_cleanup_owner using (true);

-- 16. research_budget_ledger_input_bindings (companion, immutable)
create policy budget_input_bindings_rpc_select
  on app_data_agent.research_budget_ledger_input_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_input_bindings_rpc_insert
  on app_data_agent.research_budget_ledger_input_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_input_bindings_cleanup_delete
  on app_data_agent.research_budget_ledger_input_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- 17. research_coverage_derivation_ref_bindings (companion, immutable)
create policy coverage_ref_bindings_rpc_select
  on app_data_agent.research_coverage_derivation_ref_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy coverage_ref_bindings_rpc_insert
  on app_data_agent.research_coverage_derivation_ref_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy coverage_ref_bindings_cleanup_delete
  on app_data_agent.research_coverage_derivation_ref_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- 18. research_candidate_attestation_ref_bindings (companion, immutable)
create policy attestation_ref_bindings_rpc_select
  on app_data_agent.research_candidate_attestation_ref_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy attestation_ref_bindings_rpc_insert
  on app_data_agent.research_candidate_attestation_ref_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy attestation_ref_bindings_cleanup_delete
  on app_data_agent.research_candidate_attestation_ref_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- 19. research_candidate_enumeration_ref_bindings (companion, immutable)
create policy candidate_enum_ref_bindings_rpc_select
  on app_data_agent.research_candidate_enumeration_ref_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy candidate_enum_ref_bindings_rpc_insert
  on app_data_agent.research_candidate_enumeration_ref_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy candidate_enum_ref_bindings_cleanup_delete
  on app_data_agent.research_candidate_enumeration_ref_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- 20. research_stop_derivation_ref_bindings (companion, immutable)
create policy stop_ref_bindings_rpc_select
  on app_data_agent.research_stop_derivation_ref_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy stop_ref_bindings_rpc_insert
  on app_data_agent.research_stop_derivation_ref_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy stop_ref_bindings_cleanup_delete
  on app_data_agent.research_stop_derivation_ref_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- ============================================================
-- Part 4: GRANT permissions for RPC owner
-- ============================================================

-- Immutable tables: SELECT, INSERT
grant select, insert on app_data_agent.research_budget_policy_versions to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_enumerator_versions to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_budget_events to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_step_operations to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_budget_ledger_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_coverage_derivation_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_candidate_enumerator_attestations to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_candidate_enumeration_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_stop_derivation_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_input_events to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_input_event_watermark_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_backend_artifact_commit_operations to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_budget_ledger_input_bindings to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_coverage_derivation_ref_bindings to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_candidate_attestation_ref_bindings to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_candidate_enumeration_ref_bindings to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_stop_derivation_ref_bindings to data_agent_u6_rpc_owner;

-- Mutable head tables: SELECT, INSERT, UPDATE
grant select, insert, update on app_data_agent.research_budget_policy_heads to data_agent_u6_rpc_owner;
grant select, insert, update on app_data_agent.research_enumerator_version_heads to data_agent_u6_rpc_owner;
grant select, insert, update on app_data_agent.research_input_event_heads to data_agent_u6_rpc_owner;

-- ============================================================
-- Part 5: GRANT permissions for cleanup owner
-- ============================================================

grant select, delete on app_data_agent.research_budget_policy_versions to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_budget_policy_heads to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_enumerator_versions to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_enumerator_version_heads to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_budget_events to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_step_operations to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_budget_ledger_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_coverage_derivation_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_candidate_enumerator_attestations to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_candidate_enumeration_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_stop_derivation_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_input_event_heads to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_input_events to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_input_event_watermark_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_backend_artifact_commit_operations to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_budget_ledger_input_bindings to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_coverage_derivation_ref_bindings to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_candidate_attestation_ref_bindings to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_candidate_enumeration_ref_bindings to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_stop_derivation_ref_bindings to data_agent_u6_cleanup_owner;

-- ============================================================
-- Part 6: GRANT permissions for provisioner owner
-- ============================================================

grant select, insert on app_data_agent.research_budget_policy_versions to data_agent_u6_provisioner_owner;
grant select, insert, update on app_data_agent.research_budget_policy_heads to data_agent_u6_provisioner_owner;
grant select, insert on app_data_agent.research_enumerator_versions to data_agent_u6_provisioner_owner;
grant select, insert, update on app_data_agent.research_enumerator_version_heads to data_agent_u6_provisioner_owner;

-- ============================================================
-- Part 7: REVOKE public/backend/service_role from new tables
-- ============================================================

revoke all on all tables in schema app_data_agent from public;
revoke all on all tables in schema app_data_agent from anon;
revoke all on all tables in schema app_data_agent from authenticated;
revoke all on all tables in schema app_data_agent from service_role;
revoke all on all tables in schema app_data_agent from data_agent_backend;

-- ============================================================
-- Part 8: Revoke artifacts INSERT/UPDATE/DELETE from backend
-- ============================================================

revoke insert, update, delete on app_data_agent.artifacts from data_agent_backend;
revoke insert, update, delete on app_data_agent.artifacts from service_role;
