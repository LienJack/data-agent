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
    and defaults_hash = app_data_agent.u2_canonical_sha256(revision_document)
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
    and config_hash = app_data_agent.u2_canonical_sha256(effective_config_json)
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
    and receipt_hash = app_data_agent.u2_canonical_sha256(receipt_json)
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
