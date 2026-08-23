-- ============================================================
-- 10610: Projection tables (executable, relationship, restriction, profile)
-- ============================================================

-- ============================================================
-- 17. semantic_executable_projection: U5 metric/dimension payload
-- Deterministic hash; belongs to one source release
-- ============================================================
create table semantic.semantic_executable_projection (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  release_id uuid not null,
  projection_digest text not null
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  projection_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 18. semantic_relationship_projection: U5 relationship sidecar
-- Exact release/datasource/catalog/digest
-- ============================================================
create table semantic.semantic_relationship_projection (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  release_id uuid not null,
  datasource_id uuid not null,
  catalog_epoch bigint not null,
  projection_digest text not null
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  projection_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 19. semantic_runtime_restriction_projection: DENY/RESTRICT policy input
-- Exact source/platform policy/compiler/generation/digest; not grantable
-- ============================================================
create table semantic.semantic_runtime_restriction_projection (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  release_id uuid not null,
  projection_digest text not null
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  platform_policy_digest text not null
    check (platform_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  compiler_bundle_digest text not null
    check (compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  pointer_generation bigint not null,
  restriction_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 20. semantic_descriptive_contribution_profile_projection: U13 profile child
-- Content-addressed; exact parent projection/release; no independent pointer
-- ============================================================
create table semantic.semantic_descriptive_contribution_profile_projection (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  parent_projection_id uuid not null,
  release_id uuid not null,
  projection_digest text not null
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  profile_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);
