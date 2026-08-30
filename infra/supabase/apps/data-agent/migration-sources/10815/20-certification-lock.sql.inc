-- FOR UPDATE applies the UPDATE USING policy even when no mutation is attempted.
-- The E7 promotion policy intentionally exposes only inactive artifacts. Exact E12+
-- replay also needs to lock its already-active certification against revocation.
-- This adds row-lock visibility only: no grants, no relaxed mutation WITH CHECK.
-- Existing promotion CHECK requires new.is_active; the unchanged immutable trigger
-- rejects active no-op/payload updates. Deactivation still fails the combined CHECK.
create policy falcon24_recovery_active_certification_lock
on app_data_agent.artifacts for update to data_agent_u6_rpc_owner
using(artifact_type='ModelCertificationReceipt' and is_active
  and platform.backend_context_matches(app_id,tenant_id,environment,true)
  and exists(select 1 from app_data_agent.falcon24_llm_execution_certification_stage stage
    join app_data_agent.falcon24_current_authority_epoch current_epoch
      on current_epoch.app_id=stage.app_id and current_epoch.tenant_id=stage.tenant_id
      and current_epoch.environment=stage.environment
      and current_epoch.authority_epoch=stage.target_authority_epoch
      and current_epoch.activation_attempt_id=stage.activation_attempt_id
    join app_data_agent.falcon24_retained_recovery_activation_receipts recovery
      on recovery.app_id=current_epoch.app_id and recovery.tenant_id=current_epoch.tenant_id
      and recovery.environment=current_epoch.environment
      and recovery.activation_attempt_id=current_epoch.activation_attempt_id
      and recovery.principal_id=stage.principal_id
    where stage.app_id=artifacts.app_id and stage.tenant_id=artifacts.tenant_id
      and stage.environment=artifacts.environment and stage.certification_run_id=artifacts.run_id
      and stage.certification_artifact_id=artifacts.artifact_id
      and stage.certification_revision=artifacts.revision
      and stage.certification_content_hash=artifacts.content_hash
      and stage.principal_id=(select principal_id from platform.current_backend_authority(true))
      and stage.status='PROMOTED'
      and pg_catalog.substr(stage.target_authority_epoch,2)::numeric>=12
      and recovery.command_document#>>'{llm_execution_stage_ref,stage_id}'=stage.stage_id::text
      and recovery.command_document#>>'{llm_execution_stage_ref,proof_hash}'=stage.proof_hash))
with check(false);
