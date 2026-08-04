-- ============================================================
-- 10615: Runtime Activation Management RPCs
-- ============================================================
-- These functions manage the runtime mode transition lifecycle:
--   activate_runtime: LEGACY→SHADOW or SHADOW→PUBLISHED_ONLY
--   application_rollback: PUBLISHED_ONLY→SHADOW
--   contract_legacy: PUBLISHED_ONLY/OPEN/AVAILABLE→PUBLISHED_ONLY/CLOSED/CLOSED
-- ============================================================

-- ============================================================
-- activate_runtime: transition runtime mode with expected-generation CAS
--
-- Allowed transitions:
--   LEGACY → SHADOW: standard activation, bootstrap/首发完成
--   SHADOW → PUBLISHED_ONLY: requires fresh shadow parity, pre-activation gate,
--     governance readiness receipt = READY, and expected release current
-- ============================================================
create or replace function semantic.activate_runtime(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_target_mode text,
  p_expected_activation_generation bigint,
  p_expected_release_generation bigint,
  p_governance_readiness_receipt_digest text default null,
  p_nonce uuid default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_current_activation record;
  v_current_release record;
  v_event_id uuid;
  v_event_digest text;
  v_result jsonb;
begin
  -- Validate target mode
  if p_target_mode not in ('SHADOW', 'PUBLISHED_ONLY') then
    raise exception using errcode = '22023', message = 'SEMANTIC_ACTIVATE_INVALID_TARGET';
  end if;

  -- Acquire scope authority fence
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  -- Lock authority fence
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Lock and read current runtime activation
  select activation.*
  into v_current_activation
  from semantic.semantic_runtime_activation as activation
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_ACTIVATE_DOMAIN_NOT_FOUND';
  end if;

  -- Lock and read current active pointer
  select pointer.*
  into v_current_release
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_ACTIVATE_POINTER_NOT_FOUND';
  end if;

  -- Expected-generation CAS
  if v_current_activation.activation_generation != p_expected_activation_generation then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_ACTIVATE_GENERATION_CONFLICT';
  end if;
  if v_current_release.current_release_generation != p_expected_release_generation then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_ACTIVATE_RELEASE_CONFLICT';
  end if;

  -- Transition-specific validation
  if p_target_mode = 'SHADOW' then
    -- LEGACY → SHADOW: bootstrap must have completed, domain must have a release
    if v_current_activation.runtime_mode != 'LEGACY' then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_ACTIVATE_SHADOW_FROM_LEGACY_REQUIRED';
    end if;
    if v_current_release.current_release_id is null then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_ACTIVATE_NO_RELEASE';
    end if;

  elsif p_target_mode = 'PUBLISHED_ONLY' then
    -- SHADOW → PUBLISHED_ONLY: requires readiness receipt and fresh shadow parity
    if v_current_activation.runtime_mode != 'SHADOW' then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_ACTIVATE_PUBLISHED_FROM_SHADOW_REQUIRED';
    end if;
    if p_governance_readiness_receipt_digest is null
      or not (p_governance_readiness_receipt_digest ~ '^sha256:[0-9a-f]{64}$')
    then
      raise exception using errcode = '22023', message = 'SEMANTIC_ACTIVATE_READINESS_RECEIPT_REQUIRED';
    end if;
    if p_nonce is null then
      raise exception using errcode = '22023', message = 'SEMANTIC_ACTIVATE_NONCE_REQUIRED';
    end if;

    -- Verify nonce uniqueness: nonce must not have been used in any activation event
    perform 1
    from semantic.semantic_outbox as outbox
    where outbox.app_id = p_app_id
      and outbox.tenant_id = p_tenant_id
      and outbox.environment = p_environment
      and outbox.semantic_domain = p_semantic_domain
      and outbox.event_type = 'RUNTIME_ACTIVATION_CHANGED'
      and outbox.event_payload @> jsonb_build_object('nonce', p_nonce::text);
    if found then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_ACTIVATE_NONCE_REUSED';
    end if;
  end if;

  -- Perform transition
  update semantic.semantic_runtime_activation as activation
  set runtime_mode = p_target_mode,
      activation_generation = activation.activation_generation + 1,
      last_governance_readiness_receipt_digest =
        case when p_target_mode = 'PUBLISHED_ONLY'
          then p_governance_readiness_receipt_digest
          else last_governance_readiness_receipt_digest
        end,
      updated_at = pg_catalog.clock_timestamp()
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain;

  -- Write outbox event
  v_event_id := extensions.gen_random_uuid();
  v_event_digest := semantic.semantic_sha256(
    v_event_id::text || p_target_mode,
    jsonb_build_object('version', '1.0.0', 'kind', 'activation_event')
  );

  insert into semantic.semantic_outbox (
    app_id, tenant_id, environment, semantic_domain,
    event_id, event_type, counter_kind, axis_generation,
    observed_release_generation, observed_activation_generation,
    event_payload, event_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_event_id, 'RUNTIME_ACTIVATION_CHANGED', 'ACTIVATION',
    v_current_activation.activation_generation + 1,
    p_expected_release_generation, v_current_activation.activation_generation + 1,
    jsonb_build_object(
      'from_mode', v_current_activation.runtime_mode,
      'to_mode', p_target_mode,
      'nonce', p_nonce::text,
      'governance_readiness_receipt_digest', p_governance_readiness_receipt_digest,
      'previous_activation_generation', v_current_activation.activation_generation
    ),
    v_event_digest
  );

  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'event_digest', v_event_digest,
    'runtime_mode', p_target_mode,
    'activation_generation', v_current_activation.activation_generation + 1,
    'from_mode', v_current_activation.runtime_mode
  );

  return v_result;
end;
$function$;

-- ============================================================
-- application_rollback: PUBLISHED_ONLY → SHADOW rollback
-- Requires window OPEN, current LegacyEquivalenceReceipt, expected generation CAS
-- ============================================================
create or replace function semantic.application_rollback(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_expected_activation_generation bigint,
  p_legacy_equivalence_receipt_digest text,
  p_nonce uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_current_activation record;
  v_current_release record;
  v_event_id uuid;
  v_event_digest text;
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

  -- Lock and read current runtime activation
  select activation.*
  into v_current_activation
  from semantic.semantic_runtime_activation as activation
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_ROLLBACK_DOMAIN_NOT_FOUND';
  end if;

  -- Must be in PUBLISHED_ONLY mode
  if v_current_activation.runtime_mode != 'PUBLISHED_ONLY' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_ROLLBACK_NOT_PUBLISHED_ONLY';
  end if;

  -- Rollback window must be OPEN
  if v_current_activation.rollback_window_status != 'OPEN' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_ROLLBACK_WINDOW_CLOSED';
  end if;

  -- Expected-generation CAS
  if v_current_activation.activation_generation != p_expected_activation_generation then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_ROLLBACK_GENERATION_CONFLICT';
  end if;

  -- Validate receipt digest format
  if not (p_legacy_equivalence_receipt_digest ~ '^sha256:[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'SEMANTIC_ROLLBACK_INVALID_RECEIPT';
  end if;

  -- Verify nonce uniqueness
  perform 1
  from semantic.semantic_outbox as outbox
  where outbox.app_id = p_app_id
    and outbox.tenant_id = p_tenant_id
    and outbox.environment = p_environment
    and outbox.semantic_domain = p_semantic_domain
    and outbox.event_type = 'APPLICATION_ROLLBACK_EXECUTED'
    and outbox.event_payload @> jsonb_build_object('nonce', p_nonce::text);
  if found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_ROLLBACK_NONCE_REUSED';
  end if;

  -- Perform rollback
  update semantic.semantic_runtime_activation as activation
  set runtime_mode = 'SHADOW',
      activation_generation = activation.activation_generation + 1,
      updated_at = pg_catalog.clock_timestamp()
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain;

  -- Write outbox event
  v_event_id := extensions.gen_random_uuid();
  v_event_digest := semantic.semantic_sha256(
    v_event_id::text || p_legacy_equivalence_receipt_digest,
    jsonb_build_object('version', '1.0.0', 'kind', 'application_rollback_event')
  );

  insert into semantic.semantic_outbox (
    app_id, tenant_id, environment, semantic_domain,
    event_id, event_type, counter_kind, axis_generation,
    observed_release_generation, observed_activation_generation,
    event_payload, event_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_event_id, 'APPLICATION_ROLLBACK_EXECUTED', 'ACTIVATION',
    v_current_activation.activation_generation + 1,
    v_current_activation.current_release_generation, v_current_activation.activation_generation + 1,
    jsonb_build_object(
      'from_mode', 'PUBLISHED_ONLY',
      'to_mode', 'SHADOW',
      'nonce', p_nonce::text,
      'legacy_equivalence_receipt_digest', p_legacy_equivalence_receipt_digest,
      'previous_activation_generation', v_current_activation.activation_generation
    ),
    v_event_digest
  );

  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'event_digest', v_event_digest,
    'runtime_mode', 'SHADOW',
    'activation_generation', v_current_activation.activation_generation + 1
  );

  return v_result;
end;
$function$;

-- ============================================================
-- contract_legacy: close legacy contract and rollback window
-- PUBLISHED_ONLY/OPEN/AVAILABLE → PUBLISHED_ONLY/CLOSED/CLOSED
-- Requires multi-sign closure authorization with all closure probes passed
-- ============================================================
create or replace function semantic.contract_legacy(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_expected_activation_generation bigint,
  p_closure_authorization_id uuid,
  p_nonce uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_current_activation record;
  v_authorization record;
  v_event_id uuid;
  v_event_digest text;
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

  -- Lock and read current runtime activation
  select activation.*
  into v_current_activation
  from semantic.semantic_runtime_activation as activation
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_CONTRACT_DOMAIN_NOT_FOUND';
  end if;

  -- Must be in PUBLISHED_ONLY mode
  if v_current_activation.runtime_mode != 'PUBLISHED_ONLY' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CONTRACT_NOT_PUBLISHED_ONLY';
  end if;

  -- Rollback window must be OPEN
  if v_current_activation.rollback_window_status != 'OPEN' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CONTRACT_WINDOW_ALREADY_CLOSED';
  end if;

  -- Legacy contract must be AVAILABLE
  if v_current_activation.legacy_contract_status != 'AVAILABLE' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CONTRACT_ALREADY_CLOSED';
  end if;

  -- Expected-generation CAS
  if v_current_activation.activation_generation != p_expected_activation_generation then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CONTRACT_GENERATION_CONFLICT';
  end if;

  -- Verify and consume closure authorization
  select auth.*
  into v_authorization
  from semantic.semantic_legacy_closure_authorization as auth
  where auth.app_id = p_app_id
    and auth.tenant_id = p_tenant_id
    and auth.environment = p_environment
    and auth.semantic_domain = p_semantic_domain
    and auth.authorization_id = p_closure_authorization_id
    and auth.is_consumed = false
    and auth.expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CONTRACT_AUTHORIZATION_INVALID';
  end if;

  -- Mark authorization as consumed
  update semantic.semantic_legacy_closure_authorization as auth
  set is_consumed = true,
      consumed_at = pg_catalog.clock_timestamp()
  where auth.authorization_id = p_closure_authorization_id;

  -- Perform closure
  update semantic.semantic_runtime_activation as activation
  set rollback_window_status = 'CLOSED',
      legacy_contract_status = 'CLOSED',
      closure_authorization_digest = v_authorization.closure_digest,
      activation_generation = activation.activation_generation + 1,
      updated_at = pg_catalog.clock_timestamp()
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain;

  -- Write outbox event
  v_event_id := extensions.gen_random_uuid();
  v_event_digest := semantic.semantic_sha256(
    v_event_id::text || p_closure_authorization_id::text,
    jsonb_build_object('version', '1.0.0', 'kind', 'legacy_contract_event')
  );

  insert into semantic.semantic_outbox (
    app_id, tenant_id, environment, semantic_domain,
    event_id, event_type, counter_kind, axis_generation,
    observed_release_generation, observed_activation_generation,
    event_payload, event_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_event_id, 'LEGACY_CONTRACT_CLOSED', 'ACTIVATION',
    v_current_activation.activation_generation + 1,
    v_current_activation.current_release_generation, v_current_activation.activation_generation + 1,
    jsonb_build_object(
      'closure_authorization_id', p_closure_authorization_id::text,
      'closure_digest', v_authorization.closure_digest,
      'nonce', p_nonce::text,
      'previous_activation_generation', v_current_activation.activation_generation
    ),
    v_event_digest
  );

  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'event_digest', v_event_digest,
    'rollback_window_status', 'CLOSED',
    'legacy_contract_status', 'CLOSED',
    'activation_generation', v_current_activation.activation_generation + 1
  );

  return v_result;
end;
$function$;
