-- environment_model_sync_concurrency_migration_checksum: sha256:7c66080782f43216b4e8463a69eda7bd7cfef794e608c963ad81342d2c5ac425
-- ============================================================
-- 10652: Serialize environment model catalog synchronization
-- Depends on: 20260725010651_app_data_agent_environment_model_availability
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'ENVIRONMENT_MODEL_SYNC_CONCURRENCY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'ENVIRONMENT_MODEL_SYNC_CONCURRENCY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010651_app_data_agent_environment_model_availability'
  ) then
    raise exception using errcode = 'P0001', message = 'ENVIRONMENT_MODEL_SYNC_CONCURRENCY_BASELINE_10651_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
alter function platform.sync_environment_model_catalog(uuid,uuid,jsonb)
  rename to sync_environment_model_catalog_unlocked;

create function platform.sync_environment_model_catalog(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns setof app_data_agent.model_catalog_entries
language plpgsql volatile security definer set search_path = '' as $function$
declare scope_record record;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;

  perform platform.acquire_lifecycle_shared_lock(
    deployment.app_id, deployment.environment
  )
  from platform.deployment_mappings as deployment
  where deployment.deployment_id = requested_deployment_id and deployment.is_active;

  select deployment.app_id, deployment.environment into scope_record
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state = 'ACTIVE'
    and app_user.status = 'ACTIVE';
  if not found then
    raise exception using errcode = '42501', message = 'ENVIRONMENT_MODEL_CATALOG_SYNC_DENIED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      scope_record.app_id, scope_record.environment, 'environment-model-catalog-sync'
    )::text,
    0
  ));

  return query
  select * from platform.sync_environment_model_catalog_unlocked(
    requested_deployment_id, requested_principal_id, command
  );
end
$function$;
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
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010652_app_data_agent_environment_model_sync_concurrency',
  'sha256:7c66080782f43216b4e8463a69eda7bd7cfef794e608c963ad81342d2c5ac425'
);

commit;
