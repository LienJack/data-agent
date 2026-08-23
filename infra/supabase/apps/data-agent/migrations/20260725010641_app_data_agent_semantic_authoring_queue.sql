-- semantic_authoring_queue_migration_checksum: sha256:ecdd2ec2c13765e4d0c01268398bbb2d85279354158d84c886d020e564867764
-- ============================================================
-- 10641: Semantic authoring Worker lease queue
-- ============================================================
-- Depends on: 20260725010640_app_data_agent_semantic_graph_studio

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_AUTHORING_QUEUE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_AUTHORING_QUEUE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010640_app_data_agent_semantic_graph_studio';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_QUEUE_BASELINE_10640_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010641_app_data_agent_semantic_authoring_queue'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_QUEUE_MIGRATION_10641_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_authoring_run') is null
    or pg_catalog.to_regprocedure('semantic.build_authoring_state(uuid,uuid,text,text,uuid)') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_QUEUE_AUTHORITY_SURFACE_MISSING';
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
-- ============================================================
-- 10641: Narrow queue grants and postconditions
-- ============================================================

alter function semantic.claim_semantic_authoring_run(uuid,uuid,text,uuid,text,text,integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.heartbeat_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint,integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.release_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.claim_semantic_authoring_run(uuid,uuid,text,uuid,text,text,integer) from public;
revoke all on function semantic.heartbeat_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint,integer) from public;
revoke all on function semantic.release_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint) from public;
grant execute on function semantic.claim_semantic_authoring_run(uuid,uuid,text,uuid,text,text,integer)
  to data_agent_backend;
grant execute on function semantic.heartbeat_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint,integer)
  to data_agent_backend;
grant execute on function semantic.release_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint)
  to data_agent_backend;

do $postconditions$
declare
  function_name text;
  function_record record;
begin
  if has_table_privilege(
    'data_agent_backend', 'semantic.semantic_authoring_run', 'SELECT,INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_QUEUE_TABLE_PRIVILEGE_LEAK';
  end if;
  foreach function_name in array array[
    'claim_semantic_authoring_run',
    'heartbeat_semantic_authoring_run',
    'release_semantic_authoring_run'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_QUEUE_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010641_app_data_agent_semantic_authoring_queue',
  'sha256:ecdd2ec2c13765e4d0c01268398bbb2d85279354158d84c886d020e564867764'
);

commit;
