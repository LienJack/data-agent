begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010601_app_data_agent_u6_research_controlled_fixture',
  'sha256:2d649ec965fbd9e63f8be85b8aebfa25e3127c9073d2a6c1d1a7dbaba5eeb05b'
);

-- ============================================================
-- u6_research_fixture_contracts
-- Stores controlled fixture contracts for L2 research cases.
-- Append-only: once written, a contract is immutable.
-- ============================================================

create table app_data_agent.u6_research_fixture_contracts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  fixture_id text not null
    check (fixture_id = 'retail-revenue-investigation-v1'),
  protocol_version text not null
    check (protocol_version = 'u6-controlled-fixture@1.0.0'),
  fixture_hash text not null
    check (fixture_hash ~ '^sha256:[0-9a-f]{64}$'),
  contract_json jsonb not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),

  primary key (app_id, tenant_id, environment, fixture_id)
);

-- Unique constraint for idempotent replay: same scope + fixture_id + protocol_version
create unique index u6_research_fixture_contracts_idempotency_uq
  on app_data_agent.u6_research_fixture_contracts (app_id, tenant_id, environment, fixture_id, protocol_version);

-- Lookup index for contract resolution
create unique index u6_research_fixture_contracts_version_uq
  on app_data_agent.u6_research_fixture_contracts (app_id, tenant_id, environment, fixture_id, protocol_version, fixture_hash);

-- ============================================================
-- u6_research_fixture_case_evaluations
-- Stores per-case evaluation results for controlled fixture runs.
-- Append-only: each evaluation is recorded once and immutable.
-- ============================================================

create table app_data_agent.u6_research_fixture_case_evaluations (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  fixture_id text not null
    check (fixture_id = 'retail-revenue-investigation-v1'),
  case_id text not null
    check (char_length(case_id) between 1 and 128),
  mutation_id text not null
    check (char_length(mutation_id) between 1 and 128),
  run_id uuid not null,
  attempt_id uuid not null,
  evaluation_id uuid not null,
  evaluation_result text not null
    check (char_length(evaluation_result) between 1 and 64),
  evaluation_detail text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),

  primary key (app_id, tenant_id, environment, evaluation_id)
);

-- Unique constraint for idempotent replay: same scope + fixture_id + case_id + idempotency_key
create unique index u6_research_fixture_evaluations_idempotency_uq
  on app_data_agent.u6_research_fixture_case_evaluations (app_id, tenant_id, environment, fixture_id, case_id, idempotency_key);

-- Lookup index for querying evaluations by scope + fixture_id, optionally filtered by case_id or mutation_id
create index u6_research_fixture_evaluations_lookup
  on app_data_agent.u6_research_fixture_case_evaluations (app_id, tenant_id, environment, fixture_id, case_id, mutation_id, created_at desc);

-- ============================================================
-- Scope matching helper for RLS policies
-- ============================================================

create or replace function app_data_agent.u6_current_scope_matches_row(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
)
returns boolean
language sql
stable
as $$
  select
    p_app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and p_tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and p_environment = pg_catalog.current_setting('data_agent.environment', true)
$$;

-- ============================================================
-- RLS
-- ============================================================


alter table app_data_agent.u6_research_fixture_contracts enable row level security;
alter table app_data_agent.u6_research_fixture_case_evaluations enable row level security;

-- RPC owner policy: full access scoped to current tenant
create policy u6_research_fixture_contracts_rpc_pol
  on app_data_agent.u6_research_fixture_contracts
  for all
  to data_agent_u6_rpc_owner
  using (app_data_agent.u6_current_scope_matches_row(app_id, tenant_id, environment))
  with check (app_data_agent.u6_current_scope_matches_row(app_id, tenant_id, environment));

create policy u6_research_fixture_evaluations_rpc_pol
  on app_data_agent.u6_research_fixture_case_evaluations
  for all
  to data_agent_u6_rpc_owner
  using (app_data_agent.u6_current_scope_matches_row(app_id, tenant_id, environment))
  with check (app_data_agent.u6_current_scope_matches_row(app_id, tenant_id, environment));

-- ============================================================
-- Append-only triggers (reject UPDATE/DELETE)
-- ============================================================

create trigger u6_research_fixture_contracts_immutable_trg
  before delete or update on app_data_agent.u6_research_fixture_contracts
  for each row
  execute function platform.reject_immutable_mutation();

create trigger u6_research_fixture_evaluations_immutable_trg
  before delete or update on app_data_agent.u6_research_fixture_case_evaluations
  for each row
  execute function platform.reject_immutable_mutation();

-- ============================================================
-- Grants
-- ============================================================

grant insert, select on app_data_agent.u6_research_fixture_contracts
  to data_agent_u6_rpc_owner;

grant insert, select on app_data_agent.u6_research_fixture_case_evaluations
  to data_agent_u6_rpc_owner;

commit;
