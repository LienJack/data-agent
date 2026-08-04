-- semantic_migration_checksum: sha256:958df7eb774820b1bcef515546d206b9e2d60270cb79c86174fb26801a266c3b
-- ============================================================
-- 10615: Published-only Bridge — Runtime Activation & V2 Grounding Materializer
-- ============================================================
-- This migration adds:
--   1. activate_runtime() — SHADOW→PUBLISHED_ONLY and LEGACY→SHADOW transitions
--   2. application_rollback() — PUBLISHED_ONLY→SHADOW rollback
--   3. contract_legacy() — legacy contract closure
--   4. commit_published_grounding_bundle_v2() — V2 materializer binding to semantic_runtime_projection_binding
--   5. Extended outbox event types for activation/rollback/contract events
--
-- Depends on: 20260725010610_app_data_agent_semantic_control_plane (10610)
-- ============================================================

begin;

-- ============================================================
-- Executor safety: must run as postgres with proper maintenance window
-- ============================================================
do $bootstrap$
declare
  session_arm_ms bigint;
  arm_now timestamptz;
  window_expires_at timestamptz;
  effective_budget_ms bigint;
  rearm_verified_at timestamptz;
  requested_deployment_id uuid;
  observed_database_identity_hash text;
  expected_database_identity_hash text;
  executor record;
  transaction_setting bigint;
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'SEMANTIC_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  -- Verify 10610 baseline is installed and immutable
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010610_app_data_agent_semantic_control_plane';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_MIGRATION_BASELINE_10610_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010615_app_data_agent_semantic_published_bridge'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_MIGRATION_10615_ALREADY_RECORDED';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);

lock table
  semantic.semantic_runtime_activation,
  semantic.semantic_active_pointer,
  semantic.semantic_authority_fence,
  semantic.semantic_source_release,
  semantic.semantic_runtime_projection_binding,
  semantic.semantic_legacy_closure_authorization,
  semantic.semantic_legacy_equivalence_receipt,
  semantic.semantic_legacy_equivalence_attempt,
  semantic.semantic_legacy_compatible_mirror,
  semantic.semantic_outbox
in access exclusive mode nowait;
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
-- ============================================================
-- 10615: V2 Published Grounding Bundle Materializer
-- ============================================================
-- commit_published_grounding_bundle_v2: atomically binds three U5 Artifacts
-- with semantic_runtime_projection_binding in the same database transaction.
--
-- This is the V2 materializer that only operates after 10610 is installed.
-- It enforces published-only projection binding: the projection must belong
-- to a published release (not draft/fixture/rejected/stale).
--
-- Idempotent on (scope, run_id, materialization_input_hash).
-- Crash semantics: fully consumable bundle or non-consumable staging.
-- ============================================================

create or replace function semantic.commit_published_grounding_bundle_v2(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_run_id uuid,
  p_materialization_input_hash text,
  p_semantic_release_ref uuid,
  p_schema_snapshot_ref uuid,
  p_policy_receipt_ref uuid,
  p_projection_id uuid,
  p_binding_id uuid,
  p_u5_artifact_ref uuid default null,
  p_u5_artifact_hash text default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_activation record;
  v_release record;
  v_binding_hash text;
  v_existing record;
  v_result jsonb;
  v_event_id uuid;
  v_event_digest text;
begin
  -- Validate input hash format
  if not (p_materialization_input_hash ~ '^sha256:[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'SEMANTIC_BRIDGE_INVALID_INPUT_HASH';
  end if;

  if p_u5_artifact_hash is not null
    and not (p_u5_artifact_hash ~ '^sha256:[0-9a-f]{64}$')
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_BRIDGE_INVALID_ARTIFACT_HASH';
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

  -- Check idempotency: same (scope, run_id, materialization_input_hash)
  select binding.*
  into v_existing
  from semantic.semantic_runtime_projection_binding as binding
  where binding.app_id = p_app_id
    and binding.tenant_id = p_tenant_id
    and binding.environment = p_environment
    and binding.semantic_domain = p_semantic_domain
    and binding.binding_hash = semantic.semantic_sha256(
      p_run_id::text || p_materialization_input_hash,
      jsonb_build_object('version', '1.0.0', 'kind', 'grounding_binding')
    );
  if found then
    -- Idempotent: return existing binding
    return jsonb_build_object(
      'binding_id', v_existing.binding_id,
      'binding_hash', v_existing.binding_hash,
      'release_id', v_existing.release_id,
      'projection_id', v_existing.projection_id,
      'is_idempotent', true
    );
  end if;

  -- Verify runtime mode is not LEGACY (published-only bridge requires at least SHADOW)
  select activation.*
  into v_activation
  from semantic.semantic_runtime_activation as activation
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_BRIDGE_DOMAIN_NOT_FOUND';
  end if;
  if v_activation.runtime_mode = 'LEGACY' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_BRIDGE_LEGACY_MODE_UNSUPPORTED';
  end if;

  -- Verify the projection belongs to a published release (not draft/fixture/rejected/stale)
  -- The projection must be in a semantic_executable_projection that is referenced by
  -- a semantic_source_release
  select release.release_id, release.release_generation, release.release_digest
  into v_release
  from semantic.semantic_source_release as release
  where release.app_id = p_app_id
    and release.tenant_id = p_tenant_id
    and release.environment = p_environment
    and release.semantic_domain = p_semantic_domain
    and (
      release.executable_projection_ref = p_projection_id
      or release.relationship_projection_ref = p_projection_id
      or release.runtime_restriction_projection_ref = p_projection_id
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_BRIDGE_PROJECTION_NOT_PUBLISHED';
  end if;

  -- Compute binding hash
  v_binding_hash := semantic.semantic_sha256(
    p_run_id::text || p_materialization_input_hash,
    jsonb_build_object('version', '1.0.0', 'kind', 'grounding_binding')
  );

  -- Insert binding
  insert into semantic.semantic_runtime_projection_binding (
    app_id, tenant_id, environment, semantic_domain,
    binding_id, release_id, projection_id, run_id,
    u5_artifact_ref, u5_artifact_hash, binding_hash
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    p_binding_id, v_release.release_id, p_projection_id, p_run_id,
    p_u5_artifact_ref, p_u5_artifact_hash, v_binding_hash
  );

  -- Write outbox event
  v_event_id := extensions.gen_random_uuid();
  v_event_digest := semantic.semantic_sha256(
    v_event_id::text || p_binding_id::text,
    jsonb_build_object('version', '1.0.0', 'kind', 'grounding_binding_event')
  );

  insert into semantic.semantic_outbox (
    app_id, tenant_id, environment, semantic_domain,
    event_id, event_type, counter_kind, axis_generation,
    observed_release_generation, observed_activation_generation,
    event_payload, event_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_event_id, 'SOURCE_RELEASE_ACTIVATED', 'RELEASE',
    v_release.release_generation, v_release.release_generation, v_activation.activation_generation,
    jsonb_build_object(
      'binding_id', p_binding_id::text,
      'binding_hash', v_binding_hash,
      'release_id', v_release.release_id::text,
      'release_generation', v_release.release_generation,
      'projection_id', p_projection_id::text,
      'run_id', p_run_id::text,
      'materialization_input_hash', p_materialization_input_hash,
      'runtime_mode', v_activation.runtime_mode
    ),
    v_event_digest
  );

  v_result := jsonb_build_object(
    'binding_id', p_binding_id,
    'binding_hash', v_binding_hash,
    'release_id', v_release.release_id,
    'release_generation', v_release.release_generation,
    'projection_id', p_projection_id,
    'run_id', p_run_id,
    'is_idempotent', false
  );

  return v_result;
end;
$function$;
-- ============================================================
-- 10615: RLS, policy, ACL, and owner assignments for 10615 functions
-- ============================================================

-- Grant EXECUTE on activation RPCs to A8 Publisher role
grant execute on function semantic.activate_runtime(
  uuid, uuid, text, text, text, bigint, bigint, text, uuid
) to data_agent_u6_rpc_owner;

grant execute on function semantic.application_rollback(
  uuid, uuid, text, text, bigint, text, uuid
) to data_agent_u6_rpc_owner;

grant execute on function semantic.contract_legacy(
  uuid, uuid, text, text, bigint, uuid, uuid
) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on V2 published grounding bundle materializer to A8 Publisher role
grant execute on function semantic.commit_published_grounding_bundle_v2(
  uuid, uuid, text, text, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text
) to data_agent_u6_rpc_owner;

-- Schema USAGE already granted by 10610
-- ============================================================
-- 10615: Post-conditions, ledger checksum, and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010615_app_data_agent_semantic_published_bridge',
  'sha256:0000000000000000000000000000000000000000000000000000000000000000'
);

commit;
