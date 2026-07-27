create table app_data_agent.research_artifact_commit_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  commit_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  artifact_authority_domain text not null check (
    artifact_authority_domain in (
      'BRIEF_SEMANTIC', 'PLANNING', 'OBLIGATION_EXECUTION', 'EVIDENCE',
      'CLAIM_STRUCTURE', 'RELATION', 'PROOF', 'COVERAGE', 'RESEARCH_STOP',
      'PROJECTION', 'EVIDENCE_GATE', 'READINESS'
    )
  ),
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null check (revision >= 1),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  parent_ref jsonb,
  candidate_json jsonb not null check (pg_catalog.jsonb_typeof(candidate_json) = 'object'),
  outcome text not null default 'COMMITTED' check (outcome = 'COMMITTED'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, commit_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict not deferrable,
  foreign key (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
  )
    references app_data_agent.artifacts (
      app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_current_evidence_relation_keys (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  claim_ref_identity text not null check (pg_catalog.length(claim_ref_identity) between 1 and 4096),
  evidence_ref_identity text not null
    check (pg_catalog.length(evidence_ref_identity) between 1 and 4096),
  pair_identity_hash text not null check (pair_identity_hash ~ '^sha256:[0-9a-f]{64}$'),
  artifact_id uuid not null,
  artifact_type text not null default 'EvidenceRelation'
    check (artifact_type = 'EvidenceRelation'),
  revision integer not null check (revision >= 1),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id, tenant_id, environment, run_id, claim_ref_identity, evidence_ref_identity
  ),
  unique (app_id, tenant_id, environment, run_id, pair_identity_hash),
  unique (app_id, tenant_id, environment, run_id, artifact_id),
  foreign key (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
  )
    references app_data_agent.artifacts (
      app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
    )
    on delete restrict not deferrable
);
