-- agent_team_migration_checksum: sha256:c1cb243629c2ec06d27c6dad5f6a10342768dce14fafe617504f0db149d9b21e
-- ============================================================
-- 10658: Agent Team v2 and Sensitive Execution Artifact Authority
-- Forward-only metadata and hash authority; no historical data mutation.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='AGENT_TEAM_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode='42501',message='AGENT_TEAM_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010657_app_data_agent_artifact_export_authority'
  ) then
    raise exception using errcode='P0001',message='AGENT_TEAM_BASELINE_10657_MISSING';
  end if;
  if pg_catalog.to_regclass('app_data_agent.run_attempts') is null
    or pg_catalog.to_regprocedure('app_data_agent.assert_provider_active_worker_lease(jsonb)') is null
  then
    raise exception using errcode='P0001',message='AGENT_TEAM_RUNTIME_AUTHORITY_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u19_team_owner') then
    create role data_agent_u19_team_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.agent_profile_revisions (
  profile_id text not null check (profile_id in (
    'data-agent-orchestrator','semantic-management-agent',
    'governed-text2sql-agent','report-writing-agent'
  )),
  profile_revision integer not null check (profile_revision=1),
  profile_hash text not null check (profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  profile_json jsonb not null check (pg_catalog.jsonb_typeof(profile_json)='object'),
  primary key (profile_id,profile_revision),
  unique (profile_id,profile_revision,profile_hash),
  check (profile_hash=app_data_agent.u2_canonical_sha256(profile_json-'profile_hash'))
);

insert into app_data_agent.agent_profile_revisions(profile_id,profile_revision,profile_hash,profile_json)
values
('data-agent-orchestrator',1,'sha256:c46b9eb899fe2dd1592b914b509268b8281736ad223181be5a4e998ecd9eddad',
 '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"data-agent-orchestrator","revision":1,"direct_tool_allowlist":[],"delegation_ceiling":["governed-text2sql-agent","report-writing-agent","semantic-management-agent"],"mandatory_context":["GOAL","OPEN_OBLIGATIONS","POLICY","QUESTION"],"workflow":{"workflow_id":"team.orchestrator.v2","workflow_revision":1},"expected_output_artifact_types":["ReportManifest"],"verifier":{"verifier_id":"team.orchestrator-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"NEEDS_CLARIFICATION"},"profile_hash":"sha256:c46b9eb899fe2dd1592b914b509268b8281736ad223181be5a4e998ecd9eddad"}'::jsonb),
('semantic-management-agent',1,'sha256:92910b6741ada7b2e5377c0b00b3ff2c64be7f0fb5567161359dfbabd4814b38',
 '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"semantic-management-agent","revision":1,"direct_tool_allowlist":["semantic.candidate.write","semantic.catalog.read"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING"],"workflow":{"workflow_id":"team.semantic-candidate.v2","workflow_revision":1},"expected_output_artifact_types":["SemanticGraphCandidate"],"verifier":{"verifier_id":"team.semantic-candidate-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:92910b6741ada7b2e5377c0b00b3ff2c64be7f0fb5567161359dfbabd4814b38"}'::jsonb),
('governed-text2sql-agent',1,'sha256:e283c8d3800ddc40b3d59580368d4334c69c7b54df4c455fdfd4c119d71b349c',
 '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"governed-text2sql-agent","revision":1,"direct_tool_allowlist":["semantic.release.read","sql.compiler.compile","sql.sandbox.execute"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.governed-text2sql.v2","workflow_revision":1},"expected_output_artifact_types":["QueryEvidence"],"verifier":{"verifier_id":"team.query-evidence-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"NEEDS_CLARIFICATION"},"profile_hash":"sha256:e283c8d3800ddc40b3d59580368d4334c69c7b54df4c455fdfd4c119d71b349c"}'::jsonb),
('report-writing-agent',1,'sha256:7bcc21bc4933193b9f2f25791cfb694c90873525cc749e868b53a7ff79f2a26d',
 '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"report-writing-agent","revision":1,"direct_tool_allowlist":["evidence.read","report.project"],"delegation_ceiling":[],"mandatory_context":["CLAIM_EVIDENCE","GOAL","POLICY","QUERY_EVIDENCE"],"workflow":{"workflow_id":"team.report-writing.v2","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport"],"verifier":{"verifier_id":"team.report-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:7bcc21bc4933193b9f2f25791cfb694c90873525cc749e868b53a7ff79f2a26d"}'::jsonb);

create table app_data_agent.agent_team_tasks (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  principal_id uuid not null,
  task_id uuid not null,
  parent_task_id uuid,
  parent_handoff_id uuid,
  depth integer not null check (depth in (0,1)),
  profile_id text not null,
  profile_revision integer not null,
  profile_hash text not null check (profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  task_revision integer not null check (task_revision>=1),
  goal_revision integer not null check (goal_revision>=1),
  task_attempt_id uuid not null,
  authority_attempt_id uuid not null,
  outbox_id uuid not null,
  command_id uuid not null,
  worker_id text not null,
  lease_token bigint not null check (lease_token between 1 and 9007199254740991),
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  task_hash text not null check (task_hash ~ '^sha256:[0-9a-f]{64}$'),
  create_command_id uuid not null,
  create_request_hash text not null check (create_request_hash ~ '^sha256:[0-9a-f]{64}$'),
  task_json jsonb not null check (
    pg_catalog.jsonb_typeof(task_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(task_json)
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,task_id),
  unique (app_id,tenant_id,environment,create_command_id),
  unique (app_id,tenant_id,environment,task_id,task_revision),
  unique (app_id,tenant_id,environment,task_id,task_revision,task_hash),
  foreign key (profile_id,profile_revision,profile_hash)
    references app_data_agent.agent_profile_revisions(profile_id,profile_revision,profile_hash),
  foreign key (app_id,tenant_id,environment,run_id,principal_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id,principal_id),
  foreign key (app_id,tenant_id,environment,authority_attempt_id,outbox_id,run_id,worker_fence)
    references app_data_agent.run_attempts(app_id,tenant_id,environment,attempt_id,outbox_id,run_id,worker_fence),
  foreign key (app_id,tenant_id,environment,parent_task_id)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id)
    deferrable initially deferred,
  check (
    (depth=0 and parent_task_id is null and parent_handoff_id is null and profile_id='data-agent-orchestrator')
    or (depth=1 and parent_task_id is not null and parent_handoff_id is not null and profile_id<>'data-agent-orchestrator')
  )
);

create table app_data_agent.agent_team_handoffs (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  handoff_id uuid not null,
  parent_task_id uuid not null,
  child_task_id uuid not null,
  parent_expected_revision integer not null,
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  command_id uuid not null,
  handoff_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(handoff_json)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,handoff_id),
  unique (app_id,tenant_id,environment,command_id),
  unique (app_id,tenant_id,environment,parent_task_id,request_hash),
  foreign key (app_id,tenant_id,environment,parent_task_id)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id),
  foreign key (app_id,tenant_id,environment,child_task_id)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id)
);

create table app_data_agent.agent_team_context_epochs (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  task_id uuid not null,
  epoch_id uuid not null,
  epoch_revision integer not null check (epoch_revision>=1),
  phase text not null check (phase in ('STARTED','SUMMARY_COMMITTED','REPLACEMENT_COMMITTED','PROBE_PASSED','ACTIVATED')),
  build_signature text not null check (build_signature ~ '^sha256:[0-9a-f]{64}$'),
  obligation_ledger_hash text not null check (obligation_ledger_hash ~ '^sha256:[0-9a-f]{64}$'),
  document_hash text not null check (document_hash ~ '^sha256:[0-9a-f]{64}$'),
  command_id uuid not null,
  epoch_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(epoch_json)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,task_id,epoch_id,epoch_revision),
  unique (app_id,tenant_id,environment,command_id),
  foreign key (app_id,tenant_id,environment,task_id)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id)
);

create table app_data_agent.agent_team_completion_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  task_id uuid not null,
  completion_id uuid not null,
  task_revision integer not null,
  completion_hash text not null check (completion_hash ~ '^sha256:[0-9a-f]{64}$'),
  command_id uuid not null,
  receipt_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(receipt_json)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,completion_id),
  unique (app_id,tenant_id,environment,task_id,completion_hash),
  unique (app_id,tenant_id,environment,command_id),
  foreign key (app_id,tenant_id,environment,task_id,task_revision)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id,task_revision)
);

create table app_data_agent.agent_team_events (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  task_id uuid not null,
  event_id uuid not null,
  event_type text not null check (event_type='LATE_RESULT_IGNORED'),
  event_hash text not null check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  command_id uuid not null,
  event_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(event_json)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,event_id),
  unique (app_id,tenant_id,environment,command_id),
  foreign key (app_id,tenant_id,environment,task_id)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id)
);

create table app_data_agent.agent_team_verifier_decisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  task_id uuid not null,
  task_revision integer not null,
  decision_id uuid not null,
  completion_hash text not null check (completion_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision_hash text not null check (decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(decision_json)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,decision_id),
  unique (app_id,tenant_id,environment,task_id,decision_hash),
  foreign key (app_id,tenant_id,environment,task_id,task_revision)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id,task_revision)
);

create table app_data_agent.agent_team_task_capabilities (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  task_id uuid not null,
  capability_id uuid not null,
  capability_hash text not null check (capability_hash ~ '^sha256:[0-9a-f]{64}$'),
  task_revision integer not null,
  task_attempt_id uuid not null,
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  expires_at timestamptz not null,
  revocation_version integer not null check (revocation_version>=1),
  command_id uuid not null,
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  capability_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(capability_json)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,capability_id),
  unique (app_id,tenant_id,environment,command_id),
  foreign key (app_id,tenant_id,environment,task_id,task_revision)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id,task_revision)
);

create table app_data_agent.agent_team_acceptance_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  task_id uuid not null,
  task_revision integer not null,
  completion_id uuid not null,
  acceptance_hash text not null check (acceptance_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text not null check (status in ('ACCEPTED','REJECTED')),
  command_id uuid not null,
  receipt_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(receipt_json)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,task_id,acceptance_hash),
  unique (app_id,tenant_id,environment,command_id),
  foreign key (app_id,tenant_id,environment,completion_id)
    references app_data_agent.agent_team_completion_receipts(app_id,tenant_id,environment,completion_id)
);

create table app_data_agent.sensitive_execution_artifacts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  artifact_id uuid not null,
  artifact_revision integer not null check (artifact_revision>=1),
  task_id uuid not null,
  context_epoch_id uuid,
  plaintext_hash text not null check (plaintext_hash ~ '^sha256:[0-9a-f]{64}$'),
  ciphertext_hash text not null check (ciphertext_hash ~ '^sha256:[0-9a-f]{64}$'),
  storage_key_hash text not null check (storage_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  key_id text not null,
  lifecycle_status text not null check (lifecycle_status in ('ACTIVE','TOMBSTONED')),
  expires_at timestamptz not null,
  legal_hold boolean not null,
  ref_count integer not null check (ref_count>=0),
  tombstoned_at timestamptz,
  backup_expires_at timestamptz not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text not null,
  receipt_json jsonb not null check (
    not app_data_agent.contains_potential_plaintext_secret(receipt_json)
    and not (receipt_json ? 'plaintext') and not (receipt_json ? 'ciphertext')
  ),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,artifact_id,artifact_revision),
  unique (app_id,tenant_id,environment,idempotency_key),
  unique (app_id,tenant_id,environment,artifact_id,artifact_revision,plaintext_hash),
  foreign key (app_id,tenant_id,environment,task_id)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id),
  check (backup_expires_at>=expires_at),
  check (
    (lifecycle_status='ACTIVE' and ref_count>=1 and tombstoned_at is null)
    or (lifecycle_status='TOMBSTONED' and ref_count=0 and tombstoned_at is not null and not legal_hold)
  )
);

create table app_data_agent.sensitive_execution_artifact_access_audit (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  audit_id bigint generated always as identity,
  artifact_id uuid not null,
  artifact_revision integer not null,
  principal_id uuid not null,
  action text not null check (action in ('COMMIT','LOAD')),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,audit_id),
  foreign key (app_id,tenant_id,environment,artifact_id,artifact_revision)
    references app_data_agent.sensitive_execution_artifacts(app_id,tenant_id,environment,artifact_id,artifact_revision)
);

alter table app_data_agent.agent_profile_revisions owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_tasks owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_handoffs owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_context_epochs owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_completion_receipts owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_events owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_verifier_decisions owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_task_capabilities owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_acceptance_receipts owner to data_agent_u19_team_owner;
alter table app_data_agent.sensitive_execution_artifacts owner to data_agent_u19_team_owner;
alter table app_data_agent.sensitive_execution_artifact_access_audit owner to data_agent_u19_team_owner;

alter table app_data_agent.agent_team_tasks enable row level security;
alter table app_data_agent.agent_team_tasks force row level security;
alter table app_data_agent.agent_team_handoffs enable row level security;
alter table app_data_agent.agent_team_handoffs force row level security;
alter table app_data_agent.agent_team_context_epochs enable row level security;
alter table app_data_agent.agent_team_context_epochs force row level security;
alter table app_data_agent.agent_team_completion_receipts enable row level security;
alter table app_data_agent.agent_team_completion_receipts force row level security;
alter table app_data_agent.agent_team_events enable row level security;
alter table app_data_agent.agent_team_events force row level security;
alter table app_data_agent.agent_team_verifier_decisions enable row level security;
alter table app_data_agent.agent_team_verifier_decisions force row level security;
alter table app_data_agent.agent_team_task_capabilities enable row level security;
alter table app_data_agent.agent_team_task_capabilities force row level security;
alter table app_data_agent.agent_team_acceptance_receipts enable row level security;
alter table app_data_agent.agent_team_acceptance_receipts force row level security;
alter table app_data_agent.sensitive_execution_artifacts enable row level security;
alter table app_data_agent.sensitive_execution_artifacts force row level security;
alter table app_data_agent.sensitive_execution_artifact_access_audit enable row level security;
alter table app_data_agent.sensitive_execution_artifact_access_audit force row level security;

create policy agent_team_tasks_owner_all on app_data_agent.agent_team_tasks
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy agent_team_handoffs_owner_all on app_data_agent.agent_team_handoffs
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy agent_team_context_epochs_owner_all on app_data_agent.agent_team_context_epochs
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy agent_team_completion_owner_all on app_data_agent.agent_team_completion_receipts
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy agent_team_events_owner_all on app_data_agent.agent_team_events
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy agent_team_verifier_owner_all on app_data_agent.agent_team_verifier_decisions
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy agent_team_capability_owner_all on app_data_agent.agent_team_task_capabilities
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy agent_team_acceptance_owner_all on app_data_agent.agent_team_acceptance_receipts
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy sensitive_execution_artifacts_owner_all on app_data_agent.sensitive_execution_artifacts
for all to data_agent_u19_team_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy sensitive_execution_access_owner_all on app_data_agent.sensitive_execution_artifact_access_audit
for all to data_agent_u19_team_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false))
with check (platform.backend_context_matches(app_id,tenant_id,environment,true));

create function app_data_agent.reject_agent_team_authority_mutation()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='AGENT_TEAM_AUTHORITY_IMMUTABLE';
end
$function$;
alter function app_data_agent.reject_agent_team_authority_mutation() owner to data_agent_u19_team_owner;

create trigger agent_team_tasks_immutable before update or delete on app_data_agent.agent_team_tasks
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger agent_team_handoffs_immutable before update or delete on app_data_agent.agent_team_handoffs
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger agent_team_epochs_immutable before update or delete on app_data_agent.agent_team_context_epochs
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger agent_team_completion_immutable before update or delete on app_data_agent.agent_team_completion_receipts
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger agent_team_events_immutable before update or delete on app_data_agent.agent_team_events
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger agent_team_verifier_immutable before update or delete on app_data_agent.agent_team_verifier_decisions
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger agent_team_capability_immutable before update or delete on app_data_agent.agent_team_task_capabilities
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger agent_team_acceptance_immutable before update or delete on app_data_agent.agent_team_acceptance_receipts
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger sensitive_execution_artifacts_immutable before update or delete on app_data_agent.sensitive_execution_artifacts
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create trigger sensitive_execution_access_immutable before update or delete on app_data_agent.sensitive_execution_artifact_access_audit
for each row execute function app_data_agent.reject_agent_team_authority_mutation();
create function app_data_agent.agent_team_assert_store_command(
  requested_command jsonb,
  expected_operation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  lease_authority jsonb;
  expected_document_hash text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','operation','command_id','scope','run_id','task_id','expected_revision',
    'lease','selector','document','document_hash','request_hash'
  ]) or requested_command ->> 'schema_version' <> 'agent-team-store-command@1.0.0'
    or requested_command ->> 'operation' <> expected_operation
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array['app_id','tenant_id','environment']
    )
    or app_data_agent.contains_potential_plaintext_secret(
      (requested_command-'lease')- 'selector'
    )
  then
    raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID';
  end if;
  if expected_operation in ('LOAD_RUN','LOAD_TASK_CAPABILITY') then
    if requested_command -> 'document' <> 'null'::jsonb
      or requested_command -> 'document_hash' <> 'null'::jsonb
    then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  elsif pg_catalog.jsonb_typeof(requested_command -> 'document') <> 'object' then
    raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID';
  end if;
  if expected_operation='LOAD_TASK_CAPABILITY' then
    if not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'selector',array['capability_id','capability_hash']
    ) then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  elsif requested_command -> 'selector' <> 'null'::jsonb then
    raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID';
  end if;
  if requested_command -> 'document' <> 'null'::jsonb then
    expected_document_hash := app_data_agent.u2_canonical_sha256(requested_command -> 'document');
    if requested_command ->> 'document_hash' <> expected_document_hash then
      raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID';
    end if;
  end if;
  if requested_command ->> 'request_hash'
    <> app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;

  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_command -> 'lease');
  if requested_command #>> '{scope,app_id}' <> lease_authority ->> 'app_id'
    or requested_command #>> '{scope,tenant_id}' <> lease_authority ->> 'tenant_id'
    or requested_command #>> '{scope,environment}' <> lease_authority ->> 'environment'
    or requested_command ->> 'run_id' <> lease_authority ->> 'run_id'
  then raise exception using errcode='42501',message='AGENT_TEAM_SCOPE_MISMATCH'; end if;
  return lease_authority;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID';
end
$function$;

create function app_data_agent.agent_team_store_result(
  requested_command jsonb,
  requested_disposition text,
  result_document jsonb
)
returns jsonb
language sql
stable
set search_path=''
as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version','agent-team-store-result@1.0.0',
    'operation',requested_command ->> 'operation',
    'disposition',requested_disposition,
    'request_hash',requested_command ->> 'request_hash',
    'document_hash',case when result_document='null'::jsonb then null
      else app_data_agent.u2_canonical_sha256(result_document) end,
    'document',result_document
  );
$function$;

create function app_data_agent.create_agent_team_task(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  authority jsonb;
  task jsonb;
  existing app_data_agent.agent_team_tasks%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'CREATE_TASK');
  task := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(task,array[
    'schema_version','task_id','parent_task_id','parent_handoff_id','depth','scope','run_id',
    'profile_id','profile_revision','profile_hash','task_revision','goal_revision','attempt_id',
    'worker_fence','artifact_refs','context_epoch_ref','bounds','acceptance','task_hash'
  ]) or task ->> 'schema_version' <> 'agent-team-task@2.0.0'
    or (task ->> 'task_id')::uuid <> (requested_command ->> 'task_id')::uuid
    or task ->> 'run_id' <> authority ->> 'run_id'
    or task -> 'scope' <> requested_command -> 'scope'
    or (task ->> 'depth')::integer <> 0
    or task ->> 'profile_id' <> 'data-agent-orchestrator'
    or task -> 'parent_task_id' <> 'null'::jsonb
    or task -> 'parent_handoff_id' <> 'null'::jsonb
    or task -> 'context_epoch_ref' <> 'null'::jsonb
    or task ->> 'attempt_id' <> authority ->> 'attempt_id'
    or (task ->> 'worker_fence')::bigint <> (authority ->> 'worker_fence')::bigint
    or task ->> 'task_hash' <> app_data_agent.u2_canonical_sha256(task-'task_hash')
    or pg_catalog.jsonb_typeof(task -> 'artifact_refs')<>'array'
    or pg_catalog.jsonb_typeof(task -> 'bounds')<>'object'
    or pg_catalog.jsonb_typeof(task -> 'acceptance')<>'object'
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(task -> 'artifact_refs') reference
      where reference ->> 'app_id'<>authority ->> 'app_id'
        or reference ->> 'tenant_id'<>authority ->> 'tenant_id'
        or reference ->> 'environment'<>authority ->> 'environment'
        or reference ->> 'run_id'<>authority ->> 'run_id'
    )
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(task -> 'artifact_refs') reference
      group by reference having pg_catalog.count(*)>1
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions p
      where p.profile_id=task ->> 'profile_id'
        and p.profile_revision=(task ->> 'profile_revision')::integer
        and p.profile_hash=task ->> 'profile_hash'
    )
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  select * into existing from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid
    and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment'
    and create_command_id=(requested_command ->> 'command_id')::uuid;
  if found then
    if existing.create_request_hash <> requested_command ->> 'request_hash'
      or existing.task_json <> task
    then raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',existing.task_json);
  end if;

  insert into app_data_agent.agent_team_tasks(
    app_id,tenant_id,environment,run_id,principal_id,task_id,parent_task_id,parent_handoff_id,
    depth,profile_id,profile_revision,profile_hash,task_revision,goal_revision,task_attempt_id,
    authority_attempt_id,outbox_id,command_id,worker_id,lease_token,worker_fence,task_hash,
    create_command_id,create_request_hash,task_json
  ) values (
    (authority ->> 'app_id')::uuid,(authority ->> 'tenant_id')::uuid,authority ->> 'environment',
    (authority ->> 'run_id')::uuid,(authority ->> 'principal_id')::uuid,(task ->> 'task_id')::uuid,
    null,null,0,task ->> 'profile_id',(task ->> 'profile_revision')::integer,task ->> 'profile_hash',
    (task ->> 'task_revision')::integer,(task ->> 'goal_revision')::integer,(task ->> 'attempt_id')::uuid,
    (authority ->> 'attempt_id')::uuid,(authority ->> 'outbox_id')::uuid,
    (authority ->> 'command_id')::uuid,authority ->> 'worker_id',(authority ->> 'lease_token')::bigint,
    (authority ->> 'worker_fence')::bigint,task ->> 'task_hash',
    (requested_command ->> 'command_id')::uuid,requested_command ->> 'request_hash',task
  );
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',task);
end
$function$;

create function app_data_agent.prepare_agent_team_handoff(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  authority jsonb;
  handoff jsonb;
  child jsonb;
  parent app_data_agent.agent_team_tasks%rowtype;
  existing app_data_agent.agent_team_handoffs%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'PREPARE_HANDOFF');
  handoff := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(handoff,array[
    'schema_version','parent_task_id','parent_expected_revision','parent_task_hash',
    'capability_id','capability_hash','request_hash','child_task','idempotency_key'
  ]) or handoff ->> 'schema_version' <> 'subagent-delegation-command@2.0.0'
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  child := handoff -> 'child_task';
  if not app_data_agent.provider_json_object_has_exact_keys(child,array[
    'schema_version','task_id','parent_task_id','parent_handoff_id','depth','scope','run_id',
    'profile_id','profile_revision','profile_hash','task_revision','goal_revision','attempt_id',
    'worker_fence','artifact_refs','context_epoch_ref','bounds','acceptance','task_hash'
  ]) or child ->> 'schema_version' <> 'agent-team-task@2.0.0'
    or child ->> 'task_hash' <> app_data_agent.u2_canonical_sha256(child-'task_hash')
    or (child ->> 'depth')::integer <> 1
    or child ->> 'parent_task_id' <> handoff ->> 'parent_task_id'
    or child ->> 'profile_id' = 'data-agent-orchestrator'
    or child -> 'scope' <> requested_command -> 'scope'
    or child ->> 'run_id' <> requested_command ->> 'run_id'
    or (child ->> 'worker_fence')::bigint <> (authority ->> 'worker_fence')::bigint
    or pg_catalog.jsonb_typeof(child -> 'artifact_refs')<>'array'
    or pg_catalog.jsonb_typeof(child -> 'bounds')<>'object'
    or pg_catalog.jsonb_typeof(child -> 'acceptance')<>'object'
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(child -> 'artifact_refs') reference
      where reference ->> 'app_id'<>authority ->> 'app_id'
        or reference ->> 'tenant_id'<>authority ->> 'tenant_id'
        or reference ->> 'environment'<>authority ->> 'environment'
        or reference ->> 'run_id'<>authority ->> 'run_id'
    )
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(child -> 'artifact_refs') reference
      group by reference having pg_catalog.count(*)>1
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions p
      where p.profile_id=child ->> 'profile_id'
        and p.profile_revision=(child ->> 'profile_revision')::integer
        and p.profile_hash=child ->> 'profile_hash'
    )
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;

  select * into parent from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment' and task_id=(handoff ->> 'parent_task_id')::uuid
  for update;
  if not found or parent.depth<>0 or parent.profile_id<>'data-agent-orchestrator'
    or parent.task_revision<>(handoff ->> 'parent_expected_revision')::integer
    or parent.task_hash<>handoff ->> 'parent_task_hash'
    or parent.authority_attempt_id<>(authority ->> 'attempt_id')::uuid
    or parent.worker_fence<>(authority ->> 'worker_fence')::bigint
  then raise exception using errcode='40001',message='AGENT_TEAM_REVISION_CONFLICT'; end if;
  if (child ->> 'goal_revision')::integer<>parent.goal_revision
    or (child #>> '{bounds,max_context_bytes}')::integer>(parent.task_json #>> '{bounds,max_context_bytes}')::integer
    or (child #>> '{bounds,max_input_tokens}')::integer>(parent.task_json #>> '{bounds,max_input_tokens}')::integer
    or (child #>> '{bounds,max_output_tokens}')::integer>(parent.task_json #>> '{bounds,max_output_tokens}')::integer
    or (child #>> '{bounds,max_tool_calls}')::integer>(parent.task_json #>> '{bounds,max_tool_calls}')::integer
    or (child #>> '{bounds,timeout_ms}')::integer>(parent.task_json #>> '{bounds,timeout_ms}')::integer
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(child -> 'artifact_refs') child_reference
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(parent.task_json -> 'artifact_refs') parent_reference
        where parent_reference=child_reference
      )
    )
  then raise exception using errcode='42501',message='AGENT_TEAM_CAPABILITY_REQUIRED'; end if;
  if child -> 'context_epoch_ref' <> 'null'::jsonb and (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(child -> 'artifact_refs') reference
    join app_data_agent.sensitive_execution_artifacts artifact
      on artifact.app_id=parent.app_id
     and artifact.tenant_id=parent.tenant_id
     and artifact.environment=parent.environment
     and artifact.run_id=parent.run_id
     and artifact.artifact_id=(reference ->> 'artifact_id')::uuid
     and artifact.artifact_revision=(reference ->> 'revision')::integer
     and artifact.plaintext_hash=reference ->> 'content_hash'
     and artifact.lifecycle_status='ACTIVE'
     and artifact.expires_at>pg_catalog.clock_timestamp()
    where reference ->> 'artifact_type'='SensitiveExecutionArtifact'
  ) <> 1 then
    raise exception using errcode='42501',message='AGENT_TEAM_CAPABILITY_REQUIRED';
  end if;
  if not exists (
    select 1 from app_data_agent.agent_team_task_capabilities c
    where c.app_id=parent.app_id and c.tenant_id=parent.tenant_id and c.environment=parent.environment
      and c.capability_id=(handoff ->> 'capability_id')::uuid
      and c.capability_hash=handoff ->> 'capability_hash'
      and c.task_id=parent.task_id and c.expires_at>pg_catalog.clock_timestamp()
      and c.worker_fence=parent.worker_fence
  ) then raise exception using errcode='42501',message='AGENT_TEAM_CAPABILITY_REQUIRED'; end if;

  select * into existing from app_data_agent.agent_team_handoffs
  where app_id=parent.app_id and tenant_id=parent.tenant_id and environment=parent.environment
    and command_id=(requested_command ->> 'command_id')::uuid;
  if found then
    if existing.handoff_json<>handoff or existing.request_hash<>requested_command ->> 'request_hash'
    then raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',existing.handoff_json);
  end if;

  insert into app_data_agent.agent_team_tasks(
    app_id,tenant_id,environment,run_id,principal_id,task_id,parent_task_id,parent_handoff_id,
    depth,profile_id,profile_revision,profile_hash,task_revision,goal_revision,task_attempt_id,
    authority_attempt_id,outbox_id,command_id,worker_id,lease_token,worker_fence,task_hash,
    create_command_id,create_request_hash,task_json
  ) values (
    parent.app_id,parent.tenant_id,parent.environment,parent.run_id,parent.principal_id,
    (child ->> 'task_id')::uuid,parent.task_id,(child ->> 'parent_handoff_id')::uuid,1,
    child ->> 'profile_id',(child ->> 'profile_revision')::integer,child ->> 'profile_hash',
    (child ->> 'task_revision')::integer,(child ->> 'goal_revision')::integer,
    (child ->> 'attempt_id')::uuid,(authority ->> 'attempt_id')::uuid,(authority ->> 'outbox_id')::uuid,
    (authority ->> 'command_id')::uuid,authority ->> 'worker_id',(authority ->> 'lease_token')::bigint,
    (authority ->> 'worker_fence')::bigint,child ->> 'task_hash',
    (requested_command ->> 'command_id')::uuid,requested_command ->> 'request_hash',child
  );
  insert into app_data_agent.agent_team_handoffs(
    app_id,tenant_id,environment,run_id,handoff_id,parent_task_id,child_task_id,
    parent_expected_revision,request_hash,command_id,handoff_json
  ) values (
    parent.app_id,parent.tenant_id,parent.environment,parent.run_id,
    (child ->> 'parent_handoff_id')::uuid,parent.task_id,(child ->> 'task_id')::uuid,
    (handoff ->> 'parent_expected_revision')::integer,requested_command ->> 'request_hash',
    (requested_command ->> 'command_id')::uuid,handoff
  );
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',handoff);
end
$function$;

create function app_data_agent.issue_agent_team_task_capability(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  authority jsonb;
  capability jsonb;
  task app_data_agent.agent_team_tasks%rowtype;
  existing app_data_agent.agent_team_task_capabilities%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'ISSUE_TASK_CAPABILITY');
  if (select current_authority.membership_role
      from platform.current_backend_authority(true) current_authority) <> 'owner'
  then raise exception using errcode='42501',message='AGENT_TEAM_CAPABILITY_REQUIRED'; end if;
  capability := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(capability,array[
    'schema_version','capability_id','scope','run_id','task_id','attempt_id','worker_fence',
    'profile_id','profile_revision','profile_hash','artifact_ref_identities','operation_audiences',
    'issuer','issued_at','expires_at','nonce','revocation_version','capability_hash'
  ]) or capability ->> 'schema_version'<>'task-capability-receipt@2.0.0'
    or capability ->> 'capability_hash'<>app_data_agent.u2_canonical_sha256(capability-'capability_hash')
    or capability -> 'scope'<>requested_command -> 'scope'
    or capability ->> 'run_id'<>requested_command ->> 'run_id'
    or capability ->> 'task_id'<>requested_command ->> 'task_id'
    or capability #>> '{issuer,principal_id}'<>authority ->> 'principal_id'
    or (capability ->> 'expires_at')::timestamptz <= (capability ->> 'issued_at')::timestamptz
    or (capability ->> 'expires_at')::timestamptz > (capability ->> 'issued_at')::timestamptz + interval '10 minutes'
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  select * into task from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment' and task_id=(requested_command ->> 'task_id')::uuid
  for share;
  if not found or task.authority_attempt_id<>(authority ->> 'attempt_id')::uuid
    or task.worker_fence<>(authority ->> 'worker_fence')::bigint
    or task.task_attempt_id<>(capability ->> 'attempt_id')::uuid
    or task.profile_id<>capability ->> 'profile_id'
    or task.profile_revision<>(capability ->> 'profile_revision')::integer
    or task.profile_hash<>capability ->> 'profile_hash'
  then raise exception using errcode='40001',message='AGENT_TEAM_LEASE_STALE'; end if;
  select * into existing from app_data_agent.agent_team_task_capabilities
  where app_id=task.app_id and tenant_id=task.tenant_id and environment=task.environment
    and command_id=(requested_command ->> 'command_id')::uuid;
  if found then
    if existing.request_hash<>requested_command ->> 'request_hash' or existing.capability_json<>capability
    then raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',existing.capability_json);
  end if;
  insert into app_data_agent.agent_team_task_capabilities(
    app_id,tenant_id,environment,run_id,task_id,capability_id,capability_hash,task_revision,
    task_attempt_id,worker_fence,expires_at,revocation_version,command_id,request_hash,capability_json
  ) values (
    task.app_id,task.tenant_id,task.environment,task.run_id,task.task_id,
    (capability ->> 'capability_id')::uuid,capability ->> 'capability_hash',task.task_revision,
    task.task_attempt_id,task.worker_fence,(capability ->> 'expires_at')::timestamptz,
    (capability ->> 'revocation_version')::integer,(requested_command ->> 'command_id')::uuid,
    requested_command ->> 'request_hash',capability
  );
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',capability);
end
$function$;

create function app_data_agent.load_agent_team_task_capability(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare authority jsonb; capability jsonb;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'LOAD_TASK_CAPABILITY');
  select c.capability_json into capability from app_data_agent.agent_team_task_capabilities c
  where c.app_id=(authority ->> 'app_id')::uuid and c.tenant_id=(authority ->> 'tenant_id')::uuid
    and c.environment=authority ->> 'environment' and c.task_id=(requested_command ->> 'task_id')::uuid
    and c.capability_id=(requested_command #>> '{selector,capability_id}')::uuid
    and c.capability_hash=requested_command #>> '{selector,capability_hash}'
    and c.expires_at>pg_catalog.clock_timestamp();
  return app_data_agent.agent_team_store_result(
    requested_command,'LOADED',case when found then capability else 'null'::jsonb end
  );
end
$function$;

create function app_data_agent.commit_agent_team_context_epoch(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare authority jsonb; document jsonb; task app_data_agent.agent_team_tasks%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'COMMIT_CONTEXT_EPOCH');
  document := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(document,array[
    'schema_version','transition_id','current_epoch','proposed_epoch','current_obligations',
    'proposed_obligations','phase','revision','transition_hash'
  ]) or document ->> 'schema_version'<>'context-epoch-transition@2.0.0'
    or document ->> 'transition_hash'<>app_data_agent.u2_canonical_sha256(document-'transition_hash')
    or pg_catalog.jsonb_typeof(document #> '{current_obligations,obligations}')<>'array'
    or pg_catalog.jsonb_typeof(document #> '{proposed_obligations,obligations}')<>'array'
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  select * into task from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment' and task_id=(requested_command ->> 'task_id')::uuid
  for share;
  if not found or task.task_revision<>(requested_command ->> 'expected_revision')::integer
    or task.authority_attempt_id<>(authority ->> 'attempt_id')::uuid
    or task.worker_fence<>(authority ->> 'worker_fence')::bigint
  then raise exception using errcode='40001',message='AGENT_TEAM_REVISION_CONFLICT'; end if;
  if document ->> 'phase'='ACTIVATED'
    and (document #> '{current_obligations,obligations}')<>(document #> '{proposed_obligations,obligations}')
  then raise exception using errcode='55000',message='AGENT_TEAM_OBLIGATION_SET_MISMATCH'; end if;
  if document ->> 'phase'='ACTIVATED' and exists (
    select 1 from pg_catalog.jsonb_array_elements(
      document #> '{proposed_obligations,obligations}'
    ) obligation
    where obligation ->> 'kind'='PENDING_EFFECT' and obligation ->> 'status'<>'RESOLVED'
  ) then
    raise exception using errcode='55000',message='AGENT_TEAM_PENDING_EFFECT_RECONCILIATION_REQUIRED';
  end if;
  insert into app_data_agent.agent_team_context_epochs(
    app_id,tenant_id,environment,run_id,task_id,epoch_id,epoch_revision,phase,
    build_signature,obligation_ledger_hash,document_hash,command_id,epoch_json
  ) values (
    task.app_id,task.tenant_id,task.environment,task.run_id,task.task_id,
    (document #>> '{proposed_epoch,epoch_id}')::uuid,(document ->> 'revision')::integer,
    document ->> 'phase',document #>> '{proposed_epoch,build_signature}',
    document #>> '{proposed_obligations,ledger_hash}',requested_command ->> 'document_hash',
    (requested_command ->> 'command_id')::uuid,document
  );
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',document);
exception when unique_violation then
  if exists (select 1 from app_data_agent.agent_team_context_epochs e
    where e.app_id=(authority ->> 'app_id')::uuid and e.tenant_id=(authority ->> 'tenant_id')::uuid
      and e.environment=authority ->> 'environment' and e.command_id=(requested_command ->> 'command_id')::uuid
      and e.document_hash=requested_command ->> 'document_hash')
  then return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',document); end if;
  raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT';
end
$function$;

create function app_data_agent.commit_agent_team_completion(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare authority jsonb; receipt jsonb; task app_data_agent.agent_team_tasks%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'COMMIT_COMPLETION');
  receipt := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(receipt,array[
    'schema_version','completion_id','task_id','task_revision','task_hash','attempt_id',
    'worker_fence','profile_id','profile_hash','output_ref','status','completed_at',
    'idempotency_key','completion_hash'
  ]) or receipt ->> 'schema_version'<>'task-completion-receipt@2.0.0'
    or receipt ->> 'completion_hash'<>app_data_agent.u2_canonical_sha256(receipt-'completion_hash')
    or receipt ->> 'status'<>'COMPLETED'
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  select * into task from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment' and task_id=(requested_command ->> 'task_id')::uuid
  for share;
  if not found or task.task_id<>(receipt ->> 'task_id')::uuid
    or task.task_revision<>(receipt ->> 'task_revision')::integer or task.task_hash<>receipt ->> 'task_hash'
    or task.task_attempt_id<>(receipt ->> 'attempt_id')::uuid
    or task.worker_fence<>(receipt ->> 'worker_fence')::bigint
    or task.profile_id<>receipt ->> 'profile_id'
    or task.profile_hash<>receipt ->> 'profile_hash'
    or task.authority_attempt_id<>(authority ->> 'attempt_id')::uuid
    or receipt #>> '{output_ref,app_id}'<>task.app_id::text
    or receipt #>> '{output_ref,tenant_id}'<>task.tenant_id::text
    or receipt #>> '{output_ref,environment}'<>task.environment
    or receipt #>> '{output_ref,run_id}'<>task.run_id::text
    or not (task.task_json #> '{acceptance,required_artifact_types}')
      ? (receipt #>> '{output_ref,artifact_type}')
  then raise exception using errcode='40001',message='AGENT_TEAM_LEASE_STALE'; end if;
  insert into app_data_agent.agent_team_completion_receipts(
    app_id,tenant_id,environment,run_id,task_id,completion_id,task_revision,
    completion_hash,command_id,receipt_json
  ) values (
    task.app_id,task.tenant_id,task.environment,task.run_id,task.task_id,
    (receipt ->> 'completion_id')::uuid,task.task_revision,receipt ->> 'completion_hash',
    (requested_command ->> 'command_id')::uuid,receipt
  );
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',receipt);
exception when unique_violation then
  if exists (select 1 from app_data_agent.agent_team_completion_receipts c
    where c.app_id=task.app_id and c.tenant_id=task.tenant_id and c.environment=task.environment
      and c.command_id=(requested_command ->> 'command_id')::uuid and c.receipt_json=receipt)
  then return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',receipt); end if;
  raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT';
end
$function$;

create function app_data_agent.commit_agent_team_acceptance(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare authority jsonb; document jsonb; verifier jsonb; receipt jsonb; task app_data_agent.agent_team_tasks%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'COMMIT_ACCEPTANCE');
  document := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(document,array[
    'schema_version','verifier_decision','acceptance_receipt'
  ]) or document ->> 'schema_version'<>'task-acceptance-commit@2.0.0'
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  verifier := document -> 'verifier_decision'; receipt := document -> 'acceptance_receipt';
  if not app_data_agent.provider_json_object_has_exact_keys(verifier,array[
      'schema_version','decision_id','task_id','task_revision','completion_hash','schema_valid',
      'scope_valid','policy_valid','provenance_valid','execution_valid','intent_grounded',
      'oracle_verified','semantic_status','decided_at','decision_hash'
    ])
    or not app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','task_id','task_revision','task_hash','completion_id','completion_hash',
      'verifier_decision_id','verifier_decision_hash','coverage_hash','blocking_obligation_ids',
      'status','reason','accepted_at','acceptance_hash'
    ])
    or verifier ->> 'schema_version'<>'team-verifier-decision@2.0.0'
    or receipt ->> 'schema_version'<>'task-acceptance-receipt@2.0.0'
    or pg_catalog.jsonb_typeof(receipt -> 'blocking_obligation_ids')<>'array'
    or verifier ->> 'decision_hash'<>app_data_agent.u2_canonical_sha256(verifier-'decision_hash')
    or receipt ->> 'acceptance_hash'<>app_data_agent.u2_canonical_sha256(receipt-'acceptance_hash')
    or verifier ->> 'task_id'<>receipt ->> 'task_id'
    or verifier ->> 'completion_hash'<>receipt ->> 'completion_hash'
    or verifier ->> 'decision_id'<>receipt ->> 'verifier_decision_id'
    or verifier ->> 'decision_hash'<>receipt ->> 'verifier_decision_hash'
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  if (receipt ->> 'status'='ACCEPTED' and (
      receipt -> 'reason'<>'null'::jsonb
      or pg_catalog.jsonb_array_length(receipt -> 'blocking_obligation_ids')<>0
      or verifier ->> 'semantic_status'<>'VERIFIED'
      or verifier ->> 'schema_valid'<>'PASS'
      or verifier ->> 'scope_valid'<>'PASS'
      or verifier ->> 'policy_valid'<>'PASS'
      or verifier ->> 'provenance_valid'<>'PASS'
      or verifier ->> 'execution_valid'<>'PASS'
      or verifier ->> 'intent_grounded'<>'PASS'
      or verifier ->> 'oracle_verified'<>'PASS'
    )) or (receipt ->> 'status'='REJECTED' and receipt -> 'reason'='null'::jsonb)
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  select * into task from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment' and task_id=(requested_command ->> 'task_id')::uuid
  for share;
  if not found or task.task_revision<>(receipt ->> 'task_revision')::integer
    or task.task_hash<>receipt ->> 'task_hash'
    or task.authority_attempt_id<>(authority ->> 'attempt_id')::uuid
    or not exists (select 1 from app_data_agent.agent_team_completion_receipts c
      where c.app_id=task.app_id and c.tenant_id=task.tenant_id and c.environment=task.environment
        and c.completion_id=(receipt ->> 'completion_id')::uuid
        and c.completion_hash=receipt ->> 'completion_hash')
  then raise exception using errcode='40001',message='AGENT_TEAM_REVISION_CONFLICT'; end if;
  insert into app_data_agent.agent_team_verifier_decisions(
    app_id,tenant_id,environment,run_id,task_id,task_revision,decision_id,
    completion_hash,decision_hash,decision_json
  ) values (
    task.app_id,task.tenant_id,task.environment,task.run_id,task.task_id,task.task_revision,
    (verifier ->> 'decision_id')::uuid,verifier ->> 'completion_hash',verifier ->> 'decision_hash',verifier
  );
  insert into app_data_agent.agent_team_acceptance_receipts(
    app_id,tenant_id,environment,run_id,task_id,task_revision,completion_id,
    acceptance_hash,status,command_id,receipt_json
  ) values (
    task.app_id,task.tenant_id,task.environment,task.run_id,task.task_id,task.task_revision,
    (receipt ->> 'completion_id')::uuid,receipt ->> 'acceptance_hash',receipt ->> 'status',
    (requested_command ->> 'command_id')::uuid,receipt
  );
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',document);
exception when unique_violation then
  if exists (select 1 from app_data_agent.agent_team_acceptance_receipts a
    where a.app_id=task.app_id and a.tenant_id=task.tenant_id and a.environment=task.environment
      and a.command_id=(requested_command ->> 'command_id')::uuid and a.receipt_json=receipt)
  then return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',document); end if;
  raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT';
end
$function$;

create function app_data_agent.record_agent_team_late_result(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare authority jsonb; event jsonb; task app_data_agent.agent_team_tasks%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'RECORD_LATE_RESULT');
  event := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(event,array[
    'schema_version','event_id','task_id','task_revision','attempt_id','worker_fence',
    'result_hash','reason','observed_at','event_hash'
  ]) or event ->> 'schema_version'<>'late-task-result-audit@2.0.0'
    or event ->> 'event_hash'<>app_data_agent.u2_canonical_sha256(event-'event_hash')
    or event ->> 'reason' not in (
      'CANCELLED','TIMED_OUT','LEASE_EXPIRED','STALE_PROFILE','STALE_FENCE','CHILD_ID_SPOOF'
    )
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  select * into task from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment' and task_id=(requested_command ->> 'task_id')::uuid
  for share;
  if not found or task.task_id<>(event ->> 'task_id')::uuid
    or task.task_revision<>(event ->> 'task_revision')::integer
    or task.run_id<>(authority ->> 'run_id')::uuid
  then raise exception using errcode='40001',message='AGENT_TEAM_REVISION_CONFLICT'; end if;
  insert into app_data_agent.agent_team_events(
    app_id,tenant_id,environment,run_id,task_id,event_id,event_type,event_hash,command_id,event_json
  ) values (
    task.app_id,task.tenant_id,task.environment,task.run_id,task.task_id,
    (event ->> 'event_id')::uuid,'LATE_RESULT_IGNORED',event ->> 'event_hash',
    (requested_command ->> 'command_id')::uuid,event
  );
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',event);
exception when unique_violation then
  if exists (select 1 from app_data_agent.agent_team_events e
    where e.app_id=task.app_id and e.tenant_id=task.tenant_id and e.environment=task.environment
      and e.command_id=(requested_command ->> 'command_id')::uuid and e.event_json=event)
  then return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',event); end if;
  raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT';
end
$function$;

create function app_data_agent.load_agent_team_run(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare authority jsonb; snapshot jsonb; task app_data_agent.agent_team_tasks%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'LOAD_RUN');
  select * into task from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment' and task_id=(requested_command ->> 'task_id')::uuid;
  if not found then return app_data_agent.agent_team_store_result(requested_command,'LOADED','null'::jsonb); end if;
  snapshot := pg_catalog.jsonb_build_object(
    'schema_version','agent-team-run-snapshot@1.0.0','task',task.task_json,
    'handoffs',coalesce((select pg_catalog.jsonb_agg(h.handoff_json order by h.created_at,h.handoff_id)
      from app_data_agent.agent_team_handoffs h where h.app_id=task.app_id and h.tenant_id=task.tenant_id
      and h.environment=task.environment and (h.parent_task_id=task.task_id or h.child_task_id=task.task_id)),'[]'::jsonb),
    'context_epochs',coalesce((select pg_catalog.jsonb_agg(e.epoch_json order by e.epoch_revision)
      from app_data_agent.agent_team_context_epochs e where e.app_id=task.app_id and e.tenant_id=task.tenant_id
      and e.environment=task.environment and e.task_id=task.task_id),'[]'::jsonb),
    'completions',coalesce((select pg_catalog.jsonb_agg(c.receipt_json order by c.created_at)
      from app_data_agent.agent_team_completion_receipts c where c.app_id=task.app_id and c.tenant_id=task.tenant_id
      and c.environment=task.environment and c.task_id=task.task_id),'[]'::jsonb),
    'verifier_decisions',coalesce((select pg_catalog.jsonb_agg(v.decision_json order by v.created_at)
      from app_data_agent.agent_team_verifier_decisions v where v.app_id=task.app_id and v.tenant_id=task.tenant_id
      and v.environment=task.environment and v.task_id=task.task_id),'[]'::jsonb),
    'acceptances',coalesce((select pg_catalog.jsonb_agg(a.receipt_json order by a.created_at)
      from app_data_agent.agent_team_acceptance_receipts a where a.app_id=task.app_id and a.tenant_id=task.tenant_id
      and a.environment=task.environment and a.task_id=task.task_id),'[]'::jsonb),
    'events',coalesce((select pg_catalog.jsonb_agg(e.event_json order by e.created_at,e.event_id)
      from app_data_agent.agent_team_events e where e.app_id=task.app_id and e.tenant_id=task.tenant_id
      and e.environment=task.environment and e.task_id=task.task_id),'[]'::jsonb)
  );
  return app_data_agent.agent_team_store_result(requested_command,'LOADED',snapshot);
end
$function$;

alter function app_data_agent.agent_team_assert_store_command(jsonb,text) owner to data_agent_u19_team_owner;
alter function app_data_agent.agent_team_store_result(jsonb,text,jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.create_agent_team_task(jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.prepare_agent_team_handoff(jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.issue_agent_team_task_capability(jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.load_agent_team_task_capability(jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.commit_agent_team_context_epoch(jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.commit_agent_team_completion(jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.commit_agent_team_acceptance(jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.record_agent_team_late_result(jsonb) owner to data_agent_u19_team_owner;
alter function app_data_agent.load_agent_team_run(jsonb) owner to data_agent_u19_team_owner;
create function app_data_agent.commit_sensitive_execution_artifact(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  authority jsonb;
  receipt jsonb;
  reference jsonb;
  lifecycle jsonb;
  existing app_data_agent.sensitive_execution_artifacts%rowtype;
begin
  authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  if not app_data_agent.provider_json_object_has_exact_keys(
      requested_command,array['schema_version','receipt','idempotency_key']
    )
    or requested_command ->> 'schema_version' <> 'sensitive-execution-artifact-commit@1.0.0'
    or requested_command ->> 'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{7,127}$'
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  receipt := requested_command -> 'receipt';
  reference := receipt -> 'artifact_ref';
  lifecycle := receipt -> 'lifecycle';
  if not app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','artifact_ref','task_id','context_epoch_id','content_kind',
      'plaintext_hash','ciphertext_hash','storage_key_hash','encryption','lifecycle',
      'committed_at','receipt_hash'
    ])
    or receipt ->> 'schema_version' <> 'sensitive-execution-artifact@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(reference,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ])
    or reference ->> 'artifact_type' <> 'SensitiveExecutionArtifact'
    or reference ->> 'content_hash' <> receipt ->> 'plaintext_hash'
    or not app_data_agent.provider_json_object_has_exact_keys(
      receipt -> 'encryption',array['algorithm','key_id']
    )
    or receipt #>> '{encryption,algorithm}' <> 'AES-256-GCM'
    or not app_data_agent.provider_json_object_has_exact_keys(lifecycle,array[
      'status','expires_at','legal_hold','ref_count','tombstoned_at','backup_expires_at'
    ])
    or lifecycle ->> 'status' not in ('ACTIVE','TOMBSTONED')
    or (lifecycle ->> 'ref_count')::integer<0
    or (lifecycle ->> 'backup_expires_at')::timestamptz<(lifecycle ->> 'expires_at')::timestamptz
    or (lifecycle ->> 'status'='ACTIVE' and lifecycle -> 'tombstoned_at'<>'null'::jsonb)
    or (lifecycle ->> 'status'='TOMBSTONED' and lifecycle -> 'tombstoned_at'='null'::jsonb)
    or receipt ->> 'receipt_hash' <> app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  if reference ->> 'app_id' <> authority ->> 'app_id'
    or reference ->> 'tenant_id' <> authority ->> 'tenant_id'
    or reference ->> 'environment' <> authority ->> 'environment'
    or reference ->> 'run_id' <> authority ->> 'run_id'
  then
    raise exception using errcode='42501',message='SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH';
  end if;
  if not exists (
    select 1 from app_data_agent.agent_team_tasks task
    where task.app_id=(authority ->> 'app_id')::uuid
      and task.tenant_id=(authority ->> 'tenant_id')::uuid
      and task.environment=authority ->> 'environment'
      and task.run_id=(authority ->> 'run_id')::uuid
      and task.task_id=(receipt ->> 'task_id')::uuid
      and task.authority_attempt_id=(authority ->> 'attempt_id')::uuid
      and task.worker_fence=(authority ->> 'worker_fence')::bigint
  ) or (
    receipt -> 'context_epoch_id' <> 'null'::jsonb
    and not exists (
      select 1 from app_data_agent.agent_team_context_epochs epoch
      where epoch.app_id=(authority ->> 'app_id')::uuid
        and epoch.tenant_id=(authority ->> 'tenant_id')::uuid
        and epoch.environment=authority ->> 'environment'
        and epoch.task_id=(receipt ->> 'task_id')::uuid
        and epoch.epoch_id=(receipt ->> 'context_epoch_id')::uuid
    )
  ) then
    raise exception using errcode='40001',message='SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH';
  end if;

  select * into existing
  from app_data_agent.sensitive_execution_artifacts artifact
  where artifact.app_id=(authority ->> 'app_id')::uuid
    and artifact.tenant_id=(authority ->> 'tenant_id')::uuid
    and artifact.environment=authority ->> 'environment'
    and artifact.idempotency_key=requested_command ->> 'idempotency_key';
  if found then
    if existing.receipt_json <> receipt then
      raise exception using errcode='23505',message='SENSITIVE_EXECUTION_ARTIFACT_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','sensitive-execution-artifact-commit-result@1.0.0',
      'disposition','REPLAYED','receipt',existing.receipt_json
    );
  end if;

  insert into app_data_agent.sensitive_execution_artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,artifact_revision,task_id,
    context_epoch_id,plaintext_hash,ciphertext_hash,storage_key_hash,key_id,
    lifecycle_status,expires_at,legal_hold,ref_count,tombstoned_at,backup_expires_at,
    receipt_hash,idempotency_key,receipt_json,committed_at
  ) values (
    (authority ->> 'app_id')::uuid,(authority ->> 'tenant_id')::uuid,authority ->> 'environment',
    (authority ->> 'run_id')::uuid,(reference ->> 'artifact_id')::uuid,
    (reference ->> 'revision')::integer,(receipt ->> 'task_id')::uuid,
    case when receipt -> 'context_epoch_id'='null'::jsonb then null
      else (receipt ->> 'context_epoch_id')::uuid end,
    receipt ->> 'plaintext_hash',receipt ->> 'ciphertext_hash',receipt ->> 'storage_key_hash',
    receipt #>> '{encryption,key_id}',lifecycle ->> 'status',
    (lifecycle ->> 'expires_at')::timestamptz,(lifecycle ->> 'legal_hold')::boolean,
    (lifecycle ->> 'ref_count')::integer,
    case when lifecycle -> 'tombstoned_at'='null'::jsonb then null
      else (lifecycle ->> 'tombstoned_at')::timestamptz end,
    (lifecycle ->> 'backup_expires_at')::timestamptz,receipt ->> 'receipt_hash',
    requested_command ->> 'idempotency_key',receipt,(receipt ->> 'committed_at')::timestamptz
  );
  insert into app_data_agent.sensitive_execution_artifact_access_audit(
    app_id,tenant_id,environment,artifact_id,artifact_revision,principal_id,action
  ) values (
    (authority ->> 'app_id')::uuid,(authority ->> 'tenant_id')::uuid,authority ->> 'environment',
    (reference ->> 'artifact_id')::uuid,(reference ->> 'revision')::integer,
    (authority ->> 'principal_id')::uuid,'COMMIT'
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','sensitive-execution-artifact-commit-result@1.0.0',
    'disposition','CREATED','receipt',receipt
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.load_sensitive_execution_artifact(requested_command jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  authority record;
  reference jsonb;
  artifact app_data_agent.sensitive_execution_artifacts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','artifact_ref','task_id','context_epoch_id','ciphertext_hash',
      'capability_id','capability_hash'
    ]) or requested_command ->> 'schema_version' <> 'sensitive-execution-artifact-load@1.0.0'
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  reference := requested_command -> 'artifact_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]) or reference ->> 'artifact_type' <> 'SensitiveExecutionArtifact'
  then
    raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  if reference ->> 'app_id' <> authority.app_id::text
    or reference ->> 'tenant_id' <> authority.tenant_id::text
    or reference ->> 'environment' <> authority.environment
  then
    raise exception using errcode='42501',message='SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH';
  end if;
  select * into artifact from app_data_agent.sensitive_execution_artifacts stored
  where stored.app_id=authority.app_id and stored.tenant_id=authority.tenant_id
    and stored.environment=authority.environment
    and stored.run_id=(reference ->> 'run_id')::uuid
    and stored.artifact_id=(reference ->> 'artifact_id')::uuid
    and stored.artifact_revision=(reference ->> 'revision')::integer
    and stored.plaintext_hash=reference ->> 'content_hash'
    and stored.task_id=(requested_command ->> 'task_id')::uuid
    and stored.context_epoch_id is not distinct from
      case when requested_command -> 'context_epoch_id'='null'::jsonb then null
        else (requested_command ->> 'context_epoch_id')::uuid end
    and stored.ciphertext_hash=requested_command ->> 'ciphertext_hash';
  if not found then
    return pg_catalog.jsonb_build_object(
      'schema_version','sensitive-execution-artifact-load-result@1.0.0','receipt',null
    );
  end if;
  if not exists (
    select 1 from app_data_agent.agent_team_task_capabilities capability
    where capability.app_id=artifact.app_id and capability.tenant_id=artifact.tenant_id
      and capability.environment=artifact.environment and capability.run_id=artifact.run_id
      and capability.task_id=artifact.task_id
      and capability.capability_id=(requested_command ->> 'capability_id')::uuid
      and capability.capability_hash=requested_command ->> 'capability_hash'
      and capability.expires_at>pg_catalog.clock_timestamp()
      and capability.capability_json -> 'operation_audiences' @> '["TOOL_INVOKE"]'::jsonb
  ) then
    raise exception using errcode='42501',message='SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH';
  end if;
  if artifact.lifecycle_status='TOMBSTONED' or artifact.expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='55000',message='SENSITIVE_EXECUTION_ARTIFACT_TOMBSTONED';
  end if;
  insert into app_data_agent.sensitive_execution_artifact_access_audit(
    app_id,tenant_id,environment,artifact_id,artifact_revision,principal_id,action
  ) values (
    artifact.app_id,artifact.tenant_id,artifact.environment,artifact.artifact_id,
    artifact.artifact_revision,authority.principal_id,'LOAD'
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','sensitive-execution-artifact-load-result@1.0.0',
    'receipt',artifact.receipt_json
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID';
end
$function$;

alter function app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.load_sensitive_execution_artifact(jsonb)
  owner to data_agent_u19_team_owner;
revoke all on app_data_agent.agent_profile_revisions,
  app_data_agent.agent_team_tasks,
  app_data_agent.agent_team_handoffs,
  app_data_agent.agent_team_context_epochs,
  app_data_agent.agent_team_completion_receipts,
  app_data_agent.agent_team_events,
  app_data_agent.agent_team_verifier_decisions,
  app_data_agent.agent_team_task_capabilities,
  app_data_agent.agent_team_acceptance_receipts,
  app_data_agent.sensitive_execution_artifacts,
  app_data_agent.sensitive_execution_artifact_access_audit
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function app_data_agent.reject_agent_team_authority_mutation(),
  app_data_agent.agent_team_assert_store_command(jsonb,text),
  app_data_agent.agent_team_store_result(jsonb,text,jsonb),
  app_data_agent.create_agent_team_task(jsonb),
  app_data_agent.prepare_agent_team_handoff(jsonb),
  app_data_agent.issue_agent_team_task_capability(jsonb),
  app_data_agent.load_agent_team_task_capability(jsonb),
  app_data_agent.commit_agent_team_context_epoch(jsonb),
  app_data_agent.commit_agent_team_completion(jsonb),
  app_data_agent.commit_agent_team_acceptance(jsonb),
  app_data_agent.record_agent_team_late_result(jsonb),
  app_data_agent.load_agent_team_run(jsonb),
  app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb),
  app_data_agent.load_sensitive_execution_artifact(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant usage on schema app_data_agent,platform to data_agent_u19_team_owner;
grant select on app_data_agent.runs,app_data_agent.run_attempts,app_data_agent.outbox
  to data_agent_u19_team_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean),
  app_data_agent.assert_provider_active_worker_lease(jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
to data_agent_u19_team_owner;

grant execute on function
  app_data_agent.create_agent_team_task(jsonb),
  app_data_agent.prepare_agent_team_handoff(jsonb),
  app_data_agent.issue_agent_team_task_capability(jsonb),
  app_data_agent.load_agent_team_task_capability(jsonb),
  app_data_agent.commit_agent_team_context_epoch(jsonb),
  app_data_agent.commit_agent_team_completion(jsonb),
  app_data_agent.commit_agent_team_acceptance(jsonb),
  app_data_agent.record_agent_team_late_result(jsonb),
  app_data_agent.load_agent_team_run(jsonb),
  app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb),
  app_data_agent.load_sensitive_execution_artifact(jsonb)
to data_agent_backend;

do $postconditions$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'agent_team_tasks','agent_team_handoffs','agent_team_context_epochs',
    'agent_team_completion_receipts','agent_team_events','agent_team_verifier_decisions',
    'agent_team_task_capabilities','agent_team_acceptance_receipts',
    'sensitive_execution_artifacts','sensitive_execution_artifact_access_audit'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) then
      raise exception using errcode='P0001',message='AGENT_TEAM_FORCE_RLS_MISSING';
    end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname='data_agent_u19_team_owner' and not rolcanlogin and not rolsuper
      and not rolcreatedb and not rolcreaterole and not rolreplication
      and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u19_team_owner','data_agent_backend','MEMBER')
  then
    raise exception using errcode='P0001',message='AGENT_TEAM_OWNER_FLAGS_UNSAFE';
  end if;
  if pg_catalog.has_table_privilege(
      'data_agent_backend','app_data_agent.agent_team_tasks','INSERT,UPDATE,DELETE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend','app_data_agent.sensitive_execution_artifacts','INSERT,UPDATE,DELETE'
    ) or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.create_agent_team_task(jsonb)','EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb)','EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon','app_data_agent.load_agent_team_run(jsonb)','EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'authenticated','app_data_agent.load_sensitive_execution_artifact(jsonb)','EXECUTE'
    )
  then
    raise exception using errcode='P0001',message='AGENT_TEAM_GRANT_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010658_app_data_agent_agent_team_authority',
  'sha256:c1cb243629c2ec06d27c6dad5f6a10342768dce14fafe617504f0db149d9b21e'
);

commit;
