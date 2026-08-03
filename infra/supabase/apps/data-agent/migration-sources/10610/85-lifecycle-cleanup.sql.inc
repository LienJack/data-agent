-- ============================================================
-- 10610: Lifecycle cleanup functions (expiry sweeper)
-- ============================================================

-- ============================================================
-- Expire stale review packets: close expired OPEN review packets
-- ============================================================
create or replace function semantic.expire_stale_review_packets(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_batch_size integer default 100
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_expired_count integer := 0;
  v_packet record;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  for v_packet in
    select task.packet_id
    from semantic.semantic_review_task as task
    where task.app_id = p_app_id
      and task.tenant_id = p_tenant_id
      and task.environment = p_environment
      and task.semantic_domain = p_semantic_domain
      and task.decision_window_status = 'OPEN'
      and task.decision_expires_at < pg_catalog.clock_timestamp()
    limit p_batch_size
    for update skip locked
  loop
    update semantic.semantic_review_task as task
    set decision_window_status = 'CLOSED',
        review_outcome = 'EXPIRED',
        closed_at = pg_catalog.clock_timestamp()
    where task.packet_id = v_packet.packet_id;
    v_expired_count := v_expired_count + 1;
  end loop;

  return jsonb_build_object('expired_packets', v_expired_count);
end;
$function$;

-- ============================================================
-- Expire stale publish attempts: mark PREPARED attempts as STALE
-- when base dependency has changed
-- ============================================================
create or replace function semantic.expire_stale_publish_attempts(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_batch_size integer default 100
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_stale_count integer := 0;
  v_attempt record;
  v_current_dependency_generation bigint;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  select pointer.pointer_generation
  into v_current_dependency_generation
  from semantic.semantic_dependency_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;

  for v_attempt in
    select attempt.attempt_id
    from semantic.semantic_publish_attempt as attempt
    where attempt.app_id = p_app_id
      and attempt.tenant_id = p_tenant_id
      and attempt.environment = p_environment
      and attempt.semantic_domain = p_semantic_domain
      and attempt.attempt_state = 'PREPARED'
      and attempt.dependency_generation < v_current_dependency_generation
    limit p_batch_size
    for update skip locked
  loop
    update semantic.semantic_publish_attempt as attempt
    set attempt_state = 'STALE',
        updated_at = pg_catalog.clock_timestamp()
    where attempt.attempt_id = v_attempt.attempt_id;
    v_stale_count := v_stale_count + 1;
  end loop;

  return jsonb_build_object('stale_attempts', v_stale_count);
end;
$function$;

-- ============================================================
-- Expire stale bootstrap packets: close expired non-CLOSED bootstrap packets
-- ============================================================
create or replace function semantic.expire_stale_bootstrap_packets(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_batch_size integer default 100
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_expired_count integer := 0;
  v_bootstrap record;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  for v_bootstrap in
    select bootstrap.bootstrap_id
    from semantic.semantic_domain_bootstrap as bootstrap
    where bootstrap.app_id = p_app_id
      and bootstrap.tenant_id = p_tenant_id
      and bootstrap.environment = p_environment
      and bootstrap.semantic_domain = p_semantic_domain
      and bootstrap.is_closed = false
      and bootstrap.bootstrap_expires_at < pg_catalog.clock_timestamp()
    limit p_batch_size
    for update skip locked
  loop
    update semantic.semantic_domain_bootstrap as bootstrap
    set is_closed = true,
        closed_at = pg_catalog.clock_timestamp()
    where bootstrap.bootstrap_id = v_bootstrap.bootstrap_id;
    v_expired_count := v_expired_count + 1;
  end loop;

  return jsonb_build_object('expired_bootstrap_packets', v_expired_count);
end;
$function$;
