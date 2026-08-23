-- ============================================================
-- 10610: Review task and decision tables
-- ============================================================

-- ============================================================
-- 13. semantic_review_task: Candidate/rollback/legacy-closure universal packet
-- packet_kind = CANDIDATE_REVIEW | ROLLBACK_REVIEW | LEGACY_CLOSURE_REVIEW
-- decision_window_status = OPEN | CLOSED
-- review_outcome = PENDING | APPROVED | VETOED | EXPIRED
-- ============================================================
create table semantic.semantic_review_task (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  packet_id uuid not null,
  packet_kind text not null
    check (packet_kind in ('CANDIDATE_REVIEW', 'ROLLBACK_REVIEW', 'LEGACY_CLOSURE_REVIEW')),
  packet_digest text not null
    check (packet_digest ~ '^sha256:[0-9a-f]{64}$'),
  packet_payload jsonb not null,
  candidate_id uuid,
  decision_window_status text not null default 'OPEN'
    check (decision_window_status in ('OPEN', 'CLOSED')),
  review_outcome text not null default 'PENDING'
    check (review_outcome in ('PENDING', 'APPROVED', 'VETOED', 'EXPIRED')),
  decision_expires_at timestamptz not null,
  publish_expires_at timestamptz,
  quorum_rules_snapshot jsonb not null,
  veto_rules_snapshot jsonb not null,
  exclusion_set jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by text not null,
  closed_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, packet_id),
  unique (app_id, tenant_id, environment, semantic_domain, packet_digest)
);

-- ============================================================
-- 14. semantic_review_decision: human approve/reject for all three packet kinds
-- (packet, principal, semantic_role) unique, immutable
-- Reject = veto; packet_kind must match parent
-- ============================================================
create table semantic.semantic_review_decision (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  packet_id uuid not null,
  decision_id uuid not null,
  principal text not null,
  semantic_role text not null
    check (semantic_role in ('domain_reviewer', 'security_reviewer', 'admin_reviewer')),
  decision text not null
    check (decision in ('APPROVE', 'REJECT')),
  decision_reason text,
  decision_digest text not null
    check (decision_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, packet_id, decision_id),
  unique (app_id, tenant_id, environment, semantic_domain, packet_id, principal, semantic_role),
  foreign key (app_id, tenant_id, environment, semantic_domain, packet_id)
    references semantic.semantic_review_task (app_id, tenant_id, environment, semantic_domain, packet_id)
);
