-- ============================================================
-- 10628: Datasource, Q&A and Run binding authority tables
-- ============================================================

create table app_data_agent.datasource_connections (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  datasource_id uuid not null,
  name text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 255),
  datasource_type text not null check (
    datasource_type in ('postgresql', 'mysql', 'clickhouse', 'sqlite', 'trino')
  ),
  host text check (host is null or pg_catalog.length(pg_catalog.btrim(host)) between 1 and 255),
  port integer check (port is null or port between 1 and 65535),
  database_name text check (
    database_name is null or pg_catalog.length(pg_catalog.btrim(database_name)) between 1 and 255
  ),
  username text check (
    username is null or pg_catalog.length(pg_catalog.btrim(username)) between 1 and 255
  ),
  credential_ref_id uuid,
  secret_ref_id uuid,
  secret_version bigint check (secret_version is null or secret_version >= 1),
  rotation_state text check (
    rotation_state is null or rotation_state in ('ACTIVE', 'ROTATION_PENDING', 'REVOKED')
  ),
  ssl_mode text not null default 'disable'
    check (ssl_mode in ('disable', 'require', 'verify-ca', 'verify-full')),
  file_path text check (
    file_path is null or pg_catalog.length(pg_catalog.btrim(file_path)) between 1 and 4096
  ),
  catalog_name text check (
    catalog_name is null or pg_catalog.length(pg_catalog.btrim(catalog_name)) between 1 and 255
  ),
  schema_name text check (
    schema_name is null or pg_catalog.length(pg_catalog.btrim(schema_name)) between 1 and 255
  ),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ERROR', 'DISABLED')),
  last_tested_at timestamptz,
  created_by_principal_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, datasource_id),
  foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, created_by_principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, secret_ref_id)
    references app_data_agent.secret_refs (app_id, tenant_id, environment, secret_ref_id)
    on delete restrict,
  check (
    (
      credential_ref_id is null and secret_ref_id is null
      and secret_version is null and rotation_state is null
    )
    or (
      credential_ref_id is not null and secret_ref_id is not null
      and secret_version is not null and rotation_state is not null
    )
  ),
  check (
    (datasource_type = 'sqlite' and file_path is not null and secret_ref_id is null)
    or (
      datasource_type in ('postgresql', 'mysql', 'clickhouse')
      and host is not null and database_name is not null and username is not null
      and secret_ref_id is not null
    )
    or (
      datasource_type = 'trino' and host is not null and username is not null
      and secret_ref_id is not null
    )
  )
);

create unique index datasource_connections_active_name
  on app_data_agent.datasource_connections (app_id, tenant_id, environment, pg_catalog.lower(name))
  where status <> 'DISABLED';
create index datasource_connections_workspace_status
  on app_data_agent.datasource_connections (app_id, tenant_id, environment, status, updated_at desc);

-- The catalog wire format keeps datasource_id as text for U12 compatibility.
-- A generated UUID column gives PostgreSQL a real composite FK to workspace authority.
alter table catalog.physical_schema_snapshot
  add column datasource_connection_id uuid
    generated always as (datasource_id::uuid) stored,
  add constraint physical_schema_snapshot_datasource_connection_fk
    foreign key (app_id, tenant_id, environment, datasource_connection_id)
    references app_data_agent.datasource_connections (
      app_id, tenant_id, environment, datasource_id
    ) on delete restrict;

alter table catalog.schema_scan_run
  add column datasource_connection_id uuid
    generated always as (datasource_id::uuid) stored,
  add constraint schema_scan_run_datasource_connection_fk
    foreign key (app_id, tenant_id, environment, datasource_connection_id)
    references app_data_agent.datasource_connections (
      app_id, tenant_id, environment, datasource_id
    ) on delete restrict;

alter table catalog.schema_drift_event
  add column datasource_connection_id uuid
    generated always as (datasource_id::uuid) stored,
  add constraint schema_drift_event_datasource_connection_fk
    foreign key (app_id, tenant_id, environment, datasource_connection_id)
    references app_data_agent.datasource_connections (
      app_id, tenant_id, environment, datasource_id
    ) on delete restrict;

alter table semantic.semantic_domain_registry
  add constraint semantic_domain_registry_datasource_connection_fk
  foreign key (app_id, tenant_id, environment, datasource_id)
  references app_data_agent.datasource_connections (app_id, tenant_id, environment, datasource_id)
  on delete restrict,
  add constraint semantic_domain_registry_datasource_identity_key
  unique (app_id, tenant_id, environment, semantic_domain, datasource_id);

alter table semantic.semantic_relationship_projection
  add constraint semantic_relationship_projection_domain_datasource_fk
  foreign key (app_id, tenant_id, environment, semantic_domain, datasource_id)
  references semantic.semantic_domain_registry (
    app_id, tenant_id, environment, semantic_domain, datasource_id
  )
  on delete restrict;

create table app_data_agent.qa_conversations (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  conversation_id uuid not null,
  owner_principal_id uuid not null,
  title text not null check (pg_catalog.length(pg_catalog.btrim(title)) between 1 and 255),
  datasource_id uuid,
  model_id text check (
    model_id is null or (
      pg_catalog.length(model_id) between 1 and 128
      and model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$'
    )
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, conversation_id),
  unique (
    app_id, tenant_id, environment, conversation_id, datasource_id, owner_principal_id
  ),
  unique (app_id, tenant_id, environment, conversation_id, owner_principal_id),
  foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, owner_principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, datasource_id)
    references app_data_agent.datasource_connections (app_id, tenant_id, environment, datasource_id)
    on delete restrict
);

create index qa_conversations_owner_updated
  on app_data_agent.qa_conversations (
    app_id, tenant_id, environment, owner_principal_id, updated_at desc
  );

alter table app_data_agent.runs
  add constraint runs_principal_identity_key
  unique (app_id, tenant_id, environment, run_id, principal_id);

create table app_data_agent.workspace_run_bindings (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  datasource_id uuid not null,
  conversation_id uuid,
  principal_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id),
  unique (app_id, tenant_id, environment, run_id, conversation_id, principal_id),
  foreign key (app_id, tenant_id, environment, run_id, principal_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id, principal_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, datasource_id)
    references app_data_agent.datasource_connections (app_id, tenant_id, environment, datasource_id)
    on delete restrict,
  foreign key (
    app_id, tenant_id, environment, conversation_id, datasource_id, principal_id
  ) references app_data_agent.qa_conversations (
    app_id, tenant_id, environment, conversation_id, datasource_id, owner_principal_id
  ) on delete restrict
);

create table app_data_agent.qa_messages (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  conversation_id uuid not null,
  message_id uuid not null,
  owner_principal_id uuid not null,
  role text not null check (role in ('user', 'agent')),
  content text not null check (
    pg_catalog.length(pg_catalog.btrim(content)) between 1 and 200000
    and not app_data_agent.contains_potential_plaintext_secret(pg_catalog.to_jsonb(content), 'content')
  ),
  message_type text not null check (message_type in ('text', 'table', 'report', 'hypothesis', 'error')),
  run_id uuid,
  metadata jsonb not null default '{}'::jsonb check (
    pg_catalog.jsonb_typeof(metadata) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(metadata)
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, conversation_id, message_id),
  foreign key (app_id, tenant_id, environment, conversation_id, owner_principal_id)
    references app_data_agent.qa_conversations (
      app_id, tenant_id, environment, conversation_id, owner_principal_id
    ) on delete cascade,
  foreign key (app_id, tenant_id, environment, run_id, conversation_id, owner_principal_id)
    references app_data_agent.workspace_run_bindings (
      app_id, tenant_id, environment, run_id, conversation_id, principal_id
    ) on delete restrict
);

create index qa_messages_conversation_created
  on app_data_agent.qa_messages (
    app_id, tenant_id, environment, conversation_id, created_at, message_id
  );
