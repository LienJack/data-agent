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
