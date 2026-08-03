-- ============================================================
-- 10600: Cross-table FKs, indexes, and immutable triggers
-- ============================================================

-- ============================================================
-- Part 1: Immutable triggers for append-only tables
-- ============================================================

-- 1. research_budget_policy_versions
create trigger research_budget_policy_versions_immutable
  before update or delete on app_data_agent.research_budget_policy_versions
  for each row execute function platform.reject_immutable_mutation();

-- 2. research_enumerator_versions
create trigger research_enumerator_versions_immutable
  before update or delete on app_data_agent.research_enumerator_versions
  for each row execute function platform.reject_immutable_mutation();

-- 3. research_budget_events
create trigger research_budget_events_immutable
  before update or delete on app_data_agent.research_budget_events
  for each row execute function platform.reject_immutable_mutation();

-- 4. research_step_operations
create trigger research_step_operations_immutable
  before update or delete on app_data_agent.research_step_operations
  for each row execute function platform.reject_immutable_mutation();

-- 5. research_budget_ledger_receipts
create trigger research_budget_ledger_receipts_immutable
  before update or delete on app_data_agent.research_budget_ledger_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 6. research_coverage_derivation_receipts
create trigger research_coverage_derivation_receipts_immutable
  before update or delete on app_data_agent.research_coverage_derivation_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 7. research_candidate_enumerator_attestations
create trigger research_candidate_enumerator_attestations_immutable
  before update or delete on app_data_agent.research_candidate_enumerator_attestations
  for each row execute function platform.reject_immutable_mutation();

-- 8. research_candidate_enumeration_receipts
create trigger research_candidate_enumeration_receipts_immutable
  before update or delete on app_data_agent.research_candidate_enumeration_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 9. research_stop_derivation_receipts
create trigger research_stop_derivation_receipts_immutable
  before update or delete on app_data_agent.research_stop_derivation_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 10. research_input_events
create trigger research_input_events_immutable
  before update or delete on app_data_agent.research_input_events
  for each row execute function platform.reject_immutable_mutation();

-- 11. research_input_event_watermark_receipts
create trigger research_input_event_watermark_receipts_immutable
  before update or delete on app_data_agent.research_input_event_watermark_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 12. research_backend_artifact_commit_operations
create trigger research_backend_artifact_commit_operations_immutable
  before update or delete on app_data_agent.research_backend_artifact_commit_operations
  for each row execute function platform.reject_immutable_mutation();

-- 13. research_budget_ledger_input_bindings (companion)
create trigger research_budget_ledger_input_bindings_immutable
  before update or delete on app_data_agent.research_budget_ledger_input_bindings
  for each row execute function platform.reject_immutable_mutation();

-- 14. research_coverage_derivation_ref_bindings (companion)
create trigger research_coverage_derivation_ref_bindings_immutable
  before update or delete on app_data_agent.research_coverage_derivation_ref_bindings
  for each row execute function platform.reject_immutable_mutation();

-- 15. research_candidate_attestation_ref_bindings (companion)
create trigger research_candidate_attestation_ref_bindings_immutable
  before update or delete on app_data_agent.research_candidate_attestation_ref_bindings
  for each row execute function platform.reject_immutable_mutation();

-- 16. research_candidate_enumeration_ref_bindings (companion)
create trigger research_candidate_enumeration_ref_bindings_immutable
  before update or delete on app_data_agent.research_candidate_enumeration_ref_bindings
  for each row execute function platform.reject_immutable_mutation();

-- 17. research_stop_derivation_ref_bindings (companion)
create trigger research_stop_derivation_ref_bindings_immutable
  before update or delete on app_data_agent.research_stop_derivation_ref_bindings
  for each row execute function platform.reject_immutable_mutation();

-- ============================================================
-- Part 2: FK constraints from companion tables to parent tables
-- ============================================================

-- research_budget_ledger_input_bindings FK to research_budget_ledger_receipts
alter table app_data_agent.research_budget_ledger_input_bindings
  add constraint budget_input_bindings_receipt_fk
  foreign key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_coverage_derivation_ref_bindings FK to research_coverage_derivation_receipts
alter table app_data_agent.research_coverage_derivation_ref_bindings
  add constraint coverage_ref_bindings_receipt_fk
  foreign key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  references app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_candidate_attestation_ref_bindings FK to research_candidate_enumerator_attestations
alter table app_data_agent.research_candidate_attestation_ref_bindings
  add constraint attestation_ref_bindings_attestation_fk
  foreign key (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash)
  references app_data_agent.research_candidate_enumerator_attestations (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash)
  on delete restrict;

-- research_candidate_enumeration_ref_bindings FK to research_candidate_enumeration_receipts
alter table app_data_agent.research_candidate_enumeration_ref_bindings
  add constraint candidate_enum_ref_bindings_receipt_fk
  foreign key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  references app_data_agent.research_candidate_enumeration_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_stop_derivation_ref_bindings FK to research_stop_derivation_receipts
alter table app_data_agent.research_stop_derivation_ref_bindings
  add constraint stop_ref_bindings_receipt_fk
  foreign key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  references app_data_agent.research_stop_derivation_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- ============================================================
-- Part 3: FK constraints from companion tables to artifacts
-- ============================================================

-- Budget companion artifact FK
alter table app_data_agent.research_budget_ledger_input_bindings
  add constraint budget_input_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- Coverage companion artifact FK
alter table app_data_agent.research_coverage_derivation_ref_bindings
  add constraint coverage_ref_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- Attestation companion artifact FK
alter table app_data_agent.research_candidate_attestation_ref_bindings
  add constraint attestation_ref_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- Candidate Enumeration companion artifact FK
alter table app_data_agent.research_candidate_enumeration_ref_bindings
  add constraint candidate_enum_ref_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- Stop companion artifact FK
alter table app_data_agent.research_stop_derivation_ref_bindings
  add constraint stop_ref_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- ============================================================
-- Part 4: FK constraints from new tables to existing tables
-- ============================================================

-- research_budget_events FK to research_resource_run_heads
alter table app_data_agent.research_budget_events
  add constraint budget_events_run_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_resource_run_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_step_operations FK to research_resource_run_heads
alter table app_data_agent.research_step_operations
  add constraint step_operations_run_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_resource_run_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_step_operations FK to run_attempts
alter table app_data_agent.research_step_operations
  add constraint step_operations_attempt_fk
  foreign key (app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence)
  references app_data_agent.run_attempts (app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence)
  on delete restrict;

-- research_budget_ledger_receipts FK to research_resource_run_heads
alter table app_data_agent.research_budget_ledger_receipts
  add constraint budget_ledger_receipts_run_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_resource_run_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_coverage_derivation_receipts FK to research_budget_ledger_receipts
alter table app_data_agent.research_coverage_derivation_receipts
  add constraint coverage_receipts_budget_fk
  foreign key (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_candidate_enumerator_attestations FK to research_budget_ledger_receipts
alter table app_data_agent.research_candidate_enumerator_attestations
  add constraint attestations_budget_fk
  foreign key (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_candidate_enumeration_receipts FK to research_coverage_derivation_receipts
alter table app_data_agent.research_candidate_enumeration_receipts
  add constraint candidate_receipts_coverage_fk
  foreign key (app_id, tenant_id, environment, run_id, coverage_receipt_id, coverage_receipt_hash)
  references app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_candidate_enumeration_receipts FK to research_candidate_enumerator_attestations
alter table app_data_agent.research_candidate_enumeration_receipts
  add constraint candidate_receipts_attestation_fk
  foreign key (app_id, tenant_id, environment, run_id, enumerator_attestation_id, enumerator_attestation_hash)
  references app_data_agent.research_candidate_enumerator_attestations (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash)
  on delete restrict;

-- research_candidate_enumeration_receipts FK to research_budget_ledger_receipts
alter table app_data_agent.research_candidate_enumeration_receipts
  add constraint candidate_receipts_budget_fk
  foreign key (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_stop_derivation_receipts FK to research_coverage_derivation_receipts
alter table app_data_agent.research_stop_derivation_receipts
  add constraint stop_receipts_coverage_fk
  foreign key (app_id, tenant_id, environment, run_id, coverage_receipt_id, coverage_receipt_hash)
  references app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_stop_derivation_receipts FK to research_candidate_enumeration_receipts
alter table app_data_agent.research_stop_derivation_receipts
  add constraint stop_receipts_candidate_fk
  foreign key (app_id, tenant_id, environment, run_id, candidate_receipt_id, candidate_receipt_hash)
  references app_data_agent.research_candidate_enumeration_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_stop_derivation_receipts FK to research_budget_ledger_receipts
alter table app_data_agent.research_stop_derivation_receipts
  add constraint stop_receipts_budget_fk
  foreign key (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_input_events FK to research_input_event_heads
alter table app_data_agent.research_input_events
  add constraint input_events_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_input_event_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_input_event_watermark_receipts FK to research_input_event_heads
alter table app_data_agent.research_input_event_watermark_receipts
  add constraint watermark_receipts_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_input_event_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_backend_artifact_commit_operations FK to membership
alter table app_data_agent.research_backend_artifact_commit_operations
  add constraint backend_artifact_ops_membership_fk
  foreign key (app_id, tenant_id, environment, principal_id)
  references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
  on delete restrict;

-- ============================================================
-- Part 5: Indexes for semantic query paths
-- ============================================================

-- research_budget_policy_versions: lookup by tenant
create index idx_budget_policy_versions_tenant
  on app_data_agent.research_budget_policy_versions (app_id, tenant_id, environment);

-- research_enumerator_versions: lookup by tenant
create index idx_enumerator_versions_tenant
  on app_data_agent.research_enumerator_versions (app_id, tenant_id, environment);

-- research_budget_events: query by run_id, epoch, event_kind
create index idx_budget_events_run_epoch
  on app_data_agent.research_budget_events (app_id, tenant_id, environment, run_id, budget_epoch);
create index idx_budget_events_kind
  on app_data_agent.research_budget_events (app_id, tenant_id, environment, run_id, budget_epoch, event_kind);
create index idx_budget_events_chain
  on app_data_agent.research_budget_events (app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq, event_hash);

-- research_step_operations: query by run_id, step_kind, idempotency
create index idx_step_operations_run
  on app_data_agent.research_step_operations (app_id, tenant_id, environment, run_id);
create index idx_step_operations_kind
  on app_data_agent.research_step_operations (app_id, tenant_id, environment, run_id, step_kind);
create index idx_step_operations_attempt
  on app_data_agent.research_step_operations (app_id, tenant_id, environment, run_id, attempt_id);
create index idx_step_operations_budget
  on app_data_agent.research_step_operations (app_id, tenant_id, environment, run_id, budget_epoch, logical_step_id);

-- research_budget_ledger_receipts: query by run_id, epoch
create index idx_budget_ledger_receipts_run
  on app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id);
create index idx_budget_ledger_receipts_epoch
  on app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, budget_epoch);

-- research_coverage_derivation_receipts: query by budget receipt
create index idx_coverage_receipts_budget
  on app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash);

-- research_candidate_enumerator_attestations: query by budget receipt
create index idx_attestations_budget
  on app_data_agent.research_candidate_enumerator_attestations (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash);
create index idx_attestations_enumerator
  on app_data_agent.research_candidate_enumerator_attestations (app_id, tenant_id, environment, run_id, enumerator_version);

-- research_candidate_enumeration_receipts: query by coverage/attestation
create index idx_candidate_receipts_coverage
  on app_data_agent.research_candidate_enumeration_receipts (app_id, tenant_id, environment, run_id, coverage_receipt_id, coverage_receipt_hash);
create index idx_candidate_receipts_attestation
  on app_data_agent.research_candidate_enumeration_receipts (app_id, tenant_id, environment, run_id, enumerator_attestation_id, enumerator_attestation_hash);

-- research_stop_derivation_receipts: query by coverage/candidate
create index idx_stop_receipts_coverage
  on app_data_agent.research_stop_derivation_receipts (app_id, tenant_id, environment, run_id, coverage_receipt_id, coverage_receipt_hash);
create index idx_stop_receipts_candidate
  on app_data_agent.research_stop_derivation_receipts (app_id, tenant_id, environment, run_id, candidate_receipt_id, candidate_receipt_hash);
create index idx_stop_receipts_decision
  on app_data_agent.research_stop_derivation_receipts (app_id, tenant_id, environment, run_id, decision);

-- research_input_events: query chain
create index idx_input_events_chain
  on app_data_agent.research_input_events (app_id, tenant_id, environment, run_id, event_seq, event_hash);
create index idx_input_events_kind
  on app_data_agent.research_input_events (app_id, tenant_id, environment, run_id, event_kind);

-- research_input_event_watermark_receipts: query by head
create index idx_watermark_receipts_head
  on app_data_agent.research_input_event_watermark_receipts (app_id, tenant_id, environment, run_id, observed_event_seq);

-- research_backend_artifact_commit_operations: query by run
create index idx_backend_artifact_ops_run
  on app_data_agent.research_backend_artifact_commit_operations (app_id, tenant_id, environment, run_id);
create index idx_backend_artifact_ops_mode
  on app_data_agent.research_backend_artifact_commit_operations (app_id, tenant_id, environment, run_id, commit_mode);

-- Companion tables: query by parent
create index idx_budget_input_bindings_parent
  on app_data_agent.research_budget_ledger_input_bindings (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash);
create index idx_coverage_ref_bindings_parent
  on app_data_agent.research_coverage_derivation_ref_bindings (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash);
create index idx_attestation_ref_bindings_parent
  on app_data_agent.research_candidate_attestation_ref_bindings (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash);
create index idx_candidate_enum_ref_bindings_parent
  on app_data_agent.research_candidate_enumeration_ref_bindings (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash);
create index idx_stop_ref_bindings_parent
  on app_data_agent.research_stop_derivation_ref_bindings (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash);

-- Companion tables: query by artifact
create index idx_budget_input_bindings_artifact
  on app_data_agent.research_budget_ledger_input_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  where artifact_id is not null;
create index idx_coverage_ref_bindings_artifact
  on app_data_agent.research_coverage_derivation_ref_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash);
create index idx_attestation_ref_bindings_artifact
  on app_data_agent.research_candidate_attestation_ref_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash);
create index idx_candidate_enum_ref_bindings_artifact
  on app_data_agent.research_candidate_enumeration_ref_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash);
create index idx_stop_ref_bindings_artifact
  on app_data_agent.research_stop_derivation_ref_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash);
