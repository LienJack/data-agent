-- ============================================================
-- 10610: Semantic domain registry, bootstrap, and authority fence
-- ============================================================

-- Create semantic schema (independent from app_data_agent)
create schema if not exists semantic;

-- ============================================================
-- 1. semantic_domain_registry: domain identity and datasource mapping
-- L2 domain ↔ datasource: one-to-one; server-owned
-- ============================================================
create table semantic.semantic_domain_registry (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  datasource_id uuid not null,
  domain_display_name text not null,
  domain_description text,
  domain_version integer not null default 1
    check (domain_version between 1 and 2147483647),
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by text not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain),
  unique (app_id, tenant_id, environment, datasource_id)
);

-- ============================================================
-- 2. semantic_domain_bootstrap: one-time bootstrap packet/capability
-- scope-unique CLOSED tombstone; double-owner exact packet; never reopened
-- ============================================================
create table semantic.semantic_domain_bootstrap (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  bootstrap_id uuid not null,
  bootstrap_packet_digest text not null
    check (bootstrap_packet_digest ~ '^sha256:[0-9a-f]{64}$'),
  supersedes_packet_digest text
    check (supersedes_packet_digest ~ '^sha256:[0-9a-f]{64}$'),
  signer_one_principal text not null,
  signer_two_principal text not null,
  signer_one_signature text not null,
  signer_two_signature text not null,
  initial_review_policy_digest text not null
    check (initial_review_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  initial_catalog_fence_digest text not null
    check (initial_catalog_fence_digest ~ '^sha256:[0-9a-f]{64}$'),
  initial_compiler_dependency_digest text not null
    check (initial_compiler_dependency_digest ~ '^sha256:[0-9a-f]{64}$'),
  bootstrap_nonce uuid not null,
  bootstrap_expires_at timestamptz not null,
  is_closed boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, bootstrap_id),
  unique (app_id, tenant_id, environment, semantic_domain, bootstrap_packet_digest),
  unique (app_id, tenant_id, environment, semantic_domain, bootstrap_nonce)
);

-- ============================================================
-- 3. semantic_authority_fence: per App/Tenant/Environment linearization anchor
-- Exists before bootstrap; must not be missing; shared by all writers
-- ============================================================
create table semantic.semantic_authority_fence (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  fence_epoch bigint not null default 0
    check (fence_epoch between 0 and 9007199254740991),
  last_fence_update_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_fence_update_by text not null default 'system',
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment)
);
