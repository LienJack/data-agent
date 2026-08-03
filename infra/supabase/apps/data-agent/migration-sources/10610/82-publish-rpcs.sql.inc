-- ============================================================
-- 10610: Publish RPC functions
-- A8 Publisher: deterministic publish/rollback, 4 narrow credentials only
-- ============================================================

-- ============================================================
-- Prepare publish attempt: create PREPARED attempt, CAS candidate to PUBLISHING
-- ============================================================
create or replace function semantic.prepare_publish_attempt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_packet_id uuid,
  p_candidate_id uuid,
  p_compiler_bundle_digest text,
  p_catalog_fence_epoch bigint,
  p_dependency_generation bigint,
  p_target_generation bigint,
  p_idempotency_digest text,
  p_conditional_legacy_plan jsonb default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_attempt_id uuid;
  v_result jsonb;
begin
  -- Acquire locks in canonical order
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);
  perform semantic.lock_packet(p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_packet_id);

  -- Lock authority fence and packet
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Verify packet is CLOSED + APPROVED
  perform 1
  from semantic.semantic_review_task as task
  where task.app_id = p_app_id
    and task.tenant_id = p_tenant_id
    and task.environment = p_environment
    and task.semantic_domain = p_semantic_domain
    and task.packet_id = p_packet_id
    and task.decision_window_status = 'CLOSED'
    and task.review_outcome = 'APPROVED'
    and (task.publish_expires_at is null or task.publish_expires_at > pg_catalog.clock_timestamp())
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PUBLISH_CONFLICT';
  end if;

  -- CAS candidate to PUBLISHING
  update semantic.semantic_candidate as candidate
  set candidate_status = 'PUBLISHING',
      updated_at = pg_catalog.clock_timestamp()
  where candidate.app_id = p_app_id
    and candidate.tenant_id = p_tenant_id
    and candidate.environment = p_environment
    and candidate.semantic_domain = p_semantic_domain
    and candidate.candidate_id = p_candidate_id
    and candidate.candidate_status = 'APPROVED';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_NOT_PUBLISHED';
  end if;

  -- Create PREPARED attempt
  v_attempt_id := extensions.gen_random_uuid();
  insert into semantic.semantic_publish_attempt (
    app_id, tenant_id, environment, semantic_domain,
    attempt_id, packet_id, candidate_id, attempt_state,
    compiler_bundle_digest, catalog_fence_epoch, dependency_generation,
    target_generation, idempotency_digest, conditional_legacy_plan
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_attempt_id, p_packet_id, p_candidate_id, 'PREPARED',
    p_compiler_bundle_digest, p_catalog_fence_epoch, p_dependency_generation,
    p_target_generation, p_idempotency_digest, p_conditional_legacy_plan
  );

  v_result := jsonb_build_object(
    'attempt_id', v_attempt_id,
    'attempt_state', 'PREPARED',
    'target_generation', p_target_generation
  );

  return v_result;
end;
$function$;

-- ============================================================
-- Commit publish attempt: atomically commit release and projections
-- ============================================================
create or replace function semantic.commit_publish_attempt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_attempt_id uuid,
  p_executable_projection_ref uuid,
  p_executable_projection_hash text,
  p_relationship_projection_ref uuid,
  p_relationship_projection_hash text,
  p_runtime_restriction_projection_ref uuid,
  p_runtime_restriction_projection_hash text,
  p_committed_legacy_attempt_ref uuid default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_release_id uuid;
  v_release_digest text;
  v_packet_id uuid;
  v_candidate_id uuid;
  v_target_generation bigint;
  v_decision_set_digest text;
  v_quorum_snapshot jsonb;
  v_result jsonb;
begin
  -- Acquire locks
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  -- Lock attempt, active pointer, authority fence, packet
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Verify attempt is PREPARED and lock it
  select attempt.packet_id, attempt.candidate_id, attempt.target_generation,
         attempt.conditional_legacy_plan
  into v_packet_id, v_candidate_id, v_target_generation
  from semantic.semantic_publish_attempt as attempt
  where attempt.app_id = p_app_id
    and attempt.tenant_id = p_tenant_id
    and attempt.environment = p_environment
    and attempt.semantic_domain = p_semantic_domain
    and attempt.attempt_id = p_attempt_id
    and attempt.attempt_state = 'PREPARED'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PUBLISH_CONFLICT';
  end if;

  -- Lock active pointer
  perform 1
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain
  for update;

  -- Lock runtime activation
  perform 1
  from semantic.semantic_runtime_activation as activation
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain
  for update;

  -- Get decision set digest from packet
  select task.review_outcome
  into v_decision_set_digest
  from semantic.semantic_review_task as task
  where task.app_id = p_app_id
    and task.tenant_id = p_tenant_id
    and task.environment = p_environment
    and task.semantic_domain = p_semantic_domain
    and task.packet_id = v_packet_id;
  v_decision_set_digest := semantic.semantic_sha256(
    v_packet_id::text, jsonb_build_object('version', '1.0.0', 'kind', 'decision_set')
  );

  -- Create release
  v_release_id := extensions.gen_random_uuid();
  v_release_digest := semantic.semantic_sha256(
    v_attempt_id::text || v_target_generation::text,
    jsonb_build_object('version', '1.0.0', 'kind', 'source_release')
  );

  insert into semantic.semantic_source_release (
    app_id, tenant_id, environment, semantic_domain,
    release_id, release_generation, attempt_id, packet_id, candidate_id,
    release_digest, compiler_bundle_digest,
    executable_projection_ref, executable_projection_hash,
    relationship_projection_ref, relationship_projection_hash,
    runtime_restriction_projection_ref, runtime_restriction_projection_hash,
    decision_set_digest, published_by
  ) select
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_release_id, v_target_generation, p_attempt_id, attempt.packet_id, attempt.candidate_id,
    v_release_digest, attempt.compiler_bundle_digest,
    p_executable_projection_ref, p_executable_projection_hash,
    p_relationship_projection_ref, p_relationship_projection_hash,
    p_runtime_restriction_projection_ref, p_runtime_restriction_projection_hash,
    v_decision_set_digest, pg_catalog.session_user
  from semantic.semantic_publish_attempt as attempt
  where attempt.attempt_id = p_attempt_id;

  -- Update active pointer
  update semantic.semantic_active_pointer as pointer
  set current_release_id = v_release_id,
      current_release_generation = v_target_generation,
      current_release_digest = v_release_digest,
      pointer_generation = pointer.pointer_generation + 1,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = pg_catalog.session_user
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;

  -- Update runtime activation
  update semantic.semantic_runtime_activation as activation
  set current_release_id = v_release_id,
      current_release_generation = v_target_generation,
      updated_at = pg_catalog.clock_timestamp()
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain;

  -- Mark attempt as COMMITTED
  update semantic.semantic_publish_attempt as attempt
  set attempt_state = 'COMMITTED',
      committed_release_ref = v_release_id,
      committed_legacy_attempt_ref = p_committed_legacy_attempt_ref,
      updated_at = pg_catalog.clock_timestamp()
  where attempt.attempt_id = p_attempt_id;

  -- Update candidate status
  update semantic.semantic_candidate as candidate
  set candidate_status = 'PUBLISHED',
      updated_at = pg_catalog.clock_timestamp()
  where candidate.candidate_id = v_candidate_id;

  v_result := jsonb_build_object(
    'release_id', v_release_id,
    'release_generation', v_target_generation,
    'release_digest', v_release_digest,
    'attempt_state', 'COMMITTED'
  );

  return v_result;
end;
$function$;
