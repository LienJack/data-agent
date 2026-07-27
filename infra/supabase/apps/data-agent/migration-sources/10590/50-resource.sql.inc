create table app_data_agent.research_resource_run_heads (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  next_reservation_seq bigint not null default 1
    check (next_reservation_seq between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict not deferrable
);

create table app_data_agent.research_resource_reservations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  reservation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  reservation_seq bigint not null check (reservation_seq between 1 and 9007199254740991),
  reserve_idempotency_key text not null
    check (pg_catalog.length(reserve_idempotency_key) between 1 and 256),
  reserve_input_hash text not null check (reserve_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  research_brief_ref jsonb not null check (pg_catalog.jsonb_typeof(research_brief_ref) = 'object'),
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  requested_json jsonb not null check (pg_catalog.jsonb_typeof(requested_json) = 'object'),
  reserved_json jsonb not null check (pg_catalog.jsonb_typeof(reserved_json) = 'object'),
  state text not null check (
    state in (
      'RESERVED', 'IN_USE', 'SETTLED', 'SETTLED_OVER_LIMIT',
      'CANCELLED', 'EXPIRED', 'ABANDONED'
    )
  ),
  reservation_expires_at timestamptz not null,
  invocation_id uuid,
  request_id uuid,
  resource_lease_id uuid,
  canonical_request_digest text
    check (canonical_request_digest is null or canonical_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  attempt_id uuid,
  worker_fence bigint check (worker_fence is null or worker_fence between 1 and 9007199254740991),
  lease_expires_at timestamptz,
  actual_json jsonb,
  invocation_outcome_usage_ref jsonb,
  adapter_termination_receipt_ref jsonb,
  outcome_unknown_hash text
    check (outcome_unknown_hash is null or outcome_unknown_hash ~ '^sha256:[0-9a-f]{64}$'),
  end_reason_code text,
  reserved_at timestamptz not null default pg_catalog.clock_timestamp(),
  begun_at timestamptz,
  ended_at timestamptz,
  primary key (app_id, tenant_id, environment, reservation_id),
  unique (app_id, tenant_id, environment, run_id, reservation_seq),
  unique (
    app_id, tenant_id, environment, run_id, principal_id, reserve_idempotency_key
  ),
  foreign key (app_id, tenant_id, environment, run_id, principal_id)
    references app_data_agent.runs (
      app_id, tenant_id, environment, run_id, principal_id
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (
      app_id, tenant_id, environment, principal_id
    )
    on delete restrict not deferrable,
  check (
    (state = 'RESERVED' and invocation_id is null and resource_lease_id is null
      and actual_json is null and begun_at is null and ended_at is null)
    or (state in ('IN_USE', 'ABANDONED') and invocation_id is not null
      and request_id is not null and resource_lease_id is not null
      and canonical_request_digest is not null and attempt_id is not null
      and worker_fence is not null and begun_at is not null)
    or (state in ('SETTLED', 'SETTLED_OVER_LIMIT') and invocation_id is not null
      and resource_lease_id is not null and actual_json is not null
      and invocation_outcome_usage_ref is not null and ended_at is not null)
    or (state in ('CANCELLED', 'EXPIRED') and ended_at is not null)
  )
);

create table app_data_agent.research_resource_transition_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  transition_id uuid not null,
  reservation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition text not null
    check (transition in ('BEGIN', 'SETTLE', 'CANCEL', 'EXPIRE', 'ABANDONED')),
  source_state text not null,
  result_state text not null,
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, transition_id),
  unique (app_id, tenant_id, environment, reservation_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    )
    on delete restrict not deferrable
);
