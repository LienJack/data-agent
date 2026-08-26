create table app_data_agent.e1_analysis_publications(
  app_id uuid not null,tenant_id uuid not null,environment text not null,run_id uuid not null,
  publication_hash text not null check(publication_hash~'^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,attempt_id uuid not null,worker_fence bigint not null check(worker_fence>=1),
  idempotency_key text not null check(pg_catalog.length(idempotency_key) between 8 and 256),
  analysis_program_ref jsonb not null check(pg_catalog.jsonb_typeof(analysis_program_ref)='object'),
  public_event_id uuid not null,command_json jsonb not null check(pg_catalog.jsonb_typeof(command_json)='object'),
  receipt_json jsonb not null check(pg_catalog.jsonb_typeof(receipt_json)='object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,run_id,publication_hash),
  unique(app_id,tenant_id,environment,run_id,principal_id,idempotency_key),
  unique(app_id,tenant_id,environment,run_id,public_event_id),
  foreign key(app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,attempt_id)
    references app_data_agent.run_attempts(app_id,tenant_id,environment,attempt_id) on delete restrict
);

create table app_data_agent.e1_analysis_publication_artifacts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,run_id uuid not null,
  publication_hash text not null,ordinal integer not null check(ordinal>=1),role text not null,
  reference_json jsonb not null check(pg_catalog.jsonb_typeof(reference_json)='object'),
  primary key(app_id,tenant_id,environment,run_id,publication_hash,ordinal),
  foreign key(app_id,tenant_id,environment,run_id,publication_hash)
    references app_data_agent.e1_analysis_publications(
      app_id,tenant_id,environment,run_id,publication_hash) on delete restrict,
  check(role in('SANDBOX_RESULT','SANDBOX_RECEIPT','DERIVED_EVIDENCE',
    'COMPLETION_READY','CHART','REPORT'))
);

create table app_data_agent.e1_analysis_publication_current(
  app_id uuid not null,tenant_id uuid not null,environment text not null,run_id uuid not null,
  publication_hash text not null,public_event_id uuid not null,committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,run_id),
  foreign key(app_id,tenant_id,environment,run_id,publication_hash)
    references app_data_agent.e1_analysis_publications(
      app_id,tenant_id,environment,run_id,publication_hash) on delete restrict
);

create table app_data_agent.e1_analysis_publication_outbox(
  app_id uuid not null,tenant_id uuid not null,environment text not null,run_id uuid not null,
  public_event_id uuid not null,publication_hash text not null,payload_json jsonb not null,
  delivery_status text not null default 'PENDING' check(delivery_status in('PENDING','DELIVERED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),delivered_at timestamptz,
  primary key(app_id,tenant_id,environment,run_id,public_event_id),
  foreign key(app_id,tenant_id,environment,run_id,publication_hash)
    references app_data_agent.e1_analysis_publications(
      app_id,tenant_id,environment,run_id,publication_hash) on delete restrict
);

create trigger e1_analysis_publications_immutable before update or delete
on app_data_agent.e1_analysis_publications for each row
execute function app_data_agent.analysis_governed_state_immutable();
create trigger e1_analysis_publication_artifacts_immutable before update or delete
on app_data_agent.e1_analysis_publication_artifacts for each row
execute function app_data_agent.analysis_governed_state_immutable();
create trigger e1_analysis_publication_current_immutable before update or delete
on app_data_agent.e1_analysis_publication_current for each row
execute function app_data_agent.analysis_governed_state_immutable();
