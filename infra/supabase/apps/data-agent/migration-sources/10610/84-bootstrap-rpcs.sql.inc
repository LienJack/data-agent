-- ============================================================
-- 10610: Bootstrap RPC functions
-- A3 Admin: double-signed bootstrap manifest only
-- Independent bootstrap executor
-- ============================================================

-- ============================================================
-- Bootstrap domain: atomically create domain registry, policy, fence, and pointer
-- Requires double-signed packet from two distinct platform+domain owners
-- ============================================================
create or replace function semantic.bootstrap_domain(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_datasource_id uuid,
  p_domain_display_name text,
  p_bootstrap_packet_digest text,
  p_signer_one_principal text,
  p_signer_two_principal text,
  p_signer_one_signature text,
  p_signer_two_signature text,
  p_initial_review_policy_payload jsonb,
  p_initial_review_policy_digest text,
  p_initial_reviewer_assignments jsonb,
  p_initial_catalog_fence_digest text,
  p_initial_compiler_dependency_digest text,
  p_initial_closure_policy_digest text,
  p_bootstrap_nonce uuid,
  p_bootstrap_expires_at timestamptz
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_bootstrap_id uuid;
  v_fence_epoch bigint;
  v_result jsonb;
  v_initial_policy_version bigint;
  v_initial_reviewer_count integer;
  v_assignment record;
begin
  -- Acquire scope authority fence
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  -- Lock authority fence
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Verify domain not already registered
  perform 1
  from semantic.semantic_domain_registry as registry
  where registry.app_id = p_app_id
    and registry.tenant_id = p_tenant_id
    and registry.environment = p_environment
    and registry.semantic_domain = p_semantic_domain;
  if found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DOMAIN_BOOTSTRAP_CLOSED';
  end if;

  -- Verify signers are distinct
  if p_signer_one_principal = p_signer_two_principal then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;

  -- Create bootstrap receipt
  v_bootstrap_id := extensions.gen_random_uuid();
  insert into semantic.semantic_domain_bootstrap (
    app_id, tenant_id, environment, semantic_domain,
    bootstrap_id, bootstrap_packet_digest,
    signer_one_principal, signer_two_principal,
    signer_one_signature, signer_two_signature,
    initial_review_policy_digest,
    initial_catalog_fence_digest,
    initial_compiler_dependency_digest,
    bootstrap_nonce, bootstrap_expires_at
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_bootstrap_id, p_bootstrap_packet_digest,
    p_signer_one_principal, p_signer_two_principal,
    p_signer_one_signature, p_signer_two_signature,
    p_initial_review_policy_digest,
    p_initial_catalog_fence_digest,
    p_initial_compiler_dependency_digest,
    p_bootstrap_nonce, p_bootstrap_expires_at
  );

  -- Create domain registry entry
  insert into semantic.semantic_domain_registry (
    app_id, tenant_id, environment, semantic_domain,
    datasource_id, domain_display_name, created_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    p_datasource_id, p_domain_display_name, pg_catalog.session_user
  );

  -- Create initial review policy (version 1)
  insert into semantic.semantic_reviewer_policy_revision (
    app_id, tenant_id, environment, semantic_domain,
    policy_version, policy_digest, policy_payload,
    quorum_rules, veto_rules, expiry_rules, role_separation_rules,
    min_reviewers, decision_timeout_seconds, created_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    1, p_initial_review_policy_digest, p_initial_review_policy_payload,
    p_initial_review_policy_payload->'quorum_rules',
    p_initial_review_policy_payload->'veto_rules',
    p_initial_review_policy_payload->'expiry_rules',
    p_initial_review_policy_payload->'role_separation_rules',
    (p_initial_review_policy_payload->>'min_reviewers')::integer,
    (p_initial_review_policy_payload->>'decision_timeout_seconds')::integer,
    pg_catalog.session_user
  );

  -- Create reviewer assignments
  for v_assignment in select * from jsonb_to_recordset(p_initial_reviewer_assignments) as x(
    principal text, semantic_role text, membership_version bigint
  )
  loop
    insert into semantic.semantic_reviewer_assignment (
      app_id, tenant_id, environment, semantic_domain,
      assignment_id, principal, semantic_role,
      membership_version, policy_version, assigned_by
    ) values (
      p_app_id, p_tenant_id, p_environment, p_semantic_domain,
      extensions.gen_random_uuid(), v_assignment.principal, v_assignment.semantic_role,
      v_assignment.membership_version, 1, pg_catalog.session_user
    );
    v_initial_reviewer_count := v_initial_reviewer_count + 1;
  end loop;

  -- Verify at least one reviewer is different from both signers
  perform 1
  from semantic.semantic_reviewer_assignment as assignment
  where assignment.app_id = p_app_id
    and assignment.tenant_id = p_tenant_id
    and assignment.environment = p_environment
    and assignment.semantic_domain = p_semantic_domain
    and assignment.principal not in (p_signer_one_principal, p_signer_two_principal);
  if not found then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;

  -- Create policy pointer (version 1)
  insert into semantic.semantic_reviewer_policy_pointer (
    app_id, tenant_id, environment, semantic_domain,
    current_policy_version, current_policy_digest, updated_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    1, p_initial_review_policy_digest, pg_catalog.session_user
  );

  -- Create catalog fence (epoch 0)
  get diagnostics v_fence_epoch = pg_current_xact_id;
  insert into semantic.semantic_catalog_fence (
    app_id, tenant_id, environment, semantic_domain,
    catalog_epoch, catalog_digest, schema_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    0, p_initial_catalog_fence_digest, p_initial_catalog_fence_digest
  );

  -- Create dependency pointer
  insert into semantic.semantic_dependency_pointer (
    app_id, tenant_id, environment, semantic_domain,
    current_catalog_epoch, current_catalog_digest,
    current_compiler_bundle_digest, current_closure_policy_digest, updated_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    0, p_initial_catalog_fence_digest,
    p_initial_compiler_dependency_digest, p_initial_closure_policy_digest,
    pg_catalog.session_user
  );

  -- Create genesis active pointer (generation 0, null release)
  insert into semantic.semantic_active_pointer (
    app_id, tenant_id, environment, semantic_domain,
    current_release_generation, updated_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    0, pg_catalog.session_user
  );

  -- Create runtime activation (LEGACY mode)
  insert into semantic.semantic_runtime_activation (
    app_id, tenant_id, environment, semantic_domain,
    runtime_mode, activation_generation,
    current_release_generation
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    'LEGACY', 1, 0
  );

  -- Mark bootstrap as CLOSED
  update semantic.semantic_domain_bootstrap as bootstrap
  set is_closed = true,
      closed_at = pg_catalog.clock_timestamp()
  where bootstrap.bootstrap_id = v_bootstrap_id;

  v_result := jsonb_build_object(
    'bootstrap_id', v_bootstrap_id,
    'bootstrap_packet_digest', p_bootstrap_packet_digest,
    'initial_policy_version', 1,
    'initial_reviewer_count', v_initial_reviewer_count,
    'runtime_mode', 'LEGACY'
  );

  return v_result;
end;
$function$;
