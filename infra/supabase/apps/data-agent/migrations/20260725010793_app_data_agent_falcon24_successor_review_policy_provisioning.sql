-- falcon24_successor_review_policy_provisioning_migration_checksum: sha256:f6370a0956fb3e4a96abdc539543324db4bd6d0c558134f55b650048177c2c25
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare relation_name text; function_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010792_app_data_agent_semantic_successor_review_preparation'
        and migration_checksum=
          'sha256:9457e523edfd72d1f227f5109aea204e6ab8ed76a0f10cfd4b6f62a619cee055')
  then raise exception using errcode='P0001',
    message='FALCON24_SUCCESSOR_REVIEW_POLICY_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'app_data_agent.memberships',
    'app_data_agent.falcon24_current_authority_epoch',
    'semantic.semantic_domain_registry','semantic.semantic_active_pointer',
    'semantic.semantic_source_release',
    'semantic.semantic_reviewer_policy_revision',
    'semantic.semantic_reviewer_policy_pointer',
    'semantic.semantic_reviewer_assignment',
    'semantic.semantic_successor_review_preparation'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_INVENTORY_DRIFT',
      detail=relation_name; end if;
  end loop;

  foreach function_name in array array[
    'semantic.lock_semantic_authority_fence(uuid,uuid,text,text)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.u6_uuid_v5(uuid,bytea)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_FUNCTION_DRIFT',
      detail=function_name; end if;
  end loop;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
do $provision$
declare
  scope record;
  owner_membership record;
  owner_count integer;
  revision_count integer;
  pointer_count integer;
  assignment_count integer;
  policy_payload jsonb;
  policy_digest text;
  assignment_id uuid;
begin
  for scope in
    select current_epoch.app_id,current_epoch.tenant_id,current_epoch.environment,
      registry.semantic_domain,pointer.current_release_id,pointer.current_release_generation
    from app_data_agent.falcon24_current_authority_epoch as current_epoch
    join semantic.semantic_domain_registry as registry
      on registry.app_id=current_epoch.app_id
      and registry.tenant_id=current_epoch.tenant_id
      and registry.environment=current_epoch.environment
      and registry.semantic_domain='falcon24'
    join semantic.semantic_active_pointer as pointer
      on pointer.app_id=registry.app_id and pointer.tenant_id=registry.tenant_id
      and pointer.environment=registry.environment
      and pointer.semantic_domain=registry.semantic_domain
    join semantic.semantic_source_release as release
      on release.app_id=pointer.app_id and release.tenant_id=pointer.tenant_id
      and release.environment=pointer.environment
      and release.semantic_domain=pointer.semantic_domain
      and release.release_id=pointer.current_release_id
      and release.release_generation=pointer.current_release_generation
      and release.release_digest=pointer.current_release_digest
    where current_epoch.authority_epoch='E3'
      and registry.semantic_domain='falcon24'
      and pointer.current_release_generation=1
      and release.release_generation=1
    order by current_epoch.app_id,current_epoch.tenant_id,current_epoch.environment
  loop
    perform semantic.lock_semantic_authority_fence(
      scope.app_id,scope.tenant_id,scope.environment,scope.semantic_domain);

    select pg_catalog.count(*) into revision_count
      from semantic.semantic_reviewer_policy_revision as policy
      where policy.app_id=scope.app_id and policy.tenant_id=scope.tenant_id
        and policy.environment=scope.environment
        and policy.semantic_domain=scope.semantic_domain;
    select pg_catalog.count(*) into pointer_count
      from semantic.semantic_reviewer_policy_pointer as pointer
      where pointer.app_id=scope.app_id and pointer.tenant_id=scope.tenant_id
        and pointer.environment=scope.environment
        and pointer.semantic_domain=scope.semantic_domain;
    select pg_catalog.count(*) into assignment_count
      from semantic.semantic_reviewer_assignment as assignment
      where assignment.app_id=scope.app_id and assignment.tenant_id=scope.tenant_id
        and assignment.environment=scope.environment
        and assignment.semantic_domain=scope.semantic_domain;

    if pointer_count=1 then continue; end if;
    if pointer_count<>0 or revision_count<>0 or assignment_count<>0
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_PARTIAL_STATE'; end if;
    if exists(select 1 from semantic.semantic_successor_review_preparation as preparation
      where preparation.app_id=scope.app_id
        and preparation.tenant_id=scope.tenant_id
        and preparation.environment=scope.environment
        and preparation.semantic_domain=scope.semantic_domain)
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_PARTIAL_STATE'; end if;

    select pg_catalog.count(*) into owner_count
      from app_data_agent.memberships as membership
      where membership.app_id=scope.app_id
        and membership.tenant_id=scope.tenant_id
        and membership.environment=scope.environment
        and membership.membership_role='owner'
        and membership.revoked_at is null;
    if owner_count<>1
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_OWNER_INVALID'; end if;
    select membership.principal_id::text as principal,
      membership.membership_version
      into strict owner_membership
      from app_data_agent.memberships as membership
      where membership.app_id=scope.app_id
        and membership.tenant_id=scope.tenant_id
        and membership.environment=scope.environment
        and membership.membership_role='owner'
        and membership.revoked_at is null;

    policy_payload:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-successor-review-policy@1.0.0',
      'quorum_rules',pg_catalog.jsonb_build_object('required_approvals',1),
      'veto_rules',pg_catalog.jsonb_build_object(
        'min_veto_count',1,'any_veto_closes',true),
      'expiry_rules',pg_catalog.jsonb_build_object(
        'decision_timeout_seconds',604800,'publish_timeout_seconds',604800,
        'auto_expire_on_epoch_change',true),
      'role_separation_rules',pg_catalog.jsonb_build_object(
        'proposer_cannot_approve',true,'proposer_cannot_veto',true,
        'min_distinct_approvers',1,'require_author_exclusion',true),
      'min_reviewers',1,'decision_timeout_seconds',604800);
    policy_digest:=app_data_agent.u2_canonical_sha256(policy_payload);
    assignment_id:=app_data_agent.u6_uuid_v5(scope.tenant_id,
      pg_catalog.convert_to('falcon24-successor-review-policy@1.0.0','UTF8')
      ||pg_catalog.decode('00','hex')
      ||pg_catalog.convert_to(scope.environment,'UTF8')
      ||pg_catalog.decode('00','hex')
      ||pg_catalog.convert_to(owner_membership.principal,'UTF8'));

    insert into semantic.semantic_reviewer_policy_revision(
      app_id,tenant_id,environment,semantic_domain,policy_version,policy_digest,
      policy_payload,quorum_rules,veto_rules,expiry_rules,role_separation_rules,
      min_reviewers,decision_timeout_seconds,created_by)
    values(scope.app_id,scope.tenant_id,scope.environment,scope.semantic_domain,
      1,policy_digest,policy_payload,policy_payload->'quorum_rules',
      policy_payload->'veto_rules',policy_payload->'expiry_rules',
      policy_payload->'role_separation_rules',1,604800,owner_membership.principal);
    insert into semantic.semantic_reviewer_assignment(
      app_id,tenant_id,environment,semantic_domain,assignment_id,principal,
      semantic_role,membership_version,policy_version,is_active,assigned_by)
    values(scope.app_id,scope.tenant_id,scope.environment,scope.semantic_domain,
      assignment_id,owner_membership.principal,'admin_reviewer',
      owner_membership.membership_version,1,true,owner_membership.principal);
    insert into semantic.semantic_reviewer_policy_pointer(
      app_id,tenant_id,environment,semantic_domain,current_policy_version,
      current_policy_digest,pointer_generation,updated_by)
    values(scope.app_id,scope.tenant_id,scope.environment,scope.semantic_domain,
      1,policy_digest,1,owner_membership.principal);
  end loop;
end
$provision$;
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
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010793_app_data_agent_falcon24_successor_review_policy_provisioning',
  'sha256:f6370a0956fb3e4a96abdc539543324db4bd6d0c558134f55b650048177c2c25');

commit;
