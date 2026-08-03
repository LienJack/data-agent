-- ============================================================
-- 10610: Review policy, assignment, and policy pointer tables
-- ============================================================

-- ============================================================
-- 4. semantic_reviewer_policy_revision: append-only role/quorum/veto/expiry policy
-- scope/domain/versioned
-- ============================================================
create table semantic.semantic_reviewer_policy_revision (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  policy_version bigint not null
    check (policy_version between 1 and 9007199254740991),
  policy_digest text not null
    check (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_payload jsonb not null,
  quorum_rules jsonb not null,
  veto_rules jsonb not null,
  expiry_rules jsonb not null,
  role_separation_rules jsonb not null,
  min_reviewers integer not null
    check (min_reviewers between 1 and 100),
  decision_timeout_seconds integer not null
    check (decision_timeout_seconds between 60 and 2592000),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain, policy_version),
  unique (app_id, tenant_id, environment, semantic_domain, policy_digest)
);

-- ============================================================
-- 5. semantic_reviewer_assignment: eligible principal/semantic role
-- Binds to exact membership version
-- ============================================================
create table semantic.semantic_reviewer_assignment (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  assignment_id uuid not null,
  principal text not null,
  semantic_role text not null
    check (semantic_role in ('domain_reviewer', 'security_reviewer', 'admin_reviewer')),
  membership_version bigint not null
    check (membership_version between 1 and 9007199254740991),
  policy_version bigint not null
    check (policy_version between 1 and 9007199254740991),
  is_active boolean not null default true,
  assigned_at timestamptz not null default pg_catalog.clock_timestamp(),
  assigned_by text not null,
  expires_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, assignment_id),
  unique (app_id, tenant_id, environment, semantic_domain, principal, semantic_role, policy_version)
);

-- ============================================================
-- 6. semantic_reviewer_policy_pointer: current review policy
-- Single-row generation CAS
-- ============================================================
create table semantic.semantic_reviewer_policy_pointer (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  current_policy_version bigint not null
    check (current_policy_version between 1 and 9007199254740991),
  current_policy_digest text not null
    check (current_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  pointer_generation bigint not null default 1
    check (pointer_generation between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain)
);
