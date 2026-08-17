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
