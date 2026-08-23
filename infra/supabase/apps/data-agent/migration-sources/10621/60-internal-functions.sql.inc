-- ============================================================
-- 10621: Published F9 Internal Functions
-- ============================================================
-- Internal helper functions for the published F9 tables:
--   1. hash_f9_evidence — domain-separated SHA256 for safety evidence
--   2. lock_f9_fence — advisory lock for F9 operations
-- ============================================================

-- ============================================================
-- Function: hash_f9_evidence
-- Domain-separated SHA256 hash: sha256("attribution-safety" || chr(0) || canonicalJson(payload))
-- ============================================================
create or replace function app_data_agent.hash_f9_evidence(
  p_domain text,
  p_payload jsonb
) returns text
  language sql
  strict
  immutable
  set search_path = ''
as $function$
  select pg_catalog.encode(
    pg_catalog.digest(
      p_domain::bytea || pg_catalog.chr(0)::bytea || p_payload::bytea,
      'sha256'
    ),
    'hex'
  );
$function$;

-- ============================================================
-- Function: lock_f9_fence
-- Acquires an advisory lock for the F9 operations fence.
-- Returns true if the lock was acquired, raises exception on lock timeout.
-- ============================================================
create or replace function app_data_agent.lock_f9_fence(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns boolean
  language plpgsql
  strict
  volatile
  security definer
  set search_path = ''
as $function$
declare
  v_lock_key bigint;
begin
  v_lock_key := (
    ('x' || pg_catalog.left(p_app_id::text, 16))::bit(64)::bigint
    # ('x' || pg_catalog.left(p_tenant_id::text, 16))::bit(64)::bigint
  ) # 10621::bigint;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  return true;
end;
$function$;
