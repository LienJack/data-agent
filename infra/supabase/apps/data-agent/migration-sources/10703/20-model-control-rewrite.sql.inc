do $rewrite_model_commands$
declare
  target regprocedure;
  definition text;
  repaired text;
begin
  foreach target in array array[
    'app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb)'::regprocedure,
    'app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)'::regprocedure,
    'app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(target);
    repaired := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(definition,
          'app_data_agent.pricing_control_operations',
          'app_data_agent.model_control_operations'),
        'app_data_agent.pricing_audit_log',
        'app_data_agent.model_control_audit_log'),
      'PRICING_OPERATION_CONFLICT',
      'MODEL_CONTROL_OPERATION_CONFLICT'
    );

    if target = 'app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb)'::regprocedure then
      repaired := pg_catalog.replace(repaired, $old$
    if command ->> 'status' = 'ACTIVE' and not app_data_agent.model_price_chain_is_complete(
      scope_record.app_id, scope_record.environment, command ->> 'provider', command ->> 'model_id',
      nullif(command -> 'credential_ref', 'null'::jsonb)
    ) then
      raise exception using errcode = '55000', message = 'MODEL_PRICE_CHAIN_INCOMPLETE';
    end if;$old$, '');
      repaired := pg_catalog.replace(repaired, $old$
    if command ->> 'status' = 'ACTIVE' and not app_data_agent.model_price_chain_is_complete(
      scope_record.app_id, scope_record.environment, existing_catalog.provider,
      existing_catalog.model_id, existing_catalog.credential_ref
    ) then
      raise exception using errcode = '55000', message = 'MODEL_PRICE_CHAIN_INCOMPLETE';
    end if;$old$, '');
    elsif target = 'app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)'::regprocedure then
      repaired := pg_catalog.replace(repaired, $old$    target_status := case
      when not (model_item ->> 'enabled')::boolean then 'DISABLED'
      when app_data_agent.model_price_chain_is_complete(
        scope_record.app_id, scope_record.environment, connection.runtime_provider,
        model_item ->> 'model_id', connection.credential_ref
      ) then 'ACTIVE'
      else 'UNBILLABLE'
    end;$old$, $new$    target_status := case
      when not (model_item ->> 'enabled')::boolean then 'DISABLED'
      else 'ACTIVE'
    end;$new$);
    end if;

    if repaired = definition
      or pg_catalog.lower(repaired) like '%pricing_control_operations%'
      or pg_catalog.lower(repaired) like '%pricing_audit_log%'
      or pg_catalog.lower(repaired) like '%model_price_chain_is_complete%'
      or pg_catalog.lower(repaired) like '%unbillable%'
    then
      raise exception using
        errcode = 'P0001',
        message = 'MODEL_CONTROL_COMMAND_REWRITE_INCOMPLETE';
    end if;
    execute repaired;
  end loop;
end
$rewrite_model_commands$;

create or replace function platform.list_active_model_catalog(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.model_catalog_entries
language plpgsql stable security definer set search_path = '' as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  return query
  select catalog.*
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  join app_data_agent.model_catalog_entries as catalog
    on catalog.app_id = deployment.app_id and catalog.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state = 'ACTIVE'
    and app_user.status = 'ACTIVE'
    and catalog.status = 'ACTIVE'
  order by catalog.is_system_default desc, catalog.provider, catalog.model_id;
end
$function$;

do $rewrite_environment_sync$
declare
  definition text;
  repaired text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)'::regprocedure
  );
  repaired := pg_catalog.replace(definition, E'  runtime_mode text;\n', '');
  repaired := pg_catalog.replace(repaired, $old$
  insert into app_data_agent.billing_runtime_state (app_id, environment, deployment_id)
  values (scope_record.app_id, scope_record.environment, requested_deployment_id)
  on conflict (app_id, environment, deployment_id) do nothing;
  select billing_runtime.mode into strict runtime_mode
  from app_data_agent.billing_runtime_state as billing_runtime
  where billing_runtime.app_id = scope_record.app_id
    and billing_runtime.environment = scope_record.environment
    and billing_runtime.deployment_id = requested_deployment_id;
$old$, E'\n');
  repaired := pg_catalog.replace(
    repaired,
    '    target_status := case when runtime_mode = ''SHADOW'' then ''ACTIVE'' else ''UNBILLABLE'' end;',
    '    target_status := ''ACTIVE'';'
  );
  if repaired = definition
    or pg_catalog.lower(repaired) like '%billing_runtime_state%'
    or pg_catalog.lower(repaired) like '%runtime_mode%'
    or pg_catalog.lower(repaired) like '%unbillable%'
  then
    raise exception using
      errcode = 'P0001',
      message = 'ENVIRONMENT_MODEL_SYNC_REWRITE_INCOMPLETE';
  end if;
  execute repaired;
end
$rewrite_environment_sync$;

do $rewrite_model_authentication$
declare
  definition text;
  repaired text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'platform.record_model_api_authentication(uuid,uuid,jsonb)'::regprocedure
  );
  repaired := pg_catalog.replace(
    definition,
    'catalog.status not in (''ACTIVE'',''UNBILLABLE'')',
    'catalog.status <> ''ACTIVE'''
  );
  if repaired = definition or pg_catalog.lower(repaired) like '%unbillable%' then
    raise exception using
      errcode = 'P0001',
      message = 'MODEL_AUTHENTICATION_REWRITE_INCOMPLETE';
  end if;
  execute repaired;
end
$rewrite_model_authentication$;

create or replace function platform.read_operations_health(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope_record record;
  identity_count bigint;
  identity_last timestamptz;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(
    requested_deployment_id,
    requested_actor_principal_id
  );

  select pg_catalog.count(*), pg_catalog.max(operation.created_at)
  into identity_count, identity_last
  from app_data_agent.identity_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.status in ('PENDING', 'RETRY_REQUIRED');

  return pg_catalog.jsonb_build_object(
    'schema_version', 'operations-health@1.0.0',
    'generated_at', pg_catalog.clock_timestamp(),
    'gates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'IDENTITY_SIDE_EFFECTS',
        'status', case when identity_count > 0 then 'BLOCKED' else 'PASS' end,
        'count', identity_count,
        'reason_code', case
          when identity_count > 0 then 'IDENTITY_SIDE_EFFECTS_PENDING'
          else 'IDENTITY_SIDE_EFFECTS_CLEAR'
        end,
        'last_observed_at', identity_last
      )
    )
  );
end
$function$;

alter function platform.list_active_model_catalog(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function platform.read_operations_health(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
revoke all on function platform.list_active_model_catalog(uuid,uuid) from public;
revoke all on function platform.read_operations_health(uuid,uuid) from public;
grant execute on function platform.list_active_model_catalog(uuid,uuid) to data_agent_backend;
grant execute on function platform.read_operations_health(uuid,uuid) to data_agent_backend;
