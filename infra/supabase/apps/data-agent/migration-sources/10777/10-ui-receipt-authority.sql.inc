create table app_data_agent.falcon24_e1_ui_receipts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,run_id uuid not null,
  receipt_kind text not null check(receipt_kind in('QA_E2E','TRACE_UI')),
  viewport_width integer not null check(viewport_width in(390,1440)),
  viewport_height integer not null check(viewport_height between 640 and 2400),
  authority_epoch text not null check(authority_epoch='E1'),baseline_id uuid not null,
  baseline_hash text not null check(baseline_hash~'^sha256:[0-9a-f]{64}$'),
  activation_attempt_id uuid not null,web_build_hash text not null,
  dom_snapshot_hash text not null,screenshot_hash text not null,receipt_hash text not null,
  receipt_json jsonb not null check(pg_catalog.jsonb_typeof(receipt_json)='object'),
  observed_at timestamptz not null,committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,run_id,receipt_kind,viewport_width),
  unique(app_id,tenant_id,environment,run_id,receipt_hash),
  foreign key(app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  foreign key(app_id,tenant_id,environment,activation_attempt_id,baseline_id,baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash) on delete restrict,
  check(web_build_hash~'^sha256:[0-9a-f]{64}$'
    and dom_snapshot_hash~'^sha256:[0-9a-f]{64}$'
    and screenshot_hash~'^sha256:[0-9a-f]{64}$'
    and receipt_hash~'^sha256:[0-9a-f]{64}$'
    and receipt_json->>'run_id'=run_id::text
    and receipt_json->>'receipt_hash'=receipt_hash
    and receipt_hash=app_data_agent.u2_canonical_sha256(receipt_json-'receipt_hash')
    and receipt_json#>>'{authority,authority_epoch}'=authority_epoch
    and receipt_json#>>'{authority,baseline_id}'=baseline_id::text
    and receipt_json#>>'{authority,baseline_hash}'=baseline_hash
    and receipt_json#>>'{authority,activation_attempt_id}'=activation_attempt_id::text
    and receipt_json#>>'{web_build,build_id}'=web_build_hash
    and (receipt_json#>>'{viewport,width}')::integer=viewport_width
    and (receipt_json#>>'{viewport,height}')::integer=viewport_height
    and receipt_json->>'dom_snapshot_hash'=dom_snapshot_hash
    and receipt_json->>'screenshot_hash'=screenshot_hash));

create trigger falcon24_e1_ui_receipts_immutable before update or delete
on app_data_agent.falcon24_e1_ui_receipts for each row
execute function app_data_agent.analysis_governed_state_immutable();
