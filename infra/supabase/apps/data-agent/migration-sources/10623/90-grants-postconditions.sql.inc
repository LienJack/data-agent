-- ============================================================
-- 10623: Exact grants and static postconditions
-- ============================================================

grant usage on schema catalog to data_agent_u6_rpc_owner;
grant usage on schema platform to data_agent_u6_rpc_owner;
grant execute on function platform.backend_context_matches(uuid, uuid, text, boolean)
  to data_agent_u6_rpc_owner;
grant execute on function platform.canonical_sha256(jsonb)
  to data_agent_u6_rpc_owner;

grant select, insert on table catalog.physical_schema_snapshot to data_agent_u6_rpc_owner;
grant select, insert on table catalog.schema_scan_run to data_agent_u6_rpc_owner;
grant select, insert on table catalog.schema_drift_event to data_agent_u6_rpc_owner;

alter function catalog.assert_catalog_scope(uuid, uuid, text, uuid, boolean)
  owner to data_agent_u6_rpc_owner;
alter function catalog.commit_schema_scan_success(uuid, uuid, text, uuid, text, uuid, text, jsonb)
  owner to data_agent_u6_rpc_owner;
alter function catalog.commit_schema_scan_failure(uuid, uuid, text, uuid, text, text, uuid, uuid, text, text, timestamptz)
  owner to data_agent_u6_rpc_owner;
alter function catalog.commit_schema_drift(uuid, uuid, text, uuid, jsonb)
  owner to data_agent_u6_rpc_owner;
alter function catalog.get_schema_scan(uuid, uuid, text, uuid, text, uuid)
  owner to data_agent_u6_rpc_owner;
alter function catalog.get_physical_schema_snapshot(uuid, uuid, text, uuid, uuid)
  owner to data_agent_u6_rpc_owner;
alter function catalog.get_schema_drift(uuid, uuid, text, uuid, text, uuid)
  owner to data_agent_u6_rpc_owner;

revoke all on function catalog.assert_catalog_scope(uuid, uuid, text, uuid, boolean)
  from public;
revoke all on function catalog.commit_schema_scan_success(uuid, uuid, text, uuid, text, uuid, text, jsonb)
  from public;
revoke all on function catalog.commit_schema_scan_failure(uuid, uuid, text, uuid, text, text, uuid, uuid, text, text, timestamptz)
  from public;
revoke all on function catalog.commit_schema_drift(uuid, uuid, text, uuid, jsonb)
  from public;
revoke all on function catalog.get_schema_scan(uuid, uuid, text, uuid, text, uuid)
  from public;
revoke all on function catalog.get_physical_schema_snapshot(uuid, uuid, text, uuid, uuid)
  from public;
revoke all on function catalog.get_schema_drift(uuid, uuid, text, uuid, text, uuid)
  from public;

grant execute on function catalog.assert_catalog_scope(uuid, uuid, text, uuid, boolean)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.commit_schema_scan_success(uuid, uuid, text, uuid, text, uuid, text, jsonb)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.commit_schema_scan_failure(uuid, uuid, text, uuid, text, text, uuid, uuid, text, text, timestamptz)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.commit_schema_drift(uuid, uuid, text, uuid, jsonb)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.get_schema_scan(uuid, uuid, text, uuid, text, uuid)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.get_physical_schema_snapshot(uuid, uuid, text, uuid, uuid)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.get_schema_drift(uuid, uuid, text, uuid, text, uuid)
  to data_agent_u6_rpc_owner;

grant usage on schema catalog to data_agent_backend;
grant execute on function catalog.commit_schema_scan_success(uuid, uuid, text, uuid, text, uuid, text, jsonb)
  to data_agent_backend;
grant execute on function catalog.commit_schema_scan_failure(uuid, uuid, text, uuid, text, text, uuid, uuid, text, text, timestamptz)
  to data_agent_backend;
grant execute on function catalog.commit_schema_drift(uuid, uuid, text, uuid, jsonb)
  to data_agent_backend;
grant execute on function catalog.get_schema_scan(uuid, uuid, text, uuid, text, uuid)
  to data_agent_backend;
grant execute on function catalog.get_physical_schema_snapshot(uuid, uuid, text, uuid, uuid)
  to data_agent_backend;
grant execute on function catalog.get_schema_drift(uuid, uuid, text, uuid, text, uuid)
  to data_agent_backend;

revoke all on table catalog.physical_schema_snapshot from public;
revoke all on table catalog.schema_scan_run from public;
revoke all on table catalog.schema_drift_event from public;
revoke all on table catalog.physical_schema_snapshot from data_agent_backend;
revoke all on table catalog.schema_scan_run from data_agent_backend;
revoke all on table catalog.schema_drift_event from data_agent_backend;
revoke all on schema catalog from authenticated;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'physical_schema_snapshot',
    'schema_scan_run',
    'schema_drift_event'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles as owner
        on owner.oid = relation.relowner
      where namespace.nspname = 'catalog'
        and relation.relname = relation_name
        and relation.relkind = 'r'
        and relation.relrowsecurity
        and relation.relforcerowsecurity
        and owner.rolname = 'data_agent_u6_data_owner'
    ) then
      raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_TABLE_POSTCONDITION_FAILED';
    end if;
    if pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('catalog.%I', relation_name),
      'SELECT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('catalog.%I', relation_name),
      'INSERT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('catalog.%I', relation_name),
      'UPDATE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('catalog.%I', relation_name),
      'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_BACKEND_TABLE_ACL_FAILED';
    end if;
    if not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('catalog.%I', relation_name),
      'SELECT'
    ) or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('catalog.%I', relation_name),
      'INSERT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('catalog.%I', relation_name),
      'UPDATE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('catalog.%I', relation_name),
      'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_RPC_OWNER_TABLE_ACL_FAILED';
    end if;
  end loop;

  foreach function_name in array array[
    'commit_schema_scan_success',
    'commit_schema_scan_failure',
    'commit_schema_drift',
    'get_schema_scan',
    'get_physical_schema_snapshot',
    'get_schema_drift'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner
      on owner.oid = procedure.proowner
    where namespace.nspname = 'catalog'
      and procedure.proname = function_name;
    if not found
      or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in (
        'search_path=',
        'search_path=""'
      )
    then
      raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_RPC_POSTCONDITION_FAILED';
    end if;
  end loop;

  if not pg_catalog.has_schema_privilege('data_agent_backend', 'catalog', 'USAGE')
    or pg_catalog.has_schema_privilege('authenticated', 'catalog', 'USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'catalog.commit_schema_scan_success(uuid,uuid,text,uuid,text,uuid,text,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'catalog.commit_schema_scan_success(uuid,uuid,text,uuid,text,uuid,text,jsonb)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_RPC_ACL_POSTCONDITION_FAILED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog'
      and trigger.tgname = 'physical_schema_snapshot_immutable'
      and not trigger.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog'
      and trigger.tgname = 'schema_scan_run_append_only'
      and not trigger.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog'
      and trigger.tgname = 'schema_drift_event_immutable'
      and not trigger.tgisinternal
  ) then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_IMMUTABILITY_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
