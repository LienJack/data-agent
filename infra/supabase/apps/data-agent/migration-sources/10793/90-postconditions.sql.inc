do $postconditions$
declare scope record; policy record; pointer record; assignment record;
  assignment_count integer; required_approvals integer;
begin
  for scope in
    select current_epoch.app_id,current_epoch.tenant_id,current_epoch.environment,
      registry.semantic_domain
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
    select * into pointer
      from semantic.semantic_reviewer_policy_pointer as current_pointer
      where current_pointer.app_id=scope.app_id
        and current_pointer.tenant_id=scope.tenant_id
        and current_pointer.environment=scope.environment
        and current_pointer.semantic_domain=scope.semantic_domain;
    if not found then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_POSTCONDITION_FAILED'; end if;
    select * into policy
      from semantic.semantic_reviewer_policy_revision as policy_revision
      where policy_revision.app_id=scope.app_id
        and policy_revision.tenant_id=scope.tenant_id
        and policy_revision.environment=scope.environment
        and policy_revision.semantic_domain=scope.semantic_domain
        and policy_revision.policy_version=pointer.current_policy_version
        and policy_revision.policy_digest=pointer.current_policy_digest;
    if not found
      or app_data_agent.u2_canonical_sha256(policy.policy_payload)<>policy.policy_digest
      or policy.policy_digest is distinct from pointer.current_policy_digest
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_POSTCONDITION_FAILED'; end if;

    required_approvals:=coalesce(
      (policy.quorum_rules->>'required_approvals')::integer,policy.min_reviewers);
    select pg_catalog.count(*) into assignment_count
      from semantic.semantic_reviewer_assignment as current_assignment
      join app_data_agent.memberships as membership
        on membership.app_id=current_assignment.app_id
        and membership.tenant_id=current_assignment.tenant_id
        and membership.environment=current_assignment.environment
        and membership.principal_id=current_assignment.principal::uuid
        and membership.membership_version=current_assignment.membership_version
        and membership.revoked_at is null
      where current_assignment.app_id=scope.app_id
        and current_assignment.tenant_id=scope.tenant_id
        and current_assignment.environment=scope.environment
        and current_assignment.semantic_domain=scope.semantic_domain
        and current_assignment.policy_version=policy.policy_version
        and current_assignment.is_active;
    select * into assignment
      from semantic.semantic_reviewer_assignment as exact_assignment
      where exact_assignment.app_id=scope.app_id
        and exact_assignment.tenant_id=scope.tenant_id
        and exact_assignment.environment=scope.environment
        and exact_assignment.semantic_domain=scope.semantic_domain
        and exact_assignment.policy_version=policy.policy_version
        and exact_assignment.is_active
      order by exact_assignment.assignment_id limit 1;
    if assignment_count<policy.min_reviewers
      or assignment_count<required_approvals
      or not found
      or assignment.policy_version is distinct from policy.policy_version
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_POSTCONDITION_FAILED'; end if;
  end loop;
end
$postconditions$;
