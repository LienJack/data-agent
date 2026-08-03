-- ============================================================
-- 10610: Active pointer, issuer draft, and runtime projection binding
-- ============================================================

-- ============================================================
-- 21. semantic_active_pointer: scope's current release
-- Genesis null/0; single-row generation CAS
-- ============================================================
create table semantic.semantic_active_pointer (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  current_release_id uuid,
  current_release_generation bigint not null default 0
    check (current_release_generation between 0 and 9007199254740991),
  current_release_digest text
    check (current_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  pointer_generation bigint not null default 1
    check (pointer_generation between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain)
);

-- ============================================================
-- 22. semantic_grounding_issuer_draft: three issuer sealed inputs
-- Kind/issuer/capability/input/currentness/hash immutable; not consumable until READY
-- ============================================================
create table semantic.semantic_grounding_issuer_draft (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  draft_id uuid not null,
  issuer_kind text not null
    check (issuer_kind in ('AUTHORITY', 'COMPILER', 'MATERIALIZER')),
  issuer_principal text not null,
  capability text not null,
  sealed_input jsonb not null,
  currentness_hash text not null
    check (currentness_hash ~ '^sha256:[0-9a-f]{64}$'),
  draft_hash text not null
    check (draft_hash ~ '^sha256:[0-9a-f]{64}$'),
  is_ready boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, draft_id),
  unique (app_id, tenant_id, environment, semantic_domain, draft_hash)
);

-- ============================================================
-- 23. semantic_runtime_projection_binding: source to U5 run lineage
-- Exact source/projection/run/U5 refs/hash
-- ============================================================
create table semantic.semantic_runtime_projection_binding (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  binding_id uuid not null,
  release_id uuid not null,
  projection_id uuid not null,
  run_id uuid not null,
  u5_artifact_ref uuid,
  u5_artifact_hash text
    check (u5_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  binding_hash text not null
    check (binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, binding_id),
  unique (app_id, tenant_id, environment, semantic_domain, binding_hash)
);
