-- semantic_compatibility_migration_checksum: sha256:1657bb333a211200c1981e6ed2e85dc1414782f54f3885aece69c65a2f196f4d
-- ============================================================
-- 10609: Semantic publish GRANT compatibility
-- ============================================================
-- Clean installs of the registered 10610 migration need a temporary,
-- fail-closed 12-argument overload so its historical GRANT can resolve.
-- Existing databases that already recorded 10610 do not create the shim.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_COMPATIBILITY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_COMPATIBILITY_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_COMPATIBILITY_EXECUTOR_UNSAFE';
  end if;

  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010600_app_data_agent_u6_research_derivation';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_COMPATIBILITY_BASELINE_10600_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010609_app_data_agent_semantic_publish_grant_compatibility'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_COMPATIBILITY_10609_ALREADY_RECORDED';
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
-- Temporary overload for the historical 10610 GRANT only
-- ============================================================

do $compatibility$
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010610_app_data_agent_semantic_control_plane'
  ) then
    execute 'create schema if not exists semantic';
    execute $ddl$
      create or replace function semantic.commit_publish_attempt(
        p_app_id uuid,
        p_tenant_id uuid,
        p_environment text,
        p_semantic_domain text,
        p_attempt_id uuid,
        p_executable_projection_ref uuid,
        p_executable_projection_hash text,
        p_relationship_projection_ref uuid,
        p_relationship_projection_hash text,
        p_runtime_restriction_projection_ref uuid,
        p_runtime_restriction_projection_hash text,
        p_committed_legacy_attempt_ref uuid
      ) returns jsonb
        language plpgsql
        called on null input
        security invoker
        set search_path = ''
      as $function$
      begin
        raise exception using
          errcode = '0A000',
          message = 'SEMANTIC_COMMIT_PUBLISH_COMPATIBILITY_SIGNATURE_DISABLED';
      end;
      $function$
    $ddl$;
    execute $revoke$
      revoke all on function semantic.commit_publish_attempt(
        uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid
      ) from public
    $revoke$;
    execute $revoke$
      revoke all on function semantic.commit_publish_attempt(
        uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid
      ) from data_agent_u6_rpc_owner
    $revoke$;
  end if;
end
$compatibility$;
-- ============================================================
-- Compatibility surface must be inert before 10610
-- ============================================================

do $postconditions$
declare
  compatibility_rpc record;
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010610_app_data_agent_semantic_control_plane'
  ) then
    select procedure.oid, procedure.prosecdef, procedure.proisstrict, procedure.proconfig
    into compatibility_rpc
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'semantic'
      and procedure.proname = 'commit_publish_attempt'
      and procedure.pronargs = 12
      and pg_catalog.oidvectortypes(procedure.proargtypes) =
        'uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid';
    if not found then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_COMPATIBILITY_RPC_MISSING';
    end if;
    if compatibility_rpc.prosecdef then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_COMPATIBILITY_RPC_SECURITY_DEFINER';
    end if;
    if compatibility_rpc.proisstrict then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_COMPATIBILITY_RPC_STRICT';
    end if;
    if pg_catalog.array_to_string(compatibility_rpc.proconfig, ',') not in (
      'search_path=',
      'search_path=""'
    ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_COMPATIBILITY_RPC_SEARCH_PATH_INVALID';
    end if;
    if pg_catalog.has_function_privilege(
        'data_agent_u6_rpc_owner',
        compatibility_rpc.oid,
        'EXECUTE'
      ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_COMPATIBILITY_RPC_OWNER_EXECUTE_PRESENT';
    end if;
    if pg_catalog.has_function_privilege(
        'data_agent_backend',
        compatibility_rpc.oid,
        'EXECUTE'
      ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_COMPATIBILITY_BACKEND_EXECUTE_PRESENT';
    end if;
  end if;
end
$postconditions$;
-- ============================================================
-- 10609 ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010609_app_data_agent_semantic_publish_grant_compatibility',
  'sha256:1657bb333a211200c1981e6ed2e85dc1414782f54f3885aece69c65a2f196f4d'
);

commit;
