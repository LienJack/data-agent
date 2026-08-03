-- ============================================================
-- 10610: Candidate, candidate revision, and validation receipt tables
-- ============================================================

-- ============================================================
-- 10. semantic_candidate: candidate identity and state
-- Proposer immutable; points to exactly one current revision at a time
-- ============================================================
create table semantic.semantic_candidate (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  candidate_id uuid not null,
  proposer_principal text not null,
  current_revision_id uuid not null,
  candidate_status text not null
    check (candidate_status in (
      'DRAFT', 'VALIDATING', 'VALIDATION_FAILED', 'REVIEW_SUBMITTED',
      'WAITING_REVIEW', 'REJECTED', 'REVIEW_EXPIRED', 'APPROVED',
      'PUBLISHING', 'PUBLISHED', 'STALE_REBASE_REQUIRED'
    )),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, candidate_id)
);

-- ============================================================
-- 11. semantic_candidate_revision: candidate content, reason, and author
-- Append-only; payload hash unique; author enters SoD exclusion
-- ============================================================
create table semantic.semantic_candidate_revision (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  candidate_id uuid not null,
  revision_id uuid not null,
  revision_number integer not null
    check (revision_number between 1 and 2147483647),
  source_revision_id uuid not null,
  revision_payload jsonb not null,
  revision_digest text not null
    check (revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  author_principal text not null,
  change_description text,
  change_class text
    check (change_class in ('MINOR', 'MAJOR', 'RUNTIME_AUTHORIZATION', 'SECURITY')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, candidate_id, revision_id),
  unique (app_id, tenant_id, environment, semantic_domain, revision_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, candidate_id)
    references semantic.semantic_candidate (app_id, tenant_id, environment, semantic_domain, candidate_id)
);

-- ============================================================
-- 12. semantic_validation_receipt: compiler/gate/impact results
-- Exact candidate + catalog + compiler
-- ============================================================
create table semantic.semantic_validation_receipt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  receipt_id uuid not null,
  candidate_id uuid not null,
  revision_id uuid not null,
  catalog_epoch bigint not null,
  compiler_bundle_digest text not null
    check (compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  validation_outcome text not null
    check (validation_outcome in ('PASS', 'FAIL', 'WARN')),
  validation_details jsonb,
  impact_analysis jsonb,
  receipt_digest text not null
    check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, receipt_id),
  unique (app_id, tenant_id, environment, semantic_domain, receipt_digest)
);
