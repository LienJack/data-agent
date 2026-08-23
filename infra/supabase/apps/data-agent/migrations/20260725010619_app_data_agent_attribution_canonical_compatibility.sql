-- attribution_compatibility_migration_checksum: sha256:6031052694e6aa63c1d67951bd2be5f93e7ab8f6bdc2dd1cccadc5294c885696
-- ============================================================
-- 10619: Attribution bootstrap compatibility
-- ============================================================
-- The registered 10620 migration creates attribution_sha256 before the
-- canonical JSON helper it references and resolves pgcrypto.digest from the
-- wrong schema. Clean installs receive an inert canonical helper plus a
-- private, tagged digest parser shim. A narrowly matched event trigger also
-- defers validation only for the three invalid historical function bodies.
-- 10622 installs valid bodies and removes both temporary compatibility aids.
-- Existing databases that already recorded 10620 do not create the shim.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'ATTRIBUTION_COMPATIBILITY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'ATTRIBUTION_COMPATIBILITY_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'ATTRIBUTION_COMPATIBILITY_EXECUTOR_UNSAFE';
  end if;

  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010615_app_data_agent_semantic_published_bridge';
  if not found then
    raise exception using errcode = 'P0001', message = 'ATTRIBUTION_COMPATIBILITY_BASELINE_10615_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010619_app_data_agent_attribution_canonical_compatibility'
  ) then
    raise exception using errcode = 'P0001', message = 'ATTRIBUTION_COMPATIBILITY_10619_ALREADY_RECORDED';
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
-- ============================================================
-- Compatibility helper must be inert before 10620 replaces it
-- ============================================================

do $postconditions$
declare
  compatibility_helper record;
  digest_helper record;
  body_guard record;
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010620_app_data_agent_contribution_authority'
  ) then
    select procedure.oid, procedure.prosecdef, procedure.proisstrict, procedure.provolatile,
      procedure.proconfig
    into compatibility_helper
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_data_agent'
      and procedure.proname = 'attribution_canonical_json'
      and procedure.pronargs = 1
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'jsonb';
    if not found then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_COMPATIBILITY_HELPER_MISSING';
    end if;
    if compatibility_helper.prosecdef
      or compatibility_helper.proisstrict
      or compatibility_helper.provolatile <> 'i'
      or pg_catalog.array_to_string(compatibility_helper.proconfig, ',') not in (
        'search_path=',
        'search_path=""'
      )
    then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_COMPATIBILITY_HELPER_PROPERTIES_INVALID';
    end if;
    if pg_catalog.has_function_privilege(
      'data_agent_u6_rpc_owner',
      compatibility_helper.oid,
      'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'data_agent_backend',
      compatibility_helper.oid,
      'EXECUTE'
    ) then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_COMPATIBILITY_HELPER_EXECUTE_PRESENT';
    end if;

    select procedure.oid, procedure.prosecdef, procedure.proisstrict,
      procedure.provolatile, procedure.proparallel, procedure.proconfig,
      pg_catalog.obj_description(procedure.oid, 'pg_proc') as description
    into digest_helper
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'pg_catalog'
      and procedure.proname = 'digest'
      and procedure.pronargs = 2
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'bytea, text';
    if not found then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_DIGEST_COMPATIBILITY_HELPER_MISSING';
    end if;
    if digest_helper.description = 'data-agent:10619:temporary-pgcrypto-parser-shim'
      and (
        digest_helper.prosecdef
        or not digest_helper.proisstrict
        or digest_helper.provolatile <> 'i'
        or digest_helper.proparallel <> 's'
        or pg_catalog.array_to_string(digest_helper.proconfig, ',') not in (
          'search_path=',
          'search_path=""'
        )
        or pg_catalog.has_function_privilege('data_agent_backend', digest_helper.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege(
          'data_agent_u6_rpc_owner',
          digest_helper.oid,
          'EXECUTE'
        )
      )
    then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_DIGEST_COMPATIBILITY_HELPER_INVALID';
    end if;

    select procedure.oid, procedure.prosecdef, procedure.proconfig,
      event_trigger.evtenabled,
      pg_catalog.obj_description(event_trigger.oid, 'pg_event_trigger') as description
    into body_guard
    from pg_catalog.pg_event_trigger as event_trigger
    join pg_catalog.pg_proc as procedure
      on procedure.oid = event_trigger.evtfoid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where event_trigger.evtname = 'data_agent_10619_attribution_body_validation'
      and event_trigger.evtevent = 'ddl_command_start'
      and namespace.nspname = 'app_data_agent'
      and procedure.proname = 'attribution_compatibility_function_body_guard';
    if not found then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_FUNCTION_BODY_COMPATIBILITY_GUARD_MISSING';
    end if;
    if body_guard.prosecdef
      or body_guard.evtenabled <> 'O'
      or body_guard.description <>
        'data-agent:10619:temporary-attribution-function-body-validation-guard'
      or pg_catalog.array_to_string(body_guard.proconfig, ',') not in (
        'search_path=',
        'search_path=""'
      )
      or pg_catalog.has_function_privilege(
        'data_agent_backend',
        body_guard.oid,
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'data_agent_u6_rpc_owner',
        body_guard.oid,
        'EXECUTE'
      )
    then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_FUNCTION_BODY_COMPATIBILITY_GUARD_INVALID';
    end if;
  end if;
end
$postconditions$;
-- ============================================================
-- 10619 ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010619_app_data_agent_attribution_canonical_compatibility',
  'sha256:6031052694e6aa63c1d67951bd2be5f93e7ab8f6bdc2dd1cccadc5294c885696'
);

commit;
