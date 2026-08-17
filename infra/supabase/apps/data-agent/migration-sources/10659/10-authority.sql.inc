create table app_data_agent.job_handler_revisions (
  kind text not null check (kind in (
    'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT',
    'SEMANTIC_INDUCTION','METRIC_IMPORT','DATALINK_REBUILD'
  )),
  handler_revision text not null check (handler_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  enabled boolean not null,
  dependencies_ready boolean not null,
  output_receipt_required boolean not null,
  registered_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (kind,handler_revision)
);

insert into app_data_agent.job_handler_revisions(
  kind,handler_revision,enabled,dependencies_ready,output_receipt_required
) values
  ('SCHEMA_SCAN','schema-scan-handler@1.0.0',false,false,true),
  ('RELATIONSHIP_INDEX','relationship-index-handler@1.0.0',false,false,true),
  ('ARTIFACT_EXPORT','artifact-export-handler@1.0.0',true,true,true),
  ('SEMANTIC_INDUCTION','semantic-induction-handler@1.0.0',false,false,true),
  ('METRIC_IMPORT','metric-import-handler@1.0.0',false,false,true),
  ('DATALINK_REBUILD','datalink-rebuild-handler@1.0.0',false,false,true);

create table app_data_agent.jobs (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_id uuid not null,
  job_id uuid not null,
  kind text not null,
  handler_revision text not null,
  idempotency_key text not null check (
    length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  ),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_json jsonb not null check (
    pg_catalog.jsonb_typeof(input_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(input_json)
  ),
  priority integer not null check (priority between 0 and 100),
  max_attempts integer not null check (max_attempts between 1 and 10),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  worker_fence bigint not null default 0 check (worker_fence between 0 and 9007199254740991),
  cancel_policy text not null check (cancel_policy in ('COOPERATIVE','NOT_SUPPORTED')),
  status text not null check (status in (
    'QUEUED','LEASED','RUNNING','CANCEL_REQUESTED','RETRY_WAIT',
    'SUCCEEDED','FAILED','CANCELLED','DEAD_LETTER'
  )),
  next_attempt_at timestamptz,
  terminal_error_code text,
  submission_receipt_hash text not null check (submission_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  submission_receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(submission_receipt_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(submission_receipt_json)
  ),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,job_id),
  unique (app_id,tenant_id,environment,principal_id,idempotency_key),
  unique (app_id,tenant_id,environment,job_id,request_hash),
  foreign key (kind,handler_revision) references app_data_agent.job_handler_revisions(kind,handler_revision),
  check (kind in (
    'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT',
    'SEMANTIC_INDUCTION','METRIC_IMPORT','DATALINK_REBUILD'
  ))
);

create index jobs_claim_order_idx on app_data_agent.jobs(
  app_id,tenant_id,environment,status,priority desc,next_attempt_at,created_at
);

create table app_data_agent.job_attempts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  job_id uuid not null,
  request_hash text not null,
  attempt_id uuid not null,
  attempt_no integer not null check (attempt_no between 1 and 10),
  delivery_attempt_no integer not null check (delivery_attempt_no between 1 and 100),
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  lease_token bigint not null check (lease_token between 1 and 9007199254740991),
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  handler_revision text not null,
  lease_hash text not null check (lease_hash ~ '^sha256:[0-9a-f]{64}$'),
  lease_json jsonb not null check (pg_catalog.jsonb_typeof(lease_json)='object'),
  status text not null check (status in ('LEASED','RUNNING','CANCEL_REQUESTED','COMPLETED','ABANDONED')),
  lease_expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,attempt_id),
  unique (app_id,tenant_id,environment,job_id,attempt_no),
  unique (app_id,tenant_id,environment,job_id,worker_fence),
  foreign key (app_id,tenant_id,environment,job_id,request_hash)
    references app_data_agent.jobs(app_id,tenant_id,environment,job_id,request_hash)
);

create table app_data_agent.job_events (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  job_id uuid not null,
  event_id uuid not null,
  sequence bigint not null check (sequence>=1),
  event_type text not null check (event_type in (
    'JOB_QUEUED','JOB_LEASED','JOB_STARTED','JOB_HEARTBEAT','JOB_RETRY_SCHEDULED',
    'JOB_CANCEL_REQUESTED','JOB_SUCCEEDED','JOB_FAILED','JOB_CANCELLED','JOB_DEAD_LETTER'
  )),
  event_hash text not null check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  event_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(event_json)),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,event_id),
  unique (app_id,tenant_id,environment,job_id,sequence),
  foreign key (app_id,tenant_id,environment,job_id)
    references app_data_agent.jobs(app_id,tenant_id,environment,job_id)
);

create table app_data_agent.job_output_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  principal_id uuid not null,
  job_id uuid not null,
  request_hash text not null,
  attempt_id uuid not null,
  worker_fence bigint not null,
  receipt_id uuid not null,
  terminal text not null check (terminal in ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTER')),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(receipt_json)),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,job_id),
  foreign key (app_id,tenant_id,environment,job_id,request_hash)
    references app_data_agent.jobs(app_id,tenant_id,environment,job_id,request_hash),
  foreign key (app_id,tenant_id,environment,attempt_id)
    references app_data_agent.job_attempts(app_id,tenant_id,environment,attempt_id)
);

create table app_data_agent.job_worker_heartbeats (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  heartbeat_id uuid not null,
  worker_id text not null,
  handler_kinds text[] not null,
  handlers_json jsonb not null,
  capacity integer not null check (capacity between 1 and 64),
  heartbeat_hash text not null check (heartbeat_hash ~ '^sha256:[0-9a-f]{64}$'),
  heartbeat_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(heartbeat_json)),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (app_id,tenant_id,environment,heartbeat_id),
  unique (app_id,tenant_id,environment,worker_id,heartbeat_id),
  check (expires_at>observed_at)
);

create table app_data_agent.capability_readiness_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  capability text not null,
  status text not null check (status in ('READY','NOT_READY','DEGRADED')),
  reason_code text not null check (reason_code in (
    'CAPABILITY_READY','HANDLER_NOT_REGISTERED','HANDLER_REVISION_MISMATCH',
    'WORKER_HEARTBEAT_STALE','DEPENDENCY_UNAVAILABLE','OUTPUT_RECEIPT_REQUIRED'
  )),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(receipt_json)),
  evaluated_at timestamptz not null,
  valid_until timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  check (valid_until>evaluated_at)
);

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'job_handler_revisions','jobs','job_attempts','job_events','job_output_receipts',
    'job_worker_heartbeats','capability_readiness_receipts'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u10_job_owner',relation_name);
  end loop;
end
$rls$;

create policy job_handler_revisions_owner_all on app_data_agent.job_handler_revisions
  for all to data_agent_u10_job_owner using (true) with check (true);
create policy jobs_owner_all on app_data_agent.jobs for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_attempts_owner_all on app_data_agent.job_attempts for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_events_owner_all on app_data_agent.job_events for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_output_receipts_owner_all on app_data_agent.job_output_receipts for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_worker_heartbeats_owner_all on app_data_agent.job_worker_heartbeats for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy capability_readiness_receipts_owner_all on app_data_agent.capability_readiness_receipts
  for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
