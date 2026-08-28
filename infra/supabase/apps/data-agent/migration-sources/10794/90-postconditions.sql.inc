do $postconditions$
declare
  scope record;
  release semantic.semantic_source_release%rowtype;
  fence semantic.semantic_catalog_fence%rowtype;
  pointer semantic.semantic_dependency_pointer%rowtype;
  restriction semantic.semantic_runtime_restriction_projection%rowtype;
  validation semantic.semantic_bootstrap_validation_receipts%rowtype;
  release_set semantic.initial_semantic_release_sets%rowtype;
  policy semantic.semantic_bootstrap_policy_revisions%rowtype;
  fence_count integer;
  pointer_count integer;
begin
  for scope in
    select current_epoch.app_id,current_epoch.tenant_id,current_epoch.environment,
      registry.semantic_domain,active_pointer.current_release_id,
      active_pointer.current_release_digest
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
    where current_epoch.authority_epoch='E3'
      and active_pointer.current_release_generation=1
    order by current_epoch.app_id,current_epoch.tenant_id,current_epoch.environment
  loop
    select pg_catalog.count(*) into fence_count
      from semantic.semantic_catalog_fence as current_fence
      where current_fence.app_id=scope.app_id
        and current_fence.tenant_id=scope.tenant_id
        and current_fence.environment=scope.environment
        and current_fence.semantic_domain=scope.semantic_domain;
    select pg_catalog.count(*) into pointer_count
      from semantic.semantic_dependency_pointer as current_pointer
      where current_pointer.app_id=scope.app_id
        and current_pointer.tenant_id=scope.tenant_id
        and current_pointer.environment=scope.environment
        and current_pointer.semantic_domain=scope.semantic_domain;
    if fence_count<>1 or pointer_count<>1
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_POSTCONDITION_FAILED'; end if;

    select * into strict release
      from semantic.semantic_source_release as source_release
      where source_release.app_id=scope.app_id
        and source_release.tenant_id=scope.tenant_id
        and source_release.environment=scope.environment
        and source_release.semantic_domain=scope.semantic_domain
        and source_release.release_id=scope.current_release_id
        and source_release.release_generation=1
        and source_release.release_digest=scope.current_release_digest;
    select * into strict fence
      from semantic.semantic_catalog_fence as catalog_fence
      where catalog_fence.app_id=scope.app_id
        and catalog_fence.tenant_id=scope.tenant_id
        and catalog_fence.environment=scope.environment
        and catalog_fence.semantic_domain=scope.semantic_domain
        and catalog_fence.catalog_epoch=0;
    select * into strict pointer
      from semantic.semantic_dependency_pointer as dependency_pointer
      where dependency_pointer.app_id=scope.app_id
        and dependency_pointer.tenant_id=scope.tenant_id
        and dependency_pointer.environment=scope.environment
        and dependency_pointer.semantic_domain=scope.semantic_domain;
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
        and initial_release.release_set_hash=release.release_digest;
    select * into strict validation
      from semantic.semantic_bootstrap_validation_receipts as receipt
      where receipt.app_id=release_set.app_id
        and receipt.tenant_id=release_set.tenant_id
        and receipt.environment=release_set.environment
        and receipt.semantic_domain=release_set.semantic_domain
        and receipt.receipt_id=release_set.validation_receipt_id
        and receipt.receipt_hash=release_set.validation_receipt_hash;
    select policy_revision.* into strict policy
      from semantic.semantic_bootstrap_policy_pointer as current_policy
      join semantic.semantic_bootstrap_policy_revisions as policy_revision
        on policy_revision.app_id=current_policy.app_id
        and policy_revision.tenant_id=current_policy.tenant_id
        and policy_revision.environment=current_policy.environment
        and policy_revision.semantic_domain=current_policy.semantic_domain
        and policy_revision.policy_id=current_policy.policy_id
        and policy_revision.policy_revision=current_policy.policy_revision
        and policy_revision.policy_hash=current_policy.policy_hash
      where current_policy.app_id=scope.app_id
        and current_policy.tenant_id=scope.tenant_id
        and current_policy.environment=scope.environment
        and current_policy.semantic_domain=scope.semantic_domain;

    if pointer.current_catalog_epoch is distinct from 0
      or pointer.pointer_generation is distinct from 1
      or pointer.current_catalog_digest is distinct from fence.catalog_digest
      or fence.schema_digest is distinct from fence.catalog_digest
      or fence.is_valid is distinct from true
      or fence.invalidated_at is not null
      or fence.catalog_digest is distinct from
        validation.receipt_json#>>'{schema_snapshot,snapshot_hash}'
      or pointer.current_compiler_bundle_digest is distinct from release.compiler_bundle_digest
      or pointer.current_compiler_bundle_digest is distinct from restriction.compiler_bundle_digest
      or pointer.current_closure_policy_digest is distinct from policy.policy_hash
      or pointer.current_closure_policy_digest is distinct from restriction.platform_policy_digest
      or release_set.policy_hash is distinct from policy.policy_hash
      or validation.policy_hash is distinct from policy.policy_hash
      or validation.candidate_set_hash is distinct from release.compiler_bundle_digest
      or app_data_agent.u2_canonical_sha256(
        validation.receipt_json-'receipt_hash') is distinct from validation.receipt_hash
      or app_data_agent.u2_canonical_sha256(
        policy.policy_json-'policy_hash') is distinct from policy.policy_hash
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_POSTCONDITION_FAILED'; end if;
  end loop;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_DEPENDENCY_POSTCONDITION_FAILED';
end
$postconditions$;
