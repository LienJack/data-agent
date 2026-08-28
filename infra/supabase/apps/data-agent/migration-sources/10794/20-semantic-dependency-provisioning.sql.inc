do $provision$
declare
  scope record;
  release semantic.semantic_source_release%rowtype;
  publish_attempt semantic.semantic_publish_attempt%rowtype;
  relationship semantic.semantic_relationship_projection%rowtype;
  restriction semantic.semantic_runtime_restriction_projection%rowtype;
  validation semantic.semantic_bootstrap_validation_receipts%rowtype;
  release_set semantic.initial_semantic_release_sets%rowtype;
  policy_pointer semantic.semantic_bootstrap_policy_pointer%rowtype;
  policy semantic.semantic_bootstrap_policy_revisions%rowtype;
  fence_count integer;
  pointer_count integer;
  catalog_digest text;
begin
  for scope in
    select current_epoch.app_id,current_epoch.tenant_id,current_epoch.environment,
      registry.semantic_domain,registry.datasource_id,
      active_pointer.current_release_id,active_pointer.current_release_generation,
      active_pointer.current_release_digest,active_pointer.pointer_generation
    from app_data_agent.falcon24_current_authority_epoch as current_epoch
    join semantic.semantic_domain_registry as registry
      on registry.app_id=current_epoch.app_id
      and registry.tenant_id=current_epoch.tenant_id
      and registry.environment=current_epoch.environment
      and registry.semantic_domain='falcon24'
    join semantic.semantic_active_pointer as active_pointer
      on active_pointer.app_id=registry.app_id
      and active_pointer.tenant_id=registry.tenant_id
      and active_pointer.environment=registry.environment
      and active_pointer.semantic_domain=registry.semantic_domain
    join semantic.semantic_runtime_activation as runtime
      on runtime.app_id=active_pointer.app_id
      and runtime.tenant_id=active_pointer.tenant_id
      and runtime.environment=active_pointer.environment
      and runtime.semantic_domain=active_pointer.semantic_domain
      and runtime.current_release_id=active_pointer.current_release_id
      and runtime.current_release_generation=active_pointer.current_release_generation
    join semantic.semantic_source_release as source_release
      on source_release.app_id=active_pointer.app_id
      and source_release.tenant_id=active_pointer.tenant_id
      and source_release.environment=active_pointer.environment
      and source_release.semantic_domain=active_pointer.semantic_domain
      and source_release.release_id=active_pointer.current_release_id
      and source_release.release_generation=active_pointer.current_release_generation
      and source_release.release_digest=active_pointer.current_release_digest
    where current_epoch.authority_epoch='E3'
      and registry.semantic_domain='falcon24'
      and active_pointer.current_release_generation=1
      and source_release.release_generation=1
    order by current_epoch.app_id,current_epoch.tenant_id,current_epoch.environment
  loop
    perform semantic.lock_semantic_authority_fence(
      scope.app_id,scope.tenant_id,scope.environment,scope.semantic_domain);

    if exists(select 1 from app_data_agent.falcon24_authority_baselines as baseline
        where baseline.app_id=scope.app_id and baseline.tenant_id=scope.tenant_id
          and baseline.environment=scope.environment and baseline.authority_epoch='E4')
      or exists(select 1 from app_data_agent.falcon24_authority_activation_attempts as attempt
        where attempt.app_id=scope.app_id and attempt.tenant_id=scope.tenant_id
          and attempt.environment=scope.environment and attempt.authority_epoch='E4')
      or exists(select 1 from app_data_agent.falcon24_authority_staging_sessions as session
        where session.app_id=scope.app_id and session.tenant_id=scope.tenant_id
          and session.environment=scope.environment and session.authority_epoch='E4')
      or exists(select 1 from app_data_agent.falcon24_diagnostic_attempts as diagnostic
        where diagnostic.app_id=scope.app_id and diagnostic.tenant_id=scope.tenant_id
          and diagnostic.environment=scope.environment and diagnostic.authority_epoch='E4')
      or exists(select 1 from app_data_agent.runs as run
        where run.app_id=scope.app_id and run.tenant_id=scope.tenant_id
          and run.environment=scope.environment and run.authority_epoch='E4')
      or exists(select 1 from app_data_agent.effective_run_config_receipts as config
        where config.app_id=scope.app_id and config.tenant_id=scope.tenant_id
          and config.environment=scope.environment and config.authority_epoch='E4')
      or exists(select 1 from app_data_agent.artifacts as artifact
        where artifact.app_id=scope.app_id and artifact.tenant_id=scope.tenant_id
          and artifact.environment=scope.environment and artifact.authority_epoch='E4')
      or exists(select 1 from app_data_agent.falcon24_qualifications as qualification
        where qualification.app_id=scope.app_id and qualification.tenant_id=scope.tenant_id
          and qualification.environment=scope.environment
          and qualification.authority_epoch='E4')
      or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns as campaign
        where campaign.app_id=scope.app_id and campaign.tenant_id=scope.tenant_id
          and campaign.environment=scope.environment and campaign.authority_epoch='E4')
      or exists(select 1 from app_data_agent.falcon24_gate_attempt_history as gate_attempt
        where gate_attempt.app_id=scope.app_id and gate_attempt.tenant_id=scope.tenant_id
          and gate_attempt.environment=scope.environment
          and gate_attempt.authority_epoch='E4')
      or exists(select 1 from app_data_agent.falcon24_ui_receipts as ui_receipt
        where ui_receipt.app_id=scope.app_id and ui_receipt.tenant_id=scope.tenant_id
          and ui_receipt.environment=scope.environment and ui_receipt.authority_epoch='E4')
      or exists(select 1 from semantic.semantic_successor_release_stage as stage
        where stage.app_id=scope.app_id and stage.tenant_id=scope.tenant_id
          and stage.environment=scope.environment
          and stage.semantic_domain=scope.semantic_domain)
      or exists(select 1 from semantic.semantic_publish_attempt as attempt
        where attempt.app_id=scope.app_id and attempt.tenant_id=scope.tenant_id
          and attempt.environment=scope.environment
          and attempt.semantic_domain=scope.semantic_domain
          and attempt.target_generation=2)
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_E4_POLLUTED'; end if;

    select pg_catalog.count(*) into fence_count
      from semantic.semantic_catalog_fence as fence
      where fence.app_id=scope.app_id and fence.tenant_id=scope.tenant_id
        and fence.environment=scope.environment
        and fence.semantic_domain=scope.semantic_domain;
    select pg_catalog.count(*) into pointer_count
      from semantic.semantic_dependency_pointer as dependency_pointer
      where dependency_pointer.app_id=scope.app_id
        and dependency_pointer.tenant_id=scope.tenant_id
        and dependency_pointer.environment=scope.environment
        and dependency_pointer.semantic_domain=scope.semantic_domain;

    if fence_count=1 and pointer_count=1 then continue; end if;
    if fence_count<>0 or pointer_count<>0
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_PARTIAL_STATE'; end if;

    select * into strict release
      from semantic.semantic_source_release as source_release
      where source_release.app_id=scope.app_id
        and source_release.tenant_id=scope.tenant_id
        and source_release.environment=scope.environment
        and source_release.semantic_domain=scope.semantic_domain
        and source_release.release_id=scope.current_release_id
        and source_release.release_generation=1
        and source_release.release_digest=scope.current_release_digest
        and source_release.approval_mode='SYSTEM_BOOTSTRAP_POLICY';
    select * into strict publish_attempt
      from semantic.semantic_publish_attempt as attempt
      where attempt.app_id=release.app_id and attempt.tenant_id=release.tenant_id
        and attempt.environment=release.environment
        and attempt.semantic_domain=release.semantic_domain
        and attempt.attempt_id=release.attempt_id;
    select * into strict relationship
      from semantic.semantic_relationship_projection as projection
      where projection.app_id=release.app_id and projection.tenant_id=release.tenant_id
        and projection.environment=release.environment
        and projection.semantic_domain=release.semantic_domain
        and projection.projection_id=release.relationship_projection_ref
        and projection.release_id=release.release_id;
    select * into strict restriction
      from semantic.semantic_runtime_restriction_projection as projection
      where projection.app_id=release.app_id and projection.tenant_id=release.tenant_id
        and projection.environment=release.environment
        and projection.semantic_domain=release.semantic_domain
        and projection.projection_id=release.runtime_restriction_projection_ref
        and projection.release_id=release.release_id;
    select * into strict release_set
      from semantic.initial_semantic_release_sets as initial_release
      where initial_release.app_id=release.app_id
        and initial_release.tenant_id=release.tenant_id
        and initial_release.environment=release.environment
        and initial_release.semantic_domain=release.semantic_domain
        and initial_release.release_id=release.release_id
        and initial_release.release_set_hash=release.release_digest
        and initial_release.candidate_id=release.candidate_id;
    select * into strict validation
      from semantic.semantic_bootstrap_validation_receipts as receipt
      where receipt.app_id=release_set.app_id
        and receipt.tenant_id=release_set.tenant_id
        and receipt.environment=release_set.environment
        and receipt.semantic_domain=release_set.semantic_domain
        and receipt.receipt_id=release_set.validation_receipt_id
        and receipt.receipt_hash=release_set.validation_receipt_hash;
    select * into strict policy_pointer
      from semantic.semantic_bootstrap_policy_pointer as current_policy
      where current_policy.app_id=release_set.app_id
        and current_policy.tenant_id=release_set.tenant_id
        and current_policy.environment=release_set.environment
        and current_policy.semantic_domain=release_set.semantic_domain;
    select * into strict policy
      from semantic.semantic_bootstrap_policy_revisions as policy_revision
      where policy_revision.app_id=policy_pointer.app_id
        and policy_revision.tenant_id=policy_pointer.tenant_id
        and policy_revision.environment=policy_pointer.environment
        and policy_revision.semantic_domain=policy_pointer.semantic_domain
        and policy_revision.policy_id=policy_pointer.policy_id
        and policy_revision.policy_revision=policy_pointer.policy_revision
        and policy_revision.policy_hash=policy_pointer.policy_hash;

    catalog_digest:=validation.receipt_json#>>'{schema_snapshot,snapshot_hash}';
    if publish_attempt.attempt_state is distinct from 'COMMITTED'
      or publish_attempt.approval_mode is distinct from 'SYSTEM_BOOTSTRAP_POLICY'
      or publish_attempt.target_generation is distinct from 1
      or publish_attempt.catalog_fence_epoch is distinct from 0
      or publish_attempt.dependency_generation is distinct from 0
      or publish_attempt.committed_release_ref is distinct from release.release_id
      or publish_attempt.compiler_bundle_digest is distinct from release.compiler_bundle_digest
      or relationship.catalog_epoch is distinct from 0
      or relationship.datasource_id is distinct from scope.datasource_id
      or restriction.compiler_bundle_digest is distinct from release.compiler_bundle_digest
      or restriction.platform_policy_digest is distinct from policy.policy_hash
      or restriction.pointer_generation is distinct from scope.pointer_generation
      or release_set.policy_hash is distinct from policy.policy_hash
      or validation.candidate_id is distinct from release.candidate_id
      or validation.candidate_revision_id is distinct from release_set.candidate_revision_id
      or validation.candidate_set_hash is distinct from release.compiler_bundle_digest
      or validation.policy_hash is distinct from policy.policy_hash
      or validation.receipt_json->>'receipt_hash' is distinct from validation.receipt_hash
      or app_data_agent.u2_canonical_sha256(
        validation.receipt_json-'receipt_hash') is distinct from validation.receipt_hash
      or policy.policy_json->>'policy_hash' is distinct from policy.policy_hash
      or app_data_agent.u2_canonical_sha256(
        policy.policy_json-'policy_hash') is distinct from policy.policy_hash
      or catalog_digest!~'^sha256:[0-9a-f]{64}$'
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_EVIDENCE_INVALID'; end if;

    insert into semantic.semantic_catalog_fence(
      app_id,tenant_id,environment,semantic_domain,catalog_epoch,
      catalog_digest,schema_digest,is_valid)
    values(scope.app_id,scope.tenant_id,scope.environment,scope.semantic_domain,
      0,catalog_digest,catalog_digest,true);
    insert into semantic.semantic_dependency_pointer(
      app_id,tenant_id,environment,semantic_domain,current_catalog_epoch,
      current_catalog_digest,current_compiler_bundle_digest,
      current_closure_policy_digest,pointer_generation,updated_by)
    values(scope.app_id,scope.tenant_id,scope.environment,scope.semantic_domain,
      0,catalog_digest,release.compiler_bundle_digest,policy.policy_hash,1,
      'migration:10794:gen1-bootstrap-evidence');
  end loop;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_EVIDENCE_INVALID';
end
$provision$;
