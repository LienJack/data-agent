-- ============================================================
-- 10610: Catalog fence and dependency pointer tables
-- ============================================================

-- ============================================================
-- 7. semantic_catalog_fence: datasource schema epoch/digest
-- Adapter can re-verify; invalidation only advances, never resurrects
-- ============================================================
create table semantic.semantic_catalog_fence (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  catalog_epoch bigint not null
    check (catalog_epoch between 0 and 9007199254740991),
  catalog_digest text not null
    check (catalog_digest ~ '^sha256:[0-9a-f]{64}$'),
  schema_digest text not null
    check (schema_digest ~ '^sha256:[0-9a-f]{64}$'),
  is_valid boolean not null default true,
  invalidated_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, catalog_epoch)
);

-- ============================================================
-- 8. semantic_dependency_pointer: current catalog/compiler/closure tuple
-- Fence + immutable refs + generation CAS
-- ============================================================
create table semantic.semantic_dependency_pointer (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  current_catalog_epoch bigint not null
    check (current_catalog_epoch between 0 and 9007199254740991),
  current_catalog_digest text not null
    check (current_catalog_digest ~ '^sha256:[0-9a-f]{64}$'),
  current_compiler_bundle_digest text not null
    check (current_compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  current_closure_policy_digest text not null
    check (current_closure_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  pointer_generation bigint not null default 1
    check (pointer_generation between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain)
);
