-- effective_run_config_migration_checksum: sha256:9782a7b7a906e5f2c8bc79419609cabf7911487987c08ba0da926cd0df7dd146
-- ============================================================
-- 10653: Greenfield Effective Run Config PostgreSQL authority
-- Depends on: 20260725010652_app_data_agent_environment_model_sync_concurrency
-- Creates empty authority tables only: no import, backfill, or dual-write.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'EFFECTIVE_RUN_CONFIG_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'EFFECTIVE_RUN_CONFIG_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010652_app_data_agent_environment_model_sync_concurrency'
  ) then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_RUN_CONFIG_BASELINE_10652_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_effective_config_rpc_owner'
  ) then
    create role data_agent_effective_config_rpc_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
-- Mutable workspace pointer. Revision bodies are append-only below.
-- Greenfield Datasource Authority revision. U2 callers must bind the current
-- monotonic version rather than relying on an implicit revision constant.
alter table app_data_agent.datasource_connections
  add column resource_version bigint not null default 1 check (resource_version >= 1);

create function app_data_agent.guard_datasource_resource_version_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  content_changed boolean;
begin
  content_changed := row(
    new.name,new.datasource_type,new.host,new.port,new.database_name,new.username,
    new.credential_ref_id,new.secret_ref_id,new.secret_version,new.rotation_state,
    new.ssl_mode,new.file_path,new.catalog_name,new.schema_name,new.status
  ) is distinct from row(
    old.name,old.datasource_type,old.host,old.port,old.database_name,old.username,
    old.credential_ref_id,old.secret_ref_id,old.secret_version,old.rotation_state,
    old.ssl_mode,old.file_path,old.catalog_name,old.schema_name,old.status
  );
  if content_changed then
    -- The database owns the monotonic revision. Existing narrow datasource
    -- mutations need not learn a new caller-controlled version parameter.
    new.resource_version := old.resource_version + 1;
  elsif new.resource_version <> old.resource_version then
    raise exception using errcode = '23514', message = 'DATASOURCE_RESOURCE_VERSION_IMMUTABLE';
  end if;
  return new;
end
$function$;

create trigger zz_datasource_resource_version_guard
before update on app_data_agent.datasource_connections
for each row execute function app_data_agent.guard_datasource_resource_version_update();

create table app_data_agent.workspace_run_defaults (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  defaults_id uuid not null,
  defaults_revision bigint not null check (defaults_revision >= 1),
  revision_id uuid not null,
  defaults_hash text not null check (defaults_hash ~ '^sha256:[0-9a-f]{64}$'),
  updated_by_principal_id uuid not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment),
  unique (app_id, tenant_id, environment, defaults_id, defaults_revision),
  unique (app_id, tenant_id, environment, revision_id),
  foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment) on delete restrict,
  foreign key (app_id, tenant_id, environment, updated_by_principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id) on delete restrict
);

create table app_data_agent.workspace_run_default_revisions (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  defaults_id uuid not null,
  defaults_revision bigint not null check (defaults_revision >= 1),
  revision_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (
    pg_catalog.length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  ),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  defaults_json jsonb not null check (
    pg_catalog.jsonb_typeof(defaults_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(defaults_json)
  ),
  revision_document jsonb not null check (
    pg_catalog.jsonb_typeof(revision_document) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(revision_document)
  ),
  defaults_hash text not null check (
    defaults_hash ~ '^sha256:[0-9a-f]{64}$'
    and defaults_hash = platform.canonical_sha256(revision_document)
  ),
  membership_version bigint not null check (membership_version >= 1),
  user_authz_epoch bigint not null check (user_authz_epoch >= 1),
  workspace_lifecycle_version bigint not null check (workspace_lifecycle_version >= 1),
  app_epoch bigint not null check (app_epoch >= 0),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, defaults_revision),
  unique (app_id, tenant_id, environment, defaults_id, revision_id),
  unique (app_id, tenant_id, environment, principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, defaults_id, defaults_revision, defaults_hash),
  unique (app_id, tenant_id, environment, defaults_id, defaults_revision, revision_id, defaults_hash),
  foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment) on delete restrict,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id) on delete restrict
);

alter table app_data_agent.workspace_run_defaults
  add constraint workspace_run_defaults_revision_fk
  foreign key (app_id, tenant_id, environment, defaults_id, defaults_revision, revision_id, defaults_hash)
  references app_data_agent.workspace_run_default_revisions (
    app_id, tenant_id, environment, defaults_id, defaults_revision, revision_id, defaults_hash
  ) on delete restrict deferrable initially deferred;

create table app_data_agent.effective_run_config_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  config_id uuid not null,
  config_revision bigint not null check (config_revision = 1),
  config_hash text not null check (config_hash ~ '^sha256:[0-9a-f]{64}$'),
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (
    pg_catalog.length(idempotency_key) between 8 and 256
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  ),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  operation_kind text not null check (operation_kind = 'QUESTION_RUN'),
  admission text not null check (admission = 'READY'),
  defaults_revision bigint not null,
  defaults_id uuid not null,
  defaults_hash text not null check (defaults_hash ~ '^sha256:[0-9a-f]{64}$'),
  membership_version bigint not null check (membership_version >= 1),
  user_authz_epoch bigint not null check (user_authz_epoch >= 1),
  workspace_lifecycle_version bigint not null check (workspace_lifecycle_version >= 1),
  app_epoch bigint not null check (app_epoch >= 0),
  route_resolution_id uuid not null,
  route_resolution_hash text not null check (route_resolution_hash ~ '^sha256:[0-9a-f]{64}$'),
  resolver_policy_version text not null check (resolver_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'),
  model_profile_id uuid not null,
  model_config_version bigint not null check (model_config_version >= 1),
  provider text not null check (provider in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')),
  model_id text not null check (pg_catalog.length(pg_catalog.btrim(model_id)) between 1 and 256),
  datasource_id uuid not null,
  datasource_revision_hash text not null check (datasource_revision_hash ~ '^sha256:[0-9a-f]{64}$'),
  schema_datasource_id text not null check (schema_datasource_id = datasource_id::text),
  datasource_fingerprint text not null check (datasource_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  semantic_release_id uuid not null,
  semantic_release_generation bigint not null check (semantic_release_generation >= 1),
  semantic_release_digest text not null check (semantic_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  schema_snapshot_hash text not null check (schema_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  context_policy_hash text not null check (context_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  egress_policy_hash text not null check (egress_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  execution_safety_policy_hash text not null check (execution_safety_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  provider_audience text not null check (
    provider_audience in ('PRIVATE','WORKSPACE','TENANT','EXTERNAL')
  ),
  classification text not null check (
    classification in ('PUBLIC','INTERNAL','RESTRICTED','SECRET')
  ),
  effective_config_json jsonb not null check (
    pg_catalog.jsonb_typeof(effective_config_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(effective_config_json)
    and config_hash = platform.canonical_sha256(effective_config_json)
  ),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, config_id, config_revision),
  unique (app_id, tenant_id, environment, config_id, config_revision, config_hash),
  unique (app_id, tenant_id, environment, run_id),
  unique (app_id, tenant_id, environment, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, defaults_id, defaults_revision, defaults_hash)
    references app_data_agent.workspace_run_default_revisions (
      app_id, tenant_id, environment, defaults_id, defaults_revision, defaults_hash
    ) on delete restrict,
  foreign key (app_id, tenant_id, environment, run_id, principal_id)
    references app_data_agent.runs (
      app_id, tenant_id, environment, run_id, principal_id
    ) on delete restrict deferrable initially deferred,
  foreign key (app_id, tenant_id, environment, datasource_id)
    references app_data_agent.datasource_connections (
      app_id, tenant_id, environment, datasource_id
    ) on delete restrict,
  foreign key (app_id, tenant_id, environment, semantic_domain, datasource_id)
    references semantic.semantic_domain_registry (
      app_id, tenant_id, environment, semantic_domain, datasource_id
    ) on delete restrict,
  foreign key (app_id, tenant_id, environment, semantic_domain, semantic_release_id)
    references semantic.semantic_source_release (
      app_id, tenant_id, environment, semantic_domain, release_id
    ) on delete restrict,
  foreign key (
    app_id, tenant_id, environment, schema_datasource_id,
    datasource_fingerprint, schema_snapshot_hash
  ) references catalog.physical_schema_snapshot (
    app_id, tenant_id, environment, datasource_id,
    datasource_fingerprint, snapshot_content_hash
  ) on delete restrict
);

create table app_data_agent.effective_run_config_resource_bindings (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  config_id uuid not null,
  config_revision bigint not null check (config_revision = 1),
  binding_ordinal integer not null check (binding_ordinal between 1 and 4096),
  resource_kind text not null check (resource_kind in (
    'MODEL_PROFILE','DATASOURCE','FILE','KNOWLEDGE','MCP_SERVER','SKILL',
    'SEMANTIC_RELEASE','SCHEMA_SNAPSHOT','CONTEXT_POLICY','EGRESS_POLICY','EXECUTION_SAFETY_POLICY'
  )),
  mention_id uuid,
  resource_id text not null check (pg_catalog.length(pg_catalog.btrim(resource_id)) between 1 and 256),
  requested_mode text not null check (requested_mode in ('INHERIT_DEFAULT','EXPLICIT_NONE','RESOURCE_IDS','MENTION')),
  requested_revision text check (requested_revision is null or pg_catalog.length(requested_revision) between 1 and 256),
  effective_revision text check (effective_revision is null or pg_catalog.length(effective_revision) between 1 and 256),
  effective_hash text check (effective_hash is null or effective_hash ~ '^sha256:[0-9a-f]{64}$'),
  availability text not null check (availability in ('AVAILABLE','UNAVAILABLE')),
  unavailable_reason text check (unavailable_reason is null or unavailable_reason in (
    'EXPLICITLY_CLEARED','DEFAULT_NOT_CONFIGURED','DEFAULT_REMOVED','RESOURCE_NOT_FOUND_OR_FORBIDDEN',
    'RESOURCE_DISABLED','RESOURCE_REVISION_MISMATCH','RESOURCE_REVOKED','RESOURCE_KIND_MISMATCH',
    'MODEL_NOT_AVAILABLE','SEMANTIC_RELEASE_NOT_PUBLISHED','SCHEMA_SNAPSHOT_STALE','POLICY_REJECTED',
    'EGRESS_PROVIDER_DENIED','EGRESS_AUDIENCE_DENIED','MENTION_RESOURCE_ID_REQUIRED'
  )),
  binding_json jsonb not null check (
    pg_catalog.jsonb_typeof(binding_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(binding_json)
  ),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((availability = 'AVAILABLE' and effective_revision is not null and effective_hash is not null and unavailable_reason is null)
    or (availability = 'UNAVAILABLE' and effective_revision is null and effective_hash is null and unavailable_reason is not null)),
  check ((requested_mode = 'MENTION') = (mention_id is not null)),
  primary key (app_id, tenant_id, environment, config_id, config_revision, binding_ordinal),
  unique (
    app_id, tenant_id, environment, config_id, config_revision, resource_kind, resource_id
  ),
  foreign key (app_id, tenant_id, environment, config_id, config_revision)
    references app_data_agent.effective_run_config_receipts (
      app_id, tenant_id, environment, config_id, config_revision
    ) on delete restrict
);

create table app_data_agent.effective_config_context_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  context_receipt_id uuid not null,
  config_id uuid not null,
  config_revision bigint not null check (config_revision = 1),
  config_hash text not null check (config_hash ~ '^sha256:[0-9a-f]{64}$'),
  run_id uuid not null,
  principal_id uuid not null,
  consumer_kind text not null check (consumer_kind in ('RUN_ACCEPTANCE','WORKER_START')),
  consumer_id text not null check (consumer_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  attempt_id uuid,
  worker_id text check (worker_id is null or worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  lease_token bigint check (lease_token is null or lease_token >= 1),
  outbox_id uuid,
  command_id uuid,
  worker_fence bigint not null check (
    (consumer_kind = 'RUN_ACCEPTANCE' and worker_fence = 0 and attempt_id is null
      and worker_id is null and lease_token is null and outbox_id = context_receipt_id
      and command_id is not null and consumer_id = command_id::text)
    or (consumer_kind = 'WORKER_START' and worker_fence is not null and worker_fence >= 1
      and attempt_id is not null and worker_id is not null and lease_token is not null
      and outbox_id is not null and command_id is not null and consumer_id = worker_id)
  ),
  receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(receipt_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json - 'lease_token')
  ),
  receipt_hash text not null check (
    receipt_hash ~ '^sha256:[0-9a-f]{64}$'
    and receipt_hash = platform.canonical_sha256(receipt_json)
  ),
  consumed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, context_receipt_id),
  foreign key (app_id, tenant_id, environment, config_id, config_revision, config_hash)
    references app_data_agent.effective_run_config_receipts (
      app_id, tenant_id, environment, config_id, config_revision, config_hash
    ) on delete restrict,
  foreign key (app_id, tenant_id, environment, run_id, principal_id)
    references app_data_agent.runs (
      app_id, tenant_id, environment, run_id, principal_id
    ) on delete restrict deferrable initially deferred,
  foreign key (app_id, tenant_id, environment, attempt_id, outbox_id, run_id)
    references app_data_agent.run_attempts (
      app_id, tenant_id, environment, attempt_id, outbox_id, run_id
    ) on delete restrict,
  foreign key (app_id, tenant_id, environment, outbox_id)
    references app_data_agent.outbox (app_id, tenant_id, environment, outbox_id)
    on delete restrict deferrable initially deferred
);

create unique index effective_config_context_run_acceptance_replay_key
on app_data_agent.effective_config_context_receipts (
  app_id, tenant_id, environment, config_id, config_revision, consumer_kind, consumer_id
)
where consumer_kind = 'RUN_ACCEPTANCE';

create unique index effective_config_context_worker_start_replay_key
on app_data_agent.effective_config_context_receipts (
  app_id, tenant_id, environment, config_id, config_revision, consumer_kind,
  consumer_id, attempt_id, lease_token, worker_fence
)
where consumer_kind = 'WORKER_START';

revoke all on table
  app_data_agent.workspace_run_defaults,
  app_data_agent.workspace_run_default_revisions,
  app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_run_config_resource_bindings,
  app_data_agent.effective_config_context_receipts
from public, anon, authenticated, service_role, data_agent_backend;
create function app_data_agent.reject_effective_config_authority_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_AUTHORITY_IMMUTABLE';
end
$function$;

create function app_data_agent.guard_workspace_run_defaults_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.app_id is distinct from old.app_id
    or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment
    or new.defaults_id is distinct from old.defaults_id
    or new.defaults_revision <> old.defaults_revision + 1
    or new.revision_id = old.revision_id
    or new.updated_by_principal_id is null
    or new.updated_at < old.updated_at
  then
    raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT';
  end if;
  return new;
end
$function$;

create trigger workspace_run_defaults_update_guard
before update or delete on app_data_agent.workspace_run_defaults
for each row execute function app_data_agent.guard_workspace_run_defaults_update();

create trigger workspace_run_default_revisions_immutable
before update or delete on app_data_agent.workspace_run_default_revisions
for each row execute function app_data_agent.reject_effective_config_authority_mutation();

create trigger effective_run_config_receipts_immutable
before update or delete on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.reject_effective_config_authority_mutation();

create trigger effective_run_config_resource_bindings_immutable
before update or delete on app_data_agent.effective_run_config_resource_bindings
for each row execute function app_data_agent.reject_effective_config_authority_mutation();

create trigger effective_config_context_receipts_immutable
before update or delete on app_data_agent.effective_config_context_receipts
for each row execute function app_data_agent.reject_effective_config_authority_mutation();

alter table app_data_agent.workspace_run_defaults enable row level security;
alter table app_data_agent.workspace_run_defaults force row level security;
alter table app_data_agent.workspace_run_default_revisions enable row level security;
alter table app_data_agent.workspace_run_default_revisions force row level security;
alter table app_data_agent.effective_run_config_receipts enable row level security;
alter table app_data_agent.effective_run_config_receipts force row level security;
alter table app_data_agent.effective_run_config_resource_bindings enable row level security;
alter table app_data_agent.effective_run_config_resource_bindings force row level security;
alter table app_data_agent.effective_config_context_receipts enable row level security;
alter table app_data_agent.effective_config_context_receipts force row level security;

create policy workspace_run_defaults_rpc_owner
on app_data_agent.workspace_run_defaults for all
to data_agent_effective_config_rpc_owner using (true) with check (true);
create policy workspace_run_default_revisions_rpc_owner
on app_data_agent.workspace_run_default_revisions for all
to data_agent_effective_config_rpc_owner using (true) with check (true);
create policy effective_run_config_receipts_rpc_owner
on app_data_agent.effective_run_config_receipts for all
to data_agent_effective_config_rpc_owner using (true) with check (true);
create policy effective_run_config_resource_bindings_rpc_owner
on app_data_agent.effective_run_config_resource_bindings for all
to data_agent_effective_config_rpc_owner using (true) with check (true);
create policy effective_config_context_receipts_rpc_owner
on app_data_agent.effective_config_context_receipts for all
to data_agent_effective_config_rpc_owner using (true) with check (true);

create function app_data_agent.canonical_uuid_json_string_is_valid(value jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(value) = 'string'
    and value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$function$;

create function app_data_agent.versioned_resource_reference_is_valid(value jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(value) = 'object'
    and value ?& array['resource_id','resource_revision','resource_hash']
    and not exists (select 1 from pg_catalog.jsonb_object_keys(value) key(name)
      where key.name not in ('resource_id','resource_revision','resource_hash'))
    and app_data_agent.canonical_uuid_json_string_is_valid(value -> 'resource_id')
    and pg_catalog.jsonb_typeof(value -> 'resource_revision') = 'number'
    and (value ->> 'resource_revision') ~ '^[1-9][0-9]*$'
    and value ->> 'resource_hash' ~ '^sha256:[0-9a-f]{64}$';
$function$;

create function app_data_agent.versioned_resource_array_is_valid(value jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(value) = 'array'
    and pg_catalog.jsonb_array_length(value) <= 128
    and not exists (
      select 1 from pg_catalog.jsonb_array_elements(value) with ordinality item(document,ordinal)
      where not app_data_agent.versioned_resource_reference_is_valid(item.document)
        or exists (select 1 from pg_catalog.jsonb_array_elements(value) with ordinality prior(document,ordinal)
          where prior.ordinal < item.ordinal
            and prior.document ->> 'resource_id' >= item.document ->> 'resource_id')
    );
$function$;

-- U2 ships three immutable built-in policy revisions. Their values, IDs and
-- canonical hashes are server-owned; Defaults may reference but never define them.
create function app_data_agent.builtin_effective_config_policy(policy_kind text)
returns jsonb language sql immutable set search_path = '' as $function$
  select case policy_kind
    when 'CONTEXT_POLICY' then pg_catalog.jsonb_build_object(
      'resource_id','00000000-0000-4000-8000-0000000053c1'::uuid,'resource_revision',1,
      'resource_hash',platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'schema_version','effective-context-policy@1.0.0','max_context_tokens',128000,
        'max_resource_bindings',1024)),
      'max_context_tokens',128000,'max_resource_bindings',1024)
    when 'EGRESS_POLICY' then pg_catalog.jsonb_build_object(
      'resource_id','00000000-0000-4000-8000-0000000053e1'::uuid,'resource_revision',1,
      'resource_hash',platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'schema_version','effective-egress-policy@1.0.0',
        'allowed_providers',pg_catalog.jsonb_build_array('deepseek','gemini','glm','grok','kimi','openai'),
        'allowed_audiences',pg_catalog.jsonb_build_array('PRIVATE','WORKSPACE'),
        'classification','INTERNAL')),
      'allowed_providers',pg_catalog.jsonb_build_array('deepseek','gemini','glm','grok','kimi','openai'),
      'allowed_audiences',pg_catalog.jsonb_build_array('PRIVATE','WORKSPACE'),
      'classification','INTERNAL')
    when 'EXECUTION_SAFETY_POLICY' then pg_catalog.jsonb_build_object(
      'resource_id','00000000-0000-4000-8000-0000000053f1'::uuid,'resource_revision',1,
      'resource_hash',platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'schema_version','effective-execution-safety-policy@1.0.0','max_tool_calls',10000,
        'max_provider_calls',10000,'max_elapsed_ms',9007199254740991)),
      'max_tool_calls',10000,'max_provider_calls',10000,'max_elapsed_ms',9007199254740991)
    else null end;
$function$;

create function app_data_agent.requested_defaults_resource_reference_is_valid(document jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(document) = 'object'
    and document ?& array['resource_id','expected_revision']
    and (select pg_catalog.count(*) = 2 from pg_catalog.jsonb_object_keys(document))
    and app_data_agent.canonical_uuid_json_string_is_valid(document -> 'resource_id')
    and pg_catalog.jsonb_typeof(document -> 'expected_revision') = 'number'
    and document ->> 'expected_revision' ~ '^[1-9][0-9]*$';
$function$;

create function app_data_agent.requested_defaults_resource_array_is_valid(document jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(document) = 'array'
    and pg_catalog.jsonb_array_length(document) <= 128
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(document) with ordinality item(value,ordinal)
      where not app_data_agent.requested_defaults_resource_reference_is_valid(item.value)
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(document) with ordinality prior(value,ordinal)
          where prior.ordinal < item.ordinal
            and (prior.value ->> 'resource_id' > item.value ->> 'resource_id'
              or (prior.value ->> 'resource_id' = item.value ->> 'resource_id'
                and (prior.value ->> 'expected_revision')::bigint >=
                  (item.value ->> 'expected_revision')::bigint))
        )
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(document) duplicate(value)
          where duplicate.value ->> 'resource_id' = item.value ->> 'resource_id'
          group by duplicate.value ->> 'resource_id' having pg_catalog.count(*) > 1
        )
    );
$function$;

-- Exact workspaceDefaultsSelectionCandidateSchema. PostgreSQL resolves the
-- intent to workspaceDefaultsValueSchema before hashing or persisting it.
create function app_data_agent.workspace_run_defaults_document_is_valid(document jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(document) = 'object'
    and document ?& array['model','datasource','files','knowledge','mcp_servers','skills',
      'semantic_release','schema_snapshot','context_policy','egress_policy','execution_safety_policy']
    and not exists (select 1 from pg_catalog.jsonb_object_keys(document) key(name)
      where key.name not in ('model','datasource','files','knowledge','mcp_servers','skills',
        'semantic_release','schema_snapshot','context_policy','egress_policy','execution_safety_policy'))
    and (document -> 'model' = 'null'::jsonb or app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'model'))
    and (document -> 'datasource' = 'null'::jsonb or app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'datasource'))
    and app_data_agent.requested_defaults_resource_array_is_valid(document -> 'files')
    and app_data_agent.requested_defaults_resource_array_is_valid(document -> 'knowledge')
    and app_data_agent.requested_defaults_resource_array_is_valid(document -> 'mcp_servers')
    and app_data_agent.requested_defaults_resource_array_is_valid(document -> 'skills')
    and (document -> 'semantic_release' = 'null'::jsonb or app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'semantic_release'))
    and (document -> 'schema_snapshot' = 'null'::jsonb or app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'schema_snapshot'))
    and app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'context_policy')
    and app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'egress_policy')
    and app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'execution_safety_policy')
    and not app_data_agent.contains_potential_plaintext_secret(document);
$function$;

create function app_data_agent.requested_resource_selection_is_valid(value jsonb, single_value boolean)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(value) = 'object'
    and value ? 'mode'
    and value ->> 'mode' in ('INHERIT_DEFAULT','EXPLICIT_NONE','RESOURCE_IDS')
    and ((value ->> 'mode' in ('INHERIT_DEFAULT','EXPLICIT_NONE')
      and (select pg_catalog.count(*) = 1 from pg_catalog.jsonb_object_keys(value)))
      or (value ->> 'mode' = 'RESOURCE_IDS'
        and value ? 'resources'
        and (select pg_catalog.count(*) = 2 from pg_catalog.jsonb_object_keys(value))
        and pg_catalog.jsonb_typeof(value -> 'resources') = 'array'
        and pg_catalog.jsonb_array_length(value -> 'resources') between 1 and 128
        and (not single_value or pg_catalog.jsonb_array_length(value -> 'resources') = 1)
        and not exists (
          select 1 from pg_catalog.jsonb_array_elements(value -> 'resources') with ordinality item(document,ordinal)
          where pg_catalog.jsonb_typeof(item.document) <> 'object'
            or not item.document ?& array['resource_id','expected_revision']
            or (select pg_catalog.count(*) <> 2 from pg_catalog.jsonb_object_keys(item.document))
            or not app_data_agent.canonical_uuid_json_string_is_valid(item.document -> 'resource_id')
            or pg_catalog.jsonb_typeof(item.document -> 'expected_revision') <> 'number'
            or item.document ->> 'expected_revision' !~ '^[1-9][0-9]*$'
            or exists (select 1 from pg_catalog.jsonb_array_elements(value -> 'resources') with ordinality prior(document,ordinal)
              where prior.ordinal < item.ordinal and prior.document ->> 'resource_id' >= item.document ->> 'resource_id')
        )));
$function$;

create function app_data_agent.effective_config_request_is_valid(request jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(request) = 'object'
    and request ->> 'schema_version' = 'run-config-request@1.0.0'
    and request ->> 'operation' in ('QUESTION_RUN','SEMANTIC_BOOTSTRAP_JOB')
    and request ?& array['schema_version','workspace_id','idempotency_key','defaults_ref',
      'overrides','mentions','operation','request_hash']
    and ((request ->> 'operation' = 'QUESTION_RUN'
        and request ?& array['run_id','conversation_ref']
        and (select pg_catalog.count(*) = 10 from pg_catalog.jsonb_object_keys(request))
        and pg_catalog.jsonb_typeof(request -> 'conversation_ref') = 'object'
        and (select pg_catalog.count(*) = 2 from pg_catalog.jsonb_object_keys(request -> 'conversation_ref'))
        and (request -> 'conversation_ref') ?& array['conversation_id','expected_resource_version']
        and app_data_agent.canonical_uuid_json_string_is_valid(request #> '{conversation_ref,conversation_id}')
        and request #>> '{conversation_ref,expected_resource_version}' ~ '^[1-9][0-9]*$')
      or (request ->> 'operation' = 'SEMANTIC_BOOTSTRAP_JOB'
        and request ? 'job_id'
        and (select pg_catalog.count(*) in (9,10) from pg_catalog.jsonb_object_keys(request))
        and not exists (select 1 from pg_catalog.jsonb_object_keys(request) key(name)
          where key.name not in ('schema_version','workspace_id','idempotency_key','defaults_ref',
            'overrides','mentions','operation','job_id','trigger_question_run_id','request_hash'))
        and app_data_agent.canonical_uuid_json_string_is_valid(request -> 'job_id')
        and (not request ? 'trigger_question_run_id'
          or (app_data_agent.canonical_uuid_json_string_is_valid(request -> 'trigger_question_run_id')
            and request ->> 'trigger_question_run_id' <> request ->> 'job_id'))))
    and app_data_agent.canonical_uuid_json_string_is_valid(request -> 'workspace_id')
    and (request ->> 'operation' <> 'QUESTION_RUN'
      or app_data_agent.canonical_uuid_json_string_is_valid(request -> 'run_id'))
    and request ->> 'request_hash' ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(request -> 'defaults_ref') = 'object'
    and (select pg_catalog.count(*) = 3 from pg_catalog.jsonb_object_keys(request -> 'defaults_ref'))
    and app_data_agent.canonical_uuid_json_string_is_valid(request #> '{defaults_ref,defaults_id}')
    and (request #>> '{defaults_ref,defaults_revision}') ~ '^[1-9][0-9]*$'
    and request #>> '{defaults_ref,defaults_hash}' ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(request -> 'overrides') = 'object'
    and (request -> 'overrides') ?& array['model','datasource','files','knowledge','mcp_servers','skills','egress']
    and (select pg_catalog.count(*) = 7 from pg_catalog.jsonb_object_keys(request -> 'overrides'))
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,model}',true)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,datasource}',true)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,files}',false)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,knowledge}',false)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,mcp_servers}',false)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,skills}',false)
    and (request ->> 'operation' <> 'SEMANTIC_BOOTSTRAP_JOB' or (
      request #>> '{overrides,model,mode}' = 'EXPLICIT_NONE'
      and request #> '{overrides,egress}' = 'null'::jsonb
      and request #>> '{overrides,mcp_servers,mode}' = 'EXPLICIT_NONE'
      and request #>> '{overrides,skills,mode}' = 'EXPLICIT_NONE'
      and not exists (
        select 1 from pg_catalog.jsonb_array_elements(request -> 'mentions') mention(document)
        where mention.document ->> 'resource_kind' not in ('FILE','KNOWLEDGE')
      )
    ))
    and (request #> '{overrides,egress}' = 'null'::jsonb or (
      pg_catalog.jsonb_typeof(request #> '{overrides,egress}') = 'object'
      and (request #> '{overrides,egress}') ?& array['allowed_providers','allowed_audiences','classification']
      and (select pg_catalog.count(*) = 3 from pg_catalog.jsonb_object_keys(request #> '{overrides,egress}'))
      and request #>> '{overrides,egress,classification}' in ('PUBLIC','INTERNAL','RESTRICTED','SECRET')
      and pg_catalog.jsonb_typeof(request #> '{overrides,egress,allowed_providers}') = 'array'
      and pg_catalog.jsonb_array_length(request #> '{overrides,egress,allowed_providers}') between 1 and 64
      and not exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_providers}') with ordinality provider(value,ordinal)
        where provider.value not in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')
          or exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_providers}') with ordinality prior(value,ordinal)
            where prior.ordinal < provider.ordinal and prior.value >= provider.value))
      and pg_catalog.jsonb_typeof(request #> '{overrides,egress,allowed_audiences}') = 'array'
      and pg_catalog.jsonb_array_length(request #> '{overrides,egress,allowed_audiences}') between 1 and 64
      and not exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_audiences}') audience(value)
        where audience.value not in ('PRIVATE','WORKSPACE','TENANT','EXTERNAL'))
      and not exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_audiences}') with ordinality audience(value,ordinal)
        where exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_audiences}') with ordinality prior(value,ordinal)
          where prior.ordinal < audience.ordinal
            and pg_catalog.array_position(array['PRIVATE','WORKSPACE','TENANT','EXTERNAL'],prior.value)
              >= pg_catalog.array_position(array['PRIVATE','WORKSPACE','TENANT','EXTERNAL'],audience.value)))))
    and pg_catalog.jsonb_typeof(request -> 'mentions') = 'array'
    and pg_catalog.jsonb_array_length(request -> 'mentions') <= 128
    and not exists (select 1 from pg_catalog.jsonb_array_elements(request -> 'mentions') with ordinality mention(document,ordinal)
      where pg_catalog.jsonb_typeof(mention.document) <> 'object'
        or not mention.document ?& array['mention_id','resource_kind','resource_id','expected_revision']
        or (select pg_catalog.count(*) <> 4 from pg_catalog.jsonb_object_keys(mention.document))
        or not app_data_agent.canonical_uuid_json_string_is_valid(mention.document -> 'mention_id')
        or not app_data_agent.canonical_uuid_json_string_is_valid(mention.document -> 'resource_id')
        or mention.document ->> 'resource_kind' not in ('FILE','KNOWLEDGE','MCP_SERVER','SKILL')
        or (mention.document ->> 'expected_revision') !~ '^[1-9][0-9]*$'
        or exists (select 1 from pg_catalog.jsonb_array_elements(request -> 'mentions') with ordinality prior(document,ordinal)
          where prior.ordinal < mention.ordinal and prior.document ->> 'mention_id' >= mention.document ->> 'mention_id'))
    and not exists (
      select candidate.resource_kind,candidate.resource_id
      from (
        select mention.document ->> 'resource_kind' as resource_kind,
          mention.document ->> 'resource_id' as resource_id
        from pg_catalog.jsonb_array_elements(request -> 'mentions') mention(document)
        union all
        select kind.resource_kind,item.document ->> 'resource_id'
        from (values
          ('files','FILE'),('knowledge','KNOWLEDGE'),
          ('mcp_servers','MCP_SERVER'),('skills','SKILL')
        ) kind(selection_name,resource_kind)
        cross join lateral pg_catalog.jsonb_array_elements(case
          when request #>> array['overrides',kind.selection_name,'mode'] = 'RESOURCE_IDS'
            then request #> array['overrides',kind.selection_name,'resources']
          else '[]'::jsonb end) item(document)
      ) candidate
      group by candidate.resource_kind,candidate.resource_id
      having pg_catalog.count(*) > 1
    )
    and not app_data_agent.contains_potential_plaintext_secret(request);
$function$;

create function app_data_agent.build_requested_optional_resource_bindings(request jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with overridden as (
    select kind.resource_kind,'OVERRIDE'::text as source,null::jsonb as mention_id,item.document
    from (values
      ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')
    ) kind(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when request #>> array['overrides',kind.selection_name,'mode'] = 'RESOURCE_IDS'
        then request #> array['overrides',kind.selection_name,'resources']
      else '[]'::jsonb end) item(document)
  ), mentioned as (
    select mention.document ->> 'resource_kind' as resource_kind,'MENTION'::text as source,
      mention.document -> 'mention_id' as mention_id,mention.document
    from pg_catalog.jsonb_array_elements(request -> 'mentions') mention(document)
  ), bindings as (
    select pg_catalog.jsonb_build_object(
      'resource_kind',candidate.resource_kind,
      'mention_id',candidate.mention_id,
      'requested_resource_id',candidate.document -> 'resource_id',
      'requested_revision',(candidate.document ->> 'expected_revision')::bigint,
      'effective_resource',null,'source',candidate.source,
      'availability','UNAVAILABLE','unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN'
    ) as document
    from (select * from overridden union all select * from mentioned) candidate
  )
  select coalesce(pg_catalog.jsonb_agg(bindings.document order by
    bindings.document ->> 'resource_kind',bindings.document ->> 'requested_resource_id',
    bindings.document ->> 'source',bindings.document ->> 'mention_id'),'[]'::jsonb)
  from bindings;
$function$;

-- Preserve the caller-controlled singleton selection on every fail-closed
-- branch. This is a projection only: it never resolves an effective resource.
create function app_data_agent.build_unavailable_singleton_resource_binding(
  selection jsonb,
  default_reference jsonb,
  resource_kind text,
  unavailable_reason text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  requested_reference jsonb;
  binding_source text;
  binding_reason text;
begin
  if resource_kind not in ('MODEL_PROFILE','DATASOURCE')
    or not app_data_agent.requested_resource_selection_is_valid(selection,true)
    or unavailable_reason not in (
      'EXPLICITLY_CLEARED','DEFAULT_NOT_CONFIGURED','DEFAULT_REMOVED',
      'RESOURCE_NOT_FOUND_OR_FORBIDDEN','RESOURCE_DISABLED','RESOURCE_REVISION_MISMATCH',
      'MODEL_NOT_AVAILABLE'
    )
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  if selection ->> 'mode' = 'RESOURCE_IDS' then
    requested_reference := selection #> '{resources,0}';
    binding_source := 'OVERRIDE';
  elsif selection ->> 'mode' = 'EXPLICIT_NONE' then
    requested_reference := null;
    binding_source := 'OVERRIDE';
  else
    requested_reference := default_reference;
    binding_source := 'DEFAULT';
  end if;
  binding_reason := case when selection ->> 'mode' = 'EXPLICIT_NONE'
    then 'EXPLICITLY_CLEARED' else unavailable_reason end;
  return pg_catalog.jsonb_build_object(
    'resource_kind',resource_kind,'mention_id',null,
    'requested_resource_id',requested_reference -> 'resource_id',
    'requested_revision',case
      when selection ->> 'mode' = 'RESOURCE_IDS'
        then (requested_reference ->> 'expected_revision')::bigint
      when requested_reference is not null and requested_reference <> 'null'::jsonb
        then (requested_reference ->> 'resource_revision')::bigint
      else null end,
    'effective_resource',null,'source',binding_source,
    'availability','UNAVAILABLE','unavailable_reason',binding_reason
  );
end
$function$;

-- INHERIT_DEFAULT is an explicit server-owned selection. Freeze every non-empty
-- Defaults reference. Empty collections remain empty and are represented by the
-- request/evaluation wire rather than a fabricated unavailable resource binding.
create function app_data_agent.build_inherited_optional_resource_bindings(
  request jsonb,
  defaults_document jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with inherited_kind as (
    select selection_name,resource_kind,
      case when pg_catalog.jsonb_typeof(defaults_document -> selection_name) = 'array'
        then defaults_document -> selection_name else '[]'::jsonb end as references
    from (values
      ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')
    ) kind(selection_name,resource_kind)
    where request #>> array['overrides',selection_name,'mode'] = 'INHERIT_DEFAULT'
  ), projected as (
    select kind.resource_kind,item.document as reference
    from inherited_kind kind
    cross join lateral pg_catalog.jsonb_array_elements(kind.references) item(document)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'resource_kind',projected.resource_kind,'mention_id',null,
    'requested_resource_id',projected.reference -> 'resource_id',
    'requested_revision',(projected.reference ->> 'resource_revision')::bigint,
    'effective_resource',null,'source','DEFAULT','availability','UNAVAILABLE',
    'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN'
  ) order by projected.resource_kind,
    coalesce(projected.reference ->> 'resource_id','NONE')),'[]'::jsonb)
  from projected;
$function$;

create function app_data_agent.build_optional_selection_evaluations(
  request jsonb,
  defaults_ref jsonb,
  resource_bindings jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'resource_kind',kind.resource_kind,
    'selection_mode',request #>> array['overrides',kind.selection_name,'mode'],
    'binding_count',case
      when request #>> array['overrides',kind.selection_name,'mode'] = 'RESOURCE_IDS'
        then (select pg_catalog.count(*)
          from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
          where binding.document ->> 'resource_kind' = kind.resource_kind
            and binding.document ->> 'source' = 'OVERRIDE')
      when request #>> array['overrides',kind.selection_name,'mode'] = 'INHERIT_DEFAULT'
        then (select pg_catalog.count(*)
          from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
          where binding.document ->> 'resource_kind' = kind.resource_kind
            and binding.document ->> 'source' = 'DEFAULT')
      else 0 end,
    'defaults_ref',case
      when request #>> array['overrides',kind.selection_name,'mode'] = 'INHERIT_DEFAULT'
        then defaults_ref else 'null'::jsonb end
  ) order by kind.ordinal)
  from (values
    ('files','FILE',1),('knowledge','KNOWLEDGE',2),
    ('mcp_servers','MCP_SERVER',3),('skills','SKILL',4)
  ) kind(selection_name,resource_kind,ordinal);
$function$;
-- Preserve legacy payload validation while adding the only U2 production payload:
-- a strict, server-built Effective Config reference with no raw resources.
create or replace function app_data_agent.command_payload_is_valid(requested_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare item jsonb; payload_kind text;
begin
  if requested_payload is null or pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload) then return false; end if;
  if requested_payload ?& array['kind','effective_config_ref']
    and (select pg_catalog.count(*) = 2 from pg_catalog.jsonb_object_keys(requested_payload))
    and requested_payload ->> 'kind' = 'START_L2_RESEARCH'
    and pg_catalog.jsonb_typeof(requested_payload -> 'effective_config_ref') = 'object'
    and (requested_payload -> 'effective_config_ref') ?& array['config_id','config_revision','config_hash']
    and (select pg_catalog.count(*) = 3
      from pg_catalog.jsonb_object_keys(requested_payload -> 'effective_config_ref'))
    and app_data_agent.canonical_uuid_json_string_is_valid(
      requested_payload #> '{effective_config_ref,config_id}')
    and requested_payload #>> '{effective_config_ref,config_revision}' ~ '^[1-9][0-9]*$'
    and requested_payload #>> '{effective_config_ref,config_hash}' ~ '^sha256:[0-9a-f]{64}$'
  then return true; end if;

  payload_kind := requested_payload ->> 'kind';
  if payload_kind not in ('START_L2_RESEARCH','START_QA_ANALYSIS') then return false; end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(requested_payload) payload_key(key)
    where payload_key.key not in ('kind','mode','question_version','dataset_id','secret_refs',
      'datasource_id','conversation_id','message_id','model_profile_id','model_config_version',
      'provider','model_id','datasource_binding_hash')) then return false; end if;
  if payload_kind = 'START_QA_ANALYSIS' and not (requested_payload ?& array[
    'datasource_id','conversation_id','message_id','model_profile_id','model_config_version',
    'provider','model_id','datasource_binding_hash']) then return false; end if;
  if requested_payload ? 'mode' and requested_payload ->> 'mode' <> 'L2' then return false; end if;
  if requested_payload ? 'secret_refs' then
    if pg_catalog.jsonb_typeof(requested_payload -> 'secret_refs') <> 'array'
      or pg_catalog.jsonb_array_length(requested_payload -> 'secret_refs') not between 1 and 32
    then return false; end if;
    for item in select value from pg_catalog.jsonb_array_elements(requested_payload -> 'secret_refs') loop
      if item #>> '{}' !~* '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then return false; end if;
    end loop;
  end if;
  if requested_payload ? 'datasource_id' and requested_payload ->> 'datasource_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'conversation_id' and requested_payload ->> 'conversation_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'message_id' and requested_payload ->> 'message_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_profile_id' and requested_payload ->> 'model_profile_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_config_version'
    and requested_payload ->> 'model_config_version' !~ '^[1-9][0-9]*$' then return false; end if;
  if requested_payload ? 'provider' and requested_payload ->> 'provider'
    not in ('openai','anthropic','deepseek','glm','kimi','grok','gemini') then return false; end if;
  if requested_payload ? 'model_id'
    and pg_catalog.length(requested_payload ->> 'model_id') not between 1 and 256 then return false; end if;
  if requested_payload ? 'datasource_binding_hash'
    and requested_payload ->> 'datasource_binding_hash' !~ '^sha256:[0-9a-f]{64}$' then return false; end if;
  return true;
end
$function$;
create function app_data_agent.update_workspace_run_defaults(command jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  app_user_record app_data_agent.app_users%rowtype;
  workspace_record app_data_agent.workspaces%rowtype;
  current_defaults app_data_agent.workspace_run_defaults%rowtype;
  existing_revision app_data_agent.workspace_run_default_revisions%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  domain_record semantic.semantic_domain_registry%rowtype;
  release_record semantic.semantic_source_release%rowtype;
  snapshot_record catalog.physical_schema_snapshot%rowtype;
  requested_operation_id uuid;
  requested_workspace_id uuid;
  requested_expected_revision bigint;
  requested_idempotency_key text;
  requested_hash text;
  requested_defaults jsonb;
  resolved_defaults jsonb;
  model_reference jsonb := 'null'::jsonb;
  datasource_reference jsonb := 'null'::jsonb;
  semantic_reference jsonb := 'null'::jsonb;
  snapshot_reference jsonb := 'null'::jsonb;
  context_reference jsonb;
  egress_reference jsonb;
  safety_reference jsonb;
  computed_request_hash text;
  computed_defaults_hash text;
  selected_defaults_id uuid;
  revision_document jsonb;
  parent_revision bigint;
  parent_hash text;
  next_revision bigint;
  commit_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if command is null
    or pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' <> 'workspace-defaults-cas-update@1.0.0'
    or not command ?& array[
      'schema_version','operation_id','workspace_id','expected_defaults_revision','idempotency_key','request_hash','defaults'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(command) as key(name)
      where key.name not in (
        'schema_version','operation_id','workspace_id','expected_defaults_revision','idempotency_key','request_hash','defaults'
      )
    )
    or not app_data_agent.canonical_uuid_json_string_is_valid(command -> 'operation_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(command -> 'workspace_id')
    or pg_catalog.jsonb_typeof(command -> 'expected_defaults_revision') <> 'number'
    or pg_catalog.jsonb_typeof(command -> 'idempotency_key') <> 'string'
    or pg_catalog.jsonb_typeof(command -> 'request_hash') <> 'string'
    or not app_data_agent.workspace_run_defaults_document_is_valid(command -> 'defaults')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end if;

  begin
    requested_operation_id := (command ->> 'operation_id')::uuid;
    requested_workspace_id := (command ->> 'workspace_id')::uuid;
    requested_expected_revision := (command ->> 'expected_defaults_revision')::bigint;
  exception when others then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end;
  requested_idempotency_key := command ->> 'idempotency_key';
  requested_hash := command ->> 'request_hash';
  requested_defaults := command -> 'defaults';
  computed_request_hash := platform.canonical_sha256(command - 'request_hash');
  if requested_expected_revision < 0
    or pg_catalog.length(requested_idempotency_key) not between 8 and 128
    or requested_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or requested_hash is distinct from computed_request_hash
  then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(true);
  if requested_workspace_id <> authority.tenant_id then
    raise exception using errcode = '42501', message = 'WORKSPACE_RUN_DEFAULTS_SCOPE_MISMATCH';
  end if;
  if authority.membership_role <> 'owner' then
    raise exception using errcode = '42501', message = 'WORKSPACE_RUN_DEFAULTS_ADMIN_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:workspace-defaults-idempotency:' || authority.app_id::text || ':' ||
    authority.tenant_id::text || ':' || authority.environment || ':' ||
    authority.principal_id::text || ':' || requested_idempotency_key,
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:workspace-defaults:' || authority.app_id::text || ':' ||
    authority.tenant_id::text || ':' || authority.environment,
    0
  ));

  select revision.* into existing_revision
  from app_data_agent.workspace_run_default_revisions as revision
  where revision.app_id = authority.app_id
    and revision.tenant_id = authority.tenant_id
    and revision.environment = authority.environment
    and revision.principal_id = authority.principal_id
    and revision.idempotency_key = requested_idempotency_key;
  if found then
    if existing_revision.request_hash <> requested_hash
      or existing_revision.revision_id <> requested_operation_id
    then
      raise exception using errcode = '23505', message = 'WORKSPACE_RUN_DEFAULTS_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'revision',existing_revision.revision_document || pg_catalog.jsonb_build_object('defaults_hash',existing_revision.defaults_hash),
      'defaults_ref',pg_catalog.jsonb_build_object(
        'defaults_id',existing_revision.defaults_id,'defaults_revision',existing_revision.defaults_revision,
        'defaults_hash',existing_revision.defaults_hash),
      'request_hash',existing_revision.request_hash,
      'committed_at',existing_revision.revision_document ->> 'created_at',
      'replayed',true
    );
  end if;

  select defaults.* into current_defaults
  from app_data_agent.workspace_run_defaults as defaults
  where defaults.app_id = authority.app_id
    and defaults.tenant_id = authority.tenant_id
    and defaults.environment = authority.environment
  for update;
  if found then
    if current_defaults.defaults_revision <> requested_expected_revision then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT';
    end if;
    next_revision := current_defaults.defaults_revision + 1;
    selected_defaults_id := current_defaults.defaults_id;
    parent_revision := current_defaults.defaults_revision;
    parent_hash := current_defaults.defaults_hash;
  else
    if requested_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT';
    end if;
    next_revision := 1;
    selected_defaults_id := requested_operation_id;
    parent_revision := null;
    parent_hash := null;
  end if;

  select * into strict app_user_record
  from app_data_agent.app_users as app_user
  where app_user.app_id = authority.app_id
    and app_user.environment = authority.environment
    and app_user.principal_id = authority.principal_id
    and app_user.status = 'ACTIVE'
  for share;
  select * into strict workspace_record
  from app_data_agent.workspaces as workspace
  where workspace.app_id = authority.app_id
    and workspace.workspace_id = authority.tenant_id
    and workspace.environment = authority.environment
    and workspace.lifecycle = 'ACTIVE'
  for share;

  if pg_catalog.jsonb_array_length(requested_defaults -> 'files') > 0
    or pg_catalog.jsonb_array_length(requested_defaults -> 'knowledge') > 0
    or pg_catalog.jsonb_array_length(requested_defaults -> 'mcp_servers') > 0
    or pg_catalog.jsonb_array_length(requested_defaults -> 'skills') > 0
  then
    raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
  end if;

  if requested_defaults -> 'model' <> 'null'::jsonb then
    select catalog.* into model_record
    from platform.list_active_model_catalog(authority.deployment_id,authority.principal_id) as catalog
    where catalog.model_profile_id = (requested_defaults #>> '{model,resource_id}')::uuid
      and catalog.config_version = (requested_defaults #>> '{model,expected_revision}')::bigint;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    model_reference := pg_catalog.jsonb_build_object(
      'resource_id',model_record.model_profile_id,'resource_revision',model_record.config_version,
      'resource_hash',platform.canonical_sha256(pg_catalog.to_jsonb(model_record) - 'credential_ref'));
  end if;

  if requested_defaults -> 'datasource' <> 'null'::jsonb then
    select datasource.* into datasource_record
    from app_data_agent.datasource_connections as datasource
    where datasource.app_id = authority.app_id and datasource.tenant_id = authority.tenant_id
      and datasource.environment = authority.environment
      and datasource.datasource_id = (requested_defaults #>> '{datasource,resource_id}')::uuid
      and datasource.status = 'ACTIVE'
    for share;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    if (requested_defaults #>> '{datasource,expected_revision}')::bigint <>
      datasource_record.resource_version then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
    end if;
    datasource_reference := pg_catalog.jsonb_build_object(
      'resource_id',datasource_record.datasource_id,
      'resource_revision',datasource_record.resource_version,
      'resource_hash',platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'datasource_id',datasource_record.datasource_id,'datasource_type',datasource_record.datasource_type,
        'status',datasource_record.status,'resource_version',datasource_record.resource_version)));
  end if;

  if requested_defaults -> 'semantic_release' <> 'null'::jsonb then
    select release.* into release_record
    from semantic.semantic_source_release as release
    join semantic.semantic_domain_registry as domain
      on domain.app_id = release.app_id and domain.tenant_id = release.tenant_id
     and domain.environment = release.environment and domain.semantic_domain = release.semantic_domain
     and domain.is_active
    join semantic.semantic_active_pointer as pointer
      on pointer.app_id = release.app_id and pointer.tenant_id = release.tenant_id
     and pointer.environment = release.environment and pointer.semantic_domain = release.semantic_domain
     and pointer.current_release_id = release.release_id
     and pointer.current_release_generation = release.release_generation
     and pointer.current_release_digest = release.release_digest
    where release.app_id = authority.app_id and release.tenant_id = authority.tenant_id
      and release.environment = authority.environment
      and release.release_id = (requested_defaults #>> '{semantic_release,resource_id}')::uuid
      and release.release_generation = (requested_defaults #>> '{semantic_release,expected_revision}')::bigint
    for share of release,domain,pointer;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    select domain.* into strict domain_record
    from semantic.semantic_domain_registry as domain
    where domain.app_id = release_record.app_id and domain.tenant_id = release_record.tenant_id
      and domain.environment = release_record.environment
      and domain.semantic_domain = release_record.semantic_domain and domain.is_active
    for share;
    semantic_reference := pg_catalog.jsonb_build_object(
      'resource_id',release_record.release_id,'resource_revision',release_record.release_generation,
      'resource_hash',release_record.release_digest);
  end if;

  if requested_defaults -> 'schema_snapshot' <> 'null'::jsonb then
    if (requested_defaults #>> '{schema_snapshot,expected_revision}')::bigint <> 1 then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
    end if;
    select snapshot.* into snapshot_record
    from catalog.physical_schema_snapshot as snapshot
    where snapshot.app_id = authority.app_id and snapshot.tenant_id = authority.tenant_id
      and snapshot.environment = authority.environment
      and exists (
        select 1 from catalog.schema_scan_run as scan
        where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
          and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
          and scan.datasource_fingerprint = snapshot.datasource_fingerprint
          and scan.snapshot_content_hash = snapshot.snapshot_content_hash
          and scan.snapshot_id = (requested_defaults #>> '{schema_snapshot,resource_id}')::uuid
          and scan.terminal = 'SUCCEEDED'
      )
    order by snapshot.committed_at desc limit 1
    for share;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    snapshot_reference := pg_catalog.jsonb_build_object(
      'resource_id',(requested_defaults #>> '{schema_snapshot,resource_id}')::uuid,
      'resource_revision',1,'resource_hash',snapshot_record.snapshot_content_hash);
  end if;

  if datasource_reference <> 'null'::jsonb and semantic_reference <> 'null'::jsonb
    and domain_record.datasource_id is distinct from datasource_record.datasource_id then
    raise exception using errcode = '23514', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_BINDING_MISMATCH';
  end if;
  if datasource_reference <> 'null'::jsonb and snapshot_reference <> 'null'::jsonb
    and snapshot_record.datasource_connection_id is distinct from datasource_record.datasource_id then
    raise exception using errcode = '23514', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_BINDING_MISMATCH';
  end if;

  context_reference := app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY')
    - array['max_context_tokens','max_resource_bindings'];
  egress_reference := app_data_agent.builtin_effective_config_policy('EGRESS_POLICY')
    - array['allowed_providers','allowed_audiences','classification'];
  safety_reference := app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY')
    - array['max_tool_calls','max_provider_calls','max_elapsed_ms'];
  if requested_defaults #>> '{context_policy,resource_id}' <> context_reference ->> 'resource_id'
    or (requested_defaults #>> '{context_policy,expected_revision}')::bigint <>
      (context_reference ->> 'resource_revision')::bigint
    or requested_defaults #>> '{egress_policy,resource_id}' <> egress_reference ->> 'resource_id'
    or (requested_defaults #>> '{egress_policy,expected_revision}')::bigint <>
      (egress_reference ->> 'resource_revision')::bigint
    or requested_defaults #>> '{execution_safety_policy,resource_id}' <> safety_reference ->> 'resource_id'
    or (requested_defaults #>> '{execution_safety_policy,expected_revision}')::bigint <>
      (safety_reference ->> 'resource_revision')::bigint
  then
    raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
  end if;

  resolved_defaults := pg_catalog.jsonb_build_object(
    'model',model_reference,'datasource',datasource_reference,
    'files','[]'::jsonb,'knowledge','[]'::jsonb,'mcp_servers','[]'::jsonb,'skills','[]'::jsonb,
    'semantic_release',semantic_reference,'schema_snapshot',snapshot_reference,
    'context_policy',context_reference,'egress_policy',egress_reference,
    'execution_safety_policy',safety_reference);
  requested_defaults := resolved_defaults;

  commit_at := pg_catalog.clock_timestamp();
  revision_document := pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-revision@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id),
    'defaults_id',selected_defaults_id,'defaults_revision',next_revision,
    'parent_revision',parent_revision,'parent_hash',parent_hash,
    'defaults',requested_defaults,'created_by_principal_id',authority.principal_id,
    'created_at',app_data_agent.runtime_iso_timestamp(commit_at)
  );
  computed_defaults_hash := platform.canonical_sha256(revision_document);
  insert into app_data_agent.workspace_run_default_revisions (
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,principal_id,
    idempotency_key,request_hash,defaults_json,revision_document,defaults_hash,membership_version,
    user_authz_epoch,workspace_lifecycle_version,app_epoch,committed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,selected_defaults_id,next_revision,
    requested_operation_id,authority.principal_id,requested_idempotency_key,requested_hash,
    requested_defaults,revision_document,computed_defaults_hash,authority.membership_version,
    app_user_record.authz_epoch,workspace_record.lifecycle_version,authority.app_epoch,commit_at
  );

  insert into app_data_agent.workspace_run_defaults (
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,defaults_hash,
    updated_by_principal_id,updated_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,selected_defaults_id,next_revision,
    requested_operation_id,computed_defaults_hash,authority.principal_id,commit_at
  ) on conflict (app_id,tenant_id,environment) do update set
    defaults_revision = excluded.defaults_revision,
    revision_id = excluded.revision_id,
    defaults_hash = excluded.defaults_hash,
    updated_by_principal_id = excluded.updated_by_principal_id,
    updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'revision',revision_document || pg_catalog.jsonb_build_object('defaults_hash',computed_defaults_hash),
    'defaults_ref',pg_catalog.jsonb_build_object(
      'defaults_id',selected_defaults_id,'defaults_revision',next_revision,
      'defaults_hash',computed_defaults_hash),
    'request_hash',requested_hash,
    'committed_at',app_data_agent.runtime_iso_timestamp(commit_at),
    'replayed',false
  );
end
$function$;

create function app_data_agent.get_workspace_run_defaults()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare authority record; revision app_data_agent.workspace_run_default_revisions%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  select revision_row.* into revision
  from app_data_agent.workspace_run_defaults as pointer
  join app_data_agent.workspace_run_default_revisions as revision_row
    on revision_row.app_id = pointer.app_id
   and revision_row.tenant_id = pointer.tenant_id
   and revision_row.environment = pointer.environment
   and revision_row.defaults_id = pointer.defaults_id
   and revision_row.defaults_revision = pointer.defaults_revision
   and revision_row.revision_id = pointer.revision_id
   and revision_row.defaults_hash = pointer.defaults_hash
  where pointer.app_id = authority.app_id
    and pointer.tenant_id = authority.tenant_id
    and pointer.environment = authority.environment;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'revision',revision.revision_document || pg_catalog.jsonb_build_object('defaults_hash',revision.defaults_hash),
    'defaults_ref',pg_catalog.jsonb_build_object(
      'defaults_id',revision.defaults_id,'defaults_revision',revision.defaults_revision,
      'defaults_hash',revision.defaults_hash)
  );
end
$function$;
create function app_data_agent.build_question_run_config_resolution(
  requested_resolution_id uuid,
  requested_scope jsonb,
  requested_run_id uuid,
  requested_conversation_ref jsonb,
  requested_request_hash text,
  requested_defaults_ref jsonb,
  requested_authority_binding jsonb,
  requested_resource_bindings jsonb,
  requested_config jsonb,
  requested_resolved_at timestamptz,
  requested_admission text,
  requested_unavailable_reason text,
  requested_effective_config_ref jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  resolution_document jsonb;
  unavailable_reasons jsonb := '[]'::jsonb;
begin
  if requested_admission not in ('READY','BLOCKED','BOOTSTRAP_REQUIRED') then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOLUTION_INVALID';
  end if;
  if requested_unavailable_reason is not null and not exists (
    select 1 from pg_catalog.jsonb_array_elements(requested_resource_bindings) binding(document)
    where binding.document ->> 'resource_kind' in (
      'MODEL_PROFILE','DATASOURCE','SEMANTIC_RELEASE','SCHEMA_SNAPSHOT',
      'CONTEXT_POLICY','EGRESS_POLICY','EXECUTION_SAFETY_POLICY'
    )
      and binding.document ->> 'availability' = 'UNAVAILABLE'
      and binding.document ->> 'unavailable_reason' = requested_unavailable_reason
  ) then
    requested_resource_bindings := requested_resource_bindings ||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'resource_kind',case requested_unavailable_reason
        when 'MODEL_NOT_AVAILABLE' then 'MODEL_PROFILE'
        when 'SEMANTIC_RELEASE_NOT_PUBLISHED' then 'SEMANTIC_RELEASE'
        when 'SCHEMA_SNAPSHOT_STALE' then 'SCHEMA_SNAPSHOT'
        when 'POLICY_REJECTED' then 'EGRESS_POLICY'
        when 'EGRESS_PROVIDER_DENIED' then 'EGRESS_POLICY'
        when 'EGRESS_AUDIENCE_DENIED' then 'EGRESS_POLICY'
        else 'DATASOURCE' end,
      'mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
      'source',case when requested_unavailable_reason = 'SEMANTIC_RELEASE_NOT_PUBLISHED'
        then 'ACTIVE_POINTER' when requested_unavailable_reason like '%POLICY%'
        or requested_unavailable_reason like 'EGRESS_%' then 'POLICY' else 'DEFAULT' end,
      'availability','UNAVAILABLE','unavailable_reason',requested_unavailable_reason));
  end if;
  select coalesce(pg_catalog.jsonb_agg(binding.document order by
    binding.document ->> 'resource_kind',
    coalesce(binding.document #>> '{effective_resource,resource_id}',
      binding.document ->> 'requested_resource_id','NONE')),'[]'::jsonb)
    into requested_resource_bindings
  from pg_catalog.jsonb_array_elements(requested_resource_bindings) binding(document);
  if requested_admission <> 'READY' then
    select coalesce(pg_catalog.jsonb_agg(reason.name order by reason.ordinal),'[]'::jsonb)
      into unavailable_reasons
    from (values
      ('EXPLICITLY_CLEARED',1),('DEFAULT_NOT_CONFIGURED',2),('DEFAULT_REMOVED',3),
      ('RESOURCE_NOT_FOUND_OR_FORBIDDEN',4),('RESOURCE_DISABLED',5),
      ('RESOURCE_REVISION_MISMATCH',6),('RESOURCE_REVOKED',7),
      ('RESOURCE_KIND_MISMATCH',8),('MODEL_NOT_AVAILABLE',9),
      ('SEMANTIC_RELEASE_NOT_PUBLISHED',10),('SCHEMA_SNAPSHOT_STALE',11),
      ('POLICY_REJECTED',12),('EGRESS_PROVIDER_DENIED',13),
      ('EGRESS_AUDIENCE_DENIED',14),('MENTION_RESOURCE_ID_REQUIRED',15)
    ) reason(name,ordinal)
    where exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_resource_bindings) binding(document)
      where binding.document ->> 'availability' = 'UNAVAILABLE'
        and binding.document ->> 'unavailable_reason' = reason.name
    );
    if requested_admission = 'BOOTSTRAP_REQUIRED'
      and unavailable_reasons <> pg_catalog.jsonb_build_array('SEMANTIC_RELEASE_NOT_PUBLISHED')
    then
      requested_admission := 'BLOCKED';
    end if;
  end if;
  resolution_document := pg_catalog.jsonb_build_object(
    'schema_version','run-config-resolution-receipt@1.0.0',
    'resolution_id',requested_resolution_id,
    'scope',requested_scope,
    'request_hash',requested_request_hash,
    'defaults_ref',requested_defaults_ref,
    'authority_binding',requested_authority_binding,
    'resource_bindings',requested_resource_bindings,
    'optional_selection_evaluations',app_data_agent.build_optional_selection_evaluations(
      requested_config,requested_defaults_ref,requested_resource_bindings),
    'resolved_at',app_data_agent.runtime_iso_timestamp(requested_resolved_at),
    'run_id',requested_run_id,
    'operation','QUESTION_RUN',
    'conversation_ref',requested_conversation_ref,
    'admission',requested_admission,
    'unavailable_reasons',unavailable_reasons,
    'effective_config_ref',requested_effective_config_ref,
    'required_action',case when requested_admission = 'BOOTSTRAP_REQUIRED'
      then pg_catalog.to_jsonb('SEMANTIC_BOOTSTRAP'::text) else 'null'::jsonb end,
    'bootstrap_job_config',null
  );
  return pg_catalog.jsonb_build_object(
    'resolution',resolution_document || pg_catalog.jsonb_build_object(
      'resolution_hash',platform.canonical_sha256(resolution_document)),
    'effective_config',null);
end
$function$;

create function app_data_agent.resolve_semantic_bootstrap_job_config(requested_config jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  app_user_record app_data_agent.app_users%rowtype;
  workspace_record app_data_agent.workspaces%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  snapshot_record catalog.physical_schema_snapshot%rowtype;
  requested_job_id uuid;
  selected_datasource_id uuid;
  selected_datasource_revision bigint;
  request_hash text;
  scope_document jsonb;
  defaults_ref jsonb;
  authority_binding jsonb;
  datasource_selection jsonb;
  datasource_reference jsonb;
  snapshot_reference jsonb;
  datasource_hash text;
  resource_bindings jsonb := '[]'::jsonb;
  source_resources jsonb := '[]'::jsonb;
  bootstrap_document jsonb;
  resolution_document jsonb;
  unavailable_reasons jsonb := '[]'::jsonb;
  resolved_at timestamptz;
  blocked_reason text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.effective_config_request_is_valid(requested_config)
    or requested_config ->> 'operation' <> 'SEMANTIC_BOOTSTRAP_JOB' then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  begin
    requested_job_id := (requested_config ->> 'job_id')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end;
  request_hash := requested_config ->> 'request_hash';
  defaults_ref := requested_config -> 'defaults_ref';
  datasource_selection := requested_config #> '{overrides,datasource}';
  if request_hash <> platform.canonical_sha256(requested_config - 'request_hash') then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  resource_bindings := app_data_agent.build_requested_optional_resource_bindings(requested_config);
  select * into strict authority from platform.current_backend_authority(true);
  if requested_config ->> 'workspace_id' <> authority.tenant_id::text then
    raise exception using errcode = '42501', message = 'EFFECTIVE_CONFIG_REQUEST_SCOPE_MISMATCH';
  end if;
  select * into strict app_user_record from app_data_agent.app_users as app_user
  where app_user.app_id = authority.app_id and app_user.environment = authority.environment
    and app_user.principal_id = authority.principal_id and app_user.status = 'ACTIVE' for share;
  select * into strict workspace_record from app_data_agent.workspaces as workspace
  where workspace.app_id = authority.app_id and workspace.workspace_id = authority.tenant_id
    and workspace.environment = authority.environment and workspace.lifecycle = 'ACTIVE' for share;
  scope_document := pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment,
    'workspace_id',authority.tenant_id,'principal_id',authority.principal_id);
  authority_binding := pg_catalog.jsonb_build_object(
    'authz_epoch',app_user_record.authz_epoch,'membership_version',authority.membership_version,
    'workspace_lifecycle_version',workspace_record.lifecycle_version,
    'route_resolution_id',requested_job_id,
    'route_resolution_hash',platform.canonical_sha256(pg_catalog.jsonb_build_object(
      'schema_version','effective-config-route-resolution@1.0.0','route_resolution_id',requested_job_id,
      'scope',scope_document,'operation','SEMANTIC_BOOTSTRAP_JOB','request_hash',request_hash)),
    'resolver_policy_version','effective-config-resolver@1.0.0');
  resolved_at := pg_catalog.clock_timestamp();

  select pointer.* into defaults_pointer from app_data_agent.workspace_run_defaults as pointer
  where pointer.app_id = authority.app_id and pointer.tenant_id = authority.tenant_id
    and pointer.environment = authority.environment for share;
  if not found then blocked_reason := 'DEFAULT_NOT_CONFIGURED';
  elsif defaults_pointer.defaults_id::text <> requested_config #>> '{defaults_ref,defaults_id}'
    or defaults_pointer.defaults_revision::text <> requested_config #>> '{defaults_ref,defaults_revision}'
    or defaults_pointer.defaults_hash <> requested_config #>> '{defaults_ref,defaults_hash}'
  then blocked_reason := 'DEFAULT_REMOVED';
  end if;
  if blocked_reason is null then
    select revision.* into strict defaults_revision from app_data_agent.workspace_run_default_revisions revision
    where revision.app_id = defaults_pointer.app_id and revision.tenant_id = defaults_pointer.tenant_id
      and revision.environment = defaults_pointer.environment and revision.defaults_id = defaults_pointer.defaults_id
      and revision.defaults_revision = defaults_pointer.defaults_revision
      and revision.defaults_hash = defaults_pointer.defaults_hash for share;
    select resource_bindings || coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'resource_kind',source.resource_kind,'mention_id',null,
        'requested_resource_id',item.document -> 'resource_id',
        'requested_revision',(item.document ->> 'resource_revision')::bigint,
        'effective_resource',null,'source','DEFAULT','availability','UNAVAILABLE',
        'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN'
      ) order by source.resource_kind,item.document ->> 'resource_id'), '[]'::jsonb)
      into resource_bindings
    from (values ('files','FILE'),('knowledge','KNOWLEDGE')) source(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when requested_config #>> array['overrides',source.selection_name,'mode'] = 'INHERIT_DEFAULT'
        then defaults_revision.defaults_json -> source.selection_name
      else '[]'::jsonb end) item(document);
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
      group by binding.document ->> 'resource_kind',binding.document ->> 'requested_resource_id'
      having pg_catalog.count(*) > 1
    ) then
      raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_DUPLICATE';
    end if;
    if datasource_selection ->> 'mode' = 'EXPLICIT_NONE' then blocked_reason := 'EXPLICITLY_CLEARED';
    else
      datasource_reference := case when datasource_selection ->> 'mode' = 'RESOURCE_IDS'
        then pg_catalog.jsonb_build_object(
          'resource_id',datasource_selection #>> '{resources,0,resource_id}',
          'resource_revision',(datasource_selection #>> '{resources,0,expected_revision}')::bigint,
          'resource_hash','sha256:' || pg_catalog.repeat('0',64))
        else defaults_revision.defaults_json -> 'datasource' end;
      snapshot_reference := defaults_revision.defaults_json -> 'schema_snapshot';
      if datasource_reference is null or datasource_reference = 'null'::jsonb
        or snapshot_reference is null or snapshot_reference = 'null'::jsonb then
        blocked_reason := 'DEFAULT_NOT_CONFIGURED';
      end if;
    end if;
  end if;
  if blocked_reason is null then
    begin
      selected_datasource_id := (datasource_reference ->> 'resource_id')::uuid;
      selected_datasource_revision := (datasource_reference ->> 'resource_revision')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_REVISION_INVALID';
    end;
    select datasource.* into datasource_record from app_data_agent.datasource_connections datasource
    where datasource.app_id = authority.app_id and datasource.tenant_id = authority.tenant_id
      and datasource.environment = authority.environment and datasource.datasource_id = selected_datasource_id for share;
    if not found then blocked_reason := 'RESOURCE_NOT_FOUND_OR_FORBIDDEN';
    elsif datasource_record.status <> 'ACTIVE' then blocked_reason := 'RESOURCE_DISABLED';
    else
      datasource_hash := platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'datasource_id',datasource_record.datasource_id,'datasource_type',datasource_record.datasource_type,
        'status',datasource_record.status,'resource_version',datasource_record.resource_version));
      if selected_datasource_revision <> datasource_record.resource_version
        or (datasource_selection ->> 'mode' = 'INHERIT_DEFAULT'
          and datasource_reference ->> 'resource_hash' <> datasource_hash) then
        blocked_reason := 'RESOURCE_REVISION_MISMATCH';
      elsif datasource_selection ->> 'mode' = 'RESOURCE_IDS' then
        datasource_reference := datasource_reference || pg_catalog.jsonb_build_object(
          'resource_hash',datasource_hash);
      end if;
    end if;
  end if;
  if blocked_reason is null then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('resource_kind','DATASOURCE','mention_id',null,
        'requested_resource_id',selected_datasource_id,
        'requested_revision',selected_datasource_revision,
        'effective_resource',datasource_reference,'source',
        case when datasource_selection ->> 'mode' = 'RESOURCE_IDS' then 'OVERRIDE' else 'DEFAULT' end,
        'availability','AVAILABLE','unavailable_reason',null));
  end if;
  if blocked_reason is null then
    select snapshot.* into snapshot_record from catalog.physical_schema_snapshot snapshot
    where snapshot.app_id = authority.app_id and snapshot.tenant_id = authority.tenant_id
      and snapshot.environment = authority.environment and snapshot.datasource_connection_id = selected_datasource_id
      and snapshot.snapshot_content_hash = snapshot_reference ->> 'resource_hash'
      and (snapshot_reference ->> 'resource_revision')::bigint = 1
      and exists (select 1 from catalog.schema_scan_run scan
        where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
          and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
          and scan.datasource_fingerprint = snapshot.datasource_fingerprint
          and scan.snapshot_content_hash = snapshot.snapshot_content_hash and scan.terminal = 'SUCCEEDED'
          and scan.snapshot_id = (snapshot_reference ->> 'resource_id')::uuid)
    order by snapshot.committed_at desc limit 1 for share;
    if not found then blocked_reason := 'SCHEMA_SNAPSHOT_STALE'; end if;
  end if;

  if blocked_reason is null then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
        'requested_resource_id',snapshot_reference -> 'resource_id',
        'requested_revision',(snapshot_reference ->> 'resource_revision')::bigint,
        'effective_resource',snapshot_reference,'source','DEFAULT',
        'availability','AVAILABLE','unavailable_reason',null));
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
      where binding.document ->> 'resource_kind' in ('FILE','KNOWLEDGE')
    ) then
      -- U9/U10 file/knowledge Authority is not present in U2. Never turn caller
      -- references into AVAILABLE bootstrap input merely because they are well formed.
      blocked_reason := 'RESOURCE_NOT_FOUND_OR_FORBIDDEN';
      bootstrap_document := null;
    else
      source_resources := '[]'::jsonb;
      bootstrap_document := pg_catalog.jsonb_build_object(
        'schema_version','semantic-bootstrap-job-config@1.0.0','scope',scope_document,
        'job_id',requested_job_id,'operation','SEMANTIC_BOOTSTRAP_JOB','request_hash',request_hash,
        'defaults_ref',defaults_ref,'authority_binding',authority_binding,'datasource',datasource_reference,
        'semantic_release',null,'schema_snapshot',snapshot_reference || pg_catalog.jsonb_build_object(
          'datasource_id',selected_datasource_id),'source_resources',source_resources,
        'resource_bindings',resource_bindings);
      if requested_config ? 'trigger_question_run_id' then
        bootstrap_document := bootstrap_document || pg_catalog.jsonb_build_object(
          'trigger_question_run_id',(requested_config ->> 'trigger_question_run_id')::uuid);
      end if;
    end if;
  end if;
  if blocked_reason is not null
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
      where binding.document ->> 'availability' = 'UNAVAILABLE'
        and binding.document ->> 'resource_kind' in ('DATASOURCE','SCHEMA_SNAPSHOT')
        and binding.document ->> 'unavailable_reason' = blocked_reason
    )
    and not (
      blocked_reason = 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
        where binding.document ->> 'availability' = 'UNAVAILABLE'
          and binding.document ->> 'resource_kind' in ('FILE','KNOWLEDGE')
          and binding.document ->> 'unavailable_reason' = blocked_reason
      )
    )
  then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(case
      when blocked_reason = 'SCHEMA_SNAPSHOT_STALE' then pg_catalog.jsonb_build_object(
        'resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
        'requested_resource_id',snapshot_reference -> 'resource_id',
        'requested_revision',case when snapshot_reference is null then null
          else (snapshot_reference ->> 'resource_revision')::bigint end,
        'effective_resource',null,'source','DEFAULT','availability','UNAVAILABLE',
        'unavailable_reason',blocked_reason)
      else app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,datasource_reference,'DATASOURCE',blocked_reason)
      end);
  end if;
  select coalesce(pg_catalog.jsonb_agg(binding.document order by
    binding.document ->> 'resource_kind',
    coalesce(binding.document #>> '{effective_resource,resource_id}',
      binding.document ->> 'requested_resource_id','NONE')),'[]'::jsonb)
    into resource_bindings
  from pg_catalog.jsonb_array_elements(resource_bindings) binding(document);
  if bootstrap_document is not null then
    bootstrap_document := pg_catalog.jsonb_set(
      bootstrap_document,'{resource_bindings}',resource_bindings);
  end if;
  if blocked_reason is not null then
    select coalesce(pg_catalog.jsonb_agg(reason.name order by reason.ordinal),'[]'::jsonb)
      into unavailable_reasons
    from (values
      ('EXPLICITLY_CLEARED',1),('DEFAULT_NOT_CONFIGURED',2),('DEFAULT_REMOVED',3),
      ('RESOURCE_NOT_FOUND_OR_FORBIDDEN',4),('RESOURCE_DISABLED',5),
      ('RESOURCE_REVISION_MISMATCH',6),('RESOURCE_REVOKED',7),
      ('RESOURCE_KIND_MISMATCH',8),('MODEL_NOT_AVAILABLE',9),
      ('SEMANTIC_RELEASE_NOT_PUBLISHED',10),('SCHEMA_SNAPSHOT_STALE',11),
      ('POLICY_REJECTED',12),('EGRESS_PROVIDER_DENIED',13),
      ('EGRESS_AUDIENCE_DENIED',14),('MENTION_RESOURCE_ID_REQUIRED',15)
    ) reason(name,ordinal)
    where exists (
      select 1 from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
      where binding.document ->> 'availability' = 'UNAVAILABLE'
        and binding.document ->> 'unavailable_reason' = reason.name
    );
  end if;
  resolution_document := pg_catalog.jsonb_build_object(
    'schema_version','run-config-resolution-receipt@1.0.0','resolution_id',requested_job_id,
    'scope',scope_document,'request_hash',request_hash,'defaults_ref',defaults_ref,
    'authority_binding',authority_binding,'resource_bindings',resource_bindings,
    'optional_selection_evaluations',app_data_agent.build_optional_selection_evaluations(
      requested_config,defaults_ref,resource_bindings),
    'resolved_at',app_data_agent.runtime_iso_timestamp(resolved_at),
    'job_id',requested_job_id,'operation','SEMANTIC_BOOTSTRAP_JOB',
    'admission',case when blocked_reason is null then 'READY' else 'BLOCKED' end,
    'unavailable_reasons',unavailable_reasons,
    'effective_config_ref',null,'required_action',null,
    'bootstrap_job_config',bootstrap_document);
  if requested_config ? 'trigger_question_run_id' then
    resolution_document := resolution_document || pg_catalog.jsonb_build_object(
      'trigger_question_run_id',(requested_config ->> 'trigger_question_run_id')::uuid);
  end if;
  return resolution_document || pg_catalog.jsonb_build_object(
    'resolution_hash',platform.canonical_sha256(resolution_document));
end
$function$;

create function app_data_agent.accept_question_run_with_effective_config(
  requested_command jsonb,
  requested_config jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  app_user_record app_data_agent.app_users%rowtype;
  workspace_record app_data_agent.workspaces%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  existing_receipt app_data_agent.effective_run_config_receipts%rowtype;
  conversation_record app_data_agent.qa_conversations%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  domain_record semantic.semantic_domain_registry%rowtype;
  active_pointer semantic.semantic_active_pointer%rowtype;
  release_record semantic.semantic_source_release%rowtype;
  snapshot_record catalog.physical_schema_snapshot%rowtype;
  requested_run_id uuid;
  requested_config_id uuid;
  requested_resolution_id uuid;
  requested_context_receipt_id uuid;
  requested_conversation_id uuid;
  requested_conversation_version bigint;
  requested_defaults_id uuid;
  requested_defaults_revision bigint;
  requested_idempotency_key text;
  request_hash text;
  scope_document jsonb;
  defaults_ref jsonb;
  authority_binding jsonb;
  route_resolution_hash text;
  resource_bindings jsonb := '[]'::jsonb;
  resolved_at timestamptz;
  model_selection jsonb;
  datasource_selection jsonb;
  selected_model_reference jsonb;
  selected_datasource_reference jsonb;
  semantic_reference jsonb;
  snapshot_reference jsonb;
  context_reference jsonb;
  egress_reference jsonb;
  safety_reference jsonb;
  effective_model jsonb;
  effective_semantic jsonb;
  effective_snapshot jsonb;
  effective_context jsonb;
  effective_egress_policy jsonb;
  effective_safety jsonb;
  effective_egress jsonb;
  selected_model_profile_id uuid;
  selected_datasource_id uuid;
  model_expected_revision bigint;
  datasource_expected_revision bigint;
  datasource_revision_hash text;
  model_revision_hash text;
  config_document jsonb;
  config_hash text;
  config_ref jsonb;
  context_document jsonb;
  context_resource_refs jsonb;
  context_hash text;
  acceptance_result jsonb;
  accepted_payload jsonb;
  accepted_payload_hash text;
  accepted_command jsonb;
  accepted_event jsonb;
  accepted_event_hash text;
  commit_at timestamptz;
  mandatory_blocked_reason text;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.effective_config_request_is_valid(requested_config)
    or requested_config ->> 'operation' <> 'QUESTION_RUN'
    or pg_catalog.jsonb_typeof(requested_command) <> 'object'
    or not requested_command ?& array[
      'run_id','command_id','event_id','outbox_id','audit_id','idempotency_key','question']
    or (select pg_catalog.count(*) <> 7 from pg_catalog.jsonb_object_keys(requested_command))
    or exists (select 1 from pg_catalog.jsonb_object_keys(requested_command) key(name)
      where key.name not in ('run_id','command_id','event_id','outbox_id','audit_id','idempotency_key','question'))
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'run_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'command_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'event_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'outbox_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'audit_id')
    or pg_catalog.jsonb_typeof(requested_command -> 'question') <> 'string'
    or requested_command ->> 'question' <> pg_catalog.btrim(requested_command ->> 'question')
    or pg_catalog.length(pg_catalog.btrim(requested_command ->> 'question')) not between 1 and 4000
    or requested_command ? 'payload'
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  begin
    requested_run_id := (requested_config ->> 'run_id')::uuid;
    requested_config_id := (requested_command ->> 'command_id')::uuid;
    requested_resolution_id := (requested_command ->> 'event_id')::uuid;
    requested_context_receipt_id := (requested_command ->> 'outbox_id')::uuid;
    requested_conversation_id := (requested_config #>> '{conversation_ref,conversation_id}')::uuid;
    requested_conversation_version := (requested_config #>> '{conversation_ref,expected_resource_version}')::bigint;
    requested_defaults_id := (requested_config #>> '{defaults_ref,defaults_id}')::uuid;
    requested_defaults_revision := (requested_config #>> '{defaults_ref,defaults_revision}')::bigint;
    resolved_at := pg_catalog.clock_timestamp();
  exception when others then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end;
  requested_idempotency_key := requested_config ->> 'idempotency_key';
  request_hash := requested_config ->> 'request_hash';
  defaults_ref := requested_config -> 'defaults_ref';
  if request_hash <> platform.canonical_sha256(requested_config - 'request_hash')
    or requested_command ->> 'run_id' <> requested_run_id::text
    or requested_command ->> 'idempotency_key' <> requested_idempotency_key
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  resource_bindings := app_data_agent.build_requested_optional_resource_bindings(requested_config);
  model_selection := requested_config #> '{overrides,model}';
  datasource_selection := requested_config #> '{overrides,datasource}';

  select * into strict authority from platform.current_backend_authority(true);
  if requested_config ->> 'workspace_id' <> authority.tenant_id::text then
    raise exception using errcode = '42501', message = 'EFFECTIVE_CONFIG_REQUEST_SCOPE_MISMATCH';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:idempotency:' || authority.app_id::text || ':' || authority.tenant_id::text || ':' ||
    authority.environment || ':' || authority.principal_id::text || ':' || requested_idempotency_key,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:' || authority.app_id::text || ':' || authority.tenant_id::text || ':' ||
    authority.environment || ':' || requested_run_id::text,0));

  select * into strict app_user_record from app_data_agent.app_users as app_user
  where app_user.app_id = authority.app_id and app_user.environment = authority.environment
    and app_user.principal_id = authority.principal_id and app_user.status = 'ACTIVE' for share;
  select * into strict workspace_record from app_data_agent.workspaces as workspace
  where workspace.app_id = authority.app_id and workspace.workspace_id = authority.tenant_id
    and workspace.environment = authority.environment and workspace.lifecycle = 'ACTIVE' for share;
  select conversation.* into conversation_record
  from app_data_agent.qa_conversations as conversation
  where conversation.app_id = authority.app_id
    and conversation.tenant_id = authority.tenant_id
    and conversation.environment = authority.environment
    and conversation.conversation_id = requested_conversation_id
    and conversation.owner_principal_id = authority.principal_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CONVERSATION_NOT_FOUND_OR_DENIED';
  end if;
  if conversation_record.resource_version <> requested_conversation_version then
    raise exception using errcode = '40001', message = 'CONVERSATION_RESOURCE_VERSION_CONFLICT';
  end if;

  scope_document := pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment,
    'workspace_id',authority.tenant_id,'principal_id',authority.principal_id);
  route_resolution_hash := platform.canonical_sha256(pg_catalog.jsonb_build_object(
    'schema_version','effective-config-route-resolution@1.0.0',
    'route_resolution_id',requested_config_id,'scope',scope_document,
    'operation','QUESTION_RUN','request_hash',request_hash));
  authority_binding := pg_catalog.jsonb_build_object(
    'authz_epoch',app_user_record.authz_epoch,
    'membership_version',authority.membership_version,
    'workspace_lifecycle_version',workspace_record.lifecycle_version,
    'route_resolution_id',requested_config_id,
    'route_resolution_hash',route_resolution_hash,
    'resolver_policy_version','effective-config-resolver@1.0.0');

  select receipt.* into existing_receipt
  from app_data_agent.effective_run_config_receipts as receipt
  where receipt.app_id = authority.app_id and receipt.tenant_id = authority.tenant_id
    and receipt.environment = authority.environment and receipt.principal_id = authority.principal_id
    and receipt.idempotency_key = requested_idempotency_key;
  if found then
    if existing_receipt.request_hash <> request_hash or existing_receipt.config_id <> requested_config_id
      or existing_receipt.run_id <> requested_run_id
      or not exists (
        select 1 from app_data_agent.runs as accepted_run
        where accepted_run.app_id = existing_receipt.app_id
          and accepted_run.tenant_id = existing_receipt.tenant_id
          and accepted_run.environment = existing_receipt.environment
          and accepted_run.run_id = existing_receipt.run_id
          and accepted_run.principal_id = existing_receipt.principal_id
          and accepted_run.question = requested_command ->> 'question'
      )
      or not exists (
        select 1 from app_data_agent.run_events as accepted_event
        where accepted_event.app_id = existing_receipt.app_id
          and accepted_event.tenant_id = existing_receipt.tenant_id
          and accepted_event.environment = existing_receipt.environment
          and accepted_event.event_id = requested_resolution_id
          and accepted_event.run_id = existing_receipt.run_id
          and accepted_event.command_id = existing_receipt.config_id
          and accepted_event.sequence = 1
          and accepted_event.event_type = 'run.accepted'
      )
      or not exists (
        select 1 from app_data_agent.effective_config_context_receipts as accepted_context
        where accepted_context.app_id = existing_receipt.app_id
          and accepted_context.tenant_id = existing_receipt.tenant_id
          and accepted_context.environment = existing_receipt.environment
          and accepted_context.context_receipt_id = requested_context_receipt_id
          and accepted_context.config_id = existing_receipt.config_id
          and accepted_context.config_revision = existing_receipt.config_revision
          and accepted_context.config_hash = existing_receipt.config_hash
          and accepted_context.run_id = existing_receipt.run_id
          and accepted_context.principal_id = existing_receipt.principal_id
          and accepted_context.consumer_kind = 'RUN_ACCEPTANCE'
          and accepted_context.consumer_id = existing_receipt.config_id::text
          and accepted_context.outbox_id = requested_context_receipt_id
          and accepted_context.command_id = existing_receipt.config_id
      )
      or not exists (
        select 1 from app_data_agent.outbox as accepted_outbox
        where accepted_outbox.app_id = existing_receipt.app_id
          and accepted_outbox.tenant_id = existing_receipt.tenant_id
          and accepted_outbox.environment = existing_receipt.environment
          and accepted_outbox.outbox_id = requested_context_receipt_id
          and accepted_outbox.run_id = existing_receipt.run_id
          and accepted_outbox.command_id = existing_receipt.config_id
          and accepted_outbox.topic = 'run.command.accepted'
      )
      or not exists (
        select 1 from app_data_agent.audit_log as accepted_audit
        where accepted_audit.app_id = existing_receipt.app_id
          and accepted_audit.tenant_id = existing_receipt.tenant_id
          and accepted_audit.environment = existing_receipt.environment
          and accepted_audit.audit_id = (requested_command ->> 'audit_id')::uuid
          and accepted_audit.principal_id = existing_receipt.principal_id
          and accepted_audit.action = 'RUN_COMMAND_ACCEPTED'
          and accepted_audit.resource_type = 'run'
          and accepted_audit.resource_id = existing_receipt.run_id::text
          and accepted_audit.details ->> 'command_id' = existing_receipt.config_id::text
      )
      or not exists (
        select 1 from app_data_agent.workspace_run_bindings as accepted_binding
        where accepted_binding.app_id = existing_receipt.app_id
          and accepted_binding.tenant_id = existing_receipt.tenant_id
          and accepted_binding.environment = existing_receipt.environment
          and accepted_binding.run_id = existing_receipt.run_id
          and accepted_binding.datasource_id = existing_receipt.datasource_id
          and accepted_binding.conversation_id = requested_conversation_id
          and accepted_binding.principal_id = existing_receipt.principal_id
          and accepted_binding.model_profile_id = existing_receipt.model_profile_id
          and accepted_binding.model_config_version = existing_receipt.model_config_version
      )
      or not exists (
        select 1 from app_data_agent.qa_messages as accepted_message
        where accepted_message.app_id = existing_receipt.app_id
          and accepted_message.tenant_id = existing_receipt.tenant_id
          and accepted_message.environment = existing_receipt.environment
          and accepted_message.conversation_id = requested_conversation_id
          and accepted_message.message_id = requested_resolution_id
          and accepted_message.owner_principal_id = existing_receipt.principal_id
          and accepted_message.role = 'user'
          and accepted_message.content = requested_command ->> 'question'
          and accepted_message.message_type = 'text'
          and accepted_message.run_id = existing_receipt.run_id
      ) then
      raise exception using errcode = '23505', message = 'EFFECTIVE_CONFIG_IDEMPOTENCY_CONFLICT';
    end if;
    select coalesce(pg_catalog.jsonb_agg(binding.binding_json order by binding.binding_ordinal),'[]'::jsonb)
      into resource_bindings
    from app_data_agent.effective_run_config_resource_bindings as binding
    where binding.app_id = existing_receipt.app_id and binding.tenant_id = existing_receipt.tenant_id
      and binding.environment = existing_receipt.environment and binding.config_id = existing_receipt.config_id
      and binding.config_revision = existing_receipt.config_revision;
    return pg_catalog.jsonb_set(app_data_agent.build_question_run_config_resolution(
      requested_resolution_id,existing_receipt.effective_config_json -> 'scope',requested_run_id,requested_config -> 'conversation_ref',request_hash,
      existing_receipt.effective_config_json -> 'defaults_ref',
      existing_receipt.effective_config_json -> 'authority_binding',resource_bindings,
      requested_config,existing_receipt.committed_at,'READY',null,
      pg_catalog.jsonb_build_object('config_id',existing_receipt.config_id,
        'config_revision',existing_receipt.config_revision,'config_hash',existing_receipt.config_hash)),
      '{effective_config}',existing_receipt.effective_config_json || pg_catalog.jsonb_build_object(
        'config_hash',existing_receipt.config_hash));
  end if;
  if exists (select 1 from app_data_agent.idempotency_records as idempotency
    where idempotency.app_id = authority.app_id and idempotency.tenant_id = authority.tenant_id
      and idempotency.environment = authority.environment and idempotency.principal_id = authority.principal_id
      and idempotency.idempotency_key = requested_idempotency_key) then
    raise exception using errcode = '23505', message = 'EFFECTIVE_CONFIG_IDEMPOTENCY_CONFLICT';
  end if;

  select pointer.* into defaults_pointer from app_data_agent.workspace_run_defaults as pointer
  where pointer.app_id = authority.app_id and pointer.tenant_id = authority.tenant_id
    and pointer.environment = authority.environment for share;
  if not found then
    resource_bindings := resource_bindings ||
      app_data_agent.build_inherited_optional_resource_bindings(requested_config,null);
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,null,'DATASOURCE','DEFAULT_NOT_CONFIGURED'),
      app_data_agent.build_unavailable_singleton_resource_binding(
        model_selection,null,'MODEL_PROFILE','DEFAULT_NOT_CONFIGURED'));
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','DEFAULT_NOT_CONFIGURED',null);
  end if;
  if defaults_pointer.defaults_id <> requested_defaults_id
    or defaults_pointer.defaults_revision <> requested_defaults_revision
    or defaults_pointer.defaults_hash <> requested_config #>> '{defaults_ref,defaults_hash}' then
    resource_bindings := resource_bindings ||
      app_data_agent.build_inherited_optional_resource_bindings(requested_config,null);
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,null,'DATASOURCE','DEFAULT_REMOVED'),
      app_data_agent.build_unavailable_singleton_resource_binding(
        model_selection,null,'MODEL_PROFILE','DEFAULT_REMOVED'));
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','DEFAULT_REMOVED',null);
  end if;
  select revision.* into strict defaults_revision
  from app_data_agent.workspace_run_default_revisions as revision
  where revision.app_id = defaults_pointer.app_id and revision.tenant_id = defaults_pointer.tenant_id
    and revision.environment = defaults_pointer.environment and revision.defaults_id = defaults_pointer.defaults_id
    and revision.defaults_revision = defaults_pointer.defaults_revision
    and revision.revision_id = defaults_pointer.revision_id and revision.defaults_hash = defaults_pointer.defaults_hash
  for share;
  resource_bindings := resource_bindings ||
    app_data_agent.build_inherited_optional_resource_bindings(
      requested_config,defaults_revision.defaults_json);
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
    group by binding.document ->> 'resource_kind',binding.document ->> 'requested_resource_id'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_DUPLICATE';
  end if;

  selected_model_reference := case when model_selection ->> 'mode' = 'EXPLICIT_NONE'
    then null when model_selection ->> 'mode' = 'RESOURCE_IDS'
    then pg_catalog.jsonb_build_object('resource_id',model_selection #>> '{resources,0,resource_id}',
      'resource_revision',(model_selection #>> '{resources,0,expected_revision}')::bigint,
      'resource_hash','sha256:' || pg_catalog.repeat('0',64))
    else defaults_revision.defaults_json -> 'model' end;
  selected_datasource_reference := case when datasource_selection ->> 'mode' = 'EXPLICIT_NONE'
    then null when datasource_selection ->> 'mode' = 'RESOURCE_IDS'
    then pg_catalog.jsonb_build_object('resource_id',datasource_selection #>> '{resources,0,resource_id}',
      'resource_revision',(datasource_selection #>> '{resources,0,expected_revision}')::bigint,
      'resource_hash','sha256:' || pg_catalog.repeat('0',64))
    else defaults_revision.defaults_json -> 'datasource' end;

  if datasource_selection ->> 'mode' = 'EXPLICIT_NONE' then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,null,'DATASOURCE','EXPLICITLY_CLEARED'));
    mandatory_blocked_reason := 'EXPLICITLY_CLEARED';
  elsif selected_datasource_reference is null or selected_datasource_reference = 'null'::jsonb then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,null,'DATASOURCE','DEFAULT_NOT_CONFIGURED'));
    mandatory_blocked_reason := 'DEFAULT_NOT_CONFIGURED';
  else
    begin
      selected_datasource_id := (selected_datasource_reference ->> 'resource_id')::uuid;
      datasource_expected_revision := (selected_datasource_reference ->> 'resource_revision')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_REVISION_INVALID';
    end;
    select datasource.* into datasource_record from app_data_agent.datasource_connections as datasource
    where datasource.app_id = authority.app_id and datasource.tenant_id = authority.tenant_id
      and datasource.environment = authority.environment and datasource.datasource_id = selected_datasource_id for share;
    if not found then
      resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
        app_data_agent.build_unavailable_singleton_resource_binding(
          datasource_selection,selected_datasource_reference,
          'DATASOURCE','RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
      mandatory_blocked_reason := 'RESOURCE_NOT_FOUND_OR_FORBIDDEN';
    elsif datasource_record.status <> 'ACTIVE' then
      resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
        app_data_agent.build_unavailable_singleton_resource_binding(
          datasource_selection,selected_datasource_reference,'DATASOURCE','RESOURCE_DISABLED'));
      mandatory_blocked_reason := 'RESOURCE_DISABLED';
    else
      datasource_revision_hash := platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'datasource_id',datasource_record.datasource_id,'datasource_type',datasource_record.datasource_type,
        'status',datasource_record.status,'resource_version',datasource_record.resource_version));
      if datasource_expected_revision <> datasource_record.resource_version
        or (datasource_selection ->> 'mode' = 'INHERIT_DEFAULT'
          and selected_datasource_reference ->> 'resource_hash' <> datasource_revision_hash) then
        resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
          app_data_agent.build_unavailable_singleton_resource_binding(
            datasource_selection,selected_datasource_reference,
            'DATASOURCE','RESOURCE_REVISION_MISMATCH'));
        mandatory_blocked_reason := 'RESOURCE_REVISION_MISMATCH';
      else
        if datasource_selection ->> 'mode' = 'RESOURCE_IDS' then
          selected_datasource_reference := selected_datasource_reference || pg_catalog.jsonb_build_object(
            'resource_hash',datasource_revision_hash);
        end if;
        resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_kind','DATASOURCE','mention_id',null,
          'requested_resource_id',selected_datasource_reference -> 'resource_id',
          'requested_revision',(selected_datasource_reference ->> 'resource_revision')::bigint,
          'effective_resource',selected_datasource_reference,'source',
          case when datasource_selection ->> 'mode' = 'RESOURCE_IDS' then 'OVERRIDE' else 'DEFAULT' end,
          'availability','AVAILABLE','unavailable_reason',null));
      end if;
    end if;
  end if;

  if model_selection ->> 'mode' = 'EXPLICIT_NONE' then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        model_selection,null,'MODEL_PROFILE','EXPLICITLY_CLEARED'));
    mandatory_blocked_reason := coalesce(mandatory_blocked_reason,'EXPLICITLY_CLEARED');
  elsif selected_model_reference is null or selected_model_reference = 'null'::jsonb then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        model_selection,null,'MODEL_PROFILE','DEFAULT_NOT_CONFIGURED'));
    mandatory_blocked_reason := coalesce(mandatory_blocked_reason,'DEFAULT_NOT_CONFIGURED');
  else
    begin
      selected_model_profile_id := (selected_model_reference ->> 'resource_id')::uuid;
      model_expected_revision := (selected_model_reference ->> 'resource_revision')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_REVISION_INVALID';
    end;
    select catalog.* into model_record from platform.list_active_model_catalog(
      authority.deployment_id,authority.principal_id) as catalog
    where catalog.model_profile_id = selected_model_profile_id and catalog.config_version = model_expected_revision;
    if not found then
      resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
        app_data_agent.build_unavailable_singleton_resource_binding(
          model_selection,selected_model_reference,'MODEL_PROFILE','MODEL_NOT_AVAILABLE'));
      mandatory_blocked_reason := coalesce(mandatory_blocked_reason,'MODEL_NOT_AVAILABLE');
    else
      model_revision_hash := platform.canonical_sha256(pg_catalog.to_jsonb(model_record) - 'credential_ref');
      if model_selection ->> 'mode' = 'INHERIT_DEFAULT'
        and selected_model_reference ->> 'resource_hash' <> model_revision_hash then
        resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
          app_data_agent.build_unavailable_singleton_resource_binding(
            model_selection,selected_model_reference,'MODEL_PROFILE','RESOURCE_REVISION_MISMATCH'));
        mandatory_blocked_reason := coalesce(mandatory_blocked_reason,'RESOURCE_REVISION_MISMATCH');
      else
        if model_selection ->> 'mode' = 'RESOURCE_IDS' then
          selected_model_reference := selected_model_reference || pg_catalog.jsonb_build_object(
            'resource_hash',model_revision_hash);
        end if;
        resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_kind','MODEL_PROFILE','mention_id',null,
          'requested_resource_id',selected_model_reference -> 'resource_id',
          'requested_revision',(selected_model_reference ->> 'resource_revision')::bigint,
          'effective_resource',selected_model_reference,'source',
          case when model_selection ->> 'mode' = 'RESOURCE_IDS' then 'OVERRIDE' else 'DEFAULT' end,
          'availability','AVAILABLE','unavailable_reason',null));
      end if;
    end if;
  end if;

  if mandatory_blocked_reason is not null then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED',mandatory_blocked_reason,null);
  end if;
  if conversation_record.datasource_id is distinct from selected_datasource_id
    or (conversation_record.model_profile_id is not null
      and conversation_record.model_profile_id is distinct from selected_model_profile_id) then
    raise exception using errcode = '23514', message = 'CONVERSATION_RESOURCE_MISMATCH';
  end if;

  snapshot_reference := defaults_revision.defaults_json -> 'schema_snapshot';
  if snapshot_reference is null or snapshot_reference = 'null'::jsonb then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
      'source','DEFAULT','availability','UNAVAILABLE','unavailable_reason','SCHEMA_SNAPSHOT_STALE'));
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','SCHEMA_SNAPSHOT_STALE',null);
  end if;
  select snapshot.* into snapshot_record from catalog.physical_schema_snapshot as snapshot
  where snapshot.app_id = authority.app_id and snapshot.tenant_id = authority.tenant_id
    and snapshot.environment = authority.environment and snapshot.datasource_connection_id = selected_datasource_id
    and snapshot.snapshot_content_hash = snapshot_reference ->> 'resource_hash'
    and (snapshot_reference ->> 'resource_revision')::bigint = 1
    and exists (select 1 from catalog.schema_scan_run scan
      where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
        and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
        and scan.datasource_fingerprint = snapshot.datasource_fingerprint
        and scan.snapshot_content_hash = snapshot.snapshot_content_hash and scan.terminal = 'SUCCEEDED'
        and scan.snapshot_id = (snapshot_reference ->> 'resource_id')::uuid)
  order by snapshot.committed_at desc limit 1 for share;
  if not found then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
      'requested_resource_id',snapshot_reference -> 'resource_id',
      'requested_revision',(snapshot_reference ->> 'resource_revision')::bigint,
      'effective_resource',null,'source','DEFAULT','availability','UNAVAILABLE',
      'unavailable_reason','SCHEMA_SNAPSHOT_STALE'));
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','SCHEMA_SNAPSHOT_STALE',null);
  end if;

  context_reference := defaults_revision.defaults_json -> 'context_policy';
  egress_reference := defaults_revision.defaults_json -> 'egress_policy';
  safety_reference := defaults_revision.defaults_json -> 'execution_safety_policy';
  effective_context := app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY');
  effective_egress_policy := app_data_agent.builtin_effective_config_policy('EGRESS_POLICY');
  effective_safety := app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY');

  resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('resource_kind','CONTEXT_POLICY','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',context_reference,
      'source','POLICY','availability','AVAILABLE','unavailable_reason',null),
    pg_catalog.jsonb_build_object('resource_kind','EGRESS_POLICY','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',egress_reference,
      'source','POLICY','availability','AVAILABLE','unavailable_reason',null),
    pg_catalog.jsonb_build_object('resource_kind','EXECUTION_SAFETY_POLICY','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',safety_reference,
      'source','POLICY','availability','AVAILABLE','unavailable_reason',null),
    pg_catalog.jsonb_build_object('resource_kind','SEMANTIC_RELEASE','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
      'source','ACTIVE_POINTER','availability','UNAVAILABLE',
      'unavailable_reason','SEMANTIC_RELEASE_NOT_PUBLISHED')
  );

  semantic_reference := defaults_revision.defaults_json -> 'semantic_release';
  if semantic_reference is null or semantic_reference = 'null'::jsonb then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  end if;
  select domain.* into domain_record from semantic.semantic_domain_registry as domain
  where domain.app_id = authority.app_id and domain.tenant_id = authority.tenant_id
    and domain.environment = authority.environment and domain.datasource_id = selected_datasource_id
    and domain.is_active for share;
  if not found then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  end if;
  select pointer.* into active_pointer from semantic.semantic_active_pointer as pointer
  where pointer.app_id = authority.app_id and pointer.tenant_id = authority.tenant_id
    and pointer.environment = authority.environment and pointer.semantic_domain = domain_record.semantic_domain for share;
  if not found or active_pointer.current_release_id is null then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  end if;
  select release.* into release_record from semantic.semantic_source_release as release
  where release.app_id = active_pointer.app_id and release.tenant_id = active_pointer.tenant_id
    and release.environment = active_pointer.environment and release.semantic_domain = active_pointer.semantic_domain
    and release.release_id = active_pointer.current_release_id
    and release.release_generation = active_pointer.current_release_generation
    and release.release_digest = active_pointer.current_release_digest for share;
  if not found or semantic_reference ->> 'resource_id' <> release_record.release_id::text
    or (semantic_reference ->> 'resource_revision')::bigint <> release_record.release_generation
    or semantic_reference ->> 'resource_hash' <> release_record.release_digest then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  end if;

  effective_model := selected_model_reference || pg_catalog.jsonb_build_object(
    'provider',model_record.provider,'model_id',model_record.model_id,
    'profile_version','model-profile@' || model_record.config_version::text);
  effective_semantic := semantic_reference || pg_catalog.jsonb_build_object(
    'datasource_id',selected_datasource_id,'semantic_generation',release_record.release_generation,
    'publication_status','PUBLISHED');
  effective_snapshot := snapshot_reference || pg_catalog.jsonb_build_object(
    'datasource_id',selected_datasource_id,'semantic_release_id',release_record.release_id,
    'semantic_generation',release_record.release_generation);
  resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
      'requested_resource_id',snapshot_reference -> 'resource_id',
      'requested_revision',(snapshot_reference ->> 'resource_revision')::bigint,
      'effective_resource',snapshot_reference,'source','DEFAULT',
      'availability','AVAILABLE','unavailable_reason',null));
  select pg_catalog.jsonb_agg(case when binding.document ->> 'resource_kind' = 'SEMANTIC_RELEASE'
      then pg_catalog.jsonb_build_object('resource_kind','SEMANTIC_RELEASE','mention_id',null,
        'requested_resource_id',semantic_reference -> 'resource_id',
        'requested_revision',(semantic_reference ->> 'resource_revision')::bigint,
        'effective_resource',semantic_reference,'source','ACTIVE_POINTER',
        'availability','AVAILABLE','unavailable_reason',null)
      else binding.document end order by binding.ordinal)
  into resource_bindings
  from pg_catalog.jsonb_array_elements(resource_bindings) with ordinality binding(document,ordinal);

  effective_egress := coalesce(nullif(requested_config #> '{overrides,egress}','null'::jsonb),
    effective_egress_policy - array['resource_id','resource_revision','resource_hash']);
  if exists (select 1 from pg_catalog.jsonb_array_elements_text(effective_egress -> 'allowed_providers') value(name)
      where not (effective_egress_policy -> 'allowed_providers') ? value.name)
    or exists (select 1 from pg_catalog.jsonb_array_elements_text(effective_egress -> 'allowed_audiences') value(name)
      where not (effective_egress_policy -> 'allowed_audiences') ? value.name)
    or pg_catalog.array_position(array['PUBLIC','INTERNAL','RESTRICTED','SECRET'],
        effective_egress ->> 'classification')
      < pg_catalog.array_position(array['PUBLIC','INTERNAL','RESTRICTED','SECRET'],
        effective_egress_policy ->> 'classification') then
    select pg_catalog.jsonb_agg(case when binding.document ->> 'resource_kind' = 'EGRESS_POLICY'
        then pg_catalog.jsonb_build_object('resource_kind','EGRESS_POLICY','mention_id',null,
          'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
          'source','POLICY','availability','UNAVAILABLE','unavailable_reason','POLICY_REJECTED')
        else binding.document end order by binding.ordinal)
    into resource_bindings
    from pg_catalog.jsonb_array_elements(resource_bindings) with ordinality binding(document,ordinal);
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','POLICY_REJECTED',null);
  end if;
  if not (effective_egress -> 'allowed_providers') ? model_record.provider then
    select pg_catalog.jsonb_agg(case when binding.document ->> 'resource_kind' = 'EGRESS_POLICY'
        then pg_catalog.jsonb_build_object('resource_kind','EGRESS_POLICY','mention_id',null,
          'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
          'source','POLICY','availability','UNAVAILABLE','unavailable_reason','EGRESS_PROVIDER_DENIED')
        else binding.document end order by binding.ordinal)
    into resource_bindings
    from pg_catalog.jsonb_array_elements(resource_bindings) with ordinality binding(document,ordinal);
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','EGRESS_PROVIDER_DENIED',null);
  end if;

  select coalesce(pg_catalog.jsonb_agg(binding.document order by
    binding.document ->> 'resource_kind',
    coalesce(binding.document ->> 'requested_resource_id','NONE'),
    binding.document ->> 'source',
    coalesce(binding.document ->> 'mention_id','')),'[]'::jsonb)
    into resource_bindings
  from pg_catalog.jsonb_array_elements(resource_bindings) binding(document);
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
    where binding.document ->> 'availability' = 'AVAILABLE'
    group by binding.document #>> '{effective_resource,resource_id}'
    having pg_catalog.count(distinct binding.document -> 'effective_resource') > 1
  ) then
    raise exception using errcode = '23514', message = 'EFFECTIVE_CONFIG_RESOURCE_REFERENCE_CONFLICT';
  end if;
  select coalesce(pg_catalog.jsonb_agg(resource.document order by resource.document ->> 'resource_id',
      (resource.document ->> 'resource_revision')::bigint,resource.document ->> 'resource_hash'),'[]'::jsonb)
    into context_resource_refs
  from (
    select binding.document -> 'effective_resource' as document
    from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
    where binding.document ->> 'availability' = 'AVAILABLE'
    group by binding.document -> 'effective_resource'
  ) resource;
  commit_at := pg_catalog.clock_timestamp();
  config_document := pg_catalog.jsonb_build_object(
    'schema_version','effective-run-config-receipt@1.0.0',
    'config_id',requested_config_id,'config_revision',1,'scope',scope_document,
    'run_id',requested_run_id,'operation','QUESTION_RUN','admission','READY',
    'conversation_binding',pg_catalog.jsonb_build_object(
      'conversation_id',requested_conversation_id,'resource_version',requested_conversation_version),
    'request_hash',request_hash,'defaults_ref',defaults_ref,'authority_binding',authority_binding,
    'model',effective_model,'datasource',selected_datasource_reference,
    'semantic_release',effective_semantic,'schema_snapshot',effective_snapshot,
    'context_policy',effective_context,'egress_policy',effective_egress_policy,
    'execution_safety_policy',effective_safety,'resource_bindings',resource_bindings,
    'optional_selection_evaluations',app_data_agent.build_optional_selection_evaluations(
      requested_config,defaults_ref,resource_bindings),
    'effective_egress',effective_egress);
  config_hash := platform.canonical_sha256(config_document);
  config_ref := pg_catalog.jsonb_build_object(
    'config_id',requested_config_id,'config_revision',1,'config_hash',config_hash);

  insert into app_data_agent.effective_run_config_receipts (
    app_id,tenant_id,environment,config_id,config_revision,config_hash,run_id,principal_id,
    idempotency_key,request_hash,operation_kind,admission,defaults_revision,defaults_id,defaults_hash,
    membership_version,user_authz_epoch,workspace_lifecycle_version,app_epoch,route_resolution_id,
    route_resolution_hash,resolver_policy_version,model_profile_id,model_config_version,provider,model_id,
    datasource_id,datasource_revision_hash,schema_datasource_id,datasource_fingerprint,semantic_domain,
    semantic_release_id,semantic_release_generation,semantic_release_digest,schema_snapshot_hash,
    context_policy_hash,egress_policy_hash,execution_safety_policy_hash,provider_audience,classification,
    effective_config_json,committed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,requested_config_id,1,config_hash,
    requested_run_id,authority.principal_id,requested_idempotency_key,request_hash,'QUESTION_RUN','READY',
    defaults_revision.defaults_revision,defaults_revision.defaults_id,defaults_revision.defaults_hash,
    authority.membership_version,app_user_record.authz_epoch,workspace_record.lifecycle_version,
    authority.app_epoch,requested_config_id,route_resolution_hash,'effective-config-resolver@1.0.0',
    selected_model_profile_id,model_expected_revision,model_record.provider,model_record.model_id,
    selected_datasource_id,datasource_revision_hash,selected_datasource_id::text,
    snapshot_record.datasource_fingerprint,release_record.semantic_domain,release_record.release_id,
    release_record.release_generation,release_record.release_digest,snapshot_record.snapshot_content_hash,
    context_reference ->> 'resource_hash',egress_reference ->> 'resource_hash',
    safety_reference ->> 'resource_hash',effective_egress #>> '{allowed_audiences,0}',
    effective_egress ->> 'classification',config_document,commit_at);

  insert into app_data_agent.effective_run_config_resource_bindings (
    app_id,tenant_id,environment,config_id,config_revision,binding_ordinal,resource_kind,mention_id,resource_id,
    requested_mode,requested_revision,effective_revision,effective_hash,availability,unavailable_reason,
    binding_json,committed_at)
  select authority.app_id,authority.tenant_id,authority.environment,requested_config_id,1,
    binding.ordinal::integer,binding.document ->> 'resource_kind',
    (binding.document ->> 'mention_id')::uuid,
    coalesce(binding.document #>> '{effective_resource,resource_id}',binding.document ->> 'requested_resource_id','NONE'),
    case when binding.document ->> 'source' = 'MENTION' then 'MENTION'
      when binding.document ->> 'source' = 'OVERRIDE' and binding.document ->> 'requested_resource_id' is null
        then 'EXPLICIT_NONE'
      when binding.document ->> 'source' = 'OVERRIDE' then 'RESOURCE_IDS' else 'INHERIT_DEFAULT' end,
    coalesce(binding.document ->> 'requested_revision',binding.document #>> '{effective_resource,resource_revision}'),
    binding.document #>> '{effective_resource,resource_revision}',
    binding.document #>> '{effective_resource,resource_hash}',binding.document ->> 'availability',
    binding.document ->> 'unavailable_reason',binding.document,commit_at
  from pg_catalog.jsonb_array_elements(resource_bindings) with ordinality binding(document,ordinal);

  context_document := pg_catalog.jsonb_build_object(
    'schema_version','effective-config-context-receipt@1.0.0',
    'receipt_id',requested_context_receipt_id,'consumer','RUN_ACCEPTANCE','scope',scope_document,
    'outbox_id',requested_context_receipt_id,'command_id',requested_config_id,
    'consumer_id',requested_config_id::text,'attempt_id',null,'lease_token',null,'worker_fence',0,
    'run_id',requested_run_id,'config_ref',config_ref,'semantic_release',effective_semantic,
    'schema_snapshot',effective_snapshot,'context_policy',context_reference,
    'provider',model_record.provider,'audiences',effective_egress -> 'allowed_audiences',
    'classification',effective_egress ->> 'classification','resource_refs',context_resource_refs,
    'consumed_at',app_data_agent.runtime_iso_timestamp(commit_at));
  context_hash := platform.canonical_sha256(context_document);
  insert into app_data_agent.effective_config_context_receipts (
    app_id,tenant_id,environment,context_receipt_id,config_id,config_revision,config_hash,run_id,
    principal_id,consumer_kind,consumer_id,outbox_id,command_id,worker_fence,
    receipt_json,receipt_hash,consumed_at)
  values (authority.app_id,authority.tenant_id,authority.environment,requested_context_receipt_id,
    requested_config_id,1,config_hash,requested_run_id,authority.principal_id,'RUN_ACCEPTANCE',
    requested_config_id::text,requested_context_receipt_id,requested_config_id,0,
    context_document,context_hash,commit_at);

  accepted_payload := pg_catalog.jsonb_build_object(
    'kind','START_L2_RESEARCH','effective_config_ref',config_ref);
  accepted_payload_hash := platform.canonical_sha256(accepted_payload);
  accepted_command := requested_command || pg_catalog.jsonb_build_object('payload',accepted_payload);
  accepted_event := pg_catalog.jsonb_build_object(
    'schema_version','1.0.0','event_id',requested_resolution_id,
    'scope',pg_catalog.jsonb_build_object('app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment),
    'run_id',requested_run_id,'sequence',1,'worker_fence',0,
    'idempotency_key','event:' || requested_resolution_id::text,
    'occurred_at',app_data_agent.runtime_iso_timestamp(commit_at),
    'event_type','run.accepted','payload',pg_catalog.jsonb_build_object(
      'command_id',requested_config_id,'payload_hash',accepted_payload_hash));
  accepted_event_hash := app_data_agent.runtime_canonical_sha256(accepted_event);
  acceptance_result := app_data_agent.accept_backend_run_command(
    accepted_command,accepted_payload_hash,accepted_event,accepted_event_hash);
  insert into app_data_agent.workspace_run_bindings (
    app_id,tenant_id,environment,run_id,datasource_id,conversation_id,principal_id,
    model_profile_id,model_config_version,provider,model_id,datasource_binding_hash,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,requested_run_id,
    selected_datasource_id,requested_conversation_id,authority.principal_id,
    selected_model_profile_id,model_expected_revision,model_record.provider,model_record.model_id,
    datasource_revision_hash,commit_at
  );
  insert into app_data_agent.qa_messages (
    app_id,tenant_id,environment,conversation_id,message_id,owner_principal_id,
    role,content,message_type,run_id,metadata,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,requested_conversation_id,
    requested_resolution_id,authority.principal_id,'user',requested_command ->> 'question',
    'text',requested_run_id,pg_catalog.jsonb_build_object('source','QUESTION_RUN'),commit_at
  );
  return pg_catalog.jsonb_set(app_data_agent.build_question_run_config_resolution(
    requested_resolution_id,scope_document,requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,
    authority_binding,resource_bindings,requested_config,commit_at,'READY',null,config_ref),
    '{effective_config}',config_document || pg_catalog.jsonb_build_object('config_hash',config_hash));
end
$function$;
create function app_data_agent.revalidate_effective_run_config_internal(
  requested_config_id uuid,
  requested_config_revision bigint,
  requested_config_hash text,
  requested_run_id uuid,
  require_write boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  receipt app_data_agent.effective_run_config_receipts%rowtype;
  app_user_record app_data_agent.app_users%rowtype;
  workspace_record app_data_agent.workspaces%rowtype;
  defaults_history app_data_agent.workspace_run_default_revisions%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  datasource_current_hash text;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested_config_id is null
    or requested_config_revision <> 1
    or requested_config_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_run_id is null
    or require_write is null
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REFERENCE_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(require_write);
  select config.* into receipt
  from app_data_agent.effective_run_config_receipts as config
  where config.app_id = authority.app_id
    and config.tenant_id = authority.tenant_id
    and config.environment = authority.environment
    and config.principal_id = authority.principal_id
    and config.config_id = requested_config_id
    and config.config_revision = requested_config_revision
    and config.config_hash = requested_config_hash
    and config.run_id = requested_run_id;
  if not found then
    raise exception using errcode = '42501', message = 'EFFECTIVE_CONFIG_RECEIPT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if receipt.config_hash <> platform.canonical_sha256(receipt.effective_config_json) then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_TAMPERED';
  end if;

  select * into app_user_record
  from app_data_agent.app_users as app_user
  where app_user.app_id = receipt.app_id
    and app_user.environment = receipt.environment
    and app_user.principal_id = receipt.principal_id
    and app_user.status = 'ACTIVE'
  for share;
  select * into workspace_record
  from app_data_agent.workspaces as workspace
  where workspace.app_id = receipt.app_id
    and workspace.workspace_id = receipt.tenant_id
    and workspace.environment = receipt.environment
    and workspace.lifecycle = 'ACTIVE'
  for share;
  select * into defaults_history
  from app_data_agent.workspace_run_default_revisions as revision
  where revision.app_id = receipt.app_id
    and revision.tenant_id = receipt.tenant_id
    and revision.environment = receipt.environment
    and revision.defaults_id = receipt.defaults_id
    and revision.defaults_revision = receipt.defaults_revision
    and revision.defaults_hash = receipt.defaults_hash
  for share;
  if app_user_record.principal_id is null
    or workspace_record.workspace_id is null
    or defaults_history.tenant_id is null
    or authority.membership_version <> receipt.membership_version
    or authority.app_epoch <> receipt.app_epoch
    or app_user_record.authz_epoch <> receipt.user_authz_epoch
    or workspace_record.lifecycle_version <> receipt.workspace_lifecycle_version
  then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;

  select datasource.* into datasource_record
  from app_data_agent.datasource_connections as datasource
  where datasource.app_id = receipt.app_id
    and datasource.tenant_id = receipt.tenant_id
    and datasource.environment = receipt.environment
    and datasource.datasource_id = receipt.datasource_id
    and datasource.status = 'ACTIVE'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;
  perform 1
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = receipt.app_id
    and catalog.environment = receipt.environment
    and catalog.model_profile_id = receipt.model_profile_id
    and catalog.config_version = receipt.model_config_version
    and catalog.status = 'ACTIVE'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;
  datasource_current_hash := platform.canonical_sha256(pg_catalog.jsonb_build_object(
    'datasource_id',datasource_record.datasource_id,
    'datasource_type',datasource_record.datasource_type,
    'status',datasource_record.status,
    'resource_version',datasource_record.resource_version
  ));
  if datasource_current_hash <> receipt.datasource_revision_hash
    or (receipt.effective_config_json #>> '{datasource,resource_revision}')::bigint <>
      datasource_record.resource_version then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;

  select catalog.* into model_record
  from platform.list_active_model_catalog(authority.deployment_id, authority.principal_id) as catalog
  where catalog.model_profile_id = receipt.model_profile_id
    and catalog.config_version = receipt.model_config_version
    and catalog.provider = receipt.provider
    and catalog.model_id = receipt.model_id;
  if not found then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;
  if receipt.effective_config_json #>> '{model,resource_hash}' <>
      platform.canonical_sha256(pg_catalog.to_jsonb(model_record) - 'credential_ref')
    or not (receipt.effective_config_json #> '{effective_egress,allowed_providers}') ? model_record.provider
  then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;

  if not exists (
      select 1 from semantic.semantic_domain_registry domain
      where domain.app_id = receipt.app_id and domain.tenant_id = receipt.tenant_id
        and domain.environment = receipt.environment and domain.semantic_domain = receipt.semantic_domain
        and domain.datasource_id = receipt.datasource_id and domain.is_active
    )
    or not exists (
      select 1 from semantic.semantic_source_release release
      where release.app_id = receipt.app_id and release.tenant_id = receipt.tenant_id
        and release.environment = receipt.environment and release.semantic_domain = receipt.semantic_domain
        and release.release_id = receipt.semantic_release_id
        and release.release_generation = receipt.semantic_release_generation
        and release.release_digest = receipt.semantic_release_digest
    )
    or not exists (
      select 1 from catalog.physical_schema_snapshot as snapshot
      where snapshot.app_id = receipt.app_id
        and snapshot.tenant_id = receipt.tenant_id
        and snapshot.environment = receipt.environment
        and snapshot.datasource_connection_id = receipt.datasource_id
        and snapshot.datasource_fingerprint = receipt.datasource_fingerprint
        and snapshot.snapshot_content_hash = receipt.schema_snapshot_hash
        and (receipt.effective_config_json #>> '{schema_snapshot,resource_revision}')::bigint = 1
        and exists (select 1 from catalog.schema_scan_run scan
          where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
            and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
            and scan.datasource_fingerprint = snapshot.datasource_fingerprint
            and scan.snapshot_content_hash = snapshot.snapshot_content_hash and scan.terminal = 'SUCCEEDED'
            and scan.snapshot_id = (receipt.effective_config_json #>> '{schema_snapshot,resource_id}')::uuid)
    )
    or receipt.effective_config_json -> 'context_policy'
      <> app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY')
    or receipt.effective_config_json -> 'egress_policy'
      <> app_data_agent.builtin_effective_config_policy('EGRESS_POLICY')
    or receipt.effective_config_json -> 'execution_safety_policy'
      <> app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY')
  then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;

  return receipt.effective_config_json || pg_catalog.jsonb_build_object('config_hash',receipt.config_hash);
end
$function$;

create function app_data_agent.load_effective_run_config(
  requested_config_id uuid,
  requested_config_revision bigint,
  requested_config_hash text,
  requested_run_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select app_data_agent.revalidate_effective_run_config_internal(
    requested_config_id,requested_config_revision,requested_config_hash,
    requested_run_id,false
  );
$function$;

create function app_data_agent.consume_worker_effective_run_config(
  requested_context_receipt_id uuid,
  requested_config_id uuid,
  requested_config_revision bigint,
  requested_config_hash text,
  requested_run_id uuid,
  requested_consumer_id text,
  requested_attempt_id uuid,
  requested_worker_id text,
  requested_lease_token bigint,
  requested_worker_fence bigint,
  requested_outbox_id uuid,
  requested_command_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  loaded jsonb;
  existing_receipt app_data_agent.effective_config_context_receipts%rowtype;
  attempt_record app_data_agent.run_attempts%rowtype;
  current_fence bigint;
  receipt_document jsonb;
  receipt_hash text;
  consumed_at timestamptz;
  context_resource_refs jsonb;
begin
  if requested_context_receipt_id is null
    or requested_consumer_id is null
    or requested_consumer_id <> requested_worker_id
    or requested_consumer_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_attempt_id is null
    or requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_token is null or requested_lease_token < 1
    or requested_worker_fence is null
    or requested_worker_fence < 1
    or requested_outbox_id is null
    or requested_command_id is null
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  loaded := app_data_agent.revalidate_effective_run_config_internal(
    requested_config_id,requested_config_revision,requested_config_hash,
    requested_run_id,true
  );
  current_fence := app_data_agent.lock_owned_run_fence(requested_run_id);
  if current_fence is null or current_fence <> requested_worker_fence then
    raise exception using errcode = '40001', message = 'EFFECTIVE_CONFIG_WORKER_FENCE_STALE';
  end if;
  select attempt.* into attempt_record
  from app_data_agent.run_attempts attempt
  join app_data_agent.outbox message
    on message.app_id = attempt.app_id and message.tenant_id = attempt.tenant_id
   and message.environment = attempt.environment and message.outbox_id = attempt.outbox_id
   and message.run_id = attempt.run_id and message.command_id = attempt.command_id
  where attempt.app_id = authority.app_id and attempt.tenant_id = authority.tenant_id
    and attempt.environment = authority.environment and attempt.run_id = requested_run_id
    and attempt.attempt_id = requested_attempt_id and attempt.worker_id = requested_worker_id
    and attempt.lease_token = requested_lease_token and attempt.worker_fence = requested_worker_fence
    and attempt.outbox_id = requested_outbox_id and attempt.command_id = requested_command_id
    and attempt.status = 'ACTIVE' and attempt.lease_expires_at > pg_catalog.clock_timestamp()
    and message.status = 'LEASED' and message.active_attempt_id = requested_attempt_id
    and message.lease_owner = requested_worker_id and message.lease_token = requested_lease_token
    and message.run_fence = requested_worker_fence
    and message.lease_expires_at > pg_catalog.clock_timestamp()
  for update of attempt,message;
  if not found then
    raise exception using errcode = '40001', message = 'EFFECTIVE_CONFIG_WORKER_LEASE_STALE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:effective-config-consumption:' || authority.app_id::text || ':' ||
    authority.tenant_id::text || ':' || authority.environment || ':' ||
    requested_config_id::text || ':' || requested_consumer_id || ':' ||
    requested_attempt_id::text || ':' || requested_lease_token::text || ':' ||
    requested_worker_fence::text,
    0
  ));
  select context.* into existing_receipt
  from app_data_agent.effective_config_context_receipts as context
  where context.app_id = authority.app_id
    and context.tenant_id = authority.tenant_id
    and context.environment = authority.environment
    and context.config_id = requested_config_id
    and context.config_revision = requested_config_revision
    and context.consumer_kind = 'WORKER_START'
    and context.consumer_id = requested_consumer_id
    and context.attempt_id = requested_attempt_id
    and context.lease_token = requested_lease_token
    and context.worker_fence = requested_worker_fence;
  if found then
    if existing_receipt.context_receipt_id <> requested_context_receipt_id
      or existing_receipt.config_hash <> requested_config_hash
      or existing_receipt.run_id <> requested_run_id
      or existing_receipt.worker_fence <> requested_worker_fence
      or existing_receipt.attempt_id <> requested_attempt_id
      or existing_receipt.worker_id <> requested_worker_id
      or existing_receipt.lease_token <> requested_lease_token
      or existing_receipt.outbox_id <> requested_outbox_id
      or existing_receipt.command_id <> requested_command_id
    then
      raise exception using errcode = '23505', message = 'EFFECTIVE_CONFIG_WORKER_CONSUMPTION_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','effective-config-worker-consumption@1.0.0',
      'replayed',true,
      'context_receipt',existing_receipt.receipt_json || pg_catalog.jsonb_build_object(
        'receipt_hash',existing_receipt.receipt_hash),
      'effective_config',loaded
    );
  end if;

  consumed_at := pg_catalog.clock_timestamp();
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(loaded -> 'resource_bindings') binding(document)
    where binding.document ->> 'availability' = 'AVAILABLE'
    group by binding.document #>> '{effective_resource,resource_id}'
    having pg_catalog.count(distinct binding.document -> 'effective_resource') > 1
  ) then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RESOURCE_REFERENCE_CONFLICT';
  end if;
  select coalesce(pg_catalog.jsonb_agg(resource.document order by resource.document ->> 'resource_id',
      (resource.document ->> 'resource_revision')::bigint,resource.document ->> 'resource_hash'),'[]'::jsonb)
    into context_resource_refs
  from (
    select binding.document -> 'effective_resource' as document
    from pg_catalog.jsonb_array_elements(loaded -> 'resource_bindings') binding(document)
    where binding.document ->> 'availability' = 'AVAILABLE'
    group by binding.document -> 'effective_resource'
  ) resource;
  receipt_document := pg_catalog.jsonb_build_object(
    'schema_version','effective-config-context-receipt@1.0.0',
    'receipt_id',requested_context_receipt_id,'consumer','WORKER_START',
    'outbox_id',requested_outbox_id,'command_id',requested_command_id,
    'consumer_id',requested_consumer_id,'attempt_id',requested_attempt_id,
    'lease_token',requested_lease_token,'worker_fence',requested_worker_fence,
    'scope',loaded -> 'scope','run_id',requested_run_id,
    'config_ref',pg_catalog.jsonb_build_object(
      'config_id',requested_config_id,'config_revision',requested_config_revision,
      'config_hash',requested_config_hash
    ),
    'semantic_release',loaded -> 'semantic_release',
    'schema_snapshot',loaded -> 'schema_snapshot',
    'context_policy',(loaded -> 'context_policy') - array['max_context_tokens','max_resource_bindings'],
    'provider',loaded #>> '{model,provider}',
    'audiences',loaded #> '{effective_egress,allowed_audiences}',
    'classification',loaded #>> '{effective_egress,classification}',
    'resource_refs',context_resource_refs,
    'consumed_at',app_data_agent.runtime_iso_timestamp(consumed_at)
  );
  receipt_hash := platform.canonical_sha256(receipt_document);
  insert into app_data_agent.effective_config_context_receipts (
    app_id,tenant_id,environment,context_receipt_id,config_id,config_revision,
    config_hash,run_id,principal_id,consumer_kind,consumer_id,attempt_id,worker_id,
    lease_token,outbox_id,command_id,worker_fence,
    receipt_json,receipt_hash,consumed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    requested_context_receipt_id,requested_config_id,requested_config_revision,
    requested_config_hash,requested_run_id,authority.principal_id,'WORKER_START',
    requested_consumer_id,requested_attempt_id,requested_worker_id,requested_lease_token,
    requested_outbox_id,requested_command_id,requested_worker_fence,
    receipt_document,receipt_hash,consumed_at
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','effective-config-worker-consumption@1.0.0',
    'replayed',false,
    'context_receipt',receipt_document || pg_catalog.jsonb_build_object('receipt_hash',receipt_hash),
    'effective_config',loaded
  );
end
$function$;
alter table app_data_agent.workspace_run_defaults owner to data_agent_effective_config_rpc_owner;
alter table app_data_agent.workspace_run_default_revisions owner to data_agent_effective_config_rpc_owner;
alter table app_data_agent.effective_run_config_receipts owner to data_agent_effective_config_rpc_owner;
alter table app_data_agent.effective_run_config_resource_bindings owner to data_agent_effective_config_rpc_owner;
alter table app_data_agent.effective_config_context_receipts owner to data_agent_effective_config_rpc_owner;

alter function app_data_agent.reject_effective_config_authority_mutation()
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.guard_datasource_resource_version_update()
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.guard_workspace_run_defaults_update()
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.canonical_uuid_json_string_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.versioned_resource_reference_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.versioned_resource_array_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.builtin_effective_config_policy(text)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.requested_defaults_resource_reference_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.requested_defaults_resource_array_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.requested_resource_selection_is_valid(jsonb,boolean)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.workspace_run_defaults_document_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.effective_config_request_is_valid(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_unavailable_singleton_resource_binding(jsonb,jsonb,text,text)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_optional_selection_evaluations(jsonb,jsonb,jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.update_workspace_run_defaults(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.get_workspace_run_defaults()
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.build_question_run_config_resolution(uuid,jsonb,uuid,jsonb,text,jsonb,jsonb,jsonb,jsonb,timestamptz,text,text,jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.load_effective_run_config(uuid,bigint,text,uuid)
  owner to data_agent_effective_config_rpc_owner;
alter function app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)
  owner to data_agent_effective_config_rpc_owner;

-- The NOLOGIN owner receives read-only, exact-scope RLS visibility needed by
-- the resolver. Backend remains unable to read the five U2 authority tables.
create policy app_users_effective_config_owner_select
on app_data_agent.app_users for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy app_users_effective_config_owner_lock
on app_data_agent.app_users for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
) with check (false);
create policy workspaces_effective_config_owner_select
on app_data_agent.workspaces for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and workspace_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy workspaces_effective_config_owner_lock
on app_data_agent.workspaces for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and workspace_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy memberships_effective_config_owner_select
on app_data_agent.memberships for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy runs_effective_config_owner_select
on app_data_agent.runs for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy run_events_effective_config_owner_select
on app_data_agent.run_events for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy audit_log_effective_config_owner_select
on app_data_agent.audit_log for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy qa_conversations_effective_config_owner_select
on app_data_agent.qa_conversations for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy qa_conversations_effective_config_owner_update
on app_data_agent.qa_conversations for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
) with check (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy workspace_run_bindings_effective_config_owner_select
on app_data_agent.workspace_run_bindings for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy workspace_run_bindings_effective_config_owner_insert
on app_data_agent.workspace_run_bindings for insert to data_agent_effective_config_rpc_owner with check (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy qa_messages_effective_config_owner_select
on app_data_agent.qa_messages for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy qa_messages_effective_config_owner_insert
on app_data_agent.qa_messages for insert to data_agent_effective_config_rpc_owner with check (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and owner_principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy idempotency_effective_config_owner_select
on app_data_agent.idempotency_records for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
);
create policy datasource_effective_config_owner_select
on app_data_agent.datasource_connections for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy datasource_effective_config_owner_lock
on app_data_agent.datasource_connections for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy model_catalog_effective_config_owner_select
on app_data_agent.model_catalog_entries for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy model_catalog_effective_config_owner_lock
on app_data_agent.model_catalog_entries for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy semantic_domain_effective_config_owner_select
on semantic.semantic_domain_registry for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy semantic_domain_effective_config_owner_lock
on semantic.semantic_domain_registry for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy semantic_pointer_effective_config_owner_select
on semantic.semantic_active_pointer for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy semantic_pointer_effective_config_owner_lock
on semantic.semantic_active_pointer for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy semantic_release_effective_config_owner_select
on semantic.semantic_source_release for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy semantic_release_effective_config_owner_lock
on semantic.semantic_source_release for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy schema_snapshot_effective_config_owner_select
on catalog.physical_schema_snapshot for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy schema_snapshot_effective_config_owner_lock
on catalog.physical_schema_snapshot for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy schema_scan_run_effective_config_owner_select
on catalog.schema_scan_run for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy run_attempts_effective_config_owner_select
on app_data_agent.run_attempts for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy run_attempts_effective_config_owner_lock
on app_data_agent.run_attempts for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);
create policy outbox_effective_config_owner_select
on app_data_agent.outbox for select to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
);
create policy outbox_effective_config_owner_lock
on app_data_agent.outbox for update to data_agent_effective_config_rpc_owner using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
) with check (false);

grant usage on schema app_data_agent, platform, semantic, catalog
  to data_agent_effective_config_rpc_owner;
grant select on table
  app_data_agent.app_users,
  app_data_agent.workspaces,
  app_data_agent.memberships,
  app_data_agent.runs,
  app_data_agent.run_events,
  app_data_agent.audit_log,
  app_data_agent.idempotency_records,
  app_data_agent.datasource_connections,
  app_data_agent.model_catalog_entries,
  app_data_agent.qa_conversations,
  app_data_agent.workspace_run_bindings,
  app_data_agent.qa_messages,
  app_data_agent.run_attempts,
  app_data_agent.outbox,
  semantic.semantic_domain_registry,
  semantic.semantic_active_pointer,
  semantic.semantic_source_release,
  catalog.physical_schema_snapshot,
  catalog.schema_scan_run
to data_agent_effective_config_rpc_owner;
-- PostgreSQL requires UPDATE privilege to acquire FOR SHARE row locks. No
-- UPDATE RLS policy is granted, so the owner still cannot mutate these rows.
grant update on table
  app_data_agent.app_users,
  app_data_agent.workspaces,
  app_data_agent.qa_conversations,
  app_data_agent.datasource_connections,
  app_data_agent.model_catalog_entries,
  app_data_agent.run_attempts,
  app_data_agent.outbox,
  semantic.semantic_domain_registry,
  semantic.semantic_active_pointer,
  semantic.semantic_source_release,
  catalog.physical_schema_snapshot
to data_agent_effective_config_rpc_owner;
grant select,insert,update on table app_data_agent.workspace_run_defaults
  to data_agent_effective_config_rpc_owner;
grant select,insert on table
  app_data_agent.workspace_run_default_revisions,
  app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_run_config_resource_bindings,
  app_data_agent.effective_config_context_receipts
to data_agent_effective_config_rpc_owner;
grant insert on table app_data_agent.workspace_run_bindings, app_data_agent.qa_messages
  to data_agent_effective_config_rpc_owner;

grant execute on function platform.current_backend_authority(boolean)
  to data_agent_effective_config_rpc_owner;
grant execute on function platform.canonical_sha256(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function platform.list_active_model_catalog(uuid,uuid)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.contains_potential_plaintext_secret(jsonb,text)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.runtime_canonical_sha256(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.runtime_iso_timestamp(timestamptz)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.lock_owned_run_fence(uuid)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_question_run_config_resolution(uuid,jsonb,uuid,jsonb,text,jsonb,jsonb,jsonb,jsonb,timestamptz,text,text,jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_unavailable_singleton_resource_binding(jsonb,jsonb,text,text)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.build_optional_selection_evaluations(jsonb,jsonb,jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.builtin_effective_config_policy(text)
  to data_agent_effective_config_rpc_owner;

revoke all on function app_data_agent.update_workspace_run_defaults(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.requested_defaults_resource_reference_is_valid(jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.requested_defaults_resource_array_is_valid(jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.build_unavailable_singleton_resource_binding(jsonb,jsonb,text,text)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.build_optional_selection_evaluations(jsonb,jsonb,jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.guard_datasource_resource_version_update()
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.get_workspace_run_defaults()
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.build_question_run_config_resolution(uuid,jsonb,uuid,jsonb,text,jsonb,jsonb,jsonb,jsonb,timestamptz,text,text,jsonb)
  from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.load_effective_run_config(uuid,bigint,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)
  from public, anon, authenticated, service_role, data_agent_backend;

grant execute on function app_data_agent.update_workspace_run_defaults(jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.get_workspace_run_defaults()
  to data_agent_backend;
grant execute on function app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.load_effective_run_config(uuid,bigint,text,uuid)
  to data_agent_backend;
grant execute on function app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)
  to data_agent_backend;

do $postconditions$
declare
  relation_name text;
  function_record record;
begin
  if (select rolcanlogin from pg_catalog.pg_roles where rolname = 'data_agent_effective_config_rpc_owner')
    or (select rolsuper from pg_catalog.pg_roles where rolname = 'data_agent_effective_config_rpc_owner')
  then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_CONFIG_RPC_OWNER_UNSAFE';
  end if;

  foreach relation_name in array array[
    'workspace_run_defaults','workspace_run_default_revisions',
    'effective_run_config_receipts','effective_run_config_resource_bindings',
    'effective_config_context_receipts'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = relation_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'EFFECTIVE_CONFIG_TABLE_AUTHORITY_UNSAFE';
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'datasource_connections'
      and attribute.attname = 'resource_version'
      and attribute.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
      and attribute.attnotnull
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'datasource_connections'
      and trigger.tgname = 'zz_datasource_resource_version_guard'
      and not trigger.tgisinternal
  ) or pg_catalog.pg_get_functiondef(
    'app_data_agent.guard_datasource_resource_version_update()'::pg_catalog.regprocedure
  ) not like '%new.resource_version := old.resource_version + 1%'
  then
    raise exception using errcode = 'P0001', message = 'DATASOURCE_RESOURCE_VERSION_AUTHORITY_UNSAFE';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname in (
        'workspace_run_defaults','workspace_run_default_revisions',
        'effective_run_config_receipts','effective_run_config_resource_bindings',
        'effective_config_context_receipts'
      )
      and not attribute.attisdropped
      and attribute.attname ~ '(billing|price|credit|cost|settlement)'
  ) then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_CONFIG_COMMERCIAL_SURFACE_FORBIDDEN';
  end if;

  for function_record in
    select procedure.oid,procedure.prosecdef,
      pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
      procedure.proconfig,
      pg_catalog.format('%I.%I(%s)',namespace.nspname,procedure.proname,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)) as signature
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_data_agent'
      and procedure.proname in (
        'update_workspace_run_defaults','get_workspace_run_defaults',
        'accept_question_run_with_effective_config','resolve_semantic_bootstrap_job_config',
        'revalidate_effective_run_config_internal',
        'load_effective_run_config','consume_worker_effective_run_config'
      )
  loop
    if not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_effective_config_rpc_owner'
      or not ('search_path=""' = any(function_record.proconfig))
    then
      raise exception using errcode = 'P0001', message =
        'EFFECTIVE_CONFIG_SECURITY_DEFINER_UNSAFE:' || function_record.signature;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_CONFIG_FUNCTION_GRANTS_UNSAFE';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010653_app_data_agent_effective_run_config',
  'sha256:9782a7b7a906e5f2c8bc79419609cabf7911487987c08ba0da926cd0df7dd146'
);

commit;
