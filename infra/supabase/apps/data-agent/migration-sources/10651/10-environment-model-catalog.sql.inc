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
  join app_data_agent.billing_runtime_state as billing_runtime
    on billing_runtime.app_id = deployment.app_id
   and billing_runtime.environment = deployment.environment
   and billing_runtime.deployment_id = deployment.deployment_id
  join app_data_agent.model_catalog_entries as catalog
    on catalog.app_id = deployment.app_id and catalog.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state = 'ACTIVE'
    and app_user.status = 'ACTIVE'
    and catalog.status = 'ACTIVE'
    and (
      catalog.model_profile_id not in (
        '30000000-0000-4000-8000-000000000001'::uuid,
        '30000000-0000-4000-8000-000000000002'::uuid,
        '30000000-0000-4000-8000-000000000003'::uuid,
        '30000000-0000-4000-8000-000000000004'::uuid,
        '30000000-0000-4000-8000-000000000005'::uuid,
        '30000000-0000-4000-8000-000000000006'::uuid,
        '30000000-0000-4000-8000-000000000007'::uuid
      )
      or billing_runtime.mode = 'SHADOW'
      or app_data_agent.model_price_chain_is_complete(
        catalog.app_id, catalog.environment, catalog.provider, catalog.model_id,
        catalog.credential_ref
      )
    )
  order by catalog.is_system_default desc, catalog.provider, catalog.model_id;
end
$function$;

create function platform.sync_environment_model_catalog(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns setof app_data_agent.model_catalog_entries
language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  runtime_mode text;
  model_item jsonb;
  existing_model app_data_agent.model_catalog_entries%rowtype;
  changed_model app_data_agent.model_catalog_entries%rowtype;
  demoted_model app_data_agent.model_catalog_entries%rowtype;
  disabled_model app_data_agent.model_catalog_entries%rowtype;
  expected_provider text;
  target_status text;
  next_version bigint;
  existing_model_found boolean;
  seen_profile_ids uuid[] := array[]::uuid[];
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if command is null
    or pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' <> 'environment-model-catalog-sync@1.0.0'
    or not command ?& array['schema_version','models']
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(command) as command_key(key)
      where command_key.key not in ('schema_version','models')
    )
    or pg_catalog.jsonb_typeof(command -> 'models') <> 'array'
    or pg_catalog.jsonb_array_length(command -> 'models') > 7
  then
    raise exception using errcode = '22023', message = 'ENVIRONMENT_MODEL_CATALOG_SYNC_INVALID';
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(command -> 'models') as requested_model(value)
    where requested_model.value ->> 'is_system_default' = 'true'
  ) > 1 then
    raise exception using errcode = '22023', message = 'ENVIRONMENT_MODEL_DEFAULT_INVALID';
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

  insert into app_data_agent.billing_runtime_state (app_id, environment, deployment_id)
  values (scope_record.app_id, scope_record.environment, requested_deployment_id)
  on conflict (app_id, environment, deployment_id) do nothing;
  select billing_runtime.mode into strict runtime_mode
  from app_data_agent.billing_runtime_state as billing_runtime
  where billing_runtime.app_id = scope_record.app_id
    and billing_runtime.environment = scope_record.environment
    and billing_runtime.deployment_id = requested_deployment_id;

  for model_item in
    select value from pg_catalog.jsonb_array_elements(command -> 'models')
  loop
    if pg_catalog.jsonb_typeof(model_item) <> 'object'
      or not model_item ?& array[
        'model_profile_id','provider','model_id','display_name','base_url',
        'capabilities','is_system_default'
      ]
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(model_item) as model_key(key)
        where model_key.key not in (
          'model_profile_id','provider','model_id','display_name','base_url',
          'capabilities','is_system_default'
        )
      )
      or pg_catalog.length(pg_catalog.btrim(model_item ->> 'model_id')) not between 1 and 256
      or pg_catalog.length(pg_catalog.btrim(model_item ->> 'display_name')) not between 1 and 255
      or pg_catalog.length(model_item ->> 'base_url') not between 8 and 2048
      or model_item ->> 'base_url' !~ '^https://'
      or pg_catalog.jsonb_typeof(model_item -> 'capabilities') <> 'object'
      or not (model_item -> 'capabilities') ?& array[
        'structured_output','tool_calling','streaming','reasoning','vision'
      ]
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(model_item -> 'capabilities') as capability_key(key)
        where capability_key.key not in (
          'structured_output','tool_calling','streaming','reasoning','vision'
        )
      )
      or exists (
        select 1
        from pg_catalog.jsonb_each(model_item -> 'capabilities') as capability(key, value)
        where pg_catalog.jsonb_typeof(capability.value) <> 'boolean'
      )
      or pg_catalog.jsonb_typeof(model_item -> 'is_system_default') <> 'boolean'
    then
      raise exception using errcode = '22023', message = 'ENVIRONMENT_MODEL_CATALOG_SYNC_INVALID';
    end if;

    expected_provider := case model_item ->> 'model_profile_id'
      when '30000000-0000-4000-8000-000000000001' then 'openai'
      when '30000000-0000-4000-8000-000000000002' then 'anthropic'
      when '30000000-0000-4000-8000-000000000003' then 'deepseek'
      when '30000000-0000-4000-8000-000000000004' then 'glm'
      when '30000000-0000-4000-8000-000000000005' then 'kimi'
      when '30000000-0000-4000-8000-000000000006' then 'grok'
      when '30000000-0000-4000-8000-000000000007' then 'gemini'
      else null
    end;
    if expected_provider is null
      or expected_provider <> model_item ->> 'provider'
      or (model_item ->> 'model_profile_id')::uuid = any(seen_profile_ids)
    then
      raise exception using errcode = '22023', message = 'ENVIRONMENT_MODEL_PROFILE_INVALID';
    end if;
    seen_profile_ids := pg_catalog.array_append(
      seen_profile_ids, (model_item ->> 'model_profile_id')::uuid
    );
    target_status := case when runtime_mode = 'SHADOW' then 'ACTIVE' else 'UNBILLABLE' end;

    select * into existing_model
    from app_data_agent.model_catalog_entries as catalog
    where catalog.app_id = scope_record.app_id
      and catalog.environment = scope_record.environment
      and catalog.model_profile_id = (model_item ->> 'model_profile_id')::uuid
    for update;
    existing_model_found := found;
    if existing_model_found and (
      existing_model.provider_connection_id is not null
      or existing_model.credential_ref is not null
    ) then
      raise exception using errcode = '55000', message = 'ENVIRONMENT_MODEL_PROFILE_CONFLICT';
    end if;

    if (model_item ->> 'is_system_default')::boolean and target_status = 'ACTIVE' then
      for demoted_model in
        update app_data_agent.model_catalog_entries as catalog
        set is_system_default = false,
            config_version = catalog.config_version + 1,
            updated_at = pg_catalog.clock_timestamp()
        where catalog.app_id = scope_record.app_id
          and catalog.environment = scope_record.environment
          and catalog.is_system_default
          and catalog.model_profile_id <> (model_item ->> 'model_profile_id')::uuid
        returning catalog.*
      loop
        insert into app_data_agent.model_config_versions (
          app_id, environment, model_profile_id, config_version, snapshot, actor_principal_id
        ) values (
          demoted_model.app_id, demoted_model.environment, demoted_model.model_profile_id,
          demoted_model.config_version,
          pg_catalog.to_jsonb(demoted_model) - 'credential_ref', requested_principal_id
        );
      end loop;
    end if;

    if not existing_model_found then
      insert into app_data_agent.model_catalog_entries (
        app_id, environment, model_profile_id, provider_connection_id, provider, model_id,
        display_name, base_url, capabilities, credential_ref, status, config_version,
        is_system_default, created_by
      ) values (
        scope_record.app_id, scope_record.environment,
        (model_item ->> 'model_profile_id')::uuid, null, model_item ->> 'provider',
        model_item ->> 'model_id', model_item ->> 'display_name', model_item ->> 'base_url',
        model_item -> 'capabilities', null, target_status, 1,
        (model_item ->> 'is_system_default')::boolean and target_status = 'ACTIVE',
        requested_principal_id
      ) returning * into changed_model;
    elsif existing_model.provider <> model_item ->> 'provider'
      or existing_model.model_id <> model_item ->> 'model_id'
      or existing_model.display_name <> model_item ->> 'display_name'
      or existing_model.base_url <> model_item ->> 'base_url'
      or existing_model.capabilities <> model_item -> 'capabilities'
      or existing_model.status <> target_status
      or existing_model.is_system_default is distinct from (
        (model_item ->> 'is_system_default')::boolean and target_status = 'ACTIVE'
      )
    then
      next_version := existing_model.config_version + 1;
      update app_data_agent.model_catalog_entries as catalog
      set provider = model_item ->> 'provider', model_id = model_item ->> 'model_id',
          display_name = model_item ->> 'display_name', base_url = model_item ->> 'base_url',
          capabilities = model_item -> 'capabilities', credential_ref = null,
          provider_connection_id = null, status = target_status,
          config_version = next_version,
          is_system_default = (model_item ->> 'is_system_default')::boolean
            and target_status = 'ACTIVE',
          updated_at = pg_catalog.clock_timestamp()
      where catalog.app_id = existing_model.app_id
        and catalog.environment = existing_model.environment
        and catalog.model_profile_id = existing_model.model_profile_id
      returning catalog.* into changed_model;
    else
      changed_model := null;
    end if;

    if changed_model.model_profile_id is not null then
      insert into app_data_agent.model_config_versions (
        app_id, environment, model_profile_id, config_version, snapshot, actor_principal_id
      ) values (
        changed_model.app_id, changed_model.environment, changed_model.model_profile_id,
        changed_model.config_version,
        pg_catalog.to_jsonb(changed_model) - 'credential_ref', requested_principal_id
      );
    end if;
  end loop;

  for disabled_model in
    update app_data_agent.model_catalog_entries as catalog
    set status = 'DISABLED', is_system_default = false,
        config_version = catalog.config_version + 1,
        updated_at = pg_catalog.clock_timestamp()
    where catalog.app_id = scope_record.app_id
      and catalog.environment = scope_record.environment
      and catalog.model_profile_id in (
        '30000000-0000-4000-8000-000000000001'::uuid,
        '30000000-0000-4000-8000-000000000002'::uuid,
        '30000000-0000-4000-8000-000000000003'::uuid,
        '30000000-0000-4000-8000-000000000004'::uuid,
        '30000000-0000-4000-8000-000000000005'::uuid,
        '30000000-0000-4000-8000-000000000006'::uuid,
        '30000000-0000-4000-8000-000000000007'::uuid
      )
      and not (catalog.model_profile_id = any(seen_profile_ids))
      and catalog.provider_connection_id is null
      and catalog.credential_ref is null
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

  return query select * from platform.list_active_model_catalog(
    requested_deployment_id, requested_principal_id
  );
end
$function$;
