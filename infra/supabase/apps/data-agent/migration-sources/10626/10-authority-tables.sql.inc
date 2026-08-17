-- ============================================================
-- 10626: Feature packet, compile run and immutable proposal authority
-- ============================================================

create table semantic.semantic_schema_feature_packet (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  compile_run_id uuid not null,
  snapshot_id uuid not null,
  snapshot_digest text not null check (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  drift_event_id uuid,
  drift_digest text check (drift_digest ~ '^sha256:[0-9a-f]{64}$'),
  base_release_id uuid,
  base_release_generation bigint check (base_release_generation between 1 and 9007199254740991),
  base_release_digest text check (base_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  feature_digest text not null check (feature_digest ~ '^sha256:[0-9a-f]{64}$'),
  packet_payload jsonb not null check (pg_catalog.jsonb_typeof(packet_payload) = 'object'),
  packet_storage_digest text not null check (packet_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, compile_run_id),
  check ((drift_event_id is null) = (drift_digest is null)),
  check (
    (base_release_id is null and base_release_generation is null and base_release_digest is null)
    or (base_release_id is not null and base_release_generation is not null and base_release_digest is not null)
  )
);

create table semantic.semantic_candidate_compile_run (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  compile_run_id uuid not null,
  principal_id uuid not null,
  idempotency_key uuid not null,
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_revision_id uuid not null,
  feature_digest text not null check (feature_digest ~ '^sha256:[0-9a-f]{64}$'),
  agent_receipt jsonb not null check (pg_catalog.jsonb_typeof(agent_receipt) = 'object'),
  terminal text not null default 'RUNNING' check (terminal in (
    'RUNNING', 'COMPILED', 'AGENT_UNAVAILABLE', 'TIMEOUT', 'INVALID_OUTPUT',
    'VALIDATION_FAILED', 'STALE_BASE', 'IDEMPOTENCY_CONFLICT'
  )),
  proposal_digest text check (proposal_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_id uuid,
  candidate_revision_id uuid,
  failure_code text check (failure_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, compile_run_id),
  unique (app_id, tenant_id, environment, semantic_domain, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, semantic_domain, source_revision_id)
    references semantic.semantic_source_revision (app_id, tenant_id, environment, semantic_domain, revision_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, compile_run_id)
    references semantic.semantic_schema_feature_packet (app_id, tenant_id, environment, semantic_domain, compile_run_id),
  check (
    (terminal = 'RUNNING' and completed_at is null and proposal_digest is null and failure_code is null)
    or (terminal = 'COMPILED' and completed_at is not null and proposal_digest is not null and failure_code is null)
    or (terminal not in ('RUNNING', 'COMPILED') and completed_at is not null and proposal_digest is null and failure_code is not null)
  ),
  check ((candidate_id is null) = (candidate_revision_id is null))
);

create table semantic.semantic_change_proposal (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  compile_run_id uuid not null,
  proposal_digest text not null check (proposal_digest ~ '^sha256:[0-9a-f]{64}$'),
  proposal_payload jsonb not null check (pg_catalog.jsonb_typeof(proposal_payload) = 'object'),
  proposal_storage_digest text not null check (proposal_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, compile_run_id),
  unique (app_id, tenant_id, environment, semantic_domain, proposal_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, compile_run_id)
    references semantic.semantic_candidate_compile_run (app_id, tenant_id, environment, semantic_domain, compile_run_id)
);

create index semantic_candidate_compile_run_created_idx
  on semantic.semantic_candidate_compile_run (
    app_id, tenant_id, environment, semantic_domain, created_at desc, compile_run_id
  );
