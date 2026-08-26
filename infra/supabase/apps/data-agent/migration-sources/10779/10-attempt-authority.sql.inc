alter table app_data_agent.falcon24_qualifications
  add column attempt_id uuid not null;
alter table app_data_agent.falcon24_acceptance_campaigns
  add column attempt_id uuid not null,
  add column winning_qualification_attempt_id uuid not null;

do $replace_identity_checks$
declare constraint_row record;
begin
  for constraint_row in
    select constraint_definition.conrelid,constraint_definition.conname
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.contype='c'
      and constraint_definition.conrelid in(
        'app_data_agent.falcon24_qualifications'::pg_catalog.regclass,
        'app_data_agent.falcon24_acceptance_campaigns'::pg_catalog.regclass)
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid) like '%_id ~%falcon24-%'
  loop
    execute pg_catalog.format('alter table %s drop constraint %I',
      constraint_row.conrelid::pg_catalog.regclass,constraint_row.conname);
  end loop;
end
$replace_identity_checks$;

alter table app_data_agent.falcon24_qualifications
  add constraint falcon24_e1_qualification_identity_check check(
    qualification_id='E1-Q1' and qualification_version between 1 and 1000000
    and model_id~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and ((status='HOLD')=(first_failure_run_id is not null))
    and ((status='HOLD')=(first_failure_layer is not null))
    and ((status='HOLD')=(first_failure_code is not null))
    and (first_failure_layer is null or first_failure_layer in(
      'ROOT_ROUTING','SQL_DATA_PREPARATION','GOVERNED_OPERATOR','ORACLE','PUBLISHER',
      'SANDBOX_RECLAMATION'))
    and (first_failure_code is null or first_failure_code~'^[A-Z][A-Z0-9_]{2,127}$')),
  add constraint falcon24_e1_qualification_attempt_unique unique(
    app_id,tenant_id,environment,principal_id,attempt_id);

alter table app_data_agent.falcon24_acceptance_campaigns
  add constraint falcon24_e1_campaign_identity_check check(
    campaign_id='E1-C1' and campaign_version between 1 and 1000000
    and policy_id='falcon24-strict-zero-retry@1.0.0'
    and ((status='HOLD')=(first_failure_run_id is not null))
    and ((status='HOLD')=(first_failure_layer is not null))
    and ((status='HOLD')=(first_failure_code is not null))),
  add constraint falcon24_e1_campaign_attempt_unique unique(
    app_id,tenant_id,environment,principal_id,attempt_id);

create table app_data_agent.falcon24_e1_gate_attempt_history(
  app_id uuid not null,tenant_id uuid not null,environment text not null,principal_id uuid not null,
  gate_kind text not null check(gate_kind in('QUALIFICATION','CAMPAIGN')),
  gate_id text not null,attempt_id uuid not null,attempt_number integer not null,
  authority_epoch text not null check(authority_epoch='E1'),
  authority_baseline_id uuid not null,authority_baseline_hash text not null,
  manifest_hash text not null,status text not null check(status='HOLD'),
  parent_snapshot jsonb not null,slot_snapshots jsonb not null,archived_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,gate_kind,attempt_id),
  unique(app_id,tenant_id,environment,principal_id,gate_kind,gate_id,attempt_number),
  foreign key(app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,
    authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  check((gate_kind='QUALIFICATION' and gate_id='E1-Q1'
      and pg_catalog.jsonb_array_length(slot_snapshots)=16)
    or (gate_kind='CAMPAIGN' and gate_id='E1-C1'
      and pg_catalog.jsonb_array_length(slot_snapshots)=30)),
  check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'
    and manifest_hash~'^sha256:[0-9a-f]{64}$'
    and attempt_number between 1 and 1000000
    and pg_catalog.jsonb_typeof(parent_snapshot)='object'
    and pg_catalog.jsonb_typeof(slot_snapshots)='array')
);

alter table app_data_agent.falcon24_e1_gate_attempt_history enable row level security;
alter table app_data_agent.falcon24_e1_gate_attempt_history force row level security;
create policy falcon24_e1_gate_attempt_history_authority
on app_data_agent.falcon24_e1_gate_attempt_history for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
