-- ============================================================
-- 10641: Fenced lease ownership for semantic authoring Workers
-- ============================================================

alter table semantic.semantic_authoring_run
  add column lease_worker_id text,
  add column lease_token uuid,
  add column lease_claimed_at timestamptz,
  add column lease_heartbeat_at timestamptz,
  add column lease_expires_at timestamptz,
  add constraint semantic_authoring_lease_shape_check check (
    (lease_worker_id is null and lease_token is null and lease_claimed_at is null
      and lease_heartbeat_at is null and lease_expires_at is null)
    or
    (lease_worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
      and lease_token is not null and lease_claimed_at is not null
      and lease_heartbeat_at is not null and lease_expires_at is not null
      and lease_expires_at > lease_claimed_at)
  );

create index semantic_authoring_claimable_idx
  on semantic.semantic_authoring_run (
    app_id, tenant_id, environment, semantic_domain, principal_id, updated_at, authoring_run_id
  )
  where status = 'RUNNING';

create function semantic.claim_semantic_authoring_run(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_worker_id text,
  p_lease_duration_ms integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_authoring_run%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_token uuid := extensions.gen_random_uuid();
  v_expires_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or p_lease_duration_ms not between 5000 and 900000
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_LEASE_INPUT_INVALID';
  end if;
  select run.* into v_run
  from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id
    and run.tenant_id = p_tenant_id
    and run.environment = p_environment
    and run.semantic_domain = p_semantic_domain
    and run.principal_id = p_principal_id
    and run.status = 'RUNNING'
    and (run.lease_token is null or run.lease_expires_at <= v_now)
  order by run.updated_at, run.authoring_run_id
  for update skip locked
  limit 1;
  if not found then
    return null;
  end if;
  v_expires_at := v_now + (p_lease_duration_ms::text || ' milliseconds')::interval;
  update semantic.semantic_authoring_run set
    writer_fence = writer_fence + 1,
    lease_worker_id = p_worker_id,
    lease_token = v_token,
    lease_claimed_at = v_now,
    lease_heartbeat_at = v_now,
    lease_expires_at = v_expires_at,
    updated_at = v_now
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = v_run.authoring_run_id;
  insert into app_data_agent.audit_log (
    app_id, tenant_id, environment, audit_id, principal_id, action,
    resource_type, resource_id, details
  ) values (
    p_app_id, p_tenant_id, p_environment, extensions.gen_random_uuid(), p_principal_id,
    'SEMANTIC_AUTHORING_WORKER_CLAIMED', 'semantic_authoring_run', v_run.authoring_run_id::text,
    pg_catalog.jsonb_build_object(
      'worker_id', p_worker_id,
      'writer_fence', v_run.writer_fence + 1,
      'lease_expires_at', v_expires_at
    )
  );
  return pg_catalog.jsonb_build_object(
    'lease', pg_catalog.jsonb_build_object(
      'schema_version', 'semantic-authoring-lease@1.0.0',
      'scope', pg_catalog.jsonb_build_object(
        'app_id', p_app_id,
        'tenant_id', p_tenant_id,
        'environment', p_environment
      ),
      'semantic_domain', p_semantic_domain,
      'authoring_run_id', v_run.authoring_run_id,
      'principal_id', p_principal_id,
      'worker_id', p_worker_id,
      'lease_token', v_token,
      'writer_fence', v_run.writer_fence + 1,
      'claimed_at', v_now,
      'expires_at', v_expires_at
    ),
    'state', semantic.build_authoring_state(
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, v_run.authoring_run_id
    )
  );
end;
$function$;

create function semantic.heartbeat_semantic_authoring_run(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_expected_writer_fence bigint,
  p_lease_duration_ms integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_authoring_run%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_expires_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_lease_duration_ms not between 5000 and 900000 then
    raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_LEASE_INPUT_INVALID';
  end if;
  select run.* into v_run from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.authoring_run_id = p_authoring_run_id and run.principal_id = p_principal_id
  for update;
  if not found
    or v_run.status <> 'RUNNING'
    or v_run.writer_fence <> p_expected_writer_fence
    or v_run.lease_worker_id is distinct from p_worker_id
    or v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at <= v_now
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_LEASE_STALE';
  end if;
  v_expires_at := v_now + (p_lease_duration_ms::text || ' milliseconds')::interval;
  update semantic.semantic_authoring_run set
    lease_heartbeat_at = v_now,
    lease_expires_at = v_expires_at,
    updated_at = v_now
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = p_authoring_run_id;
  return pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-authoring-lease@1.0.0',
    'scope', pg_catalog.jsonb_build_object(
      'app_id', p_app_id,
      'tenant_id', p_tenant_id,
      'environment', p_environment
    ),
    'semantic_domain', p_semantic_domain,
    'authoring_run_id', p_authoring_run_id,
    'principal_id', p_principal_id,
    'worker_id', p_worker_id,
    'lease_token', p_lease_token,
    'writer_fence', p_expected_writer_fence,
    'claimed_at', v_run.lease_claimed_at,
    'expires_at', v_expires_at
  );
end;
$function$;

create function semantic.release_semantic_authoring_run(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_expected_writer_fence bigint
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_authoring_run%rowtype;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select run.* into v_run from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.authoring_run_id = p_authoring_run_id and run.principal_id = p_principal_id
  for update;
  if not found or v_run.writer_fence <> p_expected_writer_fence then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_LEASE_STALE';
  end if;
  if v_run.lease_token is null then
    return true;
  end if;
  if v_run.lease_worker_id is distinct from p_worker_id
    or v_run.lease_token is distinct from p_lease_token
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_LEASE_STALE';
  end if;
  update semantic.semantic_authoring_run set
    lease_worker_id = null,
    lease_token = null,
    lease_claimed_at = null,
    lease_heartbeat_at = null,
    lease_expires_at = null,
    updated_at = pg_catalog.clock_timestamp()
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = p_authoring_run_id;
  return true;
end;
$function$;
