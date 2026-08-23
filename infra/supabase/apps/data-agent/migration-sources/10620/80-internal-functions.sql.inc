-- ============================================================
-- 10620: Attribution Internal Functions
-- ============================================================
-- Internal helper functions for the contribution authority:
--   1. attribution_sha256 — domain-separated SHA256
--   2. lock_attribution_authority_fence — advisory lock
--   3. attribution_canonical_json — canonical JSON serialization
-- ============================================================

-- ============================================================
-- Function: attribution_sha256
-- Domain-separated SHA256 hash: sha256(domain || chr(0) || canonicalJson(payload))
-- ============================================================
create or replace function app_data_agent.attribution_sha256(
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
      p_domain::bytea || pg_catalog.chr(0)::bytea || app_data_agent.attribution_canonical_json(p_payload)::bytea,
      'sha256'
    ),
    'hex'
  );
$function$;

-- ============================================================
-- Function: lock_attribution_authority_fence
-- Acquires an advisory lock for the attribution authority fence.
-- Returns true if the lock was acquired, raises exception on lock timeout.
-- ============================================================
create or replace function app_data_agent.lock_attribution_authority_fence(
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
  );
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  return true;
end;
$function$;

-- ============================================================
-- Function: attribution_canonical_json
-- Returns canonical (deterministic) JSON serialization.
-- Sorts keys recursively, uses no whitespace, and produces
-- a stable representation suitable for hashing.
-- ============================================================
create or replace function app_data_agent.attribution_canonical_json(
  p_value jsonb
) returns text
  language plpgsql
  strict
  immutable
  set search_path = ''
as $function$
declare
  v_result text;
begin
  select string_agg(
    case
      when jsonb_typeof(p_value) = 'object' then
        '{' || (
          select string_agg(
            pg_catalog.to_json(object_key.key)::text || ':' ||
            app_data_agent.attribution_canonical_json(object_key.value),
            ',' order by object_key.key
          )
          from jsonb_each(p_value) as object_key(key, value)
        ) || '}'
      when jsonb_typeof(p_value) = 'array' then
        '[' || (
          select string_agg(
            app_data_agent.attribution_canonical_json(array_element.value),
            ',' order by row_number
          )
          from jsonb_array_elements(p_value) with ordinality as array_element(value, row_number)
        ) || ']'
      when jsonb_typeof(p_value) = 'string' then
        pg_catalog.to_json(p_value#>>'{}')::text
      when jsonb_typeof(p_value) = 'number' then
        (p_value#>>'{}')::text
      when jsonb_typeof(p_value) = 'boolean' then
        case when p_value::boolean then 'true' else 'false' end
      when jsonb_typeof(p_value) = 'null' then
        'null'
      else
        raise exception 'ATTRIBUTION_CANONICAL_JSON_UNSUPPORTED_TYPE'
    end
  ) into v_result;
  return v_result;
end;
$function$;
