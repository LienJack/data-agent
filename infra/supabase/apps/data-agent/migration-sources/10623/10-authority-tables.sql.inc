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
