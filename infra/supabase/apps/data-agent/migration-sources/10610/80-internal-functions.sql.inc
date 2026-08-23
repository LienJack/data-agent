-- ============================================================
-- 10610: Internal helper functions for semantic authority
-- ============================================================

-- ============================================================
-- Helper: acquire semantic scope authority fence (transaction advisory lock)
-- All writers must acquire this lock before writing
-- ============================================================
create or replace function semantic.lock_semantic_authority_fence(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  lock_key bigint;
begin
  lock_key := ('x' || substr(
    extensions.digest(
      p_app_id::text || p_tenant_id::text || p_environment || p_semantic_domain,
      'sha256'
    ), 1, 16
  ))::bit(64)::bigint;
  perform pg_advisory_xact_lock(lock_key);
end;
$function$;

-- ============================================================
-- Helper: acquire packet-level advisory lock
-- Must be acquired after scope authority fence, in canonical lock order
-- ============================================================
create or replace function semantic.lock_packet(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_packet_id uuid
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  lock_key bigint;
begin
  lock_key := ('x' || substr(
    extensions.digest(
      p_app_id::text || p_tenant_id::text || p_environment || p_semantic_domain || p_packet_id::text,
      'sha256'
    ), 1, 16
  ))::bit(64)::bigint;
  perform pg_advisory_xact_lock(lock_key);
end;
$function$;

-- ============================================================
-- Helper: verify current policy/assignment/membership are current
-- Returns true if all checks pass
-- ============================================================
create or replace function semantic.verify_current_review_policy(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_expected_policy_version bigint,
  p_expected_policy_digest text
) returns boolean
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_current_policy_version bigint;
  v_current_policy_digest text;
begin
  select pointer.current_policy_version, pointer.current_policy_digest
  into v_current_policy_version, v_current_policy_digest
  from semantic.semantic_reviewer_policy_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;
  if not found then
    return false;
  end if;
  return v_current_policy_version = p_expected_policy_version
    and v_current_policy_digest = p_expected_policy_digest;
end;
$function$;

-- ============================================================
-- Helper: compute canonical hash for a JSONB value
-- ============================================================
create or replace function semantic.semantic_sha256(
  p_input text,
  p_salt jsonb default '{}'::jsonb
) returns text
  language sql
  immutable
  strict
  set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(
      p_input || '|' || app_data_agent.runtime_canonical_json(p_salt),
      'sha256'
    ),
    'hex'
  );
$function$;

-- ============================================================
-- Helper: assert decision window is still open for a review packet
-- ============================================================
create or replace function semantic.assert_review_packet_open(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_packet_id uuid
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_status text;
  v_outcome text;
  v_expires_at timestamptz;
begin
  select task.decision_window_status, task.review_outcome, task.decision_expires_at
  into v_status, v_outcome, v_expires_at
  from semantic.semantic_review_task as task
  where task.app_id = p_app_id
    and task.tenant_id = p_tenant_id
    and task.environment = p_environment
    and task.semantic_domain = p_semantic_domain
    and task.packet_id = p_packet_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_REVIEW_PACKET_NOT_FOUND';
  end if;
  if v_status = 'CLOSED' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_REVIEW_WINDOW_CLOSED';
  end if;
  if v_outcome != 'PENDING' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_REVIEW_PACKET_STALE';
  end if;
  if pg_catalog.clock_timestamp() > v_expires_at then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_REVIEW_PACKET_EXPIRED';
  end if;
end;
$function$;

-- ============================================================
-- Helper: verify principal is not in exclusion set
-- ============================================================
create or replace function semantic.verify_principal_not_excluded(
  p_principal text,
  p_exclusion_set jsonb
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
begin
  if p_exclusion_set @> to_jsonb(p_principal) then
    raise exception using errcode = '42501', message = 'SEMANTIC_PRINCIPAL_EXCLUDED';
  end if;
end;
$function$;
