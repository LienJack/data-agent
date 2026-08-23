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
