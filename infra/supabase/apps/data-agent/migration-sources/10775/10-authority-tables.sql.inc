create table app_data_agent.falcon24_e1_staging_sessions(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,staging_id uuid not null,
  retained_assets_hash text not null check(retained_assets_hash~'^sha256:[0-9a-f]{64}$'),
  status text not null check(status in('STAGED','HOLD','CONSUMED')),
  failure_code text,created_by uuid not null,created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,staging_id),
  check((status='HOLD')=(failure_code is not null)
    and (failure_code is null or failure_code~'^[A-Z][A-Z0-9_]{2,127}$'))
);

create table app_data_agent.falcon24_e1_staging_receipts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  staging_id uuid not null,component text not null,subject_hash text not null,
  evidence_hash text not null,production_isolation_proven boolean not null,
  receipt_hash text not null,receipt_document jsonb not null,created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,staging_id,component),
  foreign key(app_id,tenant_id,environment,staging_id)
    references app_data_agent.falcon24_e1_staging_sessions(
      app_id,tenant_id,environment,staging_id) on delete restrict,
  check(component in('AGENT_PROFILES','DATASET','LLM_CONFIGURATION','OPERATOR_REGISTRY',
      'SANDBOX_RUNTIME','SEMANTIC_RELEASE')
    and subject_hash~'^sha256:[0-9a-f]{64}$'
    and evidence_hash~'^sha256:[0-9a-f]{64}$'
    and receipt_hash~'^sha256:[0-9a-f]{64}$'
    and (component='SANDBOX_RUNTIME' or not production_isolation_proven)
    and receipt_hash=app_data_agent.u2_canonical_sha256(receipt_document-'receipt_hash'))
);

create table app_data_agent.falcon24_authority_baselines(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  baseline_id uuid not null,authority_epoch text not null check(authority_epoch='E1'),
  staging_id uuid not null,baseline_hash text not null,baseline_document jsonb not null,
  source_commit text not null,retained_assets_hash text not null,web_build_hash text not null,
  production_isolation_proven boolean not null,production_gate text not null,
  status text not null check(status in('STAGED','ACTIVE','HOLD')),
  created_by uuid not null,activation_attempt_id uuid,created_at timestamptz not null,
  activated_at timestamptz,
  primary key(app_id,tenant_id,environment,baseline_id),
  unique(app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch),
  foreign key(app_id,tenant_id,environment,staging_id)
    references app_data_agent.falcon24_e1_staging_sessions(
      app_id,tenant_id,environment,staging_id) on delete restrict,
  check(baseline_hash~'^sha256:[0-9a-f]{64}$'
    and retained_assets_hash~'^sha256:[0-9a-f]{64}$'
    and web_build_hash~'^sha256:[0-9a-f]{64}$' and source_commit~'^[0-9a-f]{40}$'
    and production_gate in('GO','HOLD')
    and production_isolation_proven=(production_gate='GO')
    and baseline_hash=app_data_agent.u2_canonical_sha256(baseline_document-'baseline_hash')
    and ((status='ACTIVE')=(activation_attempt_id is not null and activated_at is not null)))
);

create unique index falcon24_authority_one_active_baseline
on app_data_agent.falcon24_authority_baselines(app_id,tenant_id,environment)
where status='ACTIVE';

create table app_data_agent.falcon24_e1_activation_attempts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  attempt_id uuid not null,baseline_id uuid not null,expected_baseline_hash text not null,
  status text not null check(status in('OPEN','HOLD','ACTIVATED')),failure_code text,
  created_by uuid not null,created_at timestamptz not null,decided_at timestamptz,
  primary key(app_id,tenant_id,environment,attempt_id),
  unique(app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash),
  foreign key(app_id,tenant_id,environment,baseline_id)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id) on delete restrict,
  check(expected_baseline_hash~'^sha256:[0-9a-f]{64}$'
    and ((status='OPEN')=(decided_at is null))
    and ((status='HOLD')=(failure_code is not null))
    and (status='OPEN' or decided_at is not null)
    and (failure_code is null or failure_code~'^[A-Z][A-Z0-9_]{2,127}$'))
);

create unique index falcon24_e1_one_open_activation_attempt
on app_data_agent.falcon24_e1_activation_attempts(app_id,tenant_id,environment,baseline_id)
where status='OPEN';

alter table app_data_agent.falcon24_authority_baselines
  add constraint falcon24_authority_baseline_activation_attempt_fk foreign key(
    app_id,tenant_id,environment,activation_attempt_id,baseline_id,baseline_hash)
  references app_data_agent.falcon24_e1_activation_attempts(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
  on delete restrict;

create table app_data_agent.falcon24_current_authority_epoch(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  authority_epoch text not null check(authority_epoch='E1'),baseline_id uuid not null,
  baseline_hash text not null,activation_attempt_id uuid not null,activated_at timestamptz not null,
  primary key(app_id,tenant_id,environment),
  foreign key(app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  foreign key(app_id,tenant_id,environment,activation_attempt_id,baseline_id,baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict,
  check(baseline_hash~'^sha256:[0-9a-f]{64}$')
);

alter table app_data_agent.falcon24_e1_staging_sessions enable row level security;
alter table app_data_agent.falcon24_e1_staging_sessions force row level security;
alter table app_data_agent.falcon24_e1_staging_receipts enable row level security;
alter table app_data_agent.falcon24_e1_staging_receipts force row level security;
alter table app_data_agent.falcon24_authority_baselines enable row level security;
alter table app_data_agent.falcon24_authority_baselines force row level security;
alter table app_data_agent.falcon24_e1_activation_attempts enable row level security;
alter table app_data_agent.falcon24_e1_activation_attempts force row level security;
alter table app_data_agent.falcon24_current_authority_epoch enable row level security;
alter table app_data_agent.falcon24_current_authority_epoch force row level security;

create policy falcon24_e1_staging_session_authority
on app_data_agent.falcon24_e1_staging_sessions for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e1_staging_receipt_authority
on app_data_agent.falcon24_e1_staging_receipts for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e1_baseline_authority
on app_data_agent.falcon24_authority_baselines for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e1_activation_attempt_authority
on app_data_agent.falcon24_e1_activation_attempts for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e1_current_authority
on app_data_agent.falcon24_current_authority_epoch for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
