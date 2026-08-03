-- ============================================================
-- 10610: Legacy equivalence attempt, mirror, receipt, and closure authorization
-- ============================================================

-- ============================================================
-- 25. semantic_legacy_equivalence_attempt: legacy equivalence proof
-- Generated before publish, committed only in publish transaction
-- ============================================================
create table semantic.semantic_legacy_equivalence_attempt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  attempt_id uuid not null,
  release_id uuid not null,
  target_generation bigint not null
    check (target_generation between 0 and 9007199254740991),
  executable_projection_hash text not null
    check (executable_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  relationship_projection_hash text not null
    check (relationship_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_restriction_projection_hash text not null
    check (runtime_restriction_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  catalog_fence_epoch bigint not null,
  suite_digest text not null
    check (suite_digest ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, attempt_id),
  unique (app_id, tenant_id, environment, semantic_domain, suite_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 26. semantic_legacy_compatible_mirror: rollback-valid mirror for legacy resolver
-- ============================================================
create table semantic.semantic_legacy_compatible_mirror (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  mirror_id uuid not null,
  attempt_id uuid not null,
  release_id uuid not null,
  target_generation bigint not null
    check (target_generation between 0 and 9007199254740991),
  content_digest text not null
    check (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  minimum_reader_version text not null,
  minimum_materializer_version text not null,
  mirror_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, mirror_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, attempt_id)
    references semantic.semantic_legacy_equivalence_attempt (app_id, tenant_id, environment, semantic_domain, attempt_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 27. semantic_legacy_equivalence_receipt: committed release rollback window proof
-- Only proves hash-pinned suite; committed with release/attempt/mirror/pointer
-- ============================================================
create table semantic.semantic_legacy_equivalence_receipt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  receipt_id uuid not null,
  release_id uuid not null,
  attempt_id uuid not null,
  suite_digest text not null
    check (suite_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_digest text not null
    check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, receipt_id),
  unique (app_id, tenant_id, environment, semantic_domain, receipt_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, attempt_id)
    references semantic.semantic_legacy_equivalence_attempt (app_id, tenant_id, environment, semantic_domain, attempt_id)
);

-- ============================================================
-- 28. semantic_legacy_closure_authorization: close rollback window multi-signature
-- Exact domain/release/instance/traffic/cache/outbox/rehearsal digest
-- ============================================================
create table semantic.semantic_legacy_closure_authorization (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  authorization_id uuid not null,
  release_id uuid not null,
  closure_digest text not null
    check (closure_digest ~ '^sha256:[0-9a-f]{64}$'),
  instance_digest text not null
    check (instance_digest ~ '^sha256:[0-9a-f]{64}$'),
  traffic_digest text not null
    check (traffic_digest ~ '^sha256:[0-9a-f]{64}$'),
  cache_digest text not null
    check (cache_digest ~ '^sha256:[0-9a-f]{64}$'),
  outbox_digest text not null
    check (outbox_digest ~ '^sha256:[0-9a-f]{64}$'),
  rehearsal_digest text not null
    check (rehearsal_digest ~ '^sha256:[0-9a-f]{64}$'),
  nonce uuid not null,
  expires_at timestamptz not null,
  is_consumed boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  consumed_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, authorization_id),
  unique (app_id, tenant_id, environment, semantic_domain, nonce),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);
