do $u6_relation_ownership_and_rls$
declare
  relation_name text;
  u6_job_relations constant text[] := array[
    'current_report_readiness',
    'report_read_grant_expiration_operations',
    'report_read_grants',
    'research_adapter_termination_receipts',
    'research_artifact_commit_operations',
    'research_authority_capabilities',
    'research_authority_capability_heads',
    'research_current_evidence_relation_keys',
    'research_domain_terminals',
    'research_frontier_events',
    'research_frontier_operations',
    'research_invocation_commits',
    'research_invocation_outcome_usage',
    'research_invocation_request_operations',
    'research_invocation_result_blobs',
    'research_invocation_results',
    'research_invocation_terminal_preparations',
    'research_invocation_transition_operations',
    'research_readiness_consumptions',
    'research_readiness_publications',
    'research_release_decision_commits',
    'research_resource_reservations',
    'research_resource_run_heads',
    'research_resource_transition_operations',
    'research_result_access_audit_purge_operations',
    'research_result_access_audit_retention_heads',
    'research_result_access_audit_retention_policies',
    'research_result_ciphertext_access_audits',
    'research_result_key_transition_operations',
    'research_result_key_versions',
    'research_result_retention_policies',
    'research_result_retention_policy_heads',
    'research_revocation_operations',
    'research_secure_sql_execution_receipts',
    'research_stop_terminal_commits',
    'research_system_artifacts',
    'research_system_record_identities',
    'research_system_record_transition_operations',
    'research_tool_invocation_permits',
    'research_tool_permit_policy_limits',
    'research_version_frontiers'
  ];
  retained_relations constant text[] := array[
    'research_lifecycle_cleanup_batch_receipts',
    'research_lifecycle_cleanup_operations'
  ];
  rpc_scope_predicate constant text :=
    'app_id = nullif(pg_catalog.current_setting(''data_agent.app_id'', true), '''')::uuid'
    || ' and tenant_id = nullif(pg_catalog.current_setting(''data_agent.tenant_id'', true), '''')::uuid'
    || ' and environment = pg_catalog.current_setting(''data_agent.environment'', true)';
  cleanup_scope_predicate constant text :=
    'current_user = ''data_agent_u6_cleanup_owner'''
    || ' and app_id = nullif(pg_catalog.current_setting(''app.u6_cleanup_app_id'', true), '''')::uuid'
    || ' and environment = pg_catalog.current_setting(''app.u6_cleanup_environment'', true)'
    || ' and nullif(pg_catalog.current_setting(''app.u6_cleanup_operation_id'', true), '''')::uuid is not null'
    || ' and nullif(pg_catalog.current_setting(''app.u6_cleanup_batch_id'', true), '''')::uuid is not null';
begin
  foreach relation_name in array u6_job_relations || retained_relations
  loop
    execute pg_catalog.format(
      'alter table app_data_agent.%I owner to data_agent_u6_data_owner',
      relation_name
    );
    execute pg_catalog.format(
      'alter table app_data_agent.%I enable row level security',
      relation_name
    );
    execute pg_catalog.format(
      'alter table app_data_agent.%I force row level security',
      relation_name
    );
    execute pg_catalog.format(
      'revoke all privileges on table app_data_agent.%I from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority, data_agent_u6_rpc_owner, data_agent_u6_provisioner_owner, data_agent_u6_cleanup_owner',
      relation_name
    );
  end loop;

  foreach relation_name in array u6_job_relations
  loop
    if pg_catalog.octet_length(relation_name || '_u6_rpc') > 63
      or pg_catalog.octet_length(relation_name || '_u6_cleanup') > 63
    then
      raise exception using
        errcode = '42622',
        message = 'U6_MIGRATION_POLICY_IDENTIFIER_TOO_LONG';
    end if;
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I as permissive for all to data_agent_u6_rpc_owner using (%s) with check (%s)',
      relation_name || '_u6_rpc',
      relation_name,
      rpc_scope_predicate,
      rpc_scope_predicate
    );
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I as permissive for all to data_agent_u6_cleanup_owner using (%s) with check (%s)',
      relation_name || '_u6_cleanup',
      relation_name,
      cleanup_scope_predicate,
      cleanup_scope_predicate
    );
    execute pg_catalog.format(
      'grant select, insert, update, delete on table app_data_agent.%I to data_agent_u6_rpc_owner',
      relation_name
    );
    execute pg_catalog.format(
      'grant select, insert, update, delete on table app_data_agent.%I to data_agent_u6_cleanup_owner',
      relation_name
    );
  end loop;

  create policy research_lifecycle_cleanup_operations_u6_cleanup_scope
  on app_data_agent.research_lifecycle_cleanup_operations
  as permissive
  for all
  to data_agent_u6_cleanup_owner
  using (
    current_user = 'data_agent_u6_cleanup_owner'
    and app_id =
      nullif(pg_catalog.current_setting('app.u6_cleanup_app_id', true), '')::uuid
    and environment =
      pg_catalog.current_setting('app.u6_cleanup_environment', true)
    and operation_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_operation_id', true),
        ''
      )::uuid
    and nullif(
      pg_catalog.current_setting('app.u6_cleanup_batch_id', true),
      ''
    )::uuid is not null
  )
  with check (
    current_user = 'data_agent_u6_cleanup_owner'
    and app_id =
      nullif(pg_catalog.current_setting('app.u6_cleanup_app_id', true), '')::uuid
    and environment =
      pg_catalog.current_setting('app.u6_cleanup_environment', true)
    and operation_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_operation_id', true),
        ''
      )::uuid
    and nullif(
      pg_catalog.current_setting('app.u6_cleanup_batch_id', true),
      ''
    )::uuid is not null
  );

  create policy research_lifecycle_cleanup_batch_receipts_u6_cleanup_scope
  on app_data_agent.research_lifecycle_cleanup_batch_receipts
  as permissive
  for all
  to data_agent_u6_cleanup_owner
  using (
    current_user = 'data_agent_u6_cleanup_owner'
    and app_id =
      nullif(pg_catalog.current_setting('app.u6_cleanup_app_id', true), '')::uuid
    and environment =
      pg_catalog.current_setting('app.u6_cleanup_environment', true)
    and operation_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_operation_id', true),
        ''
      )::uuid
    and batch_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_batch_id', true),
        ''
      )::uuid
  )
  with check (
    current_user = 'data_agent_u6_cleanup_owner'
    and app_id =
      nullif(pg_catalog.current_setting('app.u6_cleanup_app_id', true), '')::uuid
    and environment =
      pg_catalog.current_setting('app.u6_cleanup_environment', true)
    and operation_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_operation_id', true),
        ''
      )::uuid
    and batch_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_batch_id', true),
        ''
      )::uuid
  );
end
$u6_relation_ownership_and_rls$;

grant select, insert, update
on table app_data_agent.research_lifecycle_cleanup_operations
to data_agent_u6_cleanup_owner;
grant select, insert
on table app_data_agent.research_lifecycle_cleanup_batch_receipts
to data_agent_u6_cleanup_owner;

do $u6_provisioner_rls$
declare
  relation_name text;
  provisioner_relations constant text[] := array[
    'research_authority_capabilities',
    'research_authority_capability_heads',
    'research_result_access_audit_purge_operations',
    'research_result_access_audit_retention_heads',
    'research_result_access_audit_retention_policies',
    'research_result_ciphertext_access_audits',
    'research_result_key_transition_operations',
    'research_result_key_versions',
    'research_result_retention_policies',
    'research_result_retention_policy_heads',
    'research_tool_permit_policy_limits'
  ];
  provision_scope_predicate constant text :=
    'current_user = ''data_agent_u6_provisioner_owner'''
    || ' and app_id = nullif(pg_catalog.current_setting(''app.u6_provision_app_id'', true), '''')::uuid'
    || ' and tenant_id = nullif(pg_catalog.current_setting(''app.u6_provision_tenant_id'', true), '''')::uuid'
    || ' and environment = pg_catalog.current_setting(''app.u6_provision_environment'', true)';
begin
  foreach relation_name in array provisioner_relations
  loop
    if pg_catalog.octet_length(relation_name || '_u6_provision') > 63 then
      raise exception using
        errcode = '42622',
        message = 'U6_MIGRATION_POLICY_IDENTIFIER_TOO_LONG';
    end if;
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I as permissive for all to data_agent_u6_provisioner_owner using (%s) with check (%s)',
      relation_name || '_u6_provision',
      relation_name,
      provision_scope_predicate,
      provision_scope_predicate
    );
    execute pg_catalog.format(
      'grant select, insert, update, delete on table app_data_agent.%I to data_agent_u6_provisioner_owner',
      relation_name
    );
  end loop;
end
$u6_provisioner_rls$;

-- PostgreSQL RI triggers resolve referenced U6 tables under their relation
-- owner. The owner is intentionally NOLOGIN/NOINHERIT, but still needs schema
-- lookup permission for exact foreign-key enforcement.
grant usage on schema app_data_agent
to data_agent_u6_data_owner;

grant usage on schema
  app_data_agent,
  platform
to
  data_agent_u6_rpc_owner,
  data_agent_u6_provisioner_owner,
  data_agent_u6_cleanup_owner,
  data_agent_u6_platform_lock_owner;
grant usage on schema app_data_agent
to data_agent_u6_provisioner, data_agent_job_authority;
grant usage on schema extensions
to
  data_agent_u6_rpc_owner,
  data_agent_u6_provisioner_owner;

grant execute on function platform.current_backend_authority(boolean)
to data_agent_u6_rpc_owner, data_agent_u6_platform_lock_owner;
grant execute on function platform.backend_run_object_matches(
  uuid, uuid, text, uuid, boolean
) to data_agent_u6_rpc_owner;
grant execute on function platform.acquire_lifecycle_shared_lock(uuid, text)
to data_agent_u6_platform_lock_owner;
grant execute on function platform.acquire_lifecycle_exclusive_lock(uuid, text)
to data_agent_u6_cleanup_owner;
grant execute on function app_data_agent.runtime_canonical_json(jsonb)
to
  data_agent_u6_rpc_owner,
  data_agent_u6_provisioner_owner,
  data_agent_u6_cleanup_owner;

grant select on table
  platform.deployment_mappings,
  platform.app_environment_lifecycle,
  app_data_agent.memberships
to data_agent_u6_platform_lock_owner;
grant update (deployment_id)
on table platform.deployment_mappings
to data_agent_u6_platform_lock_owner;
grant update (app_id)
on table platform.app_environment_lifecycle
to data_agent_u6_platform_lock_owner;
grant update (principal_id)
on table app_data_agent.memberships
to data_agent_u6_platform_lock_owner;

grant select on table
  platform.resource_manifests,
  platform.app_lifecycle_events,
  platform.boundary_audit_receipts,
  platform.resource_operation_receipts
to data_agent_u6_platform_lock_owner;
grant update (manifest_id)
on table platform.resource_manifests
to data_agent_u6_platform_lock_owner;
grant update (event_id)
on table platform.app_lifecycle_events
to data_agent_u6_platform_lock_owner;
grant update (receipt_id)
on table platform.boundary_audit_receipts
to data_agent_u6_platform_lock_owner;
grant update (operation_receipt_id)
on table platform.resource_operation_receipts
to data_agent_u6_platform_lock_owner;

create policy memberships_u6_platform_lock_select
on app_data_agent.memberships
as permissive
for select
to data_agent_u6_platform_lock_owner
using (
  platform.backend_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    false
  )
);
create policy memberships_u6_platform_lock_update
on app_data_agent.memberships
as permissive
for update
to data_agent_u6_platform_lock_owner
using (
  platform.backend_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    false
  )
)
with check (false);
grant execute on function platform.backend_principal_object_matches(
  uuid, uuid, text, uuid, boolean
) to data_agent_u6_platform_lock_owner;

grant select on table
  app_data_agent.runs,
  app_data_agent.outbox,
  app_data_agent.run_attempts
to data_agent_u6_rpc_owner;
grant update (run_id) on table app_data_agent.runs
to data_agent_u6_rpc_owner;
grant update (outbox_id) on table app_data_agent.outbox
to data_agent_u6_rpc_owner;
grant update (attempt_id) on table app_data_agent.run_attempts
to data_agent_u6_rpc_owner;

create policy runs_u6_rpc_lock_select
on app_data_agent.runs
as permissive
for select
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
);
create policy runs_u6_rpc_lock_update
on app_data_agent.runs
as permissive
for update
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
)
with check (false);

create policy outbox_u6_rpc_lock_select
on app_data_agent.outbox
as permissive
for select
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
);
create policy outbox_u6_rpc_lock_update
on app_data_agent.outbox
as permissive
for update
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, true
  )
)
with check (false);

create policy run_attempts_u6_rpc_lock_select
on app_data_agent.run_attempts
as permissive
for select
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
);
create policy run_attempts_u6_rpc_lock_update
on app_data_agent.run_attempts
as permissive
for update
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, true
  )
)
with check (false);

grant select, insert on table app_data_agent.artifacts
to data_agent_u6_rpc_owner;
create policy artifacts_u6_rpc_select
on app_data_agent.artifacts
as permissive
for select
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
);
create policy artifacts_u6_rpc_insert
on app_data_agent.artifacts
as permissive
for insert
to data_agent_u6_rpc_owner
with check (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, true
  )
);

create policy artifacts_u6_reserved_insert_deny
on app_data_agent.artifacts
as restrictive
for insert
to data_agent_backend
with check (
  artifact_type not in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
);
create policy artifacts_u6_reserved_update_deny
on app_data_agent.artifacts
as restrictive
for update
to data_agent_backend
using (
  artifact_type not in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
)
with check (
  artifact_type not in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
);
create policy artifacts_u6_reserved_delete_deny
on app_data_agent.artifacts
as restrictive
for delete
to data_agent_backend
using (
  artifact_type not in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
);

alter function platform.lock_u6_authority_binding(
  uuid, uuid, text, uuid, uuid, text, text
) owner to data_agent_u6_platform_lock_owner;
alter function platform.lock_u6_cleanup_platform_evidence(
  uuid, text, bigint, uuid, text, uuid, text, uuid, text, uuid, text
) owner to data_agent_u6_platform_lock_owner;

alter function app_data_agent.u6_domain_sha256(text, jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.u6_uuid_v5(uuid, bytea)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.u6_strict_base64url_decode(text)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.u6_constant_time_equal(bytea, bytea)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.lock_u6_authority_capability(
  jsonb, text, text, text, text, boolean
) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_research_revocation_receipt(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_research_system_artifact(jsonb)
owner to data_agent_u6_rpc_owner;

alter function app_data_agent.abort_invocation_terminal_preparation(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.advance_research_version_frontier(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.authorize_agent_data_projection(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.cancel_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_adapter_termination_receipt(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_current_l2_artifact(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_current_release_go(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_invocation_terminal(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_report_read_response(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_research_stop_terminal(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.consume_current_ready(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.consume_report_read_grant(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.erase_subject_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.expire_report_read_grant(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.expire_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.expire_tool_invocation_permit(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.initialize_research_version_frontier(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.issue_tool_invocation_permit(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.mark_research_invocation_outcome_unknown(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.mark_research_resource_abandoned(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.prepare_invocation_terminal(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.publish_current_report_readiness(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.reserve_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.revoke_current_readiness(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.revoke_tool_invocation_permit(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.settle_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.start_research_invocation(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.tombstone_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_historical_l2_research_artifact(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_adapter_termination_receipt(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_invocation_outcome_usage(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_model_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_secure_sql_execution_receipt(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_sql_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_tool_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_current_tool_invocation_permit(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_invocation_result_ciphertext(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_invocation_terminal_preparation_recovery_metadata(jsonb)
owner to data_agent_u6_rpc_owner;

alter function app_data_agent.activate_u6_result_key_version(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.compromise_u6_result_key_version(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.provision_u6_authority_manifest(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.provision_u6_execution_policy_manifest(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.purge_u6_result_ciphertext_access_audits(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.retire_u6_result_key_version(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.stage_u6_result_key_version(jsonb)
owner to data_agent_u6_provisioner_owner;

do $u6_function_ownership_and_acl$
declare
  function_name text;
  public_functions constant text[] := array[
    'abort_invocation_terminal_preparation',
    'advance_research_version_frontier',
    'authorize_agent_data_projection',
    'begin_research_resource',
    'cancel_research_resource',
    'commit_adapter_termination_receipt',
    'commit_current_l2_artifact',
    'commit_current_release_go',
    'commit_invocation_terminal',
    'commit_report_read_response',
    'commit_research_stop_terminal',
    'consume_current_ready',
    'consume_report_read_grant',
    'erase_subject_invocation_result',
    'expire_report_read_grant',
    'expire_research_resource',
    'expire_tool_invocation_permit',
    'initialize_research_version_frontier',
    'issue_tool_invocation_permit',
    'mark_research_invocation_outcome_unknown',
    'mark_research_resource_abandoned',
    'prepare_invocation_terminal',
    'publish_current_report_readiness',
    'reserve_research_resource',
    'revoke_current_readiness',
    'revoke_tool_invocation_permit',
    'settle_research_resource',
    'start_research_invocation',
    'tombstone_invocation_result',
    'read_historical_l2_research_artifact',
    'resolve_committed_adapter_termination_receipt',
    'resolve_committed_invocation_outcome_usage',
    'resolve_committed_model_invocation_result',
    'resolve_committed_secure_sql_execution_receipt',
    'resolve_committed_sql_invocation_result',
    'resolve_committed_tool_invocation_result',
    'resolve_current_tool_invocation_permit',
    'resolve_invocation_result_ciphertext',
    'resolve_invocation_terminal_preparation_recovery_metadata'
  ];
  backend_enabled_functions constant text[] := array[
    'commit_research_stop_terminal',
    'consume_current_ready',
    'publish_current_report_readiness'
  ];
  deployment_functions constant text[] := array[
    'activate_u6_result_key_version',
    'compromise_u6_result_key_version',
    'provision_u6_authority_manifest',
    'provision_u6_execution_policy_manifest',
    'purge_u6_result_ciphertext_access_audits',
    'retire_u6_result_key_version',
    'stage_u6_result_key_version'
  ];
begin
  if pg_catalog.cardinality(backend_enabled_functions) <> 3
    or (
      select pg_catalog.count(distinct enabled.function_name)
      from pg_catalog.unnest(backend_enabled_functions)
        as enabled(function_name)
    ) <> 3
    or exists (
      select 1
      from pg_catalog.unnest(backend_enabled_functions)
        as enabled(function_name)
      where not (enabled.function_name = any(public_functions))
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_BACKEND_FUNCTION_CLOSED_SET_MISMATCH';
  end if;

  -- C1 only activates the three Root RPCs whose bodies are fixed fail-closed
  -- after capability validation. Every positive/read path stays dormant until
  -- its strict database verifier and real PostgreSQL Oracle are certified.
  foreach function_name in array public_functions
  loop
    execute pg_catalog.format(
      'revoke all privileges on function app_data_agent.%I(jsonb) from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority, data_agent_u6_provisioner',
      function_name
    );
    if function_name = any(backend_enabled_functions) then
      execute pg_catalog.format(
        'grant execute on function app_data_agent.%I(jsonb) to data_agent_backend',
        function_name
      );
    end if;
  end loop;

  foreach function_name in array deployment_functions
  loop
    execute pg_catalog.format(
      'revoke all privileges on function app_data_agent.%I(jsonb) from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority',
      function_name
    );
    execute pg_catalog.format(
      'grant execute on function app_data_agent.%I(jsonb) to data_agent_u6_provisioner',
      function_name
    );
  end loop;
end
$u6_function_ownership_and_acl$;

alter function app_data_agent.cleanup_u6_delete_pending_environment(jsonb)
owner to data_agent_u6_cleanup_owner;
revoke all privileges
on function app_data_agent.cleanup_u6_delete_pending_environment(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_u6_provisioner;
grant execute
on function app_data_agent.cleanup_u6_delete_pending_environment(jsonb)
to data_agent_job_authority;

revoke all privileges
on function platform.lock_u6_authority_binding(
  uuid, uuid, text, uuid, uuid, text, text
)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
grant execute
on function platform.lock_u6_authority_binding(
  uuid, uuid, text, uuid, uuid, text, text
)
to data_agent_u6_rpc_owner, data_agent_u6_provisioner_owner;

revoke all privileges
on function platform.lock_u6_cleanup_platform_evidence(
  uuid, text, bigint, uuid, text, uuid, text, uuid, text, uuid, text
)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
grant execute
on function platform.lock_u6_cleanup_platform_evidence(
  uuid, text, bigint, uuid, text, uuid, text, uuid, text, uuid, text
)
to data_agent_u6_cleanup_owner;

revoke all privileges on function app_data_agent.u6_domain_sha256(text, jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges on function app_data_agent.u6_uuid_v5(uuid, bytea)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.u6_strict_base64url_decode(text)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.u6_constant_time_equal(bytea, bytea)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.lock_u6_authority_capability(
  jsonb, text, text, text, text, boolean
)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.commit_research_revocation_receipt(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.commit_research_system_artifact(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;

grant execute on function app_data_agent.u6_domain_sha256(text, jsonb)
to data_agent_u6_provisioner_owner, data_agent_u6_cleanup_owner;
