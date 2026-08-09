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
