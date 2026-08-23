alter function platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function platform.sync_environment_model_catalog(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;

revoke all on function platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function platform.sync_environment_model_catalog(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function platform.sync_environment_model_catalog(uuid,uuid,jsonb)
  to data_agent_backend;

do $postconditions$
declare function_definition text;
begin
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'ENVIRONMENT_MODEL_UNLOCKED_SYNC_EXPOSED';
  end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'platform.sync_environment_model_catalog(uuid,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'ENVIRONMENT_MODEL_SERIALIZED_SYNC_GRANT_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict function_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'platform'
    and procedure.proname = 'sync_environment_model_catalog'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
      'requested_deployment_id uuid, requested_principal_id uuid, command jsonb';
  if function_definition not like '%pg_advisory_xact_lock%'
    or function_definition not like '%sync_environment_model_catalog_unlocked%'
  then
    raise exception using errcode = 'P0001', message = 'ENVIRONMENT_MODEL_SERIALIZED_SYNC_GUARD_MISSING';
  end if;
end
$postconditions$;
