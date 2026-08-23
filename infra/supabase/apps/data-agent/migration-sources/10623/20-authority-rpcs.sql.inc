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
