-- ============================================================
-- 10622: Repair the 10610 semantic advisory-lock key
-- ============================================================
-- pgcrypto.digest returns bytea. Convert its first eight bytes to hex before
-- casting to bit(64), and frame the scope as JSON to avoid concatenation
-- ambiguity. CREATE OR REPLACE preserves the registered owner and ACL.

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
  lock_key := (
    'x' || pg_catalog.encode(
      pg_catalog.substr(
        extensions.digest(
          pg_catalog.convert_to(
            pg_catalog.jsonb_build_array(
              p_app_id,
              p_tenant_id,
              p_environment,
              p_semantic_domain
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        1,
        8
      ),
      'hex'
    )
  )::bit(64)::bigint;
  perform pg_catalog.pg_advisory_xact_lock(lock_key);
end
$function$;

alter function semantic.lock_semantic_authority_fence(uuid, uuid, text, text)
  owner to data_agent_u6_rpc_owner;
