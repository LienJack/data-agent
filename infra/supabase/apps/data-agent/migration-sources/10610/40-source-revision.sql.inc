-- ============================================================
-- 10610: Source revision table
-- ============================================================

-- ============================================================
-- 9. semantic_source_revision: complete Source Bundle revision
-- Append-only; base release/generation exact
-- ============================================================
create table semantic.semantic_source_revision (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  revision_id uuid not null,
  revision_number integer not null
    check (revision_number between 1 and 2147483647),
  base_release_id uuid,
  base_release_generation bigint
    check (base_release_generation between 0 and 9007199254740991),
  source_payload jsonb not null,
  source_digest text not null
    check (source_digest ~ '^sha256:[0-9a-f]{64}$'),
  author_principal text not null,
  change_description text,
  change_class text
    check (change_class in ('MINOR', 'MAJOR', 'RUNTIME_AUTHORIZATION', 'SECURITY')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, revision_id),
  unique (app_id, tenant_id, environment, semantic_domain, revision_number),
  unique (app_id, tenant_id, environment, semantic_domain, source_digest)
);
