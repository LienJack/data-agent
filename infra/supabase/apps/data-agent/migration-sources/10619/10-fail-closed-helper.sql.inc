-- ============================================================
-- Temporary helper used only while the 10620 SQL body is parsed
-- ============================================================

do $compatibility$
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010620_app_data_agent_contribution_authority'
  ) then
    execute $ddl$
      create or replace function app_data_agent.attribution_canonical_json(
        p_value jsonb
      ) returns text
        language plpgsql
        called on null input
        immutable
        security invoker
        set search_path = ''
      as $function$
      begin
        raise exception using
          errcode = '0A000',
          message = 'ATTRIBUTION_CANONICAL_JSON_COMPATIBILITY_HELPER_DISABLED';
      end;
      $function$
    $ddl$;
    execute $revoke$
      revoke all on function app_data_agent.attribution_canonical_json(jsonb) from public
    $revoke$;
    execute $revoke$
      revoke all on function app_data_agent.attribution_canonical_json(jsonb) from data_agent_u6_rpc_owner
    $revoke$;
  end if;
end
$compatibility$;

-- 10620 and 10621 both qualify pgcrypto.digest as pg_catalog.digest. The
-- wrapper exists only so PostgreSQL can validate those historical SQL bodies.
-- It is private, tagged, and removed by 10622 after the bodies are corrected.
do $digest_compatibility$
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010620_app_data_agent_contribution_authority'
  ) and pg_catalog.to_regprocedure('pg_catalog.digest(bytea,text)') is null then
    execute $ddl$
      create function pg_catalog.digest(
        p_data bytea,
        p_type text
      ) returns bytea
        language sql
        strict
        immutable
        parallel safe
        security invoker
        set search_path = ''
      as $function$
        select extensions.digest(p_data, p_type)
      $function$
    $ddl$;
    execute $comment$
      comment on function pg_catalog.digest(bytea, text)
      is 'data-agent:10619:temporary-pgcrypto-parser-shim'
    $comment$;
    execute $revoke$
      revoke all on function pg_catalog.digest(bytea, text) from public
    $revoke$;
    execute $revoke$
      revoke all on function pg_catalog.digest(bytea, text) from data_agent_u6_rpc_owner
    $revoke$;
  end if;
end
$digest_compatibility$;

-- The historical canonical helper contains a PL/pgSQL statement in a CASE
-- expression. PostgreSQL rejects it during CREATE FUNCTION validation. This
-- event trigger switches validation off only for the three exact historical
-- function declarations and only for their current transaction. It never
-- changes a role/database/session default and is removed by 10622.
do $body_compatibility$
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010620_app_data_agent_contribution_authority'
  ) then
    execute $guard$
      create function app_data_agent.attribution_compatibility_function_body_guard()
      returns event_trigger
        language plpgsql
        security invoker
        set search_path = ''
      as $function$
      declare
        ddl_text text := pg_catalog.lower(pg_catalog.current_query());
      begin
        if ddl_text ~
          'create\s+or\s+replace\s+function\s+app_data_agent\.(attribution_sha256|attribution_canonical_json|hash_f9_evidence)\s*\('
        then
          if session_user <> 'postgres' or current_user <> 'postgres' then
            raise exception using
              errcode = '42501',
              message = 'ATTRIBUTION_FUNCTION_BODY_COMPATIBILITY_EXECUTOR_UNSAFE';
          end if;
          perform pg_catalog.set_config('check_function_bodies', 'off', true);
        end if;
      end
      $function$
    $guard$;
    execute $revoke$
      revoke all on function app_data_agent.attribution_compatibility_function_body_guard()
      from public
    $revoke$;
    execute $revoke$
      revoke all on function app_data_agent.attribution_compatibility_function_body_guard()
      from data_agent_u6_rpc_owner
    $revoke$;
    execute $trigger$
      create event trigger data_agent_10619_attribution_body_validation
        on ddl_command_start
        execute function app_data_agent.attribution_compatibility_function_body_guard()
    $trigger$;
    execute $comment$
      comment on event trigger data_agent_10619_attribution_body_validation
        is 'data-agent:10619:temporary-attribution-function-body-validation-guard'
    $comment$;
  end if;
end
$body_compatibility$;
