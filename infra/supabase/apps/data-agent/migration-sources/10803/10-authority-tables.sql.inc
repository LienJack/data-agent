create table app_data_agent.falcon24_four_layer_gate_attempts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,gate_id text not null,attempt_id uuid not null,
  authority_epoch text not null,authority_baseline_id uuid not null,
  authority_baseline_hash text not null,authority_activation_attempt_id uuid not null,
  source_commit text not null,worker_build_hash text not null,
  worker_generation_hash text not null,web_build_hash text not null,
  web_generation_hash text not null,semantic_release_hash text not null,
  datasource_binding_hash text not null,model_config_hash text not null,
  runtime_attestation_hash text not null,manifest_hash text not null,
  manifest_document jsonb not null,status text not null,current_layer text not null,
  next_turn_ordinal integer not null,attempt_version bigint not null default 1,
  first_failure_turn_ordinal integer,first_failure_run_id uuid,first_failure_code text,
  terminal_receipt_hash text,terminal_receipt jsonb,
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,attempt_id),
  unique(app_id,tenant_id,environment,principal_id,gate_id,attempt_id),
  foreign key(app_id,tenant_id,environment,authority_baseline_id,
    authority_baseline_hash,authority_epoch)
  references app_data_agent.falcon24_authority_baselines(
    app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch)
  on delete restrict,
  foreign key(app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
  references app_data_agent.falcon24_authority_activation_attempts(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
  on delete restrict,
  check(gate_id=authority_epoch||'-FL1' and authority_epoch~'^E[1-9][0-9]*$'
    and source_commit~'^[0-9a-f]{40}$'
    and authority_baseline_hash~'^sha256:[0-9a-f]{64}$'
    and worker_build_hash~'^sha256:[0-9a-f]{64}$'
    and worker_generation_hash~'^sha256:[0-9a-f]{64}$'
    and web_build_hash~'^sha256:[0-9a-f]{64}$'
    and web_generation_hash~'^sha256:[0-9a-f]{64}$'
    and semantic_release_hash~'^sha256:[0-9a-f]{64}$'
    and datasource_binding_hash~'^sha256:[0-9a-f]{64}$'
    and model_config_hash~'^sha256:[0-9a-f]{64}$'
    and runtime_attestation_hash~'^sha256:[0-9a-f]{64}$'
    and manifest_hash~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(manifest_document)='object'
    and status in('READY','RUNNING','FINALIZING','FAILED','PASSED')
    and current_layer in('L1','L2','L3','L4','COMPLETE')
    and next_turn_ordinal between 0 and 15 and attempt_version>0
    and ((first_failure_turn_ordinal is null)=(first_failure_run_id is null))
    and ((first_failure_turn_ordinal is null)=(first_failure_code is null))
    and (first_failure_turn_ordinal is null or first_failure_turn_ordinal between 0 and 14)
    and (first_failure_code is null or first_failure_code~'^[A-Z][A-Z0-9_]{2,127}$')
    and ((status='FAILED')=(first_failure_code is not null))
    and ((terminal_receipt_hash is null)=(terminal_receipt is null))
    and (terminal_receipt_hash is null or terminal_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (status<>'PASSED' or (next_turn_ordinal=15 and current_layer='COMPLETE'
      and terminal_receipt is not null)))
);

create unique index falcon24_four_layer_one_active_attempt
on app_data_agent.falcon24_four_layer_gate_attempts(
  app_id,tenant_id,environment,principal_id)
where status in('READY','RUNNING','FINALIZING');

create table app_data_agent.falcon24_four_layer_gate_turns(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,attempt_id uuid not null,turn_ordinal integer not null,
  turn_id text not null,layer text not null,scenario_id text not null,
  scenario_turn_index integer not null,conversation_group text,
  conversation_mode text not null,question text not null,question_hash text not null,
  expected_agents jsonb not null,rubric jsonb not null,status text not null,
  turn_version bigint not null default 1,conversation_id uuid,
  conversation_resource_version bigint,run_id uuid,claim_command_hash text,
  business_receipt_hash text,business_receipt jsonb,
  qa_ui_receipt_hash text,qa_ui_receipt jsonb,
  trace_ui_receipt_hash text,trace_ui_receipt jsonb,
  terminal_receipt_hash text,terminal_receipt jsonb,
  claimed_at timestamptz,completed_at timestamptz,
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,attempt_id,turn_ordinal),
  unique(app_id,tenant_id,environment,principal_id,attempt_id,turn_id),
  foreign key(app_id,tenant_id,environment,principal_id,attempt_id)
  references app_data_agent.falcon24_four_layer_gate_attempts(
    app_id,tenant_id,environment,principal_id,attempt_id) on delete restrict,
  check(turn_ordinal between 0 and 14 and turn_id~'^L[1-4](-[AB])?-0[1-5]$'
    and layer in('L1','L2','L3','L4')
    and scenario_id~'^l[1-4]-[a-z0-9-]+$' and scenario_turn_index between 0 and 2
    and conversation_group is null or conversation_group in('L4-A','L4-B')
    and conversation_mode in('INDEPENDENT','SHARED_SCENARIO')
    and ((layer='L4')=(conversation_group is not null))
    and ((layer='L4')=(conversation_mode='SHARED_SCENARIO'))
    and pg_catalog.length(pg_catalog.btrim(question)) between 1 and 8000
    and question_hash~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(expected_agents)='object'
    and pg_catalog.jsonb_typeof(rubric)='object'
    and status in('PLANNED','CLAIMED','BUSINESS_PASSED','BUSINESS_FAILED',
      'QA_PASSED','QA_FAILED','TRACE_PASSED','TRACE_FAILED','PASSED','FAILED')
    and turn_version>0
    and ((conversation_id is null)=(conversation_resource_version is null))
    and ((conversation_id is null)=(run_id is null))
    and ((conversation_id is null)=(claim_command_hash is null))
    and (conversation_resource_version is null or conversation_resource_version>0)
    and (claim_command_hash is null or claim_command_hash~'^sha256:[0-9a-f]{64}$')
    and ((business_receipt_hash is null)=(business_receipt is null))
    and ((qa_ui_receipt_hash is null)=(qa_ui_receipt is null))
    and ((trace_ui_receipt_hash is null)=(trace_ui_receipt is null))
    and ((terminal_receipt_hash is null)=(terminal_receipt is null))
    and (business_receipt_hash is null or business_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (qa_ui_receipt_hash is null or qa_ui_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (trace_ui_receipt_hash is null or trace_ui_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (terminal_receipt_hash is null or terminal_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (qa_ui_receipt is null or business_receipt->>'status'='PASS')
    and (trace_ui_receipt is null or qa_ui_receipt->>'status'='PASS')
    and (status not in('PASSED','FAILED') or completed_at is not null)
  )
);

create unique index falcon24_four_layer_run_unique
on app_data_agent.falcon24_four_layer_gate_turns(
  app_id,tenant_id,environment,principal_id,run_id)
where run_id is not null;

alter table app_data_agent.falcon24_four_layer_gate_attempts enable row level security;
alter table app_data_agent.falcon24_four_layer_gate_attempts force row level security;
alter table app_data_agent.falcon24_four_layer_gate_turns enable row level security;
alter table app_data_agent.falcon24_four_layer_gate_turns force row level security;

create policy falcon24_four_layer_attempt_authority
on app_data_agent.falcon24_four_layer_gate_attempts for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));

create policy falcon24_four_layer_turn_authority
on app_data_agent.falcon24_four_layer_gate_turns for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));
