begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_backend') then
    create role data_agent_backend nologin noinherit;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_platform_owner'
  ) then
    create role data_agent_platform_owner nologin noinherit;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_job_authority'
  ) then
    create role data_agent_job_authority nologin noinherit;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_secret_authority'
  ) then
    create role data_agent_secret_authority nologin noinherit;
  end if;
end
$$;

create schema if not exists platform authorization postgres;
create schema if not exists api authorization postgres;

revoke all privileges on schema platform
from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority,
  data_agent_secret_authority;
revoke create on schema api from public, anon, authenticated, service_role;

create table platform.apps (
  app_id uuid primary key,
  app_slug text not null unique
    check (app_slug ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
  display_name text not null check (pg_catalog.length(display_name) between 1 and 128),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table platform.app_environment_lifecycle (
  app_id uuid not null references platform.apps(app_id) on delete restrict,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  lifecycle_state text not null default 'ACTIVE'
    check (
      lifecycle_state in (
        'ACTIVE',
        'FROZEN',
        'EXPORT_PENDING',
        'DELETE_PENDING',
        'DELETED'
      )
    ),
  authority_epoch bigint not null default 1 check (authority_epoch >= 1),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment)
);

create table platform.schema_registry (
  schema_id uuid primary key,
  app_id uuid not null unique references platform.apps(app_id) on delete restrict,
  private_schema_name text not null unique
    check (private_schema_name ~ '^app_[a-z][a-z0-9_]{1,58}$'),
  api_prefix text not null unique
    check (api_prefix ~ '^[a-z][a-z0-9_]{1,58}__$'),
  owner_role text not null
    check (owner_role ~ '^[a-z][a-z0-9_]{1,62}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table platform.api_operation_registry (
  app_id uuid not null references platform.apps(app_id) on delete restrict,
  operation_name text not null check (operation_name ~ '^[a-z][a-z0-9_]{1,62}$'),
  exposed_name text not null unique check (exposed_name ~ '^[a-z][a-z0-9_]{3,126}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, operation_name)
);

create table platform.deployment_mappings (
  deployment_id uuid primary key,
  app_id uuid not null references platform.apps(app_id) on delete restrict,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  deployment_key_hash text not null unique
    check (deployment_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  revoked_at timestamptz,
  check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null)),
  unique (app_id, environment, deployment_id)
);

create table platform.migration_ledger (
  owner_kind text not null check (owner_kind in ('platform', 'app')),
  app_id uuid references platform.apps(app_id) on delete restrict,
  migration_version text not null
    check (migration_version ~ '^[0-9]{14}_[a-z][a-z0-9_]{1,96}$'),
  migration_checksum text not null
    check (migration_checksum ~ '^sha256:[0-9a-f]{64}$'),
  applied_at timestamptz not null default pg_catalog.clock_timestamp(),
  applied_by text not null default session_user,
  check (
    (owner_kind = 'platform' and app_id is null)
    or (owner_kind = 'app' and app_id is not null)
  ),
  unique nulls not distinct (owner_kind, app_id, migration_version)
);

create table platform.boundary_audit_receipts (
  receipt_id uuid primary key,
  app_id uuid not null references platform.apps(app_id) on delete restrict,
  environment text not null,
  tenant_id uuid,
  operation text not null
    check (
      operation in (
        'FREEZE',
        'EXPORT_REQUESTED',
        'EXPORT_COMPLETED',
        'EXPORT_CANCELLED',
        'DELETE_REQUESTED',
        'DELETE_CONFIRMED',
        'RESTORE',
        'ACTIVATE'
      )
    ),
  status text not null check (status in ('SUCCEEDED', 'FAILED')),
  previous_state text not null,
  resulting_state text not null,
  receipt_hash text not null unique check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  details jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (app_id, environment)
    references platform.app_environment_lifecycle(app_id, environment)
    on delete restrict
);

create table platform.app_lifecycle_events (
  event_id uuid primary key,
  app_id uuid not null references platform.apps(app_id) on delete restrict,
  environment text not null,
  receipt_id uuid not null unique
    references platform.boundary_audit_receipts(receipt_id) on delete restrict,
  previous_state text not null,
  resulting_state text not null,
  operation text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (app_id, environment)
    references platform.app_environment_lifecycle(app_id, environment)
    on delete restrict
);

create table platform.demo_principals (
  principal_id uuid primary key,
  app_id uuid not null references platform.apps(app_id) on delete restrict,
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_name text not null check (principal_name ~ '^[a-z][a-z0-9_-]{1,62}$'),
  rate_limit_per_minute integer not null check (rate_limit_per_minute between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (app_id, tenant_id, environment, principal_name)
);

create table platform.job_authorities (
  authority_id uuid primary key,
  authority_name text not null unique
    check (authority_name ~ '^[a-z][a-z0-9_-]{1,62}$'),
  public_key_fingerprint text not null unique
    check (public_key_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  revoked_at timestamptz,
  check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null))
);

create table platform.resource_manifests (
  manifest_id uuid primary key,
  app_id uuid not null,
  environment text not null,
  source_state text not null
    check (source_state in ('FROZEN', 'EXPORT_PENDING', 'DELETE_PENDING')),
  authority_epoch bigint not null check (authority_epoch >= 1),
  database_count bigint not null check (database_count >= 0),
  storage_count bigint not null check (storage_count >= 0),
  redis_count bigint not null check (redis_count >= 0),
  manifest_json jsonb not null
    check (pg_catalog.jsonb_typeof(manifest_json) = 'object'),
  payload_hash text not null unique
    check (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  signer_authority_id uuid not null
    references platform.job_authorities(authority_id) on delete restrict,
  signer_key_id text not null
    check (signer_key_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  signature text not null
    check (signature ~ '^ed25519:[A-Za-z0-9_-]{32,192}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (app_id, environment)
    references platform.app_environment_lifecycle(app_id, environment)
    on delete restrict,
  unique (manifest_id, app_id, environment)
);

create table platform.resource_operation_receipts (
  operation_receipt_id uuid primary key,
  app_id uuid not null,
  environment text not null,
  authority_epoch bigint not null check (authority_epoch >= 1),
  operation text not null check (operation in ('EXPORT', 'BACKUP', 'DELETE', 'VERIFY')),
  source_state text not null
    check (source_state in ('FROZEN', 'EXPORT_PENDING', 'DELETE_PENDING', 'DELETED')),
  target_state text not null
    check (target_state in ('FROZEN', 'DELETE_PENDING', 'DELETED')),
  manifest_id uuid not null,
  upstream_receipt_id uuid,
  database_affected_count bigint not null check (database_affected_count >= 0),
  storage_affected_count bigint not null check (storage_affected_count >= 0),
  redis_affected_count bigint not null check (redis_affected_count >= 0),
  database_residual_count bigint not null check (database_residual_count >= 0),
  storage_residual_count bigint not null check (storage_residual_count >= 0),
  redis_residual_count bigint not null check (redis_residual_count >= 0),
  payload_hash text not null unique
    check (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  signer_authority_id uuid not null
    references platform.job_authorities(authority_id) on delete restrict,
  signer_key_id text not null
    check (signer_key_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  signature text not null
    check (signature ~ '^ed25519:[A-Za-z0-9_-]{32,192}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (app_id, environment)
    references platform.app_environment_lifecycle(app_id, environment)
    on delete restrict,
  foreign key (manifest_id, app_id, environment)
    references platform.resource_manifests(manifest_id, app_id, environment)
    on delete restrict,
  foreign key (upstream_receipt_id, app_id, environment)
    references platform.resource_operation_receipts(
      operation_receipt_id,
      app_id,
      environment
    )
    on delete restrict,
  unique (operation_receipt_id, app_id, environment),
  check (upstream_receipt_id is null or upstream_receipt_id <> operation_receipt_id)
);

create or replace function platform.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'DA_IMMUTABLE_RECORD';
end
$$;

create trigger schema_registry_immutable
before update or delete on platform.schema_registry
for each row execute function platform.reject_immutable_mutation();

create trigger api_operation_registry_immutable
before update or delete on platform.api_operation_registry
for each row execute function platform.reject_immutable_mutation();

create trigger migration_ledger_immutable
before update or delete on platform.migration_ledger
for each row execute function platform.reject_immutable_mutation();

create trigger boundary_audit_receipts_immutable
before update or delete on platform.boundary_audit_receipts
for each row execute function platform.reject_immutable_mutation();

create trigger app_lifecycle_events_immutable
before update or delete on platform.app_lifecycle_events
for each row execute function platform.reject_immutable_mutation();

create trigger resource_manifests_immutable
before update or delete on platform.resource_manifests
for each row execute function platform.reject_immutable_mutation();

create trigger resource_operation_receipts_immutable
before update or delete on platform.resource_operation_receipts
for each row execute function platform.reject_immutable_mutation();

create or replace function platform.guard_deployment_mapping_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_DEPLOYMENT_MAPPING_IMMUTABLE';
  end if;
  if (
    new.deployment_id <> old.deployment_id
    or new.app_id <> old.app_id
    or new.environment <> old.environment
    or new.deployment_key_hash <> old.deployment_key_hash
    or new.created_at <> old.created_at
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DA_DEPLOYMENT_IDENTITY_IMMUTABLE';
  end if;
  if new is not distinct from old then
    return new;
  end if;
  if (
    old.is_active
    and old.revoked_at is null
    and not new.is_active
    and new.revoked_at is not null
  ) then
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'DA_DEPLOYMENT_REACTIVATION_FORBIDDEN';
end
$$;

create trigger deployment_mapping_transition_guard
before update or delete on platform.deployment_mappings
for each row execute function platform.guard_deployment_mapping_transition();

create or replace function platform.ensure_deployment_environment_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into platform.app_environment_lifecycle (app_id, environment)
  values (new.app_id, new.environment)
  on conflict (app_id, environment) do nothing;
  return new;
end
$$;

create trigger deployment_environment_lifecycle_initializer
after insert on platform.deployment_mappings
for each row execute function platform.ensure_deployment_environment_lifecycle();

create or replace function platform.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or value = '' then
    return null;
  end if;
  return value::uuid;
exception
  when invalid_text_representation then
    return null;
end
$$;

create or replace function platform.canonical_sha256(payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'sha256:' || pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(payload::text, 'UTF8')),
    'hex'
  )
$$;

create or replace function platform.lifecycle_lock_key(
  requested_app_id uuid,
  requested_environment text
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.hashtextextended(
    'data-agent:lifecycle:' ||
    requested_app_id::text || ':' ||
    requested_environment,
    0
  )
$$;

create or replace function platform.acquire_lifecycle_shared_lock(
  requested_app_id uuid,
  requested_environment text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock_shared(
    platform.lifecycle_lock_key(requested_app_id, requested_environment)
  )
$$;

create or replace function platform.acquire_lifecycle_exclusive_lock(
  requested_app_id uuid,
  requested_environment text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    platform.lifecycle_lock_key(requested_app_id, requested_environment)
  )
$$;

create or replace function platform.compute_resource_manifest_hash(
  requested_manifest_id uuid,
  requested_app_id uuid,
  requested_environment text,
  requested_source_state text,
  requested_authority_epoch bigint,
  requested_database_count bigint,
  requested_storage_count bigint,
  requested_redis_count bigint,
  requested_manifest_json jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select platform.canonical_sha256(
    pg_catalog.jsonb_build_object(
      'manifestId', requested_manifest_id,
      'appId', requested_app_id,
      'environment', requested_environment,
      'sourceState', requested_source_state,
      'authorityEpoch', requested_authority_epoch,
      'databaseCount', requested_database_count,
      'storageCount', requested_storage_count,
      'redisCount', requested_redis_count,
      'manifest', requested_manifest_json
    )
  )
$$;

create or replace function platform.compute_resource_operation_hash(
  requested_operation_receipt_id uuid,
  requested_app_id uuid,
  requested_environment text,
  requested_authority_epoch bigint,
  requested_operation text,
  requested_source_state text,
  requested_target_state text,
  requested_manifest_id uuid,
  requested_upstream_receipt_id uuid,
  requested_database_affected_count bigint,
  requested_storage_affected_count bigint,
  requested_redis_affected_count bigint,
  requested_database_residual_count bigint,
  requested_storage_residual_count bigint,
  requested_redis_residual_count bigint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select platform.canonical_sha256(
    pg_catalog.jsonb_build_object(
      'operationReceiptId', requested_operation_receipt_id,
      'appId', requested_app_id,
      'environment', requested_environment,
      'authorityEpoch', requested_authority_epoch,
      'operation', requested_operation,
      'sourceState', requested_source_state,
      'targetState', requested_target_state,
      'manifestId', requested_manifest_id,
      'upstreamReceiptId', requested_upstream_receipt_id,
      'databaseAffectedCount', requested_database_affected_count,
      'storageAffectedCount', requested_storage_affected_count,
      'redisAffectedCount', requested_redis_affected_count,
      'databaseResidualCount', requested_database_residual_count,
      'storageResidualCount', requested_storage_residual_count,
      'redisResidualCount', requested_redis_residual_count
    )
  )
$$;

create or replace function platform.compute_lifecycle_receipt_hash(
  requested_receipt_id uuid,
  requested_app_id uuid,
  requested_environment text,
  requested_source_state text,
  requested_target_state text,
  requested_operation text,
  requested_details jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select platform.canonical_sha256(
    pg_catalog.jsonb_build_object(
      'receiptId', requested_receipt_id,
      'appId', requested_app_id,
      'environment', requested_environment,
      'sourceState', requested_source_state,
      'targetState', requested_target_state,
      'operation', requested_operation,
      'details', requested_details
    )
  )
$$;

create or replace function platform.acquire_migration_lock(
  requested_owner_kind text,
  requested_app_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  lock_key text;
begin
  if requested_owner_kind not in ('platform', 'app') then
    raise exception using
      errcode = '22023',
      message = 'DA_MIGRATION_OWNER_INVALID';
  end if;
  if (
    (requested_owner_kind = 'platform' and requested_app_id is not null)
    or (requested_owner_kind = 'app' and requested_app_id is null)
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_MIGRATION_SCOPE_INVALID';
  end if;

  lock_key :=
    'data-agent:migration:' || requested_owner_kind || ':' ||
    coalesce(requested_app_id::text, 'platform');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_key, 0));
end
$$;

create or replace function platform.assert_migration_checksum(
  requested_owner_kind text,
  requested_app_id uuid,
  requested_version text,
  requested_checksum text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  existing_checksum text;
begin
  if requested_version !~ '^[0-9]{14}_[a-z][a-z0-9_]{1,96}$' then
    raise exception using
      errcode = '22023',
      message = 'DA_MIGRATION_VERSION_INVALID';
  end if;
  if requested_checksum !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'DA_MIGRATION_CHECKSUM_INVALID';
  end if;

  perform platform.acquire_migration_lock(requested_owner_kind, requested_app_id);
  select ledger.migration_checksum
  into existing_checksum
  from platform.migration_ledger as ledger
  where ledger.owner_kind = requested_owner_kind
    and ledger.app_id is not distinct from requested_app_id
    and ledger.migration_version = requested_version;

  if existing_checksum is not null then
    if existing_checksum <> requested_checksum then
      raise exception using
        errcode = 'P0001',
        message = 'DA_MIGRATION_CHECKSUM_MISMATCH';
    end if;
    return false;
  end if;

  insert into platform.migration_ledger (
    owner_kind,
    app_id,
    migration_version,
    migration_checksum
  )
  values (
    requested_owner_kind,
    requested_app_id,
    requested_version,
    requested_checksum
  );
  return true;
end
$$;

create or replace function platform.register_app(
  requested_app_id uuid,
  requested_schema_id uuid,
  requested_app_slug text,
  requested_display_name text,
  requested_private_schema text,
  requested_api_prefix text,
  requested_owner_role text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_api_prefix text;
  existing_app platform.apps%rowtype;
  existing_schema platform.schema_registry%rowtype;
begin
  expected_api_prefix := pg_catalog.replace(requested_app_slug, '-', '_') || '__';
  if requested_api_prefix <> expected_api_prefix then
    raise exception using
      errcode = '22023',
      message = 'DA_API_PREFIX_INVALID';
  end if;

  select app.*
  into existing_app
  from platform.apps as app
  where app.app_id = requested_app_id
     or app.app_slug = requested_app_slug;

  if found then
    select registry.*
    into existing_schema
    from platform.schema_registry as registry
    where registry.app_id = existing_app.app_id;

    if (
      existing_app.app_id = requested_app_id
      and existing_app.app_slug = requested_app_slug
      and existing_app.display_name = requested_display_name
      and existing_schema.schema_id = requested_schema_id
      and existing_schema.private_schema_name = requested_private_schema
      and existing_schema.api_prefix = requested_api_prefix
      and existing_schema.owner_role = requested_owner_role
    ) then
      return false;
    end if;

    raise exception using
      errcode = '23505',
      message = 'DA_APP_REGISTRY_CONFLICT';
  end if;

  insert into platform.apps (app_id, app_slug, display_name)
  values (requested_app_id, requested_app_slug, requested_display_name);
  insert into platform.schema_registry (
    schema_id,
    app_id,
    private_schema_name,
    api_prefix,
    owner_role
  )
  values (
    requested_schema_id,
    requested_app_id,
    requested_private_schema,
    requested_api_prefix,
    requested_owner_role
  );
  return true;
end
$$;

create or replace function platform.register_api_operation(
  requested_app_id uuid,
  requested_operation_name text,
  requested_exposed_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_name text;
  existing_name text;
begin
  select registry.api_prefix || requested_operation_name
  into expected_name
  from platform.schema_registry as registry
  where registry.app_id = requested_app_id;
  if expected_name is null or expected_name <> requested_exposed_name then
    raise exception using
      errcode = '22023',
      message = 'DA_API_OPERATION_PREFIX_INVALID';
  end if;

  select operation.exposed_name
  into existing_name
  from platform.api_operation_registry as operation
  where operation.app_id = requested_app_id
    and operation.operation_name = requested_operation_name;
  if existing_name is not null then
    if existing_name = requested_exposed_name then
      return false;
    end if;
    raise exception using
      errcode = '23505',
      message = 'DA_API_OPERATION_CONFLICT';
  end if;

  insert into platform.api_operation_registry (app_id, operation_name, exposed_name)
  values (requested_app_id, requested_operation_name, requested_exposed_name);
  return true;
end
$$;

create or replace function platform.cleanup_scope_authority(
  requested_app_id uuid,
  requested_environment text,
  requested_action text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_state text;
  current_epoch bigint;
  action_allowed boolean;
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'data_agent_job_authority',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_JOB_AUTHORITY_REQUIRED';
  end if;
  if requested_action not in (
    'ENUMERATE',
    'EXPORT',
    'BACKUP',
    'REMOVE',
    'DELETE',
    'VERIFY'
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_CLEANUP_ACTION_INVALID';
  end if;

  select lifecycle.lifecycle_state, lifecycle.authority_epoch
  into current_state, current_epoch
  from platform.app_environment_lifecycle as lifecycle
  where lifecycle.app_id = requested_app_id
    and lifecycle.environment = requested_environment;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_APP_NOT_FOUND';
  end if;

  action_allowed := case
    when current_state = 'FROZEN'
      and requested_action in ('ENUMERATE', 'EXPORT', 'BACKUP', 'VERIFY')
      then true
    when current_state = 'EXPORT_PENDING'
      and requested_action in ('ENUMERATE', 'EXPORT', 'VERIFY')
      then true
    when current_state = 'DELETE_PENDING'
      and requested_action in ('ENUMERATE', 'REMOVE', 'DELETE', 'VERIFY')
      then true
    else false
  end;
  if not action_allowed then
    raise exception using
      errcode = '42501',
      message = 'DA_CLEANUP_ACTION_FORBIDDEN';
  end if;

  return pg_catalog.jsonb_build_object(
    'appId', requested_app_id,
    'environment', requested_environment,
    'lifecycleState', current_state,
    'appEpoch', current_epoch,
    'capability', 'LIFECYCLE_CLEANUP',
    'action', requested_action
  );
end
$$;

create or replace function platform.record_resource_manifest(
  requested_manifest_id uuid,
  requested_app_id uuid,
  requested_environment text,
  requested_source_state text,
  requested_authority_epoch bigint,
  requested_database_count bigint,
  requested_storage_count bigint,
  requested_redis_count bigint,
  requested_manifest_json jsonb,
  requested_payload_hash text,
  requested_signer_authority_id uuid,
  requested_signer_key_id text,
  requested_signature text
)
returns platform.resource_manifests
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_state text;
  current_epoch bigint;
  expected_hash text;
  recorded_manifest platform.resource_manifests%rowtype;
begin
  perform platform.cleanup_scope_authority(
    requested_app_id,
    requested_environment,
    'ENUMERATE'
  );

  select lifecycle.lifecycle_state, lifecycle.authority_epoch
  into current_state, current_epoch
  from platform.app_environment_lifecycle as lifecycle
  where lifecycle.app_id = requested_app_id
    and lifecycle.environment = requested_environment;
  if (
    current_state is distinct from requested_source_state
    or current_epoch is distinct from requested_authority_epoch
  ) then
    raise exception using
      errcode = '40001',
      message = 'DA_RESOURCE_MANIFEST_STATE_STALE';
  end if;
  if not exists (
    select 1
    from platform.job_authorities as authority
    where authority.authority_id = requested_signer_authority_id
      and authority.is_active
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_JOB_SIGNER_INVALID';
  end if;

  expected_hash := platform.compute_resource_manifest_hash(
    requested_manifest_id,
    requested_app_id,
    requested_environment,
    requested_source_state,
    requested_authority_epoch,
    requested_database_count,
    requested_storage_count,
    requested_redis_count,
    requested_manifest_json
  );
  if requested_payload_hash is distinct from expected_hash then
    raise exception using
      errcode = '22023',
      message = 'DA_JOB_PAYLOAD_HASH_MISMATCH';
  end if;

  insert into platform.resource_manifests (
    manifest_id,
    app_id,
    environment,
    source_state,
    authority_epoch,
    database_count,
    storage_count,
    redis_count,
    manifest_json,
    payload_hash,
    signer_authority_id,
    signer_key_id,
    signature
  )
  values (
    requested_manifest_id,
    requested_app_id,
    requested_environment,
    requested_source_state,
    requested_authority_epoch,
    requested_database_count,
    requested_storage_count,
    requested_redis_count,
    requested_manifest_json,
    requested_payload_hash,
    requested_signer_authority_id,
    requested_signer_key_id,
    requested_signature
  )
  returning * into recorded_manifest;
  return recorded_manifest;
end
$$;

create or replace function platform.record_resource_operation_receipt(
  requested_operation_receipt_id uuid,
  requested_app_id uuid,
  requested_environment text,
  requested_authority_epoch bigint,
  requested_operation text,
  requested_source_state text,
  requested_target_state text,
  requested_manifest_id uuid,
  requested_upstream_receipt_id uuid,
  requested_database_affected_count bigint,
  requested_storage_affected_count bigint,
  requested_redis_affected_count bigint,
  requested_database_residual_count bigint,
  requested_storage_residual_count bigint,
  requested_redis_residual_count bigint,
  requested_payload_hash text,
  requested_signer_authority_id uuid,
  requested_signer_key_id text,
  requested_signature text
)
returns platform.resource_operation_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  manifest platform.resource_manifests%rowtype;
  expected_hash text;
  cleanup_action text;
  recorded_receipt platform.resource_operation_receipts%rowtype;
begin
  cleanup_action := case requested_operation
    when 'EXPORT' then 'EXPORT'
    when 'BACKUP' then 'BACKUP'
    when 'DELETE' then 'DELETE'
    when 'VERIFY' then 'VERIFY'
    else null
  end;
  if cleanup_action is null then
    raise exception using
      errcode = '22023',
      message = 'DA_RESOURCE_OPERATION_INVALID';
  end if;
  perform platform.cleanup_scope_authority(
    requested_app_id,
    requested_environment,
    cleanup_action
  );

  select resource_manifest.*
  into manifest
  from platform.resource_manifests as resource_manifest
  where resource_manifest.manifest_id = requested_manifest_id
    and resource_manifest.app_id = requested_app_id
    and resource_manifest.environment = requested_environment;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RESOURCE_MANIFEST_NOT_FOUND';
  end if;
  if not exists (
    select 1
    from platform.app_environment_lifecycle as lifecycle
    where lifecycle.app_id = requested_app_id
      and lifecycle.environment = requested_environment
      and lifecycle.lifecycle_state = requested_source_state
      and lifecycle.authority_epoch = requested_authority_epoch
  ) then
    raise exception using
      errcode = '40001',
      message = 'DA_RESOURCE_OPERATION_STATE_STALE';
  end if;
  if not exists (
    select 1
    from platform.job_authorities as authority
    where authority.authority_id = requested_signer_authority_id
      and authority.is_active
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_JOB_SIGNER_INVALID';
  end if;
  if (
    manifest.source_state <> requested_source_state
    or manifest.authority_epoch <> requested_authority_epoch
  ) then
    raise exception using
      errcode = '40001',
      message = 'DA_RESOURCE_MANIFEST_EPOCH_STALE';
  end if;
  if requested_operation in ('EXPORT', 'BACKUP', 'DELETE') and (
    requested_database_affected_count <> manifest.database_count
    or requested_storage_affected_count <> manifest.storage_count
    or requested_redis_affected_count <> manifest.redis_count
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_RESOURCE_OPERATION_COVERAGE_MISMATCH';
  end if;
  if requested_operation in ('EXPORT', 'BACKUP') and (
    requested_database_residual_count <> manifest.database_count
    or requested_storage_residual_count <> manifest.storage_count
    or requested_redis_residual_count <> manifest.redis_count
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_EXPORT_RESIDUAL_MISMATCH';
  end if;
  if requested_operation = 'DELETE' and not exists (
    select 1
    from platform.resource_operation_receipts as upstream
    where upstream.operation_receipt_id = requested_upstream_receipt_id
      and upstream.app_id = requested_app_id
      and upstream.environment = requested_environment
      and upstream.operation in ('EXPORT', 'BACKUP')
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_DELETE_UPSTREAM_RECEIPT_INVALID';
  end if;

  expected_hash := platform.compute_resource_operation_hash(
    requested_operation_receipt_id,
    requested_app_id,
    requested_environment,
    requested_authority_epoch,
    requested_operation,
    requested_source_state,
    requested_target_state,
    requested_manifest_id,
    requested_upstream_receipt_id,
    requested_database_affected_count,
    requested_storage_affected_count,
    requested_redis_affected_count,
    requested_database_residual_count,
    requested_storage_residual_count,
    requested_redis_residual_count
  );
  if requested_payload_hash is distinct from expected_hash then
    raise exception using
      errcode = '22023',
      message = 'DA_JOB_PAYLOAD_HASH_MISMATCH';
  end if;

  insert into platform.resource_operation_receipts (
    operation_receipt_id,
    app_id,
    environment,
    authority_epoch,
    operation,
    source_state,
    target_state,
    manifest_id,
    upstream_receipt_id,
    database_affected_count,
    storage_affected_count,
    redis_affected_count,
    database_residual_count,
    storage_residual_count,
    redis_residual_count,
    payload_hash,
    signer_authority_id,
    signer_key_id,
    signature
  )
  values (
    requested_operation_receipt_id,
    requested_app_id,
    requested_environment,
    requested_authority_epoch,
    requested_operation,
    requested_source_state,
    requested_target_state,
    requested_manifest_id,
    requested_upstream_receipt_id,
    requested_database_affected_count,
    requested_storage_affected_count,
    requested_redis_affected_count,
    requested_database_residual_count,
    requested_storage_residual_count,
    requested_redis_residual_count,
    requested_payload_hash,
    requested_signer_authority_id,
    requested_signer_key_id,
    requested_signature
  )
  returning * into recorded_receipt;
  return recorded_receipt;
end
$$;

create or replace function platform.transition_app_lifecycle(
  requested_app_id uuid,
  requested_environment text,
  requested_expected_state text,
  requested_target_state text,
  requested_operation text,
  requested_receipt_id uuid,
  requested_receipt_hash text,
  requested_details jsonb default '{}'::jsonb
)
returns platform.boundary_audit_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lifecycle platform.app_environment_lifecycle%rowtype;
  receipt platform.boundary_audit_receipts%rowtype;
  transition_allowed boolean;
  expected_receipt_hash text;
begin
  if requested_details is null
    or pg_catalog.jsonb_typeof(requested_details) <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_BOUNDARY_RECEIPT_DETAILS_INVALID';
  end if;

  perform platform.acquire_lifecycle_exclusive_lock(
    requested_app_id,
    requested_environment
  );
  select lifecycle.*
  into current_lifecycle
  from platform.app_environment_lifecycle as lifecycle
  where lifecycle.app_id = requested_app_id
    and lifecycle.environment = requested_environment
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_APP_ENVIRONMENT_NOT_FOUND';
  end if;
  if current_lifecycle.lifecycle_state <> requested_expected_state then
    raise exception using
      errcode = '40001',
      message = 'DA_APP_LIFECYCLE_STALE';
  end if;

  transition_allowed := case
    when requested_expected_state = 'ACTIVE'
      and requested_target_state = 'FROZEN'
      and requested_operation = 'FREEZE' then true
    when requested_expected_state = 'FROZEN'
      and requested_target_state = 'EXPORT_PENDING'
      and requested_operation = 'EXPORT_REQUESTED' then true
    when requested_expected_state = 'EXPORT_PENDING'
      and requested_target_state = 'FROZEN'
      and requested_operation = 'EXPORT_COMPLETED' then true
    when requested_expected_state = 'EXPORT_PENDING'
      and requested_target_state = 'FROZEN'
      and requested_operation = 'EXPORT_CANCELLED' then true
    when requested_expected_state = 'FROZEN'
      and requested_target_state = 'DELETE_PENDING'
      and requested_operation = 'DELETE_REQUESTED' then true
    when requested_expected_state = 'DELETE_PENDING'
      and requested_target_state = 'DELETED'
      and requested_operation = 'DELETE_CONFIRMED' then true
    when requested_expected_state in ('DELETE_PENDING', 'DELETED')
      and requested_target_state = 'FROZEN'
      and requested_operation = 'RESTORE' then true
    when requested_expected_state = 'FROZEN'
      and requested_target_state = 'ACTIVE'
      and requested_operation = 'ACTIVATE' then true
    else false
  end;
  if not transition_allowed then
    raise exception using
      errcode = '22023',
      message = 'DA_APP_LIFECYCLE_TRANSITION_INVALID';
  end if;

  expected_receipt_hash := platform.compute_lifecycle_receipt_hash(
    requested_receipt_id,
    requested_app_id,
    requested_environment,
    requested_expected_state,
    requested_target_state,
    requested_operation,
    requested_details
  );
  if requested_receipt_hash is distinct from expected_receipt_hash then
    raise exception using
      errcode = '22023',
      message = 'DA_BOUNDARY_RECEIPT_HASH_INVALID';
  end if;

  if requested_operation = 'EXPORT_COMPLETED' and not exists (
    select 1
    from platform.resource_operation_receipts as operation_receipt
    join platform.resource_manifests as manifest
      on manifest.manifest_id = operation_receipt.manifest_id
     and manifest.app_id = operation_receipt.app_id
     and manifest.environment = operation_receipt.environment
    where operation_receipt.operation_receipt_id = platform.try_uuid(
        requested_details ->> 'operation_receipt_id'
      )
      and operation_receipt.app_id = requested_app_id
      and operation_receipt.environment = requested_environment
      and operation_receipt.authority_epoch = current_lifecycle.authority_epoch
      and manifest.authority_epoch = current_lifecycle.authority_epoch
      and operation_receipt.operation = 'EXPORT'
      and operation_receipt.source_state = requested_expected_state
      and operation_receipt.target_state = requested_target_state
      and operation_receipt.database_affected_count = manifest.database_count
      and operation_receipt.storage_affected_count = manifest.storage_count
      and operation_receipt.redis_affected_count = manifest.redis_count
      and operation_receipt.database_residual_count = manifest.database_count
      and operation_receipt.storage_residual_count = manifest.storage_count
      and operation_receipt.redis_residual_count = manifest.redis_count
      and manifest.payload_hash = requested_details ->> 'resource_manifest_hash'
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_EXPORT_OPERATION_RECEIPT_INVALID';
  end if;
  if requested_operation = 'EXPORT_COMPLETED' then
    raise exception using
      errcode = '55000',
      message = 'DA_EXTERNAL_EXPORT_VERIFIER_UNAVAILABLE';
  end if;

  if requested_operation = 'DELETE_CONFIRMED' and not exists (
    select 1
    from platform.resource_operation_receipts as delete_receipt
    join platform.resource_manifests as manifest
      on manifest.manifest_id = delete_receipt.manifest_id
     and manifest.app_id = delete_receipt.app_id
     and manifest.environment = delete_receipt.environment
    join platform.resource_operation_receipts as upstream
      on upstream.operation_receipt_id = delete_receipt.upstream_receipt_id
     and upstream.app_id = delete_receipt.app_id
     and upstream.environment = delete_receipt.environment
    where delete_receipt.operation_receipt_id = platform.try_uuid(
        requested_details ->> 'operation_receipt_id'
      )
      and delete_receipt.app_id = requested_app_id
      and delete_receipt.environment = requested_environment
      and delete_receipt.authority_epoch = current_lifecycle.authority_epoch
      and manifest.authority_epoch = current_lifecycle.authority_epoch
      and delete_receipt.operation = 'DELETE'
      and delete_receipt.source_state = requested_expected_state
      and delete_receipt.target_state = requested_target_state
      and manifest.source_state = 'DELETE_PENDING'
      and delete_receipt.database_affected_count = manifest.database_count
      and delete_receipt.storage_affected_count = manifest.storage_count
      and delete_receipt.redis_affected_count = manifest.redis_count
      and delete_receipt.database_residual_count = 0
      and delete_receipt.storage_residual_count = 0
      and delete_receipt.redis_residual_count = 0
      and upstream.operation in ('EXPORT', 'BACKUP')
      and upstream.operation_receipt_id = platform.try_uuid(
        requested_details ->> 'upstream_export_receipt_id'
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_DELETE_OPERATION_RECEIPT_INVALID';
  end if;
  if requested_operation = 'DELETE_CONFIRMED' then
    raise exception using
      errcode = '55000',
      message = 'DA_EXTERNAL_DELETE_VERIFIER_UNAVAILABLE';
  end if;

  if requested_operation = 'RESTORE' and not exists (
    select 1
    from platform.resource_operation_receipts as restore_basis
    where restore_basis.operation_receipt_id = platform.try_uuid(
        requested_details ->> 'operation_receipt_id'
      )
      and restore_basis.app_id = requested_app_id
      and restore_basis.environment = requested_environment
      and restore_basis.operation in ('EXPORT', 'BACKUP')
      and restore_basis.target_state = 'FROZEN'
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_RESTORE_OPERATION_RECEIPT_INVALID';
  end if;
  if requested_operation = 'RESTORE' then
    raise exception using
      errcode = '55000',
      message = 'DA_EXTERNAL_RESTORE_VERIFIER_UNAVAILABLE';
  end if;

  update platform.app_environment_lifecycle
  set lifecycle_state = requested_target_state,
      authority_epoch = authority_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where app_id = requested_app_id
    and environment = requested_environment;

  insert into platform.boundary_audit_receipts (
    receipt_id,
    app_id,
    environment,
    operation,
    status,
    previous_state,
    resulting_state,
    receipt_hash,
    details
  )
  values (
    requested_receipt_id,
    requested_app_id,
    requested_environment,
    requested_operation,
    'SUCCEEDED',
    requested_expected_state,
    requested_target_state,
    requested_receipt_hash,
    requested_details
  )
  returning * into receipt;

  insert into platform.app_lifecycle_events (
    event_id,
    app_id,
    environment,
    receipt_id,
    previous_state,
    resulting_state,
    operation
  )
  values (
    requested_receipt_id,
    requested_app_id,
    requested_environment,
    requested_receipt_id,
    requested_expected_state,
    requested_target_state,
    requested_operation
  );

  return receipt;
end
$$;

revoke all privileges on all tables in schema platform
from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on all sequences in schema platform
from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on all functions in schema platform
from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority,
  data_agent_secret_authority;

grant usage on schema platform to data_agent_platform_owner, data_agent_job_authority;
grant select on all tables in schema platform to data_agent_platform_owner;
grant insert, update on table
  platform.deployment_mappings,
  platform.demo_principals,
  platform.job_authorities
to data_agent_platform_owner;
grant usage, select on all sequences in schema platform to data_agent_platform_owner;
grant execute on function platform.register_app(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text
) to data_agent_platform_owner;
grant execute on function platform.register_api_operation(
  uuid,
  text,
  text
) to data_agent_platform_owner;
grant execute on function platform.transition_app_lifecycle(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) to data_agent_platform_owner;
grant execute on function platform.compute_lifecycle_receipt_hash(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) to data_agent_platform_owner;
grant execute on function platform.canonical_sha256(
  jsonb
) to data_agent_platform_owner, data_agent_job_authority;
grant execute on function platform.compute_resource_manifest_hash(
  uuid,
  uuid,
  text,
  text,
  bigint,
  bigint,
  bigint,
  bigint,
  jsonb
) to data_agent_job_authority;
grant execute on function platform.compute_resource_operation_hash(
  uuid,
  uuid,
  text,
  bigint,
  text,
  text,
  text,
  uuid,
  uuid,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint
) to data_agent_job_authority;
grant execute on function platform.cleanup_scope_authority(
  uuid,
  text,
  text
) to data_agent_job_authority;
grant execute on function platform.record_resource_manifest(
  uuid,
  uuid,
  text,
  text,
  bigint,
  bigint,
  bigint,
  bigint,
  jsonb,
  text,
  uuid,
  text,
  text
) to data_agent_job_authority;
grant execute on function platform.record_resource_operation_receipt(
  uuid,
  uuid,
  text,
  bigint,
  text,
  text,
  text,
  uuid,
  uuid,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  text,
  uuid,
  text,
  text
) to data_agent_job_authority;

grant usage on schema api to anon, authenticated, service_role, data_agent_backend;

alter default privileges in schema platform revoke all privileges on tables from public;
alter default privileges in schema platform revoke all privileges on sequences from public;
alter default privileges in schema platform revoke execute on functions from public;
alter default privileges in schema api revoke all privileges on tables from public;
alter default privileges in schema api revoke execute on functions from public;

select platform.assert_migration_checksum(
  'platform',
  null,
  '20260725000100_platform_foundation',
  'sha256:28a47b75076c9248621af8dd9d0b16091693a2c44add6f3d0edad6bcff7d0ad4'
);

commit;
