-- semantic_relationship_index_migration_checksum: sha256:e4087361a32b28d408737a822ef5828ccd9c94b71f6622ce04118228c96653c3
-- ============================================================
-- 10625: PostgreSQL-fenced semantic relationship index receipts
-- ============================================================
-- Depends on: 20260725010624_app_data_agent_semantic_explorer
-- PostgreSQL remains semantic Authority. These tables record rebuildable
-- Neo4j projection operations and receipts only.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_RELATIONSHIP_INDEX_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_RELATIONSHIP_INDEX_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_RELATIONSHIP_INDEX_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010624_app_data_agent_semantic_explorer';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_BASELINE_10624_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010625_app_data_agent_semantic_relationship_index'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_MIGRATION_10625_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_source_release') is null
    or pg_catalog.to_regclass('semantic.semantic_relationship_projection') is null
    or pg_catalog.to_regclass('semantic.semantic_outbox') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
    or pg_catalog.to_regprocedure('semantic.build_explorer_release_identity(uuid,uuid,text,text,uuid)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_AUTHORITY_SURFACE_MISSING';
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
-- 10625: Projection job, immutable attempt evidence and READY receipt
-- ============================================================

create table semantic.semantic_relationship_index_job (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  release_id uuid not null,
  release_generation bigint not null
    check (release_generation between 1 and 9007199254740991),
  release_digest text not null
    check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  relationship_projection_id uuid not null,
  relationship_projection_digest text not null
    check (relationship_projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'INDEXING', 'READY', 'FAILED')),
  attempt_fence bigint not null default 0
    check (attempt_fence between 0 and 9007199254740991),
  active_attempt_id uuid,
  lease_owner uuid,
  lease_expires_at timestamptz,
  failure_count integer not null default 0
    check (failure_count between 0 and 5),
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, release_id),
  unique (app_id, tenant_id, environment, semantic_domain, release_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id),
  check (
    (status = 'INDEXING' and active_attempt_id is not null and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'INDEXING' and active_attempt_id is null and lease_owner is null and lease_expires_at is null)
  )
);

create table semantic.semantic_relationship_index_attempt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  attempt_id uuid not null,
  release_id uuid not null,
  attempt_fence bigint not null
    check (attempt_fence between 1 and 9007199254740991),
  worker_id uuid not null,
  initial_lease_expires_at timestamptz not null,
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, attempt_id),
  unique (app_id, tenant_id, environment, semantic_domain, release_id, attempt_fence),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_relationship_index_job (app_id, tenant_id, environment, semantic_domain, release_id)
);

create table semantic.semantic_relationship_index_attempt_receipt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  attempt_id uuid not null,
  release_id uuid not null,
  attempt_fence bigint not null
    check (attempt_fence between 1 and 9007199254740991),
  terminal_state text not null
    check (terminal_state in ('COMMITTED', 'FAILED', 'EXPIRED')),
  build_id uuid,
  manifest_digest text
    check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  node_count integer check (node_count between 0 and 10000000),
  edge_count integer check (edge_count between 0 and 20000000),
  reason_code text check (reason_code in (
    'INDEX_UNAVAILABLE', 'INDEX_NOT_READY', 'INDEX_DIGEST_MISMATCH', 'INDEX_BUILD_FAILED',
    'INDEX_LEASE_EXPIRED', 'INDEX_ATTEMPT_STALE', 'AUTHORITY_CHANGED'
  )),
  completed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, attempt_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, attempt_id)
    references semantic.semantic_relationship_index_attempt (app_id, tenant_id, environment, semantic_domain, attempt_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id, attempt_fence)
    references semantic.semantic_relationship_index_attempt (
      app_id, tenant_id, environment, semantic_domain, release_id, attempt_fence
    ),
  check (
    (terminal_state = 'COMMITTED'
      and build_id is not null and manifest_digest is not null
      and node_count is not null and edge_count is not null and reason_code is null)
    or (terminal_state = 'FAILED'
      and build_id is null and manifest_digest is null
      and node_count is null and edge_count is null and reason_code is not null)
    or (terminal_state = 'EXPIRED'
      and build_id is null and manifest_digest is null
      and node_count is null and edge_count is null and reason_code = 'INDEX_LEASE_EXPIRED')
  )
);

create table semantic.semantic_relationship_index_checkpoint (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  release_id uuid not null,
  release_digest text not null
    check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  relationship_projection_id uuid not null,
  relationship_projection_digest text not null
    check (relationship_projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text not null check (state in ('READY', 'FAILED', 'STALE')),
  attempt_id uuid,
  attempt_fence bigint check (attempt_fence between 1 and 9007199254740991),
  build_id uuid,
  manifest_digest text
    check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  node_count integer check (node_count between 0 and 10000000),
  edge_count integer check (edge_count between 0 and 20000000),
  reason_code text check (reason_code in (
    'INDEX_UNAVAILABLE', 'INDEX_NOT_READY', 'INDEX_DIGEST_MISMATCH', 'INDEX_BUILD_FAILED',
    'INDEX_LEASE_EXPIRED', 'INDEX_ATTEMPT_STALE', 'AUTHORITY_CHANGED'
  )),
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  indexed_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, release_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_relationship_index_job (app_id, tenant_id, environment, semantic_domain, release_id),
  check (
    (state = 'READY'
      and attempt_id is not null and attempt_fence is not null and build_id is not null
      and manifest_digest is not null and node_count is not null and edge_count is not null
      and reason_code is null and indexed_at is not null)
    or (state <> 'READY' and indexed_at is null and reason_code is not null)
  )
);

create index semantic_relationship_index_job_claim_idx
  on semantic.semantic_relationship_index_job (app_id, tenant_id, environment, semantic_domain, next_attempt_at, release_generation)
  where status in ('PENDING', 'FAILED');
create index semantic_relationship_index_job_lease_idx
  on semantic.semantic_relationship_index_job (lease_expires_at)
  where status = 'INDEXING';
create index semantic_relationship_index_attempt_release_idx
  on semantic.semantic_relationship_index_attempt (app_id, tenant_id, environment, semantic_domain, release_id, attempt_fence desc);
create index semantic_relationship_index_attempt_receipt_release_idx
  on semantic.semantic_relationship_index_attempt_receipt (
    app_id, tenant_id, environment, semantic_domain, release_id, attempt_fence desc
  );
-- ============================================================
-- 10625: Scoped discovery, lease/fence operations and receipt read
-- ============================================================

create function semantic.reconcile_relationship_index_jobs(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text
) returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_inserted integer;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  insert into semantic.semantic_relationship_index_job (
    app_id, tenant_id, environment, semantic_domain,
    release_id, release_generation, release_digest,
    relationship_projection_id, relationship_projection_digest
  )
  select
    release.app_id, release.tenant_id, release.environment, release.semantic_domain,
    release.release_id, release.release_generation, release.release_digest,
    release.relationship_projection_ref, release.relationship_projection_hash
  from semantic.semantic_source_release as release
  join semantic.semantic_relationship_projection as projection
    on projection.app_id = release.app_id
   and projection.tenant_id = release.tenant_id
   and projection.environment = release.environment
   and projection.semantic_domain = release.semantic_domain
   and projection.projection_id = release.relationship_projection_ref
   and projection.release_id = release.release_id
   and projection.projection_digest = release.relationship_projection_hash
  where release.app_id = p_app_id
    and release.tenant_id = p_tenant_id
    and release.environment = p_environment
    and release.semantic_domain = p_semantic_domain
    and (
      exists (
        select 1
        from semantic.semantic_outbox as outbox
        where outbox.app_id = release.app_id
          and outbox.tenant_id = release.tenant_id
          and outbox.environment = release.environment
          and outbox.semantic_domain = release.semantic_domain
          and outbox.event_type in ('SOURCE_RELEASE_CREATED', 'SOURCE_RELEASE_ACTIVATED')
          and pg_catalog.jsonb_typeof(outbox.event_payload -> 'release_id') = 'string'
          and (outbox.event_payload ->> 'release_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and (outbox.event_payload ->> 'release_id')::uuid = release.release_id
      )
      or not exists (
        select 1
        from semantic.semantic_outbox as any_release_event
        where any_release_event.app_id = release.app_id
          and any_release_event.tenant_id = release.tenant_id
          and any_release_event.environment = release.environment
          and any_release_event.semantic_domain = release.semantic_domain
          and any_release_event.event_type in ('SOURCE_RELEASE_CREATED', 'SOURCE_RELEASE_ACTIVATED')
      )
    )
  on conflict (app_id, tenant_id, environment, semantic_domain, release_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

create function semantic.claim_relationship_index_job(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_worker_id uuid,
  p_lease_seconds integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_job semantic.semantic_relationship_index_job%rowtype;
  v_expired_job semantic.semantic_relationship_index_job%rowtype;
  v_attempt_id uuid;
  v_lease_expires_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_worker_id is null or p_lease_seconds not between 5 and 900 then
    raise exception using errcode = '22023', message = 'SEMANTIC_RELATIONSHIP_INDEX_CLAIM_INVALID';
  end if;

  -- Lock the job before writing its append-only attempt receipt. Heartbeat,
  -- commit and fail use the same job-first order, preventing lock inversion.
  for v_expired_job in
    select job.*
    from semantic.semantic_relationship_index_job as job
    where job.app_id = p_app_id
      and job.tenant_id = p_tenant_id
      and job.environment = p_environment
      and job.semantic_domain = p_semantic_domain
      and job.status = 'INDEXING'
      and job.lease_expires_at <= v_now
    order by job.release_generation asc, job.created_at asc
    for update skip locked
  loop
    insert into semantic.semantic_relationship_index_attempt_receipt (
      app_id, tenant_id, environment, semantic_domain,
      attempt_id, release_id, attempt_fence, terminal_state,
      reason_code, completed_at
    ) values (
      v_expired_job.app_id, v_expired_job.tenant_id,
      v_expired_job.environment, v_expired_job.semantic_domain,
      v_expired_job.active_attempt_id, v_expired_job.release_id,
      v_expired_job.attempt_fence, 'EXPIRED',
      'INDEX_LEASE_EXPIRED', v_now
    )
    on conflict (app_id, tenant_id, environment, semantic_domain, attempt_id) do nothing;

    update semantic.semantic_relationship_index_job as job
    set status = 'PENDING',
        active_attempt_id = null,
        lease_owner = null,
        lease_expires_at = null,
        next_attempt_at = v_now,
        updated_at = v_now
    where job.app_id = v_expired_job.app_id
      and job.tenant_id = v_expired_job.tenant_id
      and job.environment = v_expired_job.environment
      and job.semantic_domain = v_expired_job.semantic_domain
      and job.release_id = v_expired_job.release_id
      and job.active_attempt_id = v_expired_job.active_attempt_id
      and job.attempt_fence = v_expired_job.attempt_fence;
  end loop;

  select job.*
  into v_job
  from semantic.semantic_relationship_index_job as job
  where job.app_id = p_app_id
    and job.tenant_id = p_tenant_id
    and job.environment = p_environment
    and job.semantic_domain = p_semantic_domain
    and job.status in ('PENDING', 'FAILED')
    and job.failure_count < 5
    and job.next_attempt_at <= v_now
  order by job.release_generation asc, job.created_at asc
  for update skip locked
  limit 1;
  if not found then
    return null;
  end if;

  v_attempt_id := extensions.gen_random_uuid();
  v_lease_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);
  update semantic.semantic_relationship_index_job as job
  set status = 'INDEXING',
      attempt_fence = job.attempt_fence + 1,
      active_attempt_id = v_attempt_id,
      lease_owner = p_worker_id,
      lease_expires_at = v_lease_expires_at,
      updated_at = v_now
  where job.app_id = v_job.app_id
    and job.tenant_id = v_job.tenant_id
    and job.environment = v_job.environment
    and job.semantic_domain = v_job.semantic_domain
    and job.release_id = v_job.release_id
  returning job.* into v_job;

  insert into semantic.semantic_relationship_index_attempt (
    app_id, tenant_id, environment, semantic_domain,
    attempt_id, release_id, attempt_fence, worker_id,
    initial_lease_expires_at, claimed_at
  ) values (
    v_job.app_id, v_job.tenant_id, v_job.environment, v_job.semantic_domain,
    v_attempt_id, v_job.release_id, v_job.attempt_fence, p_worker_id,
    v_lease_expires_at, v_now
  );

  return pg_catalog.jsonb_build_object(
    'semantic_domain', v_job.semantic_domain,
    'release_id', v_job.release_id,
    'release_generation', v_job.release_generation,
    'release_digest', v_job.release_digest,
    'relationship_projection_id', v_job.relationship_projection_id,
    'relationship_projection_digest', v_job.relationship_projection_digest,
    'attempt_id', v_attempt_id,
    'attempt_fence', v_job.attempt_fence,
    'worker_id', p_worker_id,
    'lease_expires_at', v_lease_expires_at
  );
end;
$function$;

create function semantic.heartbeat_relationship_index_attempt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_attempt_id uuid,
  p_attempt_fence bigint,
  p_worker_id uuid,
  p_lease_seconds integer
) returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_lease_expires_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_lease_seconds not between 5 and 900 then
    raise exception using errcode = '22023', message = 'SEMANTIC_RELATIONSHIP_INDEX_HEARTBEAT_INVALID';
  end if;
  v_lease_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);
  update semantic.semantic_relationship_index_job as job
  set lease_expires_at = v_lease_expires_at,
      updated_at = v_now
  where job.app_id = p_app_id
    and job.tenant_id = p_tenant_id
    and job.environment = p_environment
    and job.semantic_domain = p_semantic_domain
    and job.status = 'INDEXING'
    and job.active_attempt_id = p_attempt_id
    and job.attempt_fence = p_attempt_fence
    and job.lease_owner = p_worker_id
    and job.lease_expires_at > v_now;
  if not found then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE';
  end if;
  return v_lease_expires_at;
end;
$function$;

create function semantic.get_relationship_index_checkpoint(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_release_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_checkpoint semantic.semantic_relationship_index_checkpoint%rowtype;
  v_release_identity jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select checkpoint.* into v_checkpoint
  from semantic.semantic_relationship_index_checkpoint as checkpoint
  where checkpoint.app_id = p_app_id
    and checkpoint.tenant_id = p_tenant_id
    and checkpoint.environment = p_environment
    and checkpoint.semantic_domain = p_semantic_domain
    and checkpoint.release_id = p_release_id;
  if not found then
    return null;
  end if;
  v_release_identity := semantic.build_explorer_release_identity(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_release_id
  );
  if v_release_identity is null
    or v_release_identity ->> 'release_digest' <> v_checkpoint.release_digest
    or v_release_identity #>> '{relationship_projection,projection_id}' <> v_checkpoint.relationship_projection_id::text
    or v_release_identity #>> '{relationship_projection,projection_digest}' <> v_checkpoint.relationship_projection_digest
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_AUTHORITY_CHANGED';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-relationship-index-checkpoint@1.0.0',
    'semantic_domain', v_checkpoint.semantic_domain,
    'release_identity', v_release_identity,
    'state', v_checkpoint.state,
    'attempt_id', v_checkpoint.attempt_id,
    'attempt_fence', v_checkpoint.attempt_fence,
    'build_id', v_checkpoint.build_id,
    'manifest_digest', v_checkpoint.manifest_digest,
    'relationship_projection_digest', v_checkpoint.relationship_projection_digest,
    'node_count', v_checkpoint.node_count,
    'edge_count', v_checkpoint.edge_count,
    'reason_code', v_checkpoint.reason_code,
    'observed_at', v_checkpoint.observed_at,
    'indexed_at', v_checkpoint.indexed_at
  );
end;
$function$;

create function semantic.commit_relationship_index_attempt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_attempt_id uuid,
  p_attempt_fence bigint,
  p_worker_id uuid,
  p_build_id uuid,
  p_manifest_digest text,
  p_release_digest text,
  p_relationship_projection_digest text,
  p_node_count integer,
  p_edge_count integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_job semantic.semantic_relationship_index_job%rowtype;
  v_release semantic.semantic_source_release%rowtype;
  v_existing record;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_attempt_id is null
    or p_attempt_fence is null
    or p_worker_id is null
    or p_build_id is null
    or p_manifest_digest is null
    or p_manifest_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_release_digest is null
    or p_release_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_relationship_projection_digest is null
    or p_relationship_projection_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_node_count is null
    or p_node_count not between 0 and 10000000
    or p_edge_count is null
    or p_edge_count not between 0 and 20000000
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_RELATIONSHIP_INDEX_COMMIT_INVALID';
  end if;

  -- A lost response may replay the exact terminal commit. Only the original
  -- worker and byte-for-byte receipt identity may observe that idempotent result.
  select
    receipt.release_id,
    receipt.build_id,
    receipt.manifest_digest,
    receipt.node_count,
    receipt.edge_count,
    checkpoint.release_digest,
    checkpoint.relationship_projection_digest,
    checkpoint.state,
    checkpoint.attempt_id,
    checkpoint.attempt_fence
  into v_existing
  from semantic.semantic_relationship_index_attempt_receipt as receipt
  join semantic.semantic_relationship_index_attempt as attempt
    on attempt.app_id = receipt.app_id
   and attempt.tenant_id = receipt.tenant_id
   and attempt.environment = receipt.environment
   and attempt.semantic_domain = receipt.semantic_domain
   and attempt.attempt_id = receipt.attempt_id
  join semantic.semantic_relationship_index_checkpoint as checkpoint
    on checkpoint.app_id = receipt.app_id
   and checkpoint.tenant_id = receipt.tenant_id
   and checkpoint.environment = receipt.environment
   and checkpoint.semantic_domain = receipt.semantic_domain
   and checkpoint.release_id = receipt.release_id
  where receipt.app_id = p_app_id
    and receipt.tenant_id = p_tenant_id
    and receipt.environment = p_environment
    and receipt.semantic_domain = p_semantic_domain
    and receipt.attempt_id = p_attempt_id
    and receipt.attempt_fence = p_attempt_fence
    and receipt.terminal_state = 'COMMITTED'
    and attempt.worker_id = p_worker_id;
  if found then
    if v_existing.build_id <> p_build_id
      or v_existing.manifest_digest <> p_manifest_digest
      or v_existing.node_count <> p_node_count
      or v_existing.edge_count <> p_edge_count
      or v_existing.release_digest <> p_release_digest
      or v_existing.relationship_projection_digest <> p_relationship_projection_digest
      or v_existing.state <> 'READY'
      or v_existing.attempt_id <> p_attempt_id
      or v_existing.attempt_fence <> p_attempt_fence
    then
      raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE';
    end if;
    return semantic.get_relationship_index_checkpoint(
      p_app_id, p_tenant_id, p_environment, p_principal_id,
      p_semantic_domain, v_existing.release_id
    );
  end if;

  select job.* into v_job
  from semantic.semantic_relationship_index_job as job
  where job.app_id = p_app_id
    and job.tenant_id = p_tenant_id
    and job.environment = p_environment
    and job.semantic_domain = p_semantic_domain
    and job.active_attempt_id = p_attempt_id
  for update;
  if not found
    or v_job.status <> 'INDEXING'
    or v_job.attempt_fence <> p_attempt_fence
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= v_now
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE';
  end if;

  select release.* into v_release
  from semantic.semantic_source_release as release
  where release.app_id = v_job.app_id
    and release.tenant_id = v_job.tenant_id
    and release.environment = v_job.environment
    and release.semantic_domain = v_job.semantic_domain
    and release.release_id = v_job.release_id;
  if not found
    or v_release.release_digest <> v_job.release_digest
    or v_release.release_digest <> p_release_digest
    or v_release.relationship_projection_ref <> v_job.relationship_projection_id
    or v_release.relationship_projection_hash <> v_job.relationship_projection_digest
    or v_release.relationship_projection_hash <> p_relationship_projection_digest
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_AUTHORITY_CHANGED';
  end if;

  insert into semantic.semantic_relationship_index_checkpoint (
    app_id, tenant_id, environment, semantic_domain,
    release_id, release_digest, relationship_projection_id, relationship_projection_digest,
    state, attempt_id, attempt_fence, build_id, manifest_digest,
    node_count, edge_count, reason_code, observed_at, indexed_at
  ) values (
    v_job.app_id, v_job.tenant_id, v_job.environment, v_job.semantic_domain,
    v_job.release_id, v_job.release_digest, v_job.relationship_projection_id, v_job.relationship_projection_digest,
    'READY', p_attempt_id, p_attempt_fence, p_build_id, p_manifest_digest,
    p_node_count, p_edge_count, null, v_now, v_now
  )
  on conflict (app_id, tenant_id, environment, semantic_domain, release_id) do update
  set release_digest = excluded.release_digest,
      relationship_projection_id = excluded.relationship_projection_id,
      relationship_projection_digest = excluded.relationship_projection_digest,
      state = excluded.state,
      attempt_id = excluded.attempt_id,
      attempt_fence = excluded.attempt_fence,
      build_id = excluded.build_id,
      manifest_digest = excluded.manifest_digest,
      node_count = excluded.node_count,
      edge_count = excluded.edge_count,
      reason_code = null,
      observed_at = excluded.observed_at,
      indexed_at = excluded.indexed_at;

  insert into semantic.semantic_relationship_index_attempt_receipt (
    app_id, tenant_id, environment, semantic_domain,
    attempt_id, release_id, attempt_fence, terminal_state,
    build_id, manifest_digest, node_count, edge_count, completed_at
  )
  select
    attempt.app_id, attempt.tenant_id, attempt.environment, attempt.semantic_domain,
    attempt.attempt_id, attempt.release_id, attempt.attempt_fence, 'COMMITTED',
    p_build_id, p_manifest_digest, p_node_count, p_edge_count, v_now
  from semantic.semantic_relationship_index_attempt as attempt
  where attempt.app_id = p_app_id
    and attempt.tenant_id = p_tenant_id
    and attempt.environment = p_environment
    and attempt.semantic_domain = p_semantic_domain
    and attempt.attempt_id = p_attempt_id
    and attempt.attempt_fence = p_attempt_fence
    and attempt.worker_id = p_worker_id;
  if not found then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE';
  end if;

  update semantic.semantic_relationship_index_job as job
  set status = 'READY',
      active_attempt_id = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = v_now
  where job.app_id = v_job.app_id
    and job.tenant_id = v_job.tenant_id
    and job.environment = v_job.environment
    and job.semantic_domain = v_job.semantic_domain
    and job.release_id = v_job.release_id;

  return semantic.get_relationship_index_checkpoint(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain, v_job.release_id
  );
end;
$function$;

create function semantic.requeue_relationship_index_release(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_release_id uuid,
  p_expected_build_id uuid,
  p_expected_manifest_digest text,
  p_reason_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_job semantic.semantic_relationship_index_job%rowtype;
  v_checkpoint semantic.semantic_relationship_index_checkpoint%rowtype;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_release_id is null
    or p_expected_build_id is null
    or p_expected_manifest_digest is null
    or p_expected_manifest_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_reason_code not in ('INDEX_NOT_READY', 'INDEX_DIGEST_MISMATCH')
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_RELATIONSHIP_INDEX_REQUEUE_INVALID';
  end if;

  select job.* into v_job
  from semantic.semantic_relationship_index_job as job
  where job.app_id = p_app_id
    and job.tenant_id = p_tenant_id
    and job.environment = p_environment
    and job.semantic_domain = p_semantic_domain
    and job.release_id = p_release_id
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_AUTHORITY_CHANGED';
  end if;

  select checkpoint.* into v_checkpoint
  from semantic.semantic_relationship_index_checkpoint as checkpoint
  where checkpoint.app_id = p_app_id
    and checkpoint.tenant_id = p_tenant_id
    and checkpoint.environment = p_environment
    and checkpoint.semantic_domain = p_semantic_domain
    and checkpoint.release_id = p_release_id
  for update;
  if not found
    or v_checkpoint.release_digest <> v_job.release_digest
    or v_checkpoint.relationship_projection_digest <> v_job.relationship_projection_digest
    or v_checkpoint.build_id <> p_expected_build_id
    or v_checkpoint.manifest_digest <> p_expected_manifest_digest
    or not (
      (v_job.status = 'READY' and v_checkpoint.state = 'READY')
      or (
        v_job.status = 'PENDING'
        and v_checkpoint.state = 'STALE'
        and v_checkpoint.reason_code = p_reason_code
      )
    )
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE';
  end if;

  if v_job.status = 'READY' then
    update semantic.semantic_relationship_index_job as job
    set status = 'PENDING',
        active_attempt_id = null,
        lease_owner = null,
        lease_expires_at = null,
        failure_count = 0,
        next_attempt_at = v_now,
        updated_at = v_now
    where job.app_id = v_job.app_id
      and job.tenant_id = v_job.tenant_id
      and job.environment = v_job.environment
      and job.semantic_domain = v_job.semantic_domain
      and job.release_id = v_job.release_id;

    update semantic.semantic_relationship_index_checkpoint as checkpoint
    set state = 'STALE',
        reason_code = p_reason_code,
        observed_at = v_now,
        indexed_at = null
    where checkpoint.app_id = v_checkpoint.app_id
      and checkpoint.tenant_id = v_checkpoint.tenant_id
      and checkpoint.environment = v_checkpoint.environment
      and checkpoint.semantic_domain = v_checkpoint.semantic_domain
      and checkpoint.release_id = v_checkpoint.release_id;
  end if;

  return semantic.get_relationship_index_checkpoint(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain, p_release_id
  );
end;
$function$;

create function semantic.fail_relationship_index_attempt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_attempt_id uuid,
  p_attempt_fence bigint,
  p_worker_id uuid,
  p_reason_code text
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_job semantic.semantic_relationship_index_job%rowtype;
  v_preserve_ready boolean;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_reason_code is null or p_reason_code not in (
    'INDEX_UNAVAILABLE', 'INDEX_DIGEST_MISMATCH', 'INDEX_BUILD_FAILED',
    'INDEX_LEASE_EXPIRED', 'INDEX_ATTEMPT_STALE', 'AUTHORITY_CHANGED'
  ) then
    raise exception using errcode = '22023', message = 'SEMANTIC_RELATIONSHIP_INDEX_REASON_INVALID';
  end if;
  select job.* into v_job
  from semantic.semantic_relationship_index_job as job
  where job.app_id = p_app_id
    and job.tenant_id = p_tenant_id
    and job.environment = p_environment
    and job.semantic_domain = p_semantic_domain
    and job.status = 'INDEXING'
    and job.active_attempt_id = p_attempt_id
    and job.attempt_fence = p_attempt_fence
    and job.lease_owner = p_worker_id
    and job.lease_expires_at > v_now
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE';
  end if;

  select exists (
    select 1
    from semantic.semantic_relationship_index_checkpoint as checkpoint
    where checkpoint.app_id = v_job.app_id
      and checkpoint.tenant_id = v_job.tenant_id
      and checkpoint.environment = v_job.environment
      and checkpoint.semantic_domain = v_job.semantic_domain
      and checkpoint.release_id = v_job.release_id
      and checkpoint.state = 'READY'
      and checkpoint.release_digest = v_job.release_digest
      and checkpoint.relationship_projection_digest = v_job.relationship_projection_digest
  ) into v_preserve_ready;

  insert into semantic.semantic_relationship_index_attempt_receipt (
    app_id, tenant_id, environment, semantic_domain,
    attempt_id, release_id, attempt_fence, terminal_state,
    reason_code, completed_at
  )
  select
    attempt.app_id, attempt.tenant_id, attempt.environment, attempt.semantic_domain,
    attempt.attempt_id, attempt.release_id, attempt.attempt_fence, 'FAILED',
    p_reason_code, v_now
  from semantic.semantic_relationship_index_attempt as attempt
  where attempt.app_id = p_app_id
    and attempt.tenant_id = p_tenant_id
    and attempt.environment = p_environment
    and attempt.semantic_domain = p_semantic_domain
    and attempt.attempt_id = p_attempt_id
    and attempt.attempt_fence = p_attempt_fence
    and attempt.worker_id = p_worker_id;
  if not found then
    raise exception using errcode = '40001', message = 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE';
  end if;

  update semantic.semantic_relationship_index_job as job
  set status = case when v_preserve_ready then 'READY' else 'FAILED' end,
      active_attempt_id = null,
      lease_owner = null,
      lease_expires_at = null,
      failure_count = job.failure_count + 1,
      next_attempt_at = case
        when v_preserve_ready or job.failure_count + 1 >= 5 then 'infinity'::timestamptz
        else v_now + pg_catalog.make_interval(secs => pg_catalog.least(300, 5 * (job.failure_count + 1)))
      end,
      updated_at = v_now
  where job.app_id = v_job.app_id
    and job.tenant_id = v_job.tenant_id
    and job.environment = v_job.environment
    and job.semantic_domain = v_job.semantic_domain
    and job.release_id = v_job.release_id;

  insert into semantic.semantic_relationship_index_checkpoint (
    app_id, tenant_id, environment, semantic_domain,
    release_id, release_digest, relationship_projection_id, relationship_projection_digest,
    state, reason_code, observed_at
  )
  select
    job.app_id, job.tenant_id, job.environment, job.semantic_domain,
    job.release_id, job.release_digest, job.relationship_projection_id, job.relationship_projection_digest,
    'FAILED', p_reason_code, v_now
  from semantic.semantic_relationship_index_job as job
  where job.app_id = p_app_id
    and job.tenant_id = p_tenant_id
    and job.environment = p_environment
    and job.semantic_domain = p_semantic_domain
    and job.release_id = v_job.release_id
  on conflict (app_id, tenant_id, environment, semantic_domain, release_id) do update
  set state = 'FAILED',
      attempt_id = null,
      attempt_fence = null,
      build_id = null,
      manifest_digest = null,
      node_count = null,
      edge_count = null,
      reason_code = excluded.reason_code,
      observed_at = excluded.observed_at,
      indexed_at = null
  where semantic.semantic_relationship_index_checkpoint.state <> 'READY';
end;
$function$;
-- ============================================================
-- 10625: RLS, ownership, exact grants and static postconditions
-- ============================================================

alter table semantic.semantic_relationship_index_job owner to data_agent_u6_data_owner;
alter table semantic.semantic_relationship_index_attempt owner to data_agent_u6_data_owner;
alter table semantic.semantic_relationship_index_attempt_receipt owner to data_agent_u6_data_owner;
alter table semantic.semantic_relationship_index_checkpoint owner to data_agent_u6_data_owner;

alter table semantic.semantic_relationship_index_job enable row level security;
alter table semantic.semantic_relationship_index_job force row level security;
alter table semantic.semantic_relationship_index_attempt enable row level security;
alter table semantic.semantic_relationship_index_attempt force row level security;
alter table semantic.semantic_relationship_index_attempt_receipt enable row level security;
alter table semantic.semantic_relationship_index_attempt_receipt force row level security;
alter table semantic.semantic_relationship_index_checkpoint enable row level security;
alter table semantic.semantic_relationship_index_checkpoint force row level security;

create policy semantic_relationship_index_job_rpc_scope_policy
  on semantic.semantic_relationship_index_job
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_relationship_index_attempt_rpc_scope_policy
  on semantic.semantic_relationship_index_attempt
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_relationship_index_checkpoint_rpc_scope_policy
  on semantic.semantic_relationship_index_checkpoint
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_relationship_index_attempt_receipt_rpc_scope_policy
  on semantic.semantic_relationship_index_attempt_receipt
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_outbox_relationship_index_scope_policy
  on semantic.semantic_outbox
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

grant select, insert, update on table semantic.semantic_relationship_index_job to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_relationship_index_attempt to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_relationship_index_attempt_receipt to data_agent_u6_rpc_owner;
grant select, insert, update on table semantic.semantic_relationship_index_checkpoint to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_outbox to data_agent_u6_rpc_owner;

alter function semantic.reconcile_relationship_index_jobs(uuid, uuid, text, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.claim_relationship_index_job(uuid, uuid, text, uuid, text, uuid, integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.heartbeat_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.commit_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.requeue_relationship_index_release(uuid, uuid, text, uuid, text, uuid, uuid, text, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.fail_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_relationship_index_checkpoint(uuid, uuid, text, uuid, text, uuid)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.reconcile_relationship_index_jobs(uuid, uuid, text, uuid, text) from public;
revoke all on function semantic.claim_relationship_index_job(uuid, uuid, text, uuid, text, uuid, integer) from public;
revoke all on function semantic.heartbeat_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, integer) from public;
revoke all on function semantic.commit_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer) from public;
revoke all on function semantic.requeue_relationship_index_release(uuid, uuid, text, uuid, text, uuid, uuid, text, text) from public;
revoke all on function semantic.fail_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, text) from public;
revoke all on function semantic.get_relationship_index_checkpoint(uuid, uuid, text, uuid, text, uuid) from public;

grant execute on function semantic.reconcile_relationship_index_jobs(uuid, uuid, text, uuid, text)
  to data_agent_backend;
grant execute on function semantic.claim_relationship_index_job(uuid, uuid, text, uuid, text, uuid, integer)
  to data_agent_backend;
grant execute on function semantic.heartbeat_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, integer)
  to data_agent_backend;
grant execute on function semantic.commit_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer)
  to data_agent_backend;
grant execute on function semantic.requeue_relationship_index_release(uuid, uuid, text, uuid, text, uuid, uuid, text, text)
  to data_agent_backend;
grant execute on function semantic.fail_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, text)
  to data_agent_backend;
grant execute on function semantic.get_relationship_index_checkpoint(uuid, uuid, text, uuid, text, uuid)
  to data_agent_backend;

revoke all on table semantic.semantic_relationship_index_job from data_agent_backend;
revoke all on table semantic.semantic_relationship_index_attempt from data_agent_backend;
revoke all on table semantic.semantic_relationship_index_attempt_receipt from data_agent_backend;
revoke all on table semantic.semantic_relationship_index_checkpoint from data_agent_backend;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'semantic_relationship_index_job',
    'semantic_relationship_index_attempt',
    'semantic_relationship_index_attempt_receipt',
    'semantic_relationship_index_checkpoint'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'SELECT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'INSERT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'UPDATE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_BACKEND_TABLE_ACL_FAILED';
    end if;
    if not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'SELECT'
    ) or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'INSERT'
    ) or (
      relation_name in ('semantic_relationship_index_job', 'semantic_relationship_index_checkpoint')
      and not pg_catalog.has_table_privilege(
        'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'UPDATE'
      )
    ) or (
      relation_name in ('semantic_relationship_index_attempt', 'semantic_relationship_index_attempt_receipt')
      and pg_catalog.has_table_privilege(
        'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'UPDATE'
      )
    ) or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_RPC_OWNER_TABLE_ACL_FAILED';
    end if;
  end loop;

  foreach function_name in array array[
    'reconcile_relationship_index_jobs',
    'claim_relationship_index_job',
    'heartbeat_relationship_index_attempt',
    'commit_relationship_index_attempt',
    'requeue_relationship_index_release',
    'fail_relationship_index_attempt',
    'get_relationship_index_checkpoint'
  ] loop
    select
      procedure.prosecdef,
      procedure.proconfig,
      procedure.provolatile,
      owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic'
      and procedure.proname = function_name;
    if not found
      or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
      or (
        function_name = 'get_relationship_index_checkpoint'
        and function_record.provolatile <> 's'
      )
      or (
        function_name <> 'get_relationship_index_checkpoint'
        and function_record.provolatile <> 'v'
      )
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_RPC_POSTCONDITION_FAILED';
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'semantic.get_relationship_index_checkpoint(uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'semantic.get_relationship_index_checkpoint(uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'semantic.claim_relationship_index_job(uuid,uuid,text,uuid,text,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_RPC_ACL_POSTCONDITION_FAILED';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname in (
        'semantic_relationship_index_job_rpc_scope_policy',
        'semantic_relationship_index_attempt_rpc_scope_policy',
        'semantic_relationship_index_attempt_receipt_rpc_scope_policy',
        'semantic_relationship_index_checkpoint_rpc_scope_policy'
      )
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
      and policy.qual like '%semantic_domain%'
  ) <> 4 then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_RLS_POSTCONDITION_FAILED';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname = 'semantic_outbox_relationship_index_scope_policy'
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
      and policy.qual like '%semantic_domain%'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_OUTBOX_RLS_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
-- ============================================================
-- 10625: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010625_app_data_agent_semantic_relationship_index',
  'sha256:e4087361a32b28d408737a822ef5828ccd9c94b71f6622ce04118228c96653c3'
);

commit;
