begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010585_app_data_agent_benchmark_test_center',
  'sha256:8902a5d6ce936542a26a5f9ebbc72d3d3e13de56d191dc2a80057142b37bb562'
);

create table app_data_agent.benchmark_eval_runs (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_id uuid not null,
  batch_run_id uuid not null,
  idempotency_key uuid not null,
  request_hash text not null
    check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  manifest_hash text not null
    check (manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  scorecard_hash text not null
    check (scorecard_hash ~ '^sha256:[0-9a-f]{64}$'),
  run_document jsonb not null
    check (
      pg_catalog.jsonb_typeof(run_document) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(run_document)
    ),
  run_document_hash text not null
    check (
      run_document_hash ~ '^sha256:[0-9a-f]{64}$'
      and run_document_hash = app_data_agent.runtime_canonical_sha256(run_document)
    ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, batch_run_id),
  unique (app_id, tenant_id, environment, principal_id, idempotency_key)
);

comment on table app_data_agent.benchmark_eval_runs is
  'Append-only Test Center batch authority. Public case, attempts, reflection receipts and server-derived scorecard commit atomically; sealed Gold material is forbidden.';

create index benchmark_eval_runs_recent_idx
  on app_data_agent.benchmark_eval_runs (
    app_id,
    tenant_id,
    environment,
    principal_id,
    created_at desc
  );

create trigger benchmark_eval_runs_immutable
before update or delete on app_data_agent.benchmark_eval_runs
for each row execute function platform.reject_immutable_mutation();

alter table app_data_agent.benchmark_eval_runs enable row level security;
alter table app_data_agent.benchmark_eval_runs force row level security;

create policy benchmark_eval_runs_backend_select
on app_data_agent.benchmark_eval_runs
for select
to data_agent_backend
using (
  platform.backend_exact_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    false
  )
);

create policy benchmark_eval_runs_backend_insert
on app_data_agent.benchmark_eval_runs
for insert
to data_agent_backend
with check (
  platform.backend_exact_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    true
  )
);

revoke all privileges on table app_data_agent.benchmark_eval_runs
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;

grant select, insert on table app_data_agent.benchmark_eval_runs
to data_agent_backend;

commit;
