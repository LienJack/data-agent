-- model_provider_connection_migration_checksum: sha256:b7f33a629ecce39bef3bc4a7a603ba24646561067a9172be4b2a9bbf73ced30a
-- ============================================================
-- 10649: Model provider connections and multi-model selection
-- Depends on: 20260725010648_app_data_agent_qa_resource_binding
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'MODEL_PROVIDER_CONNECTION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'MODEL_PROVIDER_CONNECTION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010648_app_data_agent_qa_resource_binding'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_CONNECTION_BASELINE_10648_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.model_provider_connections (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  provider_connection_id uuid not null,
  vendor_id text not null check (vendor_id in (
    'deepseek','kimi','glm','openai','anthropic','grok','gemini',
    'volcengine','siliconflow','openai-compatible'
  )),
  runtime_provider text not null check (runtime_provider in (
    'openai','anthropic','deepseek','glm','kimi','grok','gemini'
  )),
  display_name text not null check (pg_catalog.length(pg_catalog.btrim(display_name)) between 1 and 255),
  base_url text not null check (pg_catalog.length(base_url) between 8 and 2048),
  credential_ref jsonb,
  source text not null default 'manual' check (source = 'manual'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  health text not null default 'untested' check (health in ('configured','untested','connected','failed')),
  config_version bigint not null default 1 check (config_version >= 1),
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, provider_connection_id),
  foreign key (app_id, environment, created_by)
    references app_data_agent.app_users (app_id, environment, principal_id) on delete restrict,
  check (
    credential_ref is null
    or (
      pg_catalog.jsonb_typeof(credential_ref) = 'object'
      and credential_ref ->> 'schema_version' = 'global-model-credential-ref@1.0.0'
      and credential_ref ->> 'app_id' = app_id::text
      and credential_ref ->> 'environment' = environment
      and credential_ref ->> 'rotation_state' in ('ACTIVE','ROTATION_PENDING','REVOCATION_PENDING','REVOKED')
      and (credential_ref ->> 'credential_ref_id') ~ '^[0-9a-f-]{36}$'
      and (credential_ref ->> 'secret_ref_id') ~ '^[0-9a-f-]{36}$'
      and (credential_ref ->> 'secret_version') ~ '^[1-9][0-9]*$'
    )
  )
);

create table app_data_agent.model_provider_connection_versions (
  app_id uuid not null,
  environment text not null,
  provider_connection_id uuid not null,
  config_version bigint not null check (config_version >= 1),
  snapshot jsonb not null check (
    pg_catalog.jsonb_typeof(snapshot) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(snapshot)
  ),
  actor_principal_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, provider_connection_id, config_version),
  foreign key (app_id, environment, provider_connection_id)
    references app_data_agent.model_provider_connections (app_id, environment, provider_connection_id)
    on delete restrict
);

alter table app_data_agent.model_catalog_entries
  add column provider_connection_id uuid;

alter table app_data_agent.model_catalog_entries
  add constraint model_catalog_entries_provider_connection_fk
  foreign key (app_id, environment, provider_connection_id)
  references app_data_agent.model_provider_connections (app_id, environment, provider_connection_id)
  on delete restrict;

alter table app_data_agent.model_catalog_entries
  drop constraint model_catalog_entries_app_id_environment_provider_model_id_key;

create unique index model_catalog_connection_model_unique
  on app_data_agent.model_catalog_entries (app_id, environment, provider_connection_id, model_id)
  where provider_connection_id is not null;

alter table app_data_agent.pricing_control_operations
  drop constraint pricing_control_operations_operation_kind_check;

alter table app_data_agent.pricing_control_operations
  add constraint pricing_control_operations_operation_kind_check check (operation_kind in (
    'UPSERT_MODEL','SET_MODEL_STATUS','DECIDE_PRICE','DECIDE_FX',
    'UPSERT_PROVIDER','ARCHIVE_PROVIDER','SELECT_PROVIDER_MODELS'
  ));

create trigger model_provider_connection_versions_immutable
before update or delete on app_data_agent.model_provider_connection_versions
for each row execute function app_data_agent.reject_pricing_history_mutation();
create function platform.list_model_provider_connections(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.model_provider_connections
language plpgsql volatile security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select connection.*
  from app_data_agent.model_provider_connections as connection
  where connection.app_id = scope_record.app_id
    and connection.environment = scope_record.environment
  order by
    case connection.vendor_id when 'deepseek' then 1 when 'kimi' then 2 when 'glm' then 3 else 4 end,
    connection.created_at,
    connection.provider_connection_id;
end
$function$;

create function app_data_agent.apply_model_provider_connection_command(
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
    or app_data_agent.contains_potential_plaintext_secret(command)
    or command ->> 'schema_version' not in (
      'model-provider-upsert@1.0.0','model-provider-archive@1.0.0'
    )
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
  then
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

create function app_data_agent.apply_model_provider_selection(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_control_operations%rowtype;
  connection app_data_agent.model_provider_connections%rowtype;
  existing_model app_data_agent.model_catalog_entries%rowtype;
  selected_model app_data_agent.model_catalog_entries%rowtype;
  model_item jsonb;
  result_models jsonb := '[]'::jsonb;
  operation_payload jsonb;
  input_hash text := platform.canonical_sha256(command);
  requested_version bigint;
  target_status text;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  if command is null or pg_catalog.jsonb_typeof(command) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(command)
    or command ->> 'schema_version' <> 'model-provider-selection@1.0.0'
    or pg_catalog.length(command ->> 'idempotency_key') not between 8 and 128
    or pg_catalog.jsonb_typeof(command -> 'models') <> 'array'
    or pg_catalog.jsonb_array_length(command -> 'models') not between 1 and 1000
  then
    raise exception using errcode = '22023', message = 'MODEL_PROVIDER_SELECTION_INVALID';
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
    return existing_operation.result_payload -> 'models';
  end if;

  select * into strict connection
  from app_data_agent.model_provider_connections as candidate
  where candidate.app_id = scope_record.app_id
    and candidate.environment = scope_record.environment
    and candidate.provider_connection_id = (command ->> 'provider_connection_id')::uuid
  for update;
  if connection.source <> 'manual' or connection.status <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'MODEL_PROVIDER_NOT_MUTABLE';
  end if;
  if connection.config_version <> (command ->> 'expected_connection_version')::bigint then
    raise exception using errcode = '40001', message = 'MODEL_PROVIDER_VERSION_CONFLICT';
  end if;

  for model_item in select value from pg_catalog.jsonb_array_elements(command -> 'models')
  loop
    if pg_catalog.jsonb_typeof(model_item) <> 'object'
      or not (model_item ?& array[
        'model_profile_id','model_id','display_name','capabilities','enabled','expected_config_version'
      ])
      or pg_catalog.length(model_item ->> 'model_id') not between 1 and 256
      or pg_catalog.length(model_item ->> 'display_name') not between 1 and 255
      or pg_catalog.jsonb_typeof(model_item -> 'capabilities') <> 'object'
    then
      raise exception using errcode = '22023', message = 'MODEL_PROVIDER_SELECTION_ITEM_INVALID';
    end if;

    select * into existing_model
    from app_data_agent.model_catalog_entries as catalog
    where catalog.app_id = scope_record.app_id
      and catalog.environment = scope_record.environment
      and catalog.model_profile_id = (model_item ->> 'model_profile_id')::uuid
    for update;
    requested_version := (model_item ->> 'expected_config_version')::bigint;
    if (not found and requested_version <> 0)
      or (found and (
        existing_model.config_version <> requested_version
        or existing_model.provider_connection_id is distinct from connection.provider_connection_id
      ))
    then
      raise exception using errcode = '40001', message = 'MODEL_CONFIG_VERSION_CONFLICT';
    end if;

    target_status := case
      when not (model_item ->> 'enabled')::boolean then 'DISABLED'
      when app_data_agent.model_price_chain_is_complete(
        scope_record.app_id, scope_record.environment, connection.runtime_provider,
        model_item ->> 'model_id', connection.credential_ref
      ) then 'ACTIVE'
      else 'UNBILLABLE'
    end;
    insert into app_data_agent.model_catalog_entries (
      app_id, environment, model_profile_id, provider_connection_id, provider, model_id,
      display_name, base_url, capabilities, credential_ref, status, config_version,
      is_system_default, created_by
    ) values (
      scope_record.app_id, scope_record.environment,
      (model_item ->> 'model_profile_id')::uuid, connection.provider_connection_id,
      connection.runtime_provider, model_item ->> 'model_id', model_item ->> 'display_name',
      connection.base_url, model_item -> 'capabilities', connection.credential_ref,
      target_status, requested_version + 1, false, requested_principal_id
    ) on conflict (app_id, environment, model_profile_id) do update set
      provider_connection_id = excluded.provider_connection_id,
      provider = excluded.provider,
      model_id = excluded.model_id,
      display_name = excluded.display_name,
      base_url = excluded.base_url,
      capabilities = excluded.capabilities,
      credential_ref = excluded.credential_ref,
      status = excluded.status,
      config_version = excluded.config_version,
      is_system_default = case when excluded.status = 'ACTIVE'
        then app_data_agent.model_catalog_entries.is_system_default else false end,
      updated_at = pg_catalog.clock_timestamp()
    returning * into selected_model;

    insert into app_data_agent.model_config_versions (
      app_id, environment, model_profile_id, config_version, snapshot, actor_principal_id
    ) values (
      selected_model.app_id, selected_model.environment, selected_model.model_profile_id,
      selected_model.config_version,
      pg_catalog.to_jsonb(selected_model) - 'credential_ref', requested_principal_id
    );
    result_models := result_models || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(selected_model));
  end loop;

  operation_payload := pg_catalog.jsonb_build_object(
    'provider_connection_id', connection.provider_connection_id,
    'models', result_models
  );
  insert into app_data_agent.pricing_control_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, result_payload
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'idempotency_key',
    'SELECT_PROVIDER_MODELS', input_hash, operation_payload
  );
  insert into app_data_agent.pricing_audit_log (
    app_id, environment, operation_id, actor_principal_id, action, resource_type,
    resource_id, reason, details
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'schema_version', 'MODEL_PROVIDER_MODELS',
    connection.provider_connection_id::text, 'model provider selection', operation_payload
  );
  return result_models;
end
$function$;
alter table app_data_agent.model_provider_connections owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_provider_connection_versions owner to data_agent_identity_rpc_owner;
alter function platform.list_model_provider_connections(uuid,uuid) owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;

alter table app_data_agent.model_provider_connections enable row level security;
alter table app_data_agent.model_provider_connections force row level security;
create policy model_provider_connections_pricing_rpc_policy
  on app_data_agent.model_provider_connections for all to data_agent_identity_rpc_owner
  using (true) with check (true);
alter table app_data_agent.model_provider_connection_versions enable row level security;
alter table app_data_agent.model_provider_connection_versions force row level security;
create policy model_provider_connection_versions_pricing_rpc_policy
  on app_data_agent.model_provider_connection_versions for all to data_agent_identity_rpc_owner
  using (true) with check (true);

grant select, insert, update, delete on table
  app_data_agent.model_provider_connections,
  app_data_agent.model_provider_connection_versions
to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.model_provider_connections,
  app_data_agent.model_provider_connection_versions
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function platform.list_model_provider_connections(uuid,uuid) from public;
revoke all on function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb) from public;
revoke all on function app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb) from public;

grant execute on function platform.list_model_provider_connections(uuid,uuid) to data_agent_backend;
grant execute on function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)
  to data_agent_backend;

do $postconditions$
begin
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.model_provider_connections',
    'SELECT,INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_BACKEND_TABLE_ACL_FAILED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'app_data_agent.model_catalog_entries'::regclass
      and attname = 'provider_connection_id' and not attisdropped
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_CATALOG_LINK_MISSING';
  end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_backend', 'app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_SELECTION_GRANT_MISSING';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010649_app_data_agent_model_provider_connections',
  'sha256:b7f33a629ecce39bef3bc4a7a603ba24646561067a9172be4b2a9bbf73ced30a'
);

commit;
