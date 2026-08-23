-- ============================================================
-- 10610: Rollback RPC functions
-- A8 Publisher: execute rollback with authorized nonce
-- ============================================================

-- ============================================================
-- Execute rollback: consume authorization and create rollback receipt
-- ============================================================
create or replace function semantic.execute_rollback(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_authorization_id uuid,
  p_nonce uuid,
  p_rollback_reason text
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_receipt_id uuid;
  v_receipt_digest text;
  v_from_release_id uuid;
  v_from_release_generation bigint;
  v_to_release_id uuid;
  v_to_release_generation bigint;
  v_authorization_digest text;
  v_decision_set_digest text;
  v_result jsonb;
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

  -- Lock runtime activation
  perform 1
  from semantic.semantic_runtime_activation as activation
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain
  for update;

  -- Lock active pointer
  perform 1
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain
  for update;

  -- Verify and consume authorization
  select auth.from_release_id, auth.from_release_generation,
         auth.to_release_id, auth.to_release_generation,
         auth.authorization_digest, auth.decision_set_digest
  into v_from_release_id, v_from_release_generation,
       v_to_release_id, v_to_release_generation,
       v_authorization_digest, v_decision_set_digest
  from semantic.semantic_rollback_authorization as auth
  where auth.app_id = p_app_id
    and auth.tenant_id = p_tenant_id
    and auth.environment = p_environment
    and auth.semantic_domain = p_semantic_domain
    and auth.authorization_id = p_authorization_id
    and auth.nonce = p_nonce
    and auth.is_consumed = false
    and auth.expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_ROLLBACK_CONFLICT';
  end if;

  -- Mark authorization as consumed
  update semantic.semantic_rollback_authorization as auth
  set is_consumed = true,
      consumed_at = pg_catalog.clock_timestamp()
  where auth.authorization_id = p_authorization_id;

  -- Create rollback receipt
  v_receipt_id := extensions.gen_random_uuid();
  v_receipt_digest := semantic.semantic_sha256(
    p_authorization_id::text || p_rollback_reason,
    jsonb_build_object('version', '1.0.0', 'kind', 'rollback_receipt')
  );

  insert into semantic.semantic_rollback_receipt (
    app_id, tenant_id, environment, semantic_domain,
    receipt_id, authorization_id,
    from_release_id, from_release_generation,
    to_release_id, to_release_generation,
    rollback_reason, decision_set_digest, receipt_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_receipt_id, p_authorization_id,
    v_from_release_id, v_from_release_generation,
    v_to_release_id, v_to_release_generation,
    p_rollback_reason, v_decision_set_digest, v_receipt_digest
  );

  -- Update active pointer to target release
  update semantic.semantic_active_pointer as pointer
  set current_release_id = v_to_release_id,
      current_release_generation = v_to_release_generation,
      pointer_generation = pointer.pointer_generation + 1,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = pg_catalog.session_user
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;

  v_result := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_digest', v_receipt_digest,
    'from_release_generation', v_from_release_generation,
    'to_release_generation', v_to_release_generation
  );

  return v_result;
end;
$function$;
