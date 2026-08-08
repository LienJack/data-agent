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
