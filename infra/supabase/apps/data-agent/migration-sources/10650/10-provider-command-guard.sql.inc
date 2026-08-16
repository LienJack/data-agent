create or replace function app_data_agent.apply_model_provider_connection_command(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_control_operations%rowtype;
  existing_connection app_data_agent.model_provider_connections%rowtype;
  disabled_model app_data_agent.model_catalog_entries%rowtype;
  result_payload jsonb;
  snapshot_payload jsonb;
  input_hash text := platform.canonical_sha256(command);
  requested_version bigint;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  if command is null or pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' not in (
      'model-provider-upsert@1.0.0','model-provider-archive@1.0.0'
    )
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
  then
    raise exception using errcode = '22023', message = 'MODEL_PROVIDER_COMMAND_INVALID';
  end if;
  if command ->> 'schema_version' = 'model-provider-upsert@1.0.0' and (
    not command ?& array[
      'schema_version','operation_id','idempotency_key','provider_connection_id','vendor_id',
      'runtime_provider','display_name','base_url','credential_ref','expected_config_version'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(command) as command_key(key)
      where command_key.key not in (
        'schema_version','operation_id','idempotency_key','provider_connection_id','vendor_id',
        'runtime_provider','display_name','base_url','credential_ref','expected_config_version'
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'MODEL_PROVIDER_COMMAND_INVALID';
  end if;
  if command ->> 'schema_version' = 'model-provider-archive@1.0.0' and (
    not command ?& array[
      'schema_version','operation_id','idempotency_key','provider_connection_id',
      'expected_config_version','reason'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(command) as command_key(key)
      where command_key.key not in (
        'schema_version','operation_id','idempotency_key','provider_connection_id',
        'expected_config_version','reason'
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'MODEL_PROVIDER_COMMAND_INVALID';
  end if;

  select * into existing_operation
  from app_data_agent.pricing_control_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_principal_id
    and operation.idempotency_key = command ->> 'idempotency_key';
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;

  select * into existing_connection
  from app_data_agent.model_provider_connections as connection
  where connection.app_id = scope_record.app_id
    and connection.environment = scope_record.environment
    and connection.provider_connection_id = (command ->> 'provider_connection_id')::uuid
  for update;

  if command ->> 'schema_version' = 'model-provider-upsert@1.0.0' then
    requested_version := (command ->> 'expected_config_version')::bigint;
    if (not found and requested_version <> 0)
      or (found and existing_connection.config_version <> requested_version)
      or command ->> 'vendor_id' not in (
        'deepseek','kimi','glm','openai','anthropic','grok','gemini',
        'volcengine','siliconflow','openai-compatible'
      )
      or command ->> 'runtime_provider' not in (
        'openai','anthropic','deepseek','glm','kimi','grok','gemini'
      )
      or pg_catalog.length(pg_catalog.btrim(command ->> 'display_name')) not between 1 and 255
      or pg_catalog.length(command ->> 'base_url') not between 8 and 2048
    then
      raise exception using errcode = '40001', message = 'MODEL_PROVIDER_VERSION_OR_INPUT_CONFLICT';
    end if;
    insert into app_data_agent.model_provider_connections (
      app_id, environment, provider_connection_id, vendor_id, runtime_provider,
      display_name, base_url, credential_ref, source, status, health,
      config_version, created_by
    ) values (
      scope_record.app_id, scope_record.environment,
      (command ->> 'provider_connection_id')::uuid,
      command ->> 'vendor_id', command ->> 'runtime_provider',
      command ->> 'display_name', command ->> 'base_url',
      nullif(command -> 'credential_ref', 'null'::jsonb), 'manual', 'ACTIVE', 'untested',
      requested_version + 1, requested_principal_id
    ) on conflict (app_id, environment, provider_connection_id) do update set
      vendor_id = excluded.vendor_id,
      runtime_provider = excluded.runtime_provider,
      display_name = excluded.display_name,
      base_url = excluded.base_url,
      credential_ref = excluded.credential_ref,
      status = 'ACTIVE',
      health = case
        when app_data_agent.model_provider_connections.base_url is distinct from excluded.base_url
          or app_data_agent.model_provider_connections.credential_ref is distinct from excluded.credential_ref
        then 'untested'
        else app_data_agent.model_provider_connections.health
      end,
      config_version = excluded.config_version,
      updated_at = pg_catalog.clock_timestamp();
  else
    if not found then
      raise exception using errcode = 'P0002', message = 'MODEL_PROVIDER_NOT_FOUND';
    end if;
    requested_version := (command ->> 'expected_config_version')::bigint;
    if existing_connection.config_version <> requested_version then
      raise exception using errcode = '40001', message = 'MODEL_PROVIDER_VERSION_CONFLICT';
    end if;
    update app_data_agent.model_provider_connections as connection
    set status = 'ARCHIVED', config_version = connection.config_version + 1,
        updated_at = pg_catalog.clock_timestamp()
    where connection.app_id = scope_record.app_id
      and connection.environment = scope_record.environment
      and connection.provider_connection_id = existing_connection.provider_connection_id;

    for disabled_model in
      update app_data_agent.model_catalog_entries as catalog
      set status = 'DISABLED', is_system_default = false,
          config_version = catalog.config_version + 1,
          updated_at = pg_catalog.clock_timestamp()
      where catalog.app_id = scope_record.app_id
        and catalog.environment = scope_record.environment
        and catalog.provider_connection_id = existing_connection.provider_connection_id
        and catalog.status <> 'DISABLED'
      returning catalog.*
    loop
      insert into app_data_agent.model_config_versions (
        app_id, environment, model_profile_id, config_version, snapshot, actor_principal_id
      ) values (
        disabled_model.app_id, disabled_model.environment, disabled_model.model_profile_id,
        disabled_model.config_version,
        pg_catalog.to_jsonb(disabled_model) - 'credential_ref', requested_principal_id
      );
    end loop;
  end if;

  select pg_catalog.to_jsonb(connection) into result_payload
  from app_data_agent.model_provider_connections as connection
  where connection.app_id = scope_record.app_id
    and connection.environment = scope_record.environment
    and connection.provider_connection_id = (command ->> 'provider_connection_id')::uuid;
  snapshot_payload := result_payload - 'credential_ref';
  if result_payload -> 'credential_ref' is not null
    and result_payload -> 'credential_ref' <> 'null'::jsonb
  then
    snapshot_payload := snapshot_payload || pg_catalog.jsonb_build_object(
      'secret_refs', pg_catalog.jsonb_build_array(
        'secretref:' || (result_payload #>> '{credential_ref,secret_ref_id}')
      ),
      'reference_version', (result_payload #>> '{credential_ref,secret_version}')::bigint,
      'rotation_state', result_payload #>> '{credential_ref,rotation_state}'
    );
  end if;
  insert into app_data_agent.model_provider_connection_versions (
    app_id, environment, provider_connection_id, config_version, snapshot, actor_principal_id
  ) values (
    scope_record.app_id, scope_record.environment,
    (command ->> 'provider_connection_id')::uuid,
    (result_payload ->> 'config_version')::bigint, snapshot_payload, requested_principal_id
  );
  insert into app_data_agent.pricing_control_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, result_payload
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'idempotency_key',
    case when command ->> 'schema_version' = 'model-provider-upsert@1.0.0'
      then 'UPSERT_PROVIDER' else 'ARCHIVE_PROVIDER' end,
    input_hash, result_payload
  );
  insert into app_data_agent.pricing_audit_log (
    app_id, environment, operation_id, actor_principal_id, action, resource_type,
    resource_id, reason, details
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'schema_version', 'MODEL_PROVIDER_CONNECTION',
    command ->> 'provider_connection_id',
    coalesce(command ->> 'reason', 'model provider connection command'), result_payload
  );
  return result_payload;
end
$function$;
