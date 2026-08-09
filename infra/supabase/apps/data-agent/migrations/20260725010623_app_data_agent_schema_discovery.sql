-- schema_discovery_migration_checksum: sha256:4e3548e2fbabf2e4a8bf05852550d6c49068d6db31bccdc7de8cc97412f334bb
-- ============================================================
-- 10623: PostgreSQL Schema Discovery Authority
-- ============================================================
-- Depends on: 20260725010622_app_data_agent_semantic_candidate_draft
-- Adds immutable physical catalog snapshots, append-only scan runs,
-- immutable drift events and narrow server-only RPCs.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SCHEMA_DISCOVERY_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SCHEMA_DISCOVERY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SCHEMA_DISCOVERY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010622_app_data_agent_semantic_candidate_draft';
  if not found then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_BASELINE_10622_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010623_app_data_agent_schema_discovery'
  ) then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_MIGRATION_10623_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regnamespace('catalog') is not null then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_CATALOG_SCHEMA_ALREADY_EXISTS';
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

create schema catalog authorization data_agent_u6_data_owner;
-- ============================================================
-- 10623: Immutable catalog authority tables
-- ============================================================

create table catalog.physical_schema_snapshot (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  datasource_id text not null
    check (datasource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  datasource_fingerprint text not null
    check (datasource_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_content_hash text not null
    check (snapshot_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  content_payload jsonb not null
    check (pg_catalog.jsonb_typeof(content_payload) = 'object'),
  content_storage_digest text not null
    check (content_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  first_observed_at timestamptz not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    snapshot_content_hash
  )
);

create table catalog.schema_scan_run (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  datasource_id text not null
    check (datasource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  datasource_fingerprint text not null
    check (datasource_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  scan_run_id uuid not null,
  snapshot_id uuid,
  principal_id uuid not null,
  idempotency_key uuid not null,
  request_digest text not null
    check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  terminal text not null
    check (terminal in (
      'SUCCEEDED',
      'SCHEMA_SCAN_CANCELLED',
      'SCHEMA_SCAN_TIMEOUT',
      'SCHEMA_SCAN_PERMISSION_DENIED',
      'SCHEMA_SCAN_DATASOURCE_UNAVAILABLE',
      'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID',
      'SCHEMA_SCAN_LIMIT_EXCEEDED',
      'SCHEMA_SCAN_SCOPE_FORBIDDEN',
      'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT'
    )),
  snapshot_content_hash text
    check (
      snapshot_content_hash is null
      or snapshot_content_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
  captured_at timestamptz not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, datasource_id, scan_run_id),
  unique (app_id, tenant_id, environment, snapshot_id),
  unique (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    principal_id,
    idempotency_key
  ),
  check (
    (terminal = 'SUCCEEDED' and snapshot_id is not null and snapshot_content_hash is not null)
    or
    (terminal <> 'SUCCEEDED' and snapshot_id is null and snapshot_content_hash is null)
  ),
  foreign key (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    snapshot_content_hash
  ) references catalog.physical_schema_snapshot (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    snapshot_content_hash
  )
);

create table catalog.schema_drift_event (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  datasource_id text not null
    check (datasource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  datasource_fingerprint text not null
    check (datasource_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  drift_event_id uuid not null,
  base_snapshot_content_hash text not null
    check (base_snapshot_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  current_snapshot_content_hash text not null
    check (current_snapshot_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  event_payload jsonb not null
    check (pg_catalog.jsonb_typeof(event_payload) = 'object'),
  event_storage_digest text not null
    check (event_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, datasource_id, drift_event_id),
  foreign key (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    base_snapshot_content_hash
  ) references catalog.physical_schema_snapshot (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    snapshot_content_hash
  ),
  foreign key (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    current_snapshot_content_hash
  ) references catalog.physical_schema_snapshot (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    snapshot_content_hash
  )
);

alter table catalog.physical_schema_snapshot owner to data_agent_u6_data_owner;
alter table catalog.schema_scan_run owner to data_agent_u6_data_owner;
alter table catalog.schema_drift_event owner to data_agent_u6_data_owner;

alter table catalog.physical_schema_snapshot enable row level security;
alter table catalog.physical_schema_snapshot force row level security;
alter table catalog.schema_scan_run enable row level security;
alter table catalog.schema_scan_run force row level security;
alter table catalog.schema_drift_event enable row level security;
alter table catalog.schema_drift_event force row level security;

create policy physical_schema_snapshot_scope_policy
  on catalog.physical_schema_snapshot
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );

create policy schema_scan_run_scope_policy
  on catalog.schema_scan_run
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );

create policy schema_drift_event_scope_policy
  on catalog.schema_drift_event
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );

create function catalog.reject_authority_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'SCHEMA_DISCOVERY_AUTHORITY_IMMUTABLE';
end;
$function$;

alter function catalog.reject_authority_mutation() owner to data_agent_u6_data_owner;
revoke all on function catalog.reject_authority_mutation() from public;

create trigger physical_schema_snapshot_immutable
before update or delete on catalog.physical_schema_snapshot
for each row execute function catalog.reject_authority_mutation();

create trigger schema_scan_run_append_only
before update or delete on catalog.schema_scan_run
for each row execute function catalog.reject_authority_mutation();

create trigger schema_drift_event_immutable
before update or delete on catalog.schema_drift_event
for each row execute function catalog.reject_authority_mutation();
-- ============================================================
-- 10623: Narrow schema discovery authority RPCs
-- ============================================================

create function catalog.assert_catalog_scope(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_require_write boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_app_id is null
    or p_tenant_id is null
    or p_environment is null
    or p_principal_id is null
    or nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid is distinct from p_app_id
    or nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid is distinct from p_tenant_id
    or nullif(pg_catalog.current_setting('data_agent.environment', true), '') is distinct from p_environment
    or nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid is distinct from p_principal_id
    or not platform.backend_context_matches(
      p_app_id,
      p_tenant_id,
      p_environment,
      p_require_write
    )
  then
    raise exception using errcode = '42501', message = 'SCHEMA_SCAN_SCOPE_FORBIDDEN';
  end if;
end;
$function$;

create function catalog.commit_schema_scan_success(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_datasource_id text,
  p_idempotency_key uuid,
  p_request_digest text,
  p_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_run catalog.schema_scan_run%rowtype;
  existing_snapshot catalog.physical_schema_snapshot%rowtype;
  v_scan_run_id uuid;
  v_snapshot_id uuid;
  v_datasource_fingerprint text;
  v_snapshot_content_hash text;
  v_captured_at timestamptz;
  v_content jsonb;
  v_content_storage_digest text;
begin
  perform catalog.assert_catalog_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    true
  );
  if p_datasource_id is null
    or p_datasource_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or p_idempotency_key is null
    or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot - array[
      'schema_version',
      'snapshot_id',
      'scan_run_id',
      'snapshot_content_hash',
      'captured_at',
      'content'
    ] <> '{}'::jsonb
    or p_snapshot ->> 'schema_version' <> 'physical-schema-snapshot@1.0.0'
    or pg_catalog.jsonb_typeof(p_snapshot -> 'content') <> 'object'
  then
    raise exception using errcode = '22023', message = 'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID';
  end if;

  begin
    v_scan_run_id := (p_snapshot ->> 'scan_run_id')::uuid;
    v_snapshot_id := (p_snapshot ->> 'snapshot_id')::uuid;
    v_snapshot_content_hash := p_snapshot ->> 'snapshot_content_hash';
    v_captured_at := (p_snapshot ->> 'captured_at')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID';
  end;
  v_content := p_snapshot -> 'content';
  v_datasource_fingerprint := v_content ->> 'datasource_fingerprint';
  if v_scan_run_id is null
    or v_snapshot_id is null
    or v_snapshot_content_hash !~ '^sha256:[0-9a-f]{64}$'
    or v_datasource_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or v_content ->> 'schema_version' <> 'physical-schema-content@1.0.0'
    or v_content ->> 'datasource_id' is distinct from p_datasource_id
    or v_content ->> 'engine' <> 'postgresql'
  then
    raise exception using errcode = '22023', message = 'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID';
  end if;
  v_content_storage_digest := platform.canonical_sha256(v_content);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        p_app_id,
        p_tenant_id,
        p_environment,
        p_datasource_id,
        p_principal_id,
        p_idempotency_key
      )::text,
      0
    )
  );

  select run.*
  into existing_run
  from catalog.schema_scan_run as run
  where run.app_id = p_app_id
    and run.tenant_id = p_tenant_id
    and run.environment = p_environment
    and run.datasource_id = p_datasource_id
    and run.principal_id = p_principal_id
    and run.idempotency_key = p_idempotency_key;
  if found then
    if existing_run.request_digest <> p_request_digest
      or existing_run.terminal <> 'SUCCEEDED'
      or existing_run.datasource_fingerprint <> v_datasource_fingerprint
      or existing_run.snapshot_content_hash <> v_snapshot_content_hash
    then
      raise exception using errcode = '23505', message = 'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'scan_run_id', existing_run.scan_run_id,
      'snapshot_id', existing_run.snapshot_id,
      'snapshot_content_hash', existing_run.snapshot_content_hash,
      'terminal', existing_run.terminal,
      'created', false
    );
  end if;

  insert into catalog.physical_schema_snapshot (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    snapshot_content_hash,
    content_payload,
    content_storage_digest,
    first_observed_at
  ) values (
    p_app_id,
    p_tenant_id,
    p_environment,
    p_datasource_id,
    v_datasource_fingerprint,
    v_snapshot_content_hash,
    v_content,
    v_content_storage_digest,
    v_captured_at
  ) on conflict do nothing;

  select snapshot.*
  into existing_snapshot
  from catalog.physical_schema_snapshot as snapshot
  where snapshot.app_id = p_app_id
    and snapshot.tenant_id = p_tenant_id
    and snapshot.environment = p_environment
    and snapshot.datasource_id = p_datasource_id
    and snapshot.datasource_fingerprint = v_datasource_fingerprint
    and snapshot.snapshot_content_hash = v_snapshot_content_hash;
  if not found
    or existing_snapshot.content_payload <> v_content
    or existing_snapshot.content_storage_digest <> v_content_storage_digest
  then
    raise exception using errcode = 'P0001', message = 'SCHEMA_SCAN_CONTENT_HASH_COLLISION';
  end if;

  insert into catalog.schema_scan_run (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    scan_run_id,
    snapshot_id,
    principal_id,
    idempotency_key,
    request_digest,
    terminal,
    snapshot_content_hash,
    captured_at
  ) values (
    p_app_id,
    p_tenant_id,
    p_environment,
    p_datasource_id,
    v_datasource_fingerprint,
    v_scan_run_id,
    v_snapshot_id,
    p_principal_id,
    p_idempotency_key,
    p_request_digest,
    'SUCCEEDED',
    v_snapshot_content_hash,
    v_captured_at
  );

  return pg_catalog.jsonb_build_object(
    'scan_run_id', v_scan_run_id,
    'snapshot_id', v_snapshot_id,
    'snapshot_content_hash', v_snapshot_content_hash,
    'terminal', 'SUCCEEDED',
    'created', true
  );
exception
  when unique_violation then
    if sqlerrm = 'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT' then
      raise;
    end if;
    raise exception using errcode = '23505', message = 'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT';
end;
$function$;

create function catalog.commit_schema_scan_failure(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_datasource_id text,
  p_datasource_fingerprint text,
  p_scan_run_id uuid,
  p_idempotency_key uuid,
  p_request_digest text,
  p_terminal text,
  p_captured_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_run catalog.schema_scan_run%rowtype;
begin
  perform catalog.assert_catalog_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    true
  );
  if p_datasource_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or p_datasource_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or p_scan_run_id is null
    or p_idempotency_key is null
    or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_terminal not in (
      'SCHEMA_SCAN_CANCELLED',
      'SCHEMA_SCAN_TIMEOUT',
      'SCHEMA_SCAN_PERMISSION_DENIED',
      'SCHEMA_SCAN_DATASOURCE_UNAVAILABLE',
      'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID',
      'SCHEMA_SCAN_LIMIT_EXCEEDED',
      'SCHEMA_SCAN_SCOPE_FORBIDDEN',
      'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT'
    )
    or p_captured_at is null
  then
    raise exception using errcode = '22023', message = 'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        p_app_id,
        p_tenant_id,
        p_environment,
        p_datasource_id,
        p_principal_id,
        p_idempotency_key
      )::text,
      0
    )
  );
  select run.*
  into existing_run
  from catalog.schema_scan_run as run
  where run.app_id = p_app_id
    and run.tenant_id = p_tenant_id
    and run.environment = p_environment
    and run.datasource_id = p_datasource_id
    and run.principal_id = p_principal_id
    and run.idempotency_key = p_idempotency_key;
  if found then
    if existing_run.request_digest <> p_request_digest
      or existing_run.terminal <> p_terminal
      or existing_run.datasource_fingerprint <> p_datasource_fingerprint
    then
      raise exception using errcode = '23505', message = 'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'scan_run_id', existing_run.scan_run_id,
      'terminal', existing_run.terminal,
      'created', false
    );
  end if;
  insert into catalog.schema_scan_run (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    scan_run_id,
    principal_id,
    idempotency_key,
    request_digest,
    terminal,
    captured_at
  ) values (
    p_app_id,
    p_tenant_id,
    p_environment,
    p_datasource_id,
    p_datasource_fingerprint,
    p_scan_run_id,
    p_principal_id,
    p_idempotency_key,
    p_request_digest,
    p_terminal,
    p_captured_at
  );
  return pg_catalog.jsonb_build_object(
    'scan_run_id', p_scan_run_id,
    'terminal', p_terminal,
    'created', true
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT';
end;
$function$;

create function catalog.commit_schema_drift(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_event catalog.schema_drift_event%rowtype;
  v_datasource_id text;
  v_datasource_fingerprint text;
  v_drift_event_id uuid;
  v_base_hash text;
  v_current_hash text;
  v_observed_at timestamptz;
  v_storage_digest text;
begin
  perform catalog.assert_catalog_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    true
  );
  if pg_catalog.jsonb_typeof(p_event) <> 'object'
    or p_event - array[
      'schema_version',
      'drift_event_id',
      'datasource_id',
      'datasource_fingerprint',
      'base_snapshot_content_hash',
      'current_snapshot_content_hash',
      'observed_at',
      'severity',
      'binding_impact',
      'operations'
    ] <> '{}'::jsonb
    or p_event ->> 'schema_version' <> 'schema-drift-event@1.0.0'
    or p_event ->> 'binding_impact' <> 'UNKNOWN'
    or pg_catalog.jsonb_typeof(p_event -> 'operations') <> 'array'
  then
    raise exception using errcode = '22023', message = 'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID';
  end if;
  begin
    v_drift_event_id := (p_event ->> 'drift_event_id')::uuid;
    v_observed_at := (p_event ->> 'observed_at')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID';
  end;
  v_datasource_id := p_event ->> 'datasource_id';
  v_datasource_fingerprint := p_event ->> 'datasource_fingerprint';
  v_base_hash := p_event ->> 'base_snapshot_content_hash';
  v_current_hash := p_event ->> 'current_snapshot_content_hash';
  if v_datasource_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or v_datasource_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or v_base_hash !~ '^sha256:[0-9a-f]{64}$'
    or v_current_hash !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'SCHEMA_SCAN_CATALOG_CONTRACT_INVALID';
  end if;
  v_storage_digest := platform.canonical_sha256(p_event);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        p_app_id,
        p_tenant_id,
        p_environment,
        v_datasource_id,
        v_drift_event_id
      )::text,
      0
    )
  );
  select event.*
  into existing_event
  from catalog.schema_drift_event as event
  where event.app_id = p_app_id
    and event.tenant_id = p_tenant_id
    and event.environment = p_environment
    and event.datasource_id = v_datasource_id
    and event.drift_event_id = v_drift_event_id;
  if found then
    if existing_event.event_storage_digest <> v_storage_digest
      or existing_event.event_payload <> p_event
    then
      raise exception using errcode = '23505', message = 'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'drift_event_id', existing_event.drift_event_id,
      'event_storage_digest', existing_event.event_storage_digest,
      'created', false
    );
  end if;
  insert into catalog.schema_drift_event (
    app_id,
    tenant_id,
    environment,
    datasource_id,
    datasource_fingerprint,
    drift_event_id,
    base_snapshot_content_hash,
    current_snapshot_content_hash,
    event_payload,
    event_storage_digest,
    observed_at
  ) values (
    p_app_id,
    p_tenant_id,
    p_environment,
    v_datasource_id,
    v_datasource_fingerprint,
    v_drift_event_id,
    v_base_hash,
    v_current_hash,
    p_event,
    v_storage_digest,
    v_observed_at
  );
  return pg_catalog.jsonb_build_object(
    'drift_event_id', v_drift_event_id,
    'event_storage_digest', v_storage_digest,
    'created', true
  );
exception
  when foreign_key_violation then
    raise exception using errcode = '23503', message = 'SCHEMA_SCAN_SNAPSHOT_NOT_FOUND';
end;
$function$;

create function catalog.get_schema_scan(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_datasource_id text,
  p_scan_run_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform catalog.assert_catalog_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    false
  );
  select pg_catalog.jsonb_build_object(
    'scan_run_id', run.scan_run_id,
    'datasource_id', run.datasource_id,
    'datasource_fingerprint', run.datasource_fingerprint,
    'snapshot_id', run.snapshot_id,
    'snapshot_content_hash', run.snapshot_content_hash,
    'terminal', run.terminal,
    'captured_at', run.captured_at
  )
  into result
  from catalog.schema_scan_run as run
  where run.app_id = p_app_id
    and run.tenant_id = p_tenant_id
    and run.environment = p_environment
    and run.datasource_id = p_datasource_id
    and run.scan_run_id = p_scan_run_id;
  return result;
end;
$function$;

create function catalog.get_physical_schema_snapshot(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_snapshot_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform catalog.assert_catalog_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    false
  );
  select pg_catalog.jsonb_build_object(
    'schema_version', 'physical-schema-snapshot@1.0.0',
    'snapshot_id', run.snapshot_id,
    'scan_run_id', run.scan_run_id,
    'snapshot_content_hash', run.snapshot_content_hash,
    'captured_at', run.captured_at,
    'content', snapshot.content_payload
  )
  into result
  from catalog.schema_scan_run as run
  join catalog.physical_schema_snapshot as snapshot
    on snapshot.app_id = run.app_id
    and snapshot.tenant_id = run.tenant_id
    and snapshot.environment = run.environment
    and snapshot.datasource_id = run.datasource_id
    and snapshot.datasource_fingerprint = run.datasource_fingerprint
    and snapshot.snapshot_content_hash = run.snapshot_content_hash
  where run.app_id = p_app_id
    and run.tenant_id = p_tenant_id
    and run.environment = p_environment
    and run.snapshot_id = p_snapshot_id
    and run.terminal = 'SUCCEEDED';
  return result;
end;
$function$;

create function catalog.get_schema_drift(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_datasource_id text,
  p_drift_event_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform catalog.assert_catalog_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    false
  );
  select event.event_payload
  into result
  from catalog.schema_drift_event as event
  where event.app_id = p_app_id
    and event.tenant_id = p_tenant_id
    and event.environment = p_environment
    and event.datasource_id = p_datasource_id
    and event.drift_event_id = p_drift_event_id;
  return result;
end;
$function$;
-- ============================================================
-- 10623: Exact grants and static postconditions
-- ============================================================

grant usage on schema catalog to data_agent_u6_rpc_owner;
grant usage on schema platform to data_agent_u6_rpc_owner;
grant execute on function platform.backend_context_matches(uuid, uuid, text, boolean)
  to data_agent_u6_rpc_owner;
grant execute on function platform.canonical_sha256(jsonb)
  to data_agent_u6_rpc_owner;

grant select, insert on table catalog.physical_schema_snapshot to data_agent_u6_rpc_owner;
grant select, insert on table catalog.schema_scan_run to data_agent_u6_rpc_owner;
grant select, insert on table catalog.schema_drift_event to data_agent_u6_rpc_owner;

alter function catalog.assert_catalog_scope(uuid, uuid, text, uuid, boolean)
  owner to data_agent_u6_rpc_owner;
alter function catalog.commit_schema_scan_success(uuid, uuid, text, uuid, text, uuid, text, jsonb)
  owner to data_agent_u6_rpc_owner;
alter function catalog.commit_schema_scan_failure(uuid, uuid, text, uuid, text, text, uuid, uuid, text, text, timestamptz)
  owner to data_agent_u6_rpc_owner;
alter function catalog.commit_schema_drift(uuid, uuid, text, uuid, jsonb)
  owner to data_agent_u6_rpc_owner;
alter function catalog.get_schema_scan(uuid, uuid, text, uuid, text, uuid)
  owner to data_agent_u6_rpc_owner;
alter function catalog.get_physical_schema_snapshot(uuid, uuid, text, uuid, uuid)
  owner to data_agent_u6_rpc_owner;
alter function catalog.get_schema_drift(uuid, uuid, text, uuid, text, uuid)
  owner to data_agent_u6_rpc_owner;

revoke all on function catalog.assert_catalog_scope(uuid, uuid, text, uuid, boolean)
  from public;
revoke all on function catalog.commit_schema_scan_success(uuid, uuid, text, uuid, text, uuid, text, jsonb)
  from public;
revoke all on function catalog.commit_schema_scan_failure(uuid, uuid, text, uuid, text, text, uuid, uuid, text, text, timestamptz)
  from public;
revoke all on function catalog.commit_schema_drift(uuid, uuid, text, uuid, jsonb)
  from public;
revoke all on function catalog.get_schema_scan(uuid, uuid, text, uuid, text, uuid)
  from public;
revoke all on function catalog.get_physical_schema_snapshot(uuid, uuid, text, uuid, uuid)
  from public;
revoke all on function catalog.get_schema_drift(uuid, uuid, text, uuid, text, uuid)
  from public;

grant execute on function catalog.assert_catalog_scope(uuid, uuid, text, uuid, boolean)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.commit_schema_scan_success(uuid, uuid, text, uuid, text, uuid, text, jsonb)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.commit_schema_scan_failure(uuid, uuid, text, uuid, text, text, uuid, uuid, text, text, timestamptz)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.commit_schema_drift(uuid, uuid, text, uuid, jsonb)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.get_schema_scan(uuid, uuid, text, uuid, text, uuid)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.get_physical_schema_snapshot(uuid, uuid, text, uuid, uuid)
  to data_agent_u6_rpc_owner;
grant execute on function catalog.get_schema_drift(uuid, uuid, text, uuid, text, uuid)
  to data_agent_u6_rpc_owner;

grant usage on schema catalog to data_agent_backend;
grant execute on function catalog.commit_schema_scan_success(uuid, uuid, text, uuid, text, uuid, text, jsonb)
  to data_agent_backend;
grant execute on function catalog.commit_schema_scan_failure(uuid, uuid, text, uuid, text, text, uuid, uuid, text, text, timestamptz)
  to data_agent_backend;
grant execute on function catalog.commit_schema_drift(uuid, uuid, text, uuid, jsonb)
  to data_agent_backend;
grant execute on function catalog.get_schema_scan(uuid, uuid, text, uuid, text, uuid)
  to data_agent_backend;
grant execute on function catalog.get_physical_schema_snapshot(uuid, uuid, text, uuid, uuid)
  to data_agent_backend;
grant execute on function catalog.get_schema_drift(uuid, uuid, text, uuid, text, uuid)
  to data_agent_backend;

revoke all on table catalog.physical_schema_snapshot from public;
revoke all on table catalog.schema_scan_run from public;
revoke all on table catalog.schema_drift_event from public;
revoke all on table catalog.physical_schema_snapshot from data_agent_backend;
revoke all on table catalog.schema_scan_run from data_agent_backend;
revoke all on table catalog.schema_drift_event from data_agent_backend;
revoke all on schema catalog from authenticated;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'physical_schema_snapshot',
    'schema_scan_run',
    'schema_drift_event'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles as owner
        on owner.oid = relation.relowner
      where namespace.nspname = 'catalog'
        and relation.relname = relation_name
        and relation.relkind = 'r'
        and relation.relrowsecurity
        and relation.relforcerowsecurity
        and owner.rolname = 'data_agent_u6_data_owner'
    ) then
      raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_TABLE_POSTCONDITION_FAILED';
    end if;
    if pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('catalog.%I', relation_name),
      'SELECT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('catalog.%I', relation_name),
      'INSERT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('catalog.%I', relation_name),
      'UPDATE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('catalog.%I', relation_name),
      'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_BACKEND_TABLE_ACL_FAILED';
    end if;
    if not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('catalog.%I', relation_name),
      'SELECT'
    ) or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('catalog.%I', relation_name),
      'INSERT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('catalog.%I', relation_name),
      'UPDATE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      pg_catalog.format('catalog.%I', relation_name),
      'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_RPC_OWNER_TABLE_ACL_FAILED';
    end if;
  end loop;

  foreach function_name in array array[
    'commit_schema_scan_success',
    'commit_schema_scan_failure',
    'commit_schema_drift',
    'get_schema_scan',
    'get_physical_schema_snapshot',
    'get_schema_drift'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner
      on owner.oid = procedure.proowner
    where namespace.nspname = 'catalog'
      and procedure.proname = function_name;
    if not found
      or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in (
        'search_path=',
        'search_path=""'
      )
    then
      raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_RPC_POSTCONDITION_FAILED';
    end if;
  end loop;

  if not pg_catalog.has_schema_privilege('data_agent_backend', 'catalog', 'USAGE')
    or pg_catalog.has_schema_privilege('authenticated', 'catalog', 'USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'catalog.commit_schema_scan_success(uuid,uuid,text,uuid,text,uuid,text,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'catalog.commit_schema_scan_success(uuid,uuid,text,uuid,text,uuid,text,jsonb)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_RPC_ACL_POSTCONDITION_FAILED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog'
      and trigger.tgname = 'physical_schema_snapshot_immutable'
      and not trigger.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog'
      and trigger.tgname = 'schema_scan_run_append_only'
      and not trigger.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog'
      and trigger.tgname = 'schema_drift_event_immutable'
      and not trigger.tgisinternal
  ) then
    raise exception using errcode = 'P0001', message = 'SCHEMA_DISCOVERY_IMMUTABILITY_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
-- ============================================================
-- 10623: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010623_app_data_agent_schema_discovery',
  'sha256:4e3548e2fbabf2e4a8bf05852550d6c49068d6db31bccdc7de8cc97412f334bb'
);

commit;
