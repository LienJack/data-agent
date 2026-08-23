-- workspace_data_isolation_migration_checksum: sha256:5b325e32db2b2403c33190c1901b781b1c6e26e391d0b40ed37e3b515c6efd22
-- ============================================================
-- 10628: Workspace data persistence and isolation
-- ============================================================
-- Depends on: 20260725010627_app_data_agent_workspace_identity
-- Clean-install only: no legacy Map migration, backfill or dual-write.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'WORKSPACE_DATA_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'WORKSPACE_DATA_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'WORKSPACE_DATA_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010627_app_data_agent_workspace_identity';
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_BASELINE_10627_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010628_app_data_agent_workspace_data_isolation'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_MIGRATION_10628_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('app_data_agent.workspaces') is null
    or pg_catalog.to_regclass('app_data_agent.secret_refs') is null
    or pg_catalog.to_regclass('semantic.semantic_domain_registry') is null
    or pg_catalog.to_regprocedure('platform.backend_context_matches(uuid,uuid,text,boolean)') is null
  then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_BASELINE_AUTHORITY_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
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
-- ============================================================
-- 10628: Datasource freeze, active binding and immutable attribution guards
-- ============================================================

create function app_data_agent.workspace_command_payload_is_valid(
  requested_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if requested_payload is null
    or pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or not app_data_agent.command_payload_is_valid(
      requested_payload - 'datasource_id' - 'conversation_id'
    )
  then
    return false;
  end if;
  if requested_payload ? 'datasource_id' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'datasource_id') <> 'string'
    or not (requested_payload ->> 'datasource_id' ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ) then
    return false;
  end if;
  if requested_payload ? 'conversation_id' and (
    not (requested_payload ? 'datasource_id')
    or pg_catalog.jsonb_typeof(requested_payload -> 'conversation_id') <> 'string'
    or not (requested_payload ->> 'conversation_id' ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ) then
    return false;
  end if;
  return true;
end
$function$;

revoke all on function app_data_agent.workspace_command_payload_is_valid(jsonb) from public;
grant execute on function app_data_agent.workspace_command_payload_is_valid(jsonb)
  to data_agent_backend;

alter table app_data_agent.commands drop constraint commands_payload_json_check;
alter table app_data_agent.commands
  add constraint commands_workspace_payload_check
  check (app_data_agent.workspace_command_payload_is_valid(payload_json));

create function app_data_agent.guard_qa_conversation_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.app_id <> old.app_id
    or new.tenant_id <> old.tenant_id
    or new.environment <> old.environment
    or new.conversation_id <> old.conversation_id
    or new.owner_principal_id <> old.owner_principal_id
    or new.created_at <> old.created_at
  then
    raise exception using errcode = '42501', message = 'CONVERSATION_SCOPE_IMMUTABLE';
  end if;
  if new.datasource_id is distinct from old.datasource_id then
    if old.datasource_id is not null or exists (
      select 1
      from app_data_agent.qa_messages as message
      where message.app_id = old.app_id
        and message.tenant_id = old.tenant_id
        and message.environment = old.environment
        and message.conversation_id = old.conversation_id
    ) then
      raise exception using errcode = '23514', message = 'CONVERSATION_DATASOURCE_FROZEN';
    end if;
    if not exists (
      select 1
      from app_data_agent.datasource_connections as datasource
      where datasource.app_id = new.app_id
        and datasource.tenant_id = new.tenant_id
        and datasource.environment = new.environment
        and datasource.datasource_id = new.datasource_id
        and datasource.status = 'ACTIVE'
    ) then
      raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
    end if;
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end
$function$;

create trigger qa_conversation_update_guard
before update on app_data_agent.qa_conversations
for each row execute function app_data_agent.guard_qa_conversation_update();

create function app_data_agent.guard_qa_message_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  bound_datasource_id uuid;
begin
  select conversation.datasource_id
  into bound_datasource_id
  from app_data_agent.qa_conversations as conversation
  where conversation.app_id = new.app_id
    and conversation.tenant_id = new.tenant_id
    and conversation.environment = new.environment
    and conversation.conversation_id = new.conversation_id
    and conversation.owner_principal_id = new.owner_principal_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CONVERSATION_NOT_FOUND_OR_DENIED';
  end if;
  if bound_datasource_id is null then
    raise exception using errcode = '23514', message = 'CONVERSATION_DATASOURCE_REQUIRED';
  end if;
  if not exists (
    select 1
    from app_data_agent.datasource_connections as datasource
    where datasource.app_id = new.app_id
      and datasource.tenant_id = new.tenant_id
      and datasource.environment = new.environment
      and datasource.datasource_id = bound_datasource_id
      and datasource.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;
  update app_data_agent.qa_conversations as conversation
  set updated_at = pg_catalog.clock_timestamp()
  where conversation.app_id = new.app_id
    and conversation.tenant_id = new.tenant_id
    and conversation.environment = new.environment
    and conversation.conversation_id = new.conversation_id;
  return new;
end
$function$;

create trigger qa_message_insert_guard
before insert on app_data_agent.qa_messages
for each row execute function app_data_agent.guard_qa_message_insert();

create function app_data_agent.guard_workspace_run_binding_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from app_data_agent.datasource_connections as datasource
    where datasource.app_id = new.app_id
      and datasource.tenant_id = new.tenant_id
      and datasource.environment = new.environment
      and datasource.datasource_id = new.datasource_id
      and datasource.status = 'ACTIVE'
  ) then
    raise exception using errcode = '23503', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;
  return new;
end
$function$;

create trigger workspace_run_binding_insert_guard
before insert on app_data_agent.workspace_run_bindings
for each row execute function app_data_agent.guard_workspace_run_binding_insert();

create function app_data_agent.reject_workspace_data_attribution_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'WORKSPACE_DATA_ATTRIBUTION_IMMUTABLE';
end
$function$;

create trigger workspace_run_bindings_immutable
before update or delete on app_data_agent.workspace_run_bindings
for each row execute function app_data_agent.reject_workspace_data_attribution_mutation();

create trigger qa_messages_immutable
before update on app_data_agent.qa_messages
for each row execute function app_data_agent.reject_workspace_data_attribution_mutation();
-- ============================================================
-- 10628: RLS, exact grants and migration postconditions
-- ============================================================

alter table app_data_agent.datasource_connections enable row level security;
alter table app_data_agent.datasource_connections force row level security;
alter table app_data_agent.qa_conversations enable row level security;
alter table app_data_agent.qa_conversations force row level security;
alter table app_data_agent.qa_messages enable row level security;
alter table app_data_agent.qa_messages force row level security;
alter table app_data_agent.workspace_run_bindings enable row level security;
alter table app_data_agent.workspace_run_bindings force row level security;

create policy datasource_connections_backend_select
  on app_data_agent.datasource_connections for select to data_agent_backend
  using (platform.backend_context_matches(app_id, tenant_id, environment, false));
create policy datasource_connections_backend_insert
  on app_data_agent.datasource_connections for insert to data_agent_backend
  with check (
    platform.backend_context_matches(app_id, tenant_id, environment, true)
    and pg_catalog.current_setting('data_agent.role', true) = 'owner'
  );
create policy datasource_connections_backend_update
  on app_data_agent.datasource_connections for update to data_agent_backend
  using (
    platform.backend_context_matches(app_id, tenant_id, environment, true)
    and pg_catalog.current_setting('data_agent.role', true) = 'owner'
  )
  with check (
    platform.backend_context_matches(app_id, tenant_id, environment, true)
    and pg_catalog.current_setting('data_agent.role', true) = 'owner'
  );

create policy qa_conversations_backend_select
  on app_data_agent.qa_conversations for select to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, false
    )
  );
create policy qa_conversations_backend_insert
  on app_data_agent.qa_conversations for insert to data_agent_backend
  with check (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  );
create policy qa_conversations_backend_update
  on app_data_agent.qa_conversations for update to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  )
  with check (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  );
create policy qa_conversations_backend_delete
  on app_data_agent.qa_conversations for delete to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  );

create policy qa_messages_backend_select
  on app_data_agent.qa_messages for select to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, false
    )
  );
create policy qa_messages_backend_insert
  on app_data_agent.qa_messages for insert to data_agent_backend
  with check (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, owner_principal_id, true
    )
  );

create policy workspace_run_bindings_backend_select
  on app_data_agent.workspace_run_bindings for select to data_agent_backend
  using (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, principal_id, false
    )
  );
create policy workspace_run_bindings_backend_insert
  on app_data_agent.workspace_run_bindings for insert to data_agent_backend
  with check (
    platform.backend_exact_principal_object_matches(
      app_id, tenant_id, environment, principal_id, true
    )
  );

revoke all on table
  app_data_agent.datasource_connections,
  app_data_agent.qa_conversations,
  app_data_agent.qa_messages,
  app_data_agent.workspace_run_bindings
from public, anon, authenticated, service_role;

grant select, insert, update on table app_data_agent.datasource_connections to data_agent_backend;
grant select, insert, update, delete on table app_data_agent.qa_conversations to data_agent_backend;
grant select, insert on table app_data_agent.qa_messages to data_agent_backend;
grant select, insert on table app_data_agent.workspace_run_bindings to data_agent_backend;

do $postconditions$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'datasource_connections', 'qa_conversations', 'qa_messages', 'workspace_run_bindings'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'app_data_agent'
        and class.relname = relation_name
        and class.relrowsecurity
        and class.relforcerowsecurity
    ) then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_RLS_POSTCONDITION_FAILED';
    end if;
    if pg_catalog.has_table_privilege(
      'authenticated', pg_catalog.format('app_data_agent.%I', relation_name), 'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_TABLE_EXPOSED';
    end if;
  end loop;
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.workspace_run_bindings', 'UPDATE,DELETE'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.qa_messages', 'UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_IMMUTABLE_GRANT_FAILED';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conname = 'semantic_domain_registry_datasource_connection_fk'
      and constraint_record.contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conname = 'semantic_relationship_projection_domain_datasource_fk'
      and constraint_record.contype = 'f'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_SEMANTIC_FK_MISSING';
  end if;
  if (
    select pg_catalog.count(*) <> 3
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conname in (
      'physical_schema_snapshot_datasource_connection_fk',
      'schema_scan_run_datasource_connection_fk',
      'schema_drift_event_datasource_connection_fk'
    ) and constraint_record.contype = 'f'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_DATA_CATALOG_FK_MISSING';
  end if;
end
$postconditions$;
-- ============================================================
-- 10628: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010628_app_data_agent_workspace_data_isolation',
  'sha256:5b325e32db2b2403c33190c1901b781b1c6e26e391d0b40ed37e3b515c6efd22'
);

commit;
