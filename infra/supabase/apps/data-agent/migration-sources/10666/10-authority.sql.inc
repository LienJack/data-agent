create table app_data_agent.run_interruptions (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  interruption_id uuid not null,run_id uuid not null,principal_id uuid not null,
  state text not null check(state in ('OPEN','ANSWERED')),version bigint not null check(version in (1,2)),
  worker_fence bigint not null check(worker_fence>0),checkpoint_id uuid not null,
  checkpoint_version integer not null check(checkpoint_version>0),checkpoint_hash text not null,
  interruption_hash text not null,document_json jsonb not null,opened_at timestamptz not null,
  answered_at timestamptz,
  primary key(app_id,tenant_id,environment,interruption_id),
  unique(app_id,tenant_id,environment,run_id,interruption_id,version),
  check(checkpoint_hash~'^sha256:[0-9a-f]{64}$' and interruption_hash~'^sha256:[0-9a-f]{64}$'),
  check(interruption_hash=app_data_agent.u2_canonical_sha256(document_json-'interruption_hash')),
  check(document_json->>'schema_version'='run-interruption@1.0.0'
    and (document_json->>'interruption_id')::uuid=interruption_id
    and (document_json->>'run_id')::uuid=run_id and document_json->>'state'=state
    and (document_json->>'version')::bigint=version
    and (document_json->>'worker_fence')::bigint=worker_fence),
  check((state='OPEN' and version=1 and answered_at is null)
    or (state='ANSWERED' and version=2 and answered_at is not null)),
  foreign key(app_id,tenant_id,environment,run_id,principal_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id,principal_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,run_id,checkpoint_id,checkpoint_version)
    references app_data_agent.run_checkpoints(app_id,tenant_id,environment,run_id,snapshot_id,snapshot_version)
    on delete restrict
);
create unique index run_interruptions_one_open on app_data_agent.run_interruptions(
  app_id,tenant_id,environment,run_id) where state='OPEN';

create table app_data_agent.run_interruption_replies (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  reply_id uuid not null,interruption_id uuid not null,run_id uuid not null,
  actor_principal_id uuid not null,expected_version bigint not null check(expected_version=1),
  expected_worker_fence bigint not null check(expected_worker_fence>0),response_hash text not null,
  response_json jsonb not null,resume_command_id uuid not null,resume_event_id uuid not null,
  resume_outbox_id uuid not null,receipt_hash text not null,receipt_json jsonb not null,
  committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,reply_id),
  unique(app_id,tenant_id,environment,interruption_id),
  check(response_hash~'^sha256:[0-9a-f]{64}$' and receipt_hash~'^sha256:[0-9a-f]{64}$'),
  check(response_hash=app_data_agent.u2_canonical_sha256(response_json)),
  check(receipt_hash=app_data_agent.u2_canonical_sha256(receipt_json-'receipt_hash')),
  foreign key(app_id,tenant_id,environment,interruption_id)
    references app_data_agent.run_interruptions(app_id,tenant_id,environment,interruption_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,actor_principal_id)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,resume_command_id,run_id)
    references app_data_agent.commands(app_id,tenant_id,environment,command_id,run_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,run_id,resume_event_id)
    references app_data_agent.run_events(app_id,tenant_id,environment,run_id,event_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,resume_outbox_id)
    references app_data_agent.outbox(app_id,tenant_id,environment,outbox_id) on delete restrict
);

create table app_data_agent.session_branches (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  branch_id uuid not null,parent_conversation_id uuid not null,parent_run_id uuid not null,
  parent_event_sequence bigint not null check(parent_event_sequence>0),parent_checkpoint_id uuid not null,
  parent_checkpoint_version integer not null check(parent_checkpoint_version>0),
  parent_checkpoint_hash text not null,context_receipt_id uuid not null,context_receipt_hash text not null,
  config_id uuid not null,config_revision bigint not null check(config_revision=1),config_hash text not null,
  child_conversation_id uuid not null,created_by_principal_id uuid not null,
  branch_hash text not null,document_json jsonb not null,created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,branch_id),
  unique(app_id,tenant_id,environment,child_conversation_id),
  check(parent_checkpoint_hash~'^sha256:[0-9a-f]{64}$'
    and context_receipt_hash~'^sha256:[0-9a-f]{64}$' and config_hash~'^sha256:[0-9a-f]{64}$'
    and branch_hash~'^sha256:[0-9a-f]{64}$'),
  check(branch_hash=app_data_agent.u2_canonical_sha256(document_json-'branch_hash')),
  check(document_json->>'schema_version'='session-branch@1.0.0'
    and (document_json->>'branch_id')::uuid=branch_id
    and (document_json->>'parent_run_id')::uuid=parent_run_id
    and (document_json->>'child_conversation_id')::uuid=child_conversation_id),
  foreign key(app_id,tenant_id,environment,parent_run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,parent_run_id,parent_checkpoint_id,parent_checkpoint_version)
    references app_data_agent.run_checkpoints(app_id,tenant_id,environment,run_id,snapshot_id,snapshot_version)
    on delete restrict,
  foreign key(app_id,tenant_id,environment,context_receipt_id)
    references app_data_agent.effective_config_context_receipts(
      app_id,tenant_id,environment,context_receipt_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,config_id,config_revision,config_hash)
    references app_data_agent.effective_run_config_receipts(
      app_id,tenant_id,environment,config_id,config_revision,config_hash) on delete restrict,
  foreign key(app_id,tenant_id,environment,parent_conversation_id,created_by_principal_id)
    references app_data_agent.qa_conversations(
      app_id,tenant_id,environment,conversation_id,owner_principal_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,child_conversation_id,created_by_principal_id)
    references app_data_agent.qa_conversations(
      app_id,tenant_id,environment,conversation_id,owner_principal_id) on delete restrict
);

create table app_data_agent.session_recovery_operation_receipts (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  operation_id uuid not null,actor_principal_id uuid not null,idempotency_key text not null,
  operation_kind text not null check(operation_kind in ('OPEN_INTERRUPTION','REPLY_INTERRUPTION','CREATE_BRANCH')),
  command_hash text not null,result_json jsonb not null,receipt_hash text not null,committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,operation_id),
  unique(app_id,tenant_id,environment,actor_principal_id,idempotency_key),
  check(command_hash~'^sha256:[0-9a-f]{64}$' and receipt_hash~'^sha256:[0-9a-f]{64}$'),
  check(receipt_hash=result_json->>'receipt_hash'
    and receipt_hash=app_data_agent.u2_canonical_sha256(result_json-'receipt_hash')),
  foreign key(app_id,tenant_id,environment,actor_principal_id)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);

create function app_data_agent.reject_session_recovery_immutable_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin raise exception using errcode='55000',message='SESSION_RECOVERY_AUTHORITY_IMMUTABLE'; end
$function$;
create function app_data_agent.guard_run_interruption_transition()
returns trigger language plpgsql set search_path='' as $function$
begin
  if old.state<>'OPEN' or old.version<>1 or new.state<>'ANSWERED' or new.version<>2
    or new.app_id<>old.app_id or new.tenant_id<>old.tenant_id or new.environment<>old.environment
    or new.interruption_id<>old.interruption_id or new.run_id<>old.run_id
    or new.principal_id<>old.principal_id or new.worker_fence<>old.worker_fence
    or new.checkpoint_id<>old.checkpoint_id or new.checkpoint_version<>old.checkpoint_version
    or new.checkpoint_hash<>old.checkpoint_hash or new.opened_at<>old.opened_at
  then raise exception using errcode='55000',message='RUN_INTERRUPTION_TRANSITION_INVALID'; end if;
  return new;
end
$function$;
create trigger run_interruptions_transition before update on app_data_agent.run_interruptions
for each row execute function app_data_agent.guard_run_interruption_transition();
create trigger run_interruptions_no_delete before delete on app_data_agent.run_interruptions
for each row execute function app_data_agent.reject_session_recovery_immutable_mutation();
create trigger run_interruption_replies_immutable before update or delete on app_data_agent.run_interruption_replies
for each row execute function app_data_agent.reject_session_recovery_immutable_mutation();
create trigger session_branches_immutable before update or delete on app_data_agent.session_branches
for each row execute function app_data_agent.reject_session_recovery_immutable_mutation();
create trigger session_recovery_receipts_immutable before update or delete
on app_data_agent.session_recovery_operation_receipts
for each row execute function app_data_agent.reject_session_recovery_immutable_mutation();

alter table app_data_agent.run_interruptions enable row level security;
alter table app_data_agent.run_interruptions force row level security;
alter table app_data_agent.run_interruption_replies enable row level security;
alter table app_data_agent.run_interruption_replies force row level security;
alter table app_data_agent.session_branches enable row level security;
alter table app_data_agent.session_branches force row level security;
alter table app_data_agent.session_recovery_operation_receipts enable row level security;
alter table app_data_agent.session_recovery_operation_receipts force row level security;
create policy run_interruptions_owner on app_data_agent.run_interruptions for all to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy run_interruption_replies_owner on app_data_agent.run_interruption_replies for all to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy session_branches_owner on app_data_agent.session_branches for all to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy session_recovery_receipts_owner on app_data_agent.session_recovery_operation_receipts
for all to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));

create policy u8_runs_read on app_data_agent.runs for select to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_runs_lock on app_data_agent.runs for update to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_run_projections_read on app_data_agent.run_projections for select to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_run_projections_lock on app_data_agent.run_projections for update
to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_run_checkpoints_read on app_data_agent.run_checkpoints for select to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_context_receipts_read on app_data_agent.effective_config_context_receipts
for select to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_config_receipts_read on app_data_agent.effective_run_config_receipts
for select to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_run_bindings_read on app_data_agent.workspace_run_bindings
for select to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_conversations_read on app_data_agent.qa_conversations
for select to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy u8_messages_read on app_data_agent.qa_messages for select to data_agent_u8_recovery_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
