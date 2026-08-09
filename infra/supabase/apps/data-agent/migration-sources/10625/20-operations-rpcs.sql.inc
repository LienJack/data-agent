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
