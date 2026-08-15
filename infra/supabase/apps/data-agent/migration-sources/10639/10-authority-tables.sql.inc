-- ============================================================
-- 10639: Fenced runs and append-only authoring evidence
-- ============================================================

create table semantic.semantic_authoring_run (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  authoring_run_id uuid not null,
  candidate_id uuid not null,
  graph_id uuid not null,
  base_release_id uuid,
  base_release_generation bigint not null check (base_release_generation between 0 and 9007199254740991),
  principal_id uuid not null,
  policy_version text not null check (policy_version = 'semantic-authoring-policy@1.0.0'),
  status text not null check (status in (
    'RUNNING', 'WAITING_CLARIFICATION', 'READY_FOR_REVIEW', 'FAILED', 'CANCELLED'
  )),
  working_revision integer not null default 0 check (working_revision between 0 and 2147483647),
  graph_digest text not null check (graph_digest ~ '^sha256:[0-9a-f]{64}$'),
  writer_fence bigint not null default 1 check (writer_fence between 1 and 9007199254740991),
  current_turn integer not null default 0 check (current_turn between 0 and 2147483647),
  pending_request_digest text check (pending_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  used_tool_calls integer not null default 0 check (used_tool_calls between 0 and 2147483647),
  max_turns integer not null check (max_turns between 1 and 128),
  max_tool_calls integer not null check (max_tool_calls between 1 and 2048),
  validation_receipt_digest text check (validation_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  clarification jsonb check (clarification is null or pg_catalog.jsonb_typeof(clarification) = 'object'),
  working_graph jsonb not null check (pg_catalog.jsonb_typeof(working_graph) = 'object'),
  checkpoint jsonb not null check (pg_catalog.jsonb_typeof(checkpoint) = 'object'),
  event_sequence bigint not null default 0 check (event_sequence between 0 and 9007199254740991),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 256),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  materialized_source_revision_id uuid,
  materialized_candidate_revision_id uuid,
  failure_code text check (failure_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id),
  unique (app_id, tenant_id, environment, semantic_domain, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, semantic_domain, candidate_id)
    references semantic.semantic_candidate (app_id, tenant_id, environment, semantic_domain, candidate_id),
  check ((materialized_source_revision_id is null) = (materialized_candidate_revision_id is null)),
  check (
    (status = 'READY_FOR_REVIEW' and materialized_source_revision_id is not null and failure_code is null)
    or (status = 'FAILED' and materialized_source_revision_id is null and failure_code is not null)
    or (status not in ('READY_FOR_REVIEW', 'FAILED') and materialized_source_revision_id is null and failure_code is null)
  )
);

create unique index semantic_authoring_single_writer_idx
  on semantic.semantic_authoring_run (
    app_id, tenant_id, environment, semantic_domain, candidate_id
  ) where status in ('RUNNING', 'WAITING_CLARIFICATION');

create table semantic.semantic_authoring_turn (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  turn_index integer not null check (turn_index between 1 and 2147483647),
  request_digest text not null check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_payload jsonb not null check (pg_catalog.jsonb_typeof(request_payload) = 'object'),
  response_digest text check (response_digest ~ '^sha256:[0-9a-f]{64}$'),
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, turn_index),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
    references semantic.semantic_authoring_run (app_id, tenant_id, environment, semantic_domain, authoring_run_id),
  check ((response_digest is null) = (completed_at is null))
);

create table semantic.semantic_authoring_tool_receipt (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  tool_call_id text not null check (pg_catalog.length(tool_call_id) between 1 and 256),
  turn_index integer not null check (turn_index between 1 and 2147483647),
  tool_name text not null check (tool_name ~ '^[a-z][a-z0-9_]{0,127}$'),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_digest text not null check (output_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  mutation boolean not null,
  from_working_revision integer not null,
  to_working_revision integer not null,
  before_digest text not null check (before_digest ~ '^sha256:[0-9a-f]{64}$'),
  after_digest text not null check (after_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_payload jsonb not null check (pg_catalog.jsonb_typeof(receipt_payload) = 'object'),
  committed_at timestamptz not null,
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, tool_call_id),
  unique (app_id, tenant_id, environment, semantic_domain, receipt_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
    references semantic.semantic_authoring_run (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
);

create table semantic.semantic_authoring_patch (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  patch_id uuid not null,
  tool_call_id text not null,
  from_working_revision integer not null,
  to_working_revision integer not null,
  before_digest text not null check (before_digest ~ '^sha256:[0-9a-f]{64}$'),
  after_digest text not null check (after_digest ~ '^sha256:[0-9a-f]{64}$'),
  patch_digest text not null check (patch_digest ~ '^sha256:[0-9a-f]{64}$'),
  patch_payload jsonb not null check (pg_catalog.jsonb_typeof(patch_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, patch_id),
  unique (app_id, tenant_id, environment, semantic_domain, authoring_run_id, to_working_revision),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, tool_call_id)
    references semantic.semantic_authoring_tool_receipt (
      app_id, tenant_id, environment, semantic_domain, authoring_run_id, tool_call_id
    )
);

create table semantic.semantic_authoring_event (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  sequence bigint not null check (sequence between 1 and 9007199254740991),
  event_id uuid not null,
  event_type text not null check (event_type in (
    'stage', 'tool', 'graph_patch', 'validation', 'clarification', 'authoring_terminal'
  )),
  event_payload jsonb not null check (pg_catalog.jsonb_typeof(event_payload) = 'object'),
  occurred_at timestamptz not null,
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, sequence),
  unique (app_id, tenant_id, environment, semantic_domain, authoring_run_id, event_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
    references semantic.semantic_authoring_run (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
);

create table semantic.semantic_authoring_resume_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  clarification_id uuid not null,
  answer_digest text not null check (answer_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
    references semantic.semantic_authoring_run (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
);

create index semantic_authoring_event_replay_idx
  on semantic.semantic_authoring_event (
    app_id, tenant_id, environment, semantic_domain, authoring_run_id, sequence
  );
