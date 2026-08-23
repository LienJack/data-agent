-- ============================================================
-- 10610: Publish attempt and source release tables
-- ============================================================

-- ============================================================
-- 15. semantic_publish_attempt: A8 durable publish attempt
-- Identity and exact inputs immutable after creation; state CAS only
-- ============================================================
create table semantic.semantic_publish_attempt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  attempt_id uuid not null,
  packet_id uuid not null,
  candidate_id uuid not null,
  attempt_state text not null
    check (attempt_state in ('PREPARED', 'COMMITTED', 'STALE')),
  compiler_bundle_digest text not null
    check (compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  catalog_fence_epoch bigint not null,
  dependency_generation bigint not null,
  executable_projection_ref uuid,
  executable_projection_hash text
    check (executable_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  relationship_projection_ref uuid,
  relationship_projection_hash text
    check (relationship_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_restriction_projection_ref uuid,
  runtime_restriction_projection_hash text
    check (runtime_restriction_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  target_generation bigint not null
    check (target_generation between 0 and 9007199254740991),
  idempotency_digest text not null
    check (idempotency_digest ~ '^sha256:[0-9a-f]{64}$'),
  conditional_legacy_plan jsonb,
  terminal_code text,
  terminal_detail_digest text
    check (terminal_detail_digest ~ '^sha256:[0-9a-f]{64}$'),
  committed_release_ref uuid,
  committed_legacy_attempt_ref uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, attempt_id),
  unique (app_id, tenant_id, environment, semantic_domain, idempotency_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, candidate_id)
    references semantic.semantic_candidate (app_id, tenant_id, environment, semantic_domain, candidate_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, packet_id)
    references semantic.semantic_review_task (app_id, tenant_id, environment, semantic_domain, packet_id)
);

-- ============================================================
-- 16. semantic_source_release: approved and published Source
-- Immutable; exact packet/quorum; binds three core projection digests
-- ============================================================
create table semantic.semantic_source_release (
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
  attempt_id uuid not null,
  packet_id uuid not null,
  candidate_id uuid not null,
  release_digest text not null
    check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  compiler_bundle_digest text not null
    check (compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  executable_projection_ref uuid not null,
  executable_projection_hash text not null
    check (executable_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  relationship_projection_ref uuid not null,
  relationship_projection_hash text not null
    check (relationship_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_restriction_projection_ref uuid not null,
  runtime_restriction_projection_hash text not null
    check (runtime_restriction_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  profile_child_manifest jsonb,
  quorum_snapshot jsonb not null,
  decision_set_digest text not null
    check (decision_set_digest ~ '^sha256:[0-9a-f]{64}$'),
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  published_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain, release_id),
  unique (app_id, tenant_id, environment, semantic_domain, release_generation),
  unique (app_id, tenant_id, environment, semantic_domain, release_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, attempt_id)
    references semantic.semantic_publish_attempt (app_id, tenant_id, environment, semantic_domain, attempt_id)
);
