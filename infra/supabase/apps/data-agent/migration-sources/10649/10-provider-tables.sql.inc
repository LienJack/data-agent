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
