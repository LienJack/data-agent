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
