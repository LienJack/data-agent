alter table app_data_agent.falcon24_e1_staging_sessions
  rename to falcon24_authority_staging_sessions;
alter table app_data_agent.falcon24_e1_staging_receipts
  rename to falcon24_authority_staging_receipts;
alter table app_data_agent.falcon24_e1_activation_attempts
  rename to falcon24_authority_activation_attempts;
alter table app_data_agent.falcon24_e1_ui_receipts rename to falcon24_ui_receipts;
alter table app_data_agent.falcon24_e1_gate_attempt_history
  rename to falcon24_gate_attempt_history;

alter table app_data_agent.e1_analysis_publications
  rename to falcon24_analysis_publications;
alter table app_data_agent.e1_analysis_publication_artifacts
  rename to falcon24_analysis_publication_artifacts;
alter table app_data_agent.e1_analysis_publication_current
  rename to falcon24_analysis_publication_current;
alter table app_data_agent.e1_analysis_publication_outbox
  rename to falcon24_analysis_publication_outbox;

drop trigger falcon24_e1_staging_session_state_fence
  on app_data_agent.falcon24_authority_staging_sessions;
drop trigger falcon24_e1_staging_receipt_immutable
  on app_data_agent.falcon24_authority_staging_receipts;
drop trigger falcon24_e1_activation_attempt_state_fence
  on app_data_agent.falcon24_authority_activation_attempts;
drop trigger falcon24_000_e1_qualification_slot_attempt_fence
  on app_data_agent.falcon24_qualification_slots;
drop trigger falcon24_000_e1_campaign_run_attempt_fence
  on app_data_agent.falcon24_acceptance_campaign_runs;

alter table app_data_agent.falcon24_authority_staging_sessions
  add column authority_epoch text;
alter table app_data_agent.falcon24_authority_staging_receipts
  add column authority_epoch text;
alter table app_data_agent.falcon24_authority_activation_attempts
  add column authority_epoch text;

update app_data_agent.falcon24_authority_staging_sessions set authority_epoch='E1';
update app_data_agent.falcon24_authority_staging_receipts set authority_epoch='E1';
update app_data_agent.falcon24_authority_activation_attempts set authority_epoch='E1';

alter table app_data_agent.falcon24_authority_staging_sessions
  alter column authority_epoch set not null,
  add constraint falcon24_authority_staging_session_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_authority_staging_session_epoch_key unique(
    app_id,tenant_id,environment,staging_id,authority_epoch);
alter table app_data_agent.falcon24_authority_staging_receipts
  alter column authority_epoch set not null,
  add constraint falcon24_authority_staging_receipt_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$');
alter table app_data_agent.falcon24_authority_activation_attempts
  alter column authority_epoch set not null,
  add constraint falcon24_authority_activation_attempt_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_authority_activation_attempt_epoch_key unique(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash,authority_epoch);

alter table app_data_agent.falcon24_authority_staging_receipts
  drop constraint falcon24_e1_staging_receipts_app_id_tenant_id_environment__fkey,
  drop constraint falcon24_e1_staging_receipts_check,
  add constraint falcon24_authority_staging_receipt_session_fk foreign key(
    app_id,tenant_id,environment,staging_id,authority_epoch)
    references app_data_agent.falcon24_authority_staging_sessions(
      app_id,tenant_id,environment,staging_id,authority_epoch) on delete restrict,
  add constraint falcon24_authority_staging_receipt_document_check check(
    component in('AGENT_PROFILES','DATASET','LLM_CONFIGURATION','OPERATOR_REGISTRY',
      'SANDBOX_RUNTIME','SEMANTIC_RELEASE')
    and subject_hash~'^sha256:[0-9a-f]{64}$'
    and evidence_hash~'^sha256:[0-9a-f]{64}$'
    and receipt_hash~'^sha256:[0-9a-f]{64}$'
    and (component='SANDBOX_RUNTIME' or not production_isolation_proven)
    and receipt_hash=app_data_agent.u2_canonical_sha256(receipt_document-'receipt_hash')
    and ((authority_epoch='E1'
        and receipt_document->>'schema_version'='falcon24-e1-staging-receipt@1.0.0'
        and not receipt_document?'authority_epoch')
      or (authority_epoch<>'E1'
        and receipt_document->>'schema_version'='falcon24-staging-receipt@2.0.0'
        and receipt_document->>'authority_epoch'=authority_epoch)));

alter table app_data_agent.falcon24_authority_baselines
  drop constraint falcon24_authority_baselines_app_id_tenant_id_environment__fkey,
  drop constraint falcon24_authority_baselines_authority_epoch_check,
  add constraint falcon24_authority_baseline_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_authority_baseline_document_version_check check(
    ((authority_epoch='E1'
        and baseline_document->>'schema_version'='falcon24-authority-baseline@1.0.0')
      or (authority_epoch<>'E1'
        and baseline_document->>'schema_version'='falcon24-authority-baseline@2.0.0'))
    and baseline_document->>'authority_epoch'=authority_epoch),
  add constraint falcon24_authority_baseline_epoch_identity_key unique(
    app_id,tenant_id,environment,baseline_id,authority_epoch),
  add constraint falcon24_authority_baseline_staging_fk foreign key(
    app_id,tenant_id,environment,staging_id,authority_epoch)
    references app_data_agent.falcon24_authority_staging_sessions(
      app_id,tenant_id,environment,staging_id,authority_epoch) on delete restrict;

drop index app_data_agent.falcon24_authority_one_active_baseline;
create unique index falcon24_authority_one_active_baseline_per_epoch
on app_data_agent.falcon24_authority_baselines(app_id,tenant_id,environment,authority_epoch)
where status='ACTIVE';

alter table app_data_agent.falcon24_authority_activation_attempts
  drop constraint falcon24_e1_activation_attemp_app_id_tenant_id_environment_fkey,
  add constraint falcon24_authority_activation_attempt_baseline_fk foreign key(
    app_id,tenant_id,environment,baseline_id,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,authority_epoch) on delete restrict;

alter table app_data_agent.falcon24_current_authority_epoch
  drop constraint falcon24_current_authority_epoch_authority_epoch_check,
  add constraint falcon24_current_authority_epoch_canonical_check
    check(authority_epoch~'^E[1-9][0-9]*$');

alter table app_data_agent.runs
  drop constraint runs_falcon24_e1_epoch_check,
  add constraint runs_falcon24_authority_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$');
alter table app_data_agent.effective_run_config_receipts
  drop constraint effective_config_falcon24_e1_epoch_check,
  add constraint effective_config_falcon24_authority_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$');
alter table app_data_agent.artifacts
  drop constraint artifacts_falcon24_e1_epoch_check,
  add constraint artifacts_falcon24_authority_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$');

alter table app_data_agent.falcon24_ui_receipts
  drop constraint falcon24_e1_ui_receipts_authority_epoch_check,
  add constraint falcon24_ui_receipt_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_ui_receipt_document_version_check check(
    (authority_epoch='E1' and receipt_json->>'schema_version' in(
      'falcon24-qa-e2e-receipt@1.0.0','falcon24-trace-ui-receipt@1.0.0'))
    or (authority_epoch<>'E1' and receipt_json->>'schema_version' in(
      'falcon24-qa-e2e-receipt@2.0.0','falcon24-trace-ui-receipt@2.0.0')));

alter table app_data_agent.falcon24_gate_attempt_history
  drop constraint falcon24_e1_gate_attempt_history_authority_epoch_check,
  drop constraint falcon24_e1_gate_attempt_history_check,
  add constraint falcon24_gate_attempt_history_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_gate_attempt_history_identity_check check(
    (gate_kind='QUALIFICATION' and gate_id=authority_epoch||'-Q1'
      and pg_catalog.jsonb_array_length(slot_snapshots)=16)
    or (gate_kind='CAMPAIGN' and gate_id=authority_epoch||'-C1'
      and pg_catalog.jsonb_array_length(slot_snapshots)=30));

alter table app_data_agent.falcon24_qualifications
  drop constraint falcon24_qualification_e1_epoch_check,
  drop constraint falcon24_e1_qualification_identity_check,
  add constraint falcon24_qualification_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_qualification_identity_check check(
    qualification_id=authority_epoch||'-Q1'
    and qualification_version between 1 and 1000000
    and model_id~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and (status='HOLD')=(first_failure_run_id is not null)
    and (status='HOLD')=(first_failure_layer is not null)
    and (status='HOLD')=(first_failure_code is not null)
    and (first_failure_layer is null or first_failure_layer in(
      'ROOT_ROUTING','SQL_DATA_PREPARATION','GOVERNED_OPERATOR','ORACLE','PUBLISHER',
      'SANDBOX_RECLAMATION'))
    and (first_failure_code is null or first_failure_code~'^[A-Z][A-Z0-9_]{2,127}$'));

alter table app_data_agent.falcon24_qualifications
  drop constraint falcon24_qualifications_app_id_tenant_id_environment_princi_key,
  add constraint falcon24_qualification_epoch_version_key unique(
    app_id,tenant_id,environment,principal_id,authority_epoch,qualification_version),
  add constraint falcon24_qualification_epoch_identity_key unique(
    app_id,tenant_id,environment,principal_id,qualification_id,authority_epoch);

alter table app_data_agent.falcon24_qualification_slots add column authority_epoch text;
update app_data_agent.falcon24_qualification_slots set authority_epoch='E1';
alter table app_data_agent.falcon24_qualification_slots
  alter column authority_epoch set not null,
  add constraint falcon24_qualification_slot_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_qualification_slot_epoch_parent_fk foreign key(
    app_id,tenant_id,environment,principal_id,qualification_id,authority_epoch)
    references app_data_agent.falcon24_qualifications(
      app_id,tenant_id,environment,principal_id,qualification_id,authority_epoch)
    on delete restrict;

alter table app_data_agent.falcon24_acceptance_campaigns
  drop constraint falcon24_campaign_e1_epoch_check,
  drop constraint falcon24_e1_campaign_identity_check,
  add constraint falcon24_campaign_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_campaign_identity_check check(
    campaign_id=authority_epoch||'-C1'
    and campaign_version between 1 and 1000000
    and policy_id='falcon24-strict-zero-retry@1.0.0'
    and (status='HOLD')=(first_failure_run_id is not null)
    and (status='HOLD')=(first_failure_layer is not null)
    and (status='HOLD')=(first_failure_code is not null));

alter table app_data_agent.falcon24_acceptance_campaigns
  drop constraint falcon24_acceptance_campaigns_app_id_tenant_id_environment__key,
  add constraint falcon24_campaign_epoch_version_key unique(
    app_id,tenant_id,environment,principal_id,authority_epoch,campaign_version),
  add constraint falcon24_campaign_epoch_identity_key unique(
    app_id,tenant_id,environment,principal_id,campaign_id,authority_epoch);

alter table app_data_agent.falcon24_acceptance_campaign_runs add column authority_epoch text;
update app_data_agent.falcon24_acceptance_campaign_runs set authority_epoch='E1';
alter table app_data_agent.falcon24_acceptance_campaign_runs
  alter column authority_epoch set not null,
  add constraint falcon24_campaign_run_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_campaign_run_epoch_parent_fk foreign key(
    app_id,tenant_id,environment,principal_id,campaign_id,authority_epoch)
    references app_data_agent.falcon24_acceptance_campaigns(
      app_id,tenant_id,environment,principal_id,campaign_id,authority_epoch)
    on delete restrict;

alter policy falcon24_e1_staging_session_authority
  on app_data_agent.falcon24_authority_staging_sessions
  rename to falcon24_authority_staging_session_rpc;
alter policy falcon24_e1_staging_receipt_authority
  on app_data_agent.falcon24_authority_staging_receipts
  rename to falcon24_authority_staging_receipt_rpc;
alter policy falcon24_e1_activation_attempt_authority
  on app_data_agent.falcon24_authority_activation_attempts
  rename to falcon24_authority_activation_attempt_rpc;
alter policy falcon24_e1_ui_receipts_rpc on app_data_agent.falcon24_ui_receipts
  rename to falcon24_ui_receipts_rpc;
alter policy falcon24_e1_ui_receipts_rpc_insert on app_data_agent.falcon24_ui_receipts
  rename to falcon24_ui_receipts_rpc_insert;
alter policy falcon24_e1_gate_attempt_history_authority
  on app_data_agent.falcon24_gate_attempt_history
  rename to falcon24_gate_attempt_history_rpc;
alter policy e1_analysis_publications_rpc
  on app_data_agent.falcon24_analysis_publications
  rename to falcon24_analysis_publications_rpc;
alter policy e1_analysis_publications_rpc_insert
  on app_data_agent.falcon24_analysis_publications
  rename to falcon24_analysis_publications_rpc_insert;
alter policy e1_analysis_publication_artifacts_rpc
  on app_data_agent.falcon24_analysis_publication_artifacts
  rename to falcon24_analysis_publication_artifacts_rpc;
alter policy e1_analysis_publication_artifacts_rpc_insert
  on app_data_agent.falcon24_analysis_publication_artifacts
  rename to falcon24_analysis_publication_artifacts_rpc_insert;
alter policy e1_analysis_publication_current_rpc
  on app_data_agent.falcon24_analysis_publication_current
  rename to falcon24_analysis_publication_current_rpc;
alter policy e1_analysis_publication_current_rpc_insert
  on app_data_agent.falcon24_analysis_publication_current
  rename to falcon24_analysis_publication_current_rpc_insert;
alter policy e1_analysis_publication_outbox_rpc
  on app_data_agent.falcon24_analysis_publication_outbox
  rename to falcon24_analysis_publication_outbox_rpc;
alter policy e1_analysis_publication_outbox_rpc_insert
  on app_data_agent.falcon24_analysis_publication_outbox
  rename to falcon24_analysis_publication_outbox_rpc_insert;

alter trigger e1_analysis_publications_immutable
  on app_data_agent.falcon24_analysis_publications
  rename to falcon24_analysis_publications_immutable;
alter trigger e1_analysis_publication_artifacts_immutable
  on app_data_agent.falcon24_analysis_publication_artifacts
  rename to falcon24_analysis_publication_artifacts_immutable;
alter trigger e1_analysis_publication_current_immutable
  on app_data_agent.falcon24_analysis_publication_current
  rename to falcon24_analysis_publication_current_immutable;

alter table app_data_agent.falcon24_authority_staging_sessions force row level security;
alter table app_data_agent.falcon24_authority_staging_receipts force row level security;
alter table app_data_agent.falcon24_authority_activation_attempts force row level security;
alter table app_data_agent.falcon24_ui_receipts force row level security;
alter table app_data_agent.falcon24_gate_attempt_history force row level security;
alter table app_data_agent.falcon24_analysis_publications force row level security;
alter table app_data_agent.falcon24_analysis_publication_artifacts force row level security;
alter table app_data_agent.falcon24_analysis_publication_current force row level security;
alter table app_data_agent.falcon24_analysis_publication_outbox force row level security;
