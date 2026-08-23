-- u8_recovery_migration_checksum: sha256:e2fc0422baca33341f76072af3621aaab0c702c4b01a2044e17abf476584aef2
begin;
do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='U8_RECOVERY_POSTGRES_VERSION_UNSUPPORTED'; end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='U8_RECOVERY_MIGRATION_EXECUTOR_UNSAFE'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010665_app_data_agent_extension_registry')
  then raise exception using errcode='P0001',message='U8_RECOVERY_BASELINE_10665_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u8_recovery_owner') then
    create role data_agent_u8_recovery_owner nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls;
  end if;
end
$bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010666_app_data_agent_session_recovery','sha256:e2fc0422baca33341f76072af3621aaab0c702c4b01a2044e17abf476584aef2');
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
create or replace function app_data_agent.workspace_command_payload_is_valid(requested_payload jsonb)
returns boolean language sql immutable set search_path='' as $function$
  select case
    when pg_catalog.jsonb_typeof(requested_payload)='object'
      and (select pg_catalog.count(*)=1 from pg_catalog.jsonb_object_keys(requested_payload))
      and requested_payload->>'kind' in ('RESUME_RUN','CANCEL_RUN')
      then true
    else app_data_agent.command_payload_is_valid(requested_payload)
  end;
$function$;

do $control_payload_compatibility$
begin
  if not app_data_agent.workspace_command_payload_is_valid('{"kind":"RESUME_RUN"}'::jsonb)
    or not app_data_agent.workspace_command_payload_is_valid('{"kind":"CANCEL_RUN"}'::jsonb)
    or not app_data_agent.workspace_command_payload_is_valid(
      '{"kind":"START_L2_RESEARCH","mode":"L2","datasource_id":"00000000-0000-4000-8000-00000000fa01","conversation_id":"00000000-0000-4000-8000-00000000fa04"}'::jsonb)
  then raise exception using errcode='P0001',message='U8_RUN_CONTROL_PAYLOAD_COMPATIBILITY_FAILED'; end if;
end
$control_payload_compatibility$;

create function app_data_agent.u8_replayed_receipt(receipt jsonb)
returns jsonb language sql immutable set search_path='' as $function$
  select (receipt-'receipt_hash'-'disposition')||pg_catalog.jsonb_build_object(
    'disposition','REPLAYED','receipt_hash',app_data_agent.u2_canonical_sha256(
      (receipt-'receipt_hash'-'disposition')||pg_catalog.jsonb_build_object('disposition','REPLAYED')));
$function$;

create function app_data_agent.open_run_interruption(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.session_recovery_operation_receipts%rowtype;
  run_record app_data_agent.runs%rowtype; projection app_data_agent.run_projections%rowtype;
  checkpoint app_data_agent.run_checkpoints%rowtype; document jsonb; result jsonb; now_at timestamptz;
begin
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','actor_principal_id','interruption','command_hash']::text[])
    or command->>'schema_version'<>'run-interruption-open-command@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='RUN_INTERRUPTION_OPEN_INVALID'; end if;
  document:=command->'interruption';
  if document->>'schema_version'<>'run-interruption@1.0.0'
    or document->>'interruption_hash'<>app_data_agent.u2_canonical_sha256(document-'interruption_hash')
    or document->>'state'<>'OPEN' or document->>'version'<>'1' or document->'answered_at'<>'null'::jsonb
  then raise exception using errcode='22023',message='RUN_INTERRUPTION_OPEN_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if command->>'actor_principal_id'<>authority.principal_id::text
    or document#>>'{scope,app_id}'<>authority.app_id::text
    or document#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or document#>>'{scope,environment}'<>authority.environment
  then raise exception using errcode='42501',message='RUN_INTERRUPTION_SCOPE_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':RECOVERY:'||authority.principal_id::text||':'||(command->>'idempotency_key'),0));
  select receipt.* into existing from app_data_agent.session_recovery_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing.command_hash<>command->>'command_hash' or existing.operation_kind<>'OPEN_INTERRUPTION'
    then raise exception using errcode='23505',message='SESSION_RECOVERY_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.u8_replayed_receipt(existing.result_json);
  end if;
  select run.* into run_record from app_data_agent.runs run
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=(document->>'run_id')::uuid
    and run.principal_id=authority.principal_id for update;
  if not found then raise exception using errcode='P0002',message='RUN_INTERRUPTION_NOT_FOUND_OR_DENIED'; end if;
  select value.* into projection from app_data_agent.run_projections value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
  order by value.version desc limit 1 for update;
  select value.* into checkpoint from app_data_agent.run_checkpoints value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
    and value.snapshot_id=(document#>>'{checkpoint_ref,snapshot_id}')::uuid
    and value.snapshot_version=(document#>>'{checkpoint_ref,snapshot_version}')::integer
    and value.snapshot_hash=document#>>'{checkpoint_ref,snapshot_hash}';
  if run_record.status<>'WAITING' or projection.status<>'WAITING'
    or projection.worker_fence<>(document->>'worker_fence')::bigint or checkpoint.snapshot_id is null
    or projection.projection_json#>'{active_snapshot_ref}'<>document->'checkpoint_ref'
  then raise exception using errcode='40001',message='RUN_INTERRUPTION_AUTHORITY_STALE'; end if;
  if exists(select 1 from app_data_agent.run_interruptions value where value.app_id=authority.app_id
    and value.tenant_id=authority.tenant_id and value.environment=authority.environment
    and value.run_id=run_record.run_id and value.state='OPEN')
  then raise exception using errcode='23505',message='RUN_INTERRUPTION_ALREADY_OPEN'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.run_interruptions(app_id,tenant_id,environment,interruption_id,run_id,
    principal_id,state,version,worker_fence,checkpoint_id,checkpoint_version,checkpoint_hash,
    interruption_hash,document_json,opened_at,answered_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(document->>'interruption_id')::uuid,
    run_record.run_id,authority.principal_id,'OPEN',1,(document->>'worker_fence')::bigint,
    checkpoint.snapshot_id,checkpoint.snapshot_version,checkpoint.snapshot_hash,
    document->>'interruption_hash',document,(document->>'opened_at')::timestamptz,null);
  result:=pg_catalog.jsonb_build_object('schema_version','run-interruption-open-receipt@1.0.0',
    'disposition','COMMITTED','command_hash',command->>'command_hash','interruption',document,
    'committed_at',app_data_agent.runtime_iso_timestamp(now_at));
  result:=result||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(result));
  insert into app_data_agent.session_recovery_operation_receipts(app_id,tenant_id,environment,
    operation_id,actor_principal_id,idempotency_key,operation_kind,command_hash,result_json,receipt_hash,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(command->>'operation_id')::uuid,
    authority.principal_id,command->>'idempotency_key','OPEN_INTERRUPTION',command->>'command_hash',
    result,result->>'receipt_hash',now_at);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='RUN_INTERRUPTION_OPEN_INVALID';
end
$function$;

create function app_data_agent.reply_run_interruption(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.session_recovery_operation_receipts%rowtype;
  target app_data_agent.run_interruptions%rowtype; run_record app_data_agent.runs%rowtype;
  projection app_data_agent.run_projections%rowtype; answered jsonb; resume_command jsonb;
  resume_event jsonb; resume_projection jsonb; control_result jsonb; result jsonb;
  reply_id uuid;resume_command_id uuid;resume_event_id uuid;resume_outbox_id uuid;resume_audit_id uuid;
  resume_key text;response_hash text;now_at timestamptz;
begin
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','scope','run_id','interruption_id',
    'expected_version','expected_worker_fence','actor_principal_id','response','submitted_at','command_hash']::text[])
    or command->>'schema_version'<>'interruption-reply-command@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='INTERRUPTION_REPLY_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if command->>'actor_principal_id'<>authority.principal_id::text
    or command#>>'{scope,app_id}'<>authority.app_id::text
    or command#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or command#>>'{scope,environment}'<>authority.environment
  then raise exception using errcode='42501',message='INTERRUPTION_REPLY_SCOPE_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':RECOVERY:'||authority.principal_id::text||':'||(command->>'idempotency_key'),0));
  select receipt.* into existing from app_data_agent.session_recovery_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing.command_hash<>command->>'command_hash' or existing.operation_kind<>'REPLY_INTERRUPTION'
    then raise exception using errcode='23505',message='SESSION_RECOVERY_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.u8_replayed_receipt(existing.result_json);
  end if;
  select run.* into run_record from app_data_agent.runs run
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=(command->>'run_id')::uuid
    and (authority.membership_role='owner' or run.principal_id=authority.principal_id) for update;
  if not found then raise exception using errcode='P0002',message='RUN_INTERRUPTION_NOT_FOUND_OR_DENIED'; end if;
  select value.* into projection from app_data_agent.run_projections value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
  order by value.version desc limit 1 for update;
  select value.* into target from app_data_agent.run_interruptions value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
    and value.interruption_id=(command->>'interruption_id')::uuid for update;
  if target.interruption_id is null then
    raise exception using errcode='P0002',message='RUN_INTERRUPTION_NOT_FOUND_OR_DENIED'; end if;
  if target.state<>'OPEN' or target.version<>(command->>'expected_version')::bigint
    or target.worker_fence<>(command->>'expected_worker_fence')::bigint
    or run_record.status<>'WAITING' or projection.status<>'WAITING'
    or projection.worker_fence<>target.worker_fence or projection.projection_json->>'terminal_event_id' is not null
  then raise exception using errcode='40001',message='INTERRUPTION_REPLY_VERSION_CONFLICT'; end if;
  if command#>>'{response,kind}'='OPTION' and not exists(
    select 1 from pg_catalog.jsonb_array_elements(target.document_json->'options') option(document)
    where option.document->>'option_id'=command#>>'{response,option_id}')
  then raise exception using errcode='22023',message='INTERRUPTION_REPLY_OPTION_INVALID'; end if;
  if command#>>'{response,kind}' not in ('OPTION','FREE_TEXT') then
    raise exception using errcode='22023',message='INTERRUPTION_REPLY_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  answered:=(target.document_json-'interruption_hash')||pg_catalog.jsonb_build_object(
    'state','ANSWERED','version',2,'answered_at',app_data_agent.runtime_iso_timestamp(now_at));
  answered:=answered||pg_catalog.jsonb_build_object(
    'interruption_hash',app_data_agent.u2_canonical_sha256(answered));
  reply_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-reply',command->>'command_hash')));
  resume_command_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-resume-command',command->>'command_hash')));
  resume_event_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-resume-event',command->>'command_hash')));
  resume_outbox_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-resume-outbox',command->>'command_hash')));
  resume_audit_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-resume-audit',command->>'command_hash')));
  resume_key:='u8:resume:'||(command->>'operation_id');
  resume_command:=pg_catalog.jsonb_build_object('schema_version','1.0.0','scope',command->'scope',
    'operation','RESUME','run_id',run_record.run_id,'command_id',resume_command_id,
    'event_id',resume_event_id,'outbox_id',resume_outbox_id,'audit_id',resume_audit_id,
    'idempotency_key',resume_key,'occurred_at',app_data_agent.runtime_iso_timestamp(now_at));
  resume_event:=pg_catalog.jsonb_build_object('schema_version','1.0.0','event_id',resume_event_id,
    'scope',command->'scope','run_id',run_record.run_id,'sequence',projection.version+1,
    'worker_fence',projection.worker_fence,'idempotency_key',resume_key,
    'occurred_at',app_data_agent.runtime_iso_timestamp(now_at),'event_type','run.resumed',
    'payload',pg_catalog.jsonb_build_object('command_id',resume_command_id));
  resume_projection:=app_data_agent.reduce_run_projection_document(projection.projection_json,resume_event);
  control_result:=app_data_agent.request_run_control(resume_command,resume_event,
    app_data_agent.runtime_canonical_sha256(resume_event),projection.projection_hash,
    resume_projection,app_data_agent.runtime_canonical_sha256(resume_projection));
  update app_data_agent.run_interruptions value set state='ANSWERED',version=2,
    interruption_hash=answered->>'interruption_hash',document_json=answered,answered_at=now_at
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.interruption_id=target.interruption_id;
  response_hash:=app_data_agent.u2_canonical_sha256(command->'response');
  result:=pg_catalog.jsonb_build_object('schema_version','interruption-reply-receipt@1.0.0',
    'disposition','COMMITTED','command_hash',command->>'command_hash','interruption',answered,
    'reply_id',reply_id,'response_hash',response_hash,'resume',pg_catalog.jsonb_build_object(
      'command_id',resume_command_id,'event_id',resume_event_id,'outbox_id',resume_outbox_id,
      'projection_version',(control_result#>>'{projection,version}')::bigint),
    'committed_at',app_data_agent.runtime_iso_timestamp(now_at));
  result:=result||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(result));
  insert into app_data_agent.run_interruption_replies(app_id,tenant_id,environment,reply_id,
    interruption_id,run_id,actor_principal_id,expected_version,expected_worker_fence,response_hash,
    response_json,resume_command_id,resume_event_id,resume_outbox_id,receipt_hash,receipt_json,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,reply_id,target.interruption_id,
    run_record.run_id,authority.principal_id,1,target.worker_fence,response_hash,command->'response',
    resume_command_id,resume_event_id,resume_outbox_id,result->>'receipt_hash',result,now_at);
  insert into app_data_agent.session_recovery_operation_receipts(app_id,tenant_id,environment,
    operation_id,actor_principal_id,idempotency_key,operation_kind,command_hash,result_json,receipt_hash,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(command->>'operation_id')::uuid,
    authority.principal_id,command->>'idempotency_key','REPLY_INTERRUPTION',command->>'command_hash',
    result,result->>'receipt_hash',now_at);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='INTERRUPTION_REPLY_INVALID';
end
$function$;
create function app_data_agent.create_session_branch(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.session_recovery_operation_receipts%rowtype;
  branch jsonb; run_record app_data_agent.runs%rowtype; projection app_data_agent.run_projections%rowtype;
  checkpoint app_data_agent.run_checkpoints%rowtype; context_record app_data_agent.effective_config_context_receipts%rowtype;
  parent_binding app_data_agent.workspace_run_bindings%rowtype; result jsonb; now_at timestamptz;
begin
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','branch','command_hash']::text[])
    or command->>'schema_version'<>'session-branch-command@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='SESSION_BRANCH_COMMAND_INVALID'; end if;
  branch:=command->'branch';
  if branch->>'schema_version'<>'session-branch@1.0.0'
    or branch->>'branch_hash'<>app_data_agent.u2_canonical_sha256(branch-'branch_hash')
  then raise exception using errcode='22023',message='SESSION_BRANCH_COMMAND_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if branch#>>'{scope,app_id}'<>authority.app_id::text
    or branch#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or branch#>>'{scope,environment}'<>authority.environment
    or branch->>'created_by_principal_id'<>authority.principal_id::text
  then raise exception using errcode='42501',message='SESSION_BRANCH_SCOPE_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':RECOVERY:'||authority.principal_id::text||':'||(command->>'idempotency_key'),0));
  select receipt.* into existing from app_data_agent.session_recovery_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing.command_hash<>command->>'command_hash' or existing.operation_kind<>'CREATE_BRANCH'
    then raise exception using errcode='23505',message='SESSION_RECOVERY_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.u8_replayed_receipt(existing.result_json);
  end if;
  select run.* into run_record from app_data_agent.runs run
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=(branch->>'parent_run_id')::uuid
    and (authority.membership_role='owner' or run.principal_id=authority.principal_id) for share;
  if not found then raise exception using errcode='P0002',message='SESSION_BRANCH_NOT_FOUND_OR_DENIED'; end if;
  select binding.* into parent_binding from app_data_agent.workspace_run_bindings binding
  where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
    and binding.environment=authority.environment and binding.run_id=run_record.run_id
    and binding.conversation_id=(branch->>'parent_conversation_id')::uuid
    and binding.principal_id=run_record.principal_id;
  select value.* into projection from app_data_agent.run_projections value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
  order by value.version desc limit 1 for share;
  select value.* into checkpoint from app_data_agent.run_checkpoints value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
    and value.snapshot_id=(branch#>>'{parent_checkpoint_ref,snapshot_id}')::uuid
    and value.snapshot_version=(branch#>>'{parent_checkpoint_ref,snapshot_version}')::integer
    and value.snapshot_hash=branch#>>'{parent_checkpoint_ref,snapshot_hash}';
  select value.* into context_record from app_data_agent.effective_config_context_receipts value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment
    and value.context_receipt_id=(branch#>>'{effective_config_revalidation,receipt_id}')::uuid
    and value.receipt_hash=branch#>>'{effective_config_revalidation,receipt_hash}'
    and value.config_id=(branch#>>'{effective_config_revalidation,config_ref,config_id}')::uuid
    and value.config_revision=(branch#>>'{effective_config_revalidation,config_ref,config_revision}')::bigint
    and value.config_hash=branch#>>'{effective_config_revalidation,config_ref,config_hash}'
    and value.run_id=run_record.run_id and value.principal_id=run_record.principal_id;
  if parent_binding.run_id is null or projection.run_id is null or checkpoint.snapshot_id is null
    or context_record.context_receipt_id is null
    or projection.version<>(branch->>'parent_event_sequence')::bigint
    or projection.projection_json#>'{active_snapshot_ref}'<>branch->'parent_checkpoint_ref'
    or app_data_agent.runtime_iso_timestamp(context_record.consumed_at)<>
      branch#>>'{effective_config_revalidation,revalidated_at}'
  then raise exception using errcode='40001',message='SESSION_BRANCH_AUTHORITY_STALE'; end if;
  if not exists(select 1 from app_data_agent.qa_conversations child
      where child.app_id=authority.app_id and child.tenant_id=authority.tenant_id
        and child.environment=authority.environment
        and child.conversation_id=(branch->>'child_conversation_id')::uuid
        and child.owner_principal_id=authority.principal_id)
    or exists(select 1 from app_data_agent.qa_messages message where message.app_id=authority.app_id
      and message.tenant_id=authority.tenant_id and message.environment=authority.environment
      and message.conversation_id=(branch->>'child_conversation_id')::uuid)
    or exists(select 1 from app_data_agent.workspace_run_bindings child_binding
      where child_binding.app_id=authority.app_id and child_binding.tenant_id=authority.tenant_id
        and child_binding.environment=authority.environment
        and child_binding.conversation_id=(branch->>'child_conversation_id')::uuid)
  then raise exception using errcode='23514',message='SESSION_BRANCH_CHILD_NOT_EMPTY'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.session_branches(app_id,tenant_id,environment,branch_id,
    parent_conversation_id,parent_run_id,parent_event_sequence,parent_checkpoint_id,
    parent_checkpoint_version,parent_checkpoint_hash,context_receipt_id,context_receipt_hash,
    config_id,config_revision,config_hash,child_conversation_id,created_by_principal_id,
    branch_hash,document_json,created_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(branch->>'branch_id')::uuid,
    (branch->>'parent_conversation_id')::uuid,run_record.run_id,(branch->>'parent_event_sequence')::bigint,
    checkpoint.snapshot_id,checkpoint.snapshot_version,checkpoint.snapshot_hash,
    context_record.context_receipt_id,context_record.receipt_hash,context_record.config_id,
    context_record.config_revision,context_record.config_hash,(branch->>'child_conversation_id')::uuid,
    authority.principal_id,branch->>'branch_hash',branch,(branch->>'created_at')::timestamptz);
  result:=pg_catalog.jsonb_build_object('schema_version','session-branch-receipt@1.0.0',
    'disposition','COMMITTED','command_hash',command->>'command_hash','branch',branch,
    'committed_at',app_data_agent.runtime_iso_timestamp(now_at));
  result:=result||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(result));
  insert into app_data_agent.session_recovery_operation_receipts(app_id,tenant_id,environment,
    operation_id,actor_principal_id,idempotency_key,operation_kind,command_hash,result_json,receipt_hash,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(command->>'operation_id')::uuid,
    authority.principal_id,command->>'idempotency_key','CREATE_BRANCH',command->>'command_hash',
    result,result->>'receipt_hash',now_at);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SESSION_BRANCH_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_run_interruption(requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; result jsonb;
begin
  select * into authority from platform.current_backend_authority(false);
  select interruption.document_json into result from app_data_agent.run_interruptions interruption
  join app_data_agent.runs run on run.app_id=interruption.app_id and run.tenant_id=interruption.tenant_id
    and run.environment=interruption.environment and run.run_id=interruption.run_id
  where interruption.app_id=authority.app_id and interruption.tenant_id=authority.tenant_id
    and interruption.environment=authority.environment and interruption.run_id=requested_run_id
    and (authority.membership_role='owner' or run.principal_id=authority.principal_id)
  order by interruption.opened_at desc limit 1;
  return result;
end
$function$;

create function app_data_agent.list_session_branches(requested_parent_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; result jsonb;
begin
  select * into authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(branch.document_json order by branch.created_at,branch.branch_id),'[]'::jsonb)
  into result from app_data_agent.session_branches branch join app_data_agent.runs run
    on run.app_id=branch.app_id and run.tenant_id=branch.tenant_id
    and run.environment=branch.environment and run.run_id=branch.parent_run_id
  where branch.app_id=authority.app_id and branch.tenant_id=authority.tenant_id
    and branch.environment=authority.environment and branch.parent_run_id=requested_parent_run_id
    and (authority.membership_role='owner' or run.principal_id=authority.principal_id);
  return result;
end
$function$;
alter table app_data_agent.run_interruptions owner to data_agent_u8_recovery_owner;
alter table app_data_agent.run_interruption_replies owner to data_agent_u8_recovery_owner;
alter table app_data_agent.session_branches owner to data_agent_u8_recovery_owner;
alter table app_data_agent.session_recovery_operation_receipts owner to data_agent_u8_recovery_owner;
alter function app_data_agent.reject_session_recovery_immutable_mutation() owner to data_agent_u8_recovery_owner;
alter function app_data_agent.guard_run_interruption_transition() owner to data_agent_u8_recovery_owner;
alter function app_data_agent.u8_replayed_receipt(jsonb) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.open_run_interruption(jsonb) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.reply_run_interruption(jsonb) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.create_session_branch(jsonb) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.load_run_interruption(uuid) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.list_session_branches(uuid) owner to data_agent_u8_recovery_owner;

grant usage on schema app_data_agent,platform to data_agent_u8_recovery_owner;
grant select on app_data_agent.runs,app_data_agent.run_projections,app_data_agent.run_checkpoints,
  app_data_agent.effective_config_context_receipts,app_data_agent.effective_run_config_receipts,
  app_data_agent.workspace_run_bindings,app_data_agent.qa_conversations,app_data_agent.qa_messages
  to data_agent_u8_recovery_owner;
grant update on app_data_agent.runs,app_data_agent.run_projections to data_agent_u8_recovery_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.runtime_canonical_sha256(jsonb),app_data_agent.runtime_iso_timestamp(timestamptz),
  app_data_agent.resolved_context_exact_keys(jsonb,text[]),
  app_data_agent.resolved_context_uuid_v8_from_hash(text),
  app_data_agent.reduce_run_projection_document(jsonb,jsonb),
  app_data_agent.request_run_control(jsonb,jsonb,text,text,jsonb,text)
  to data_agent_u8_recovery_owner;

revoke all on app_data_agent.run_interruptions,app_data_agent.run_interruption_replies,
  app_data_agent.session_branches,app_data_agent.session_recovery_operation_receipts
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.u8_replayed_receipt(jsonb),
  app_data_agent.open_run_interruption(jsonb),app_data_agent.reply_run_interruption(jsonb),
  app_data_agent.create_session_branch(jsonb),app_data_agent.load_run_interruption(uuid),
  app_data_agent.list_session_branches(uuid)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.open_run_interruption(jsonb),
  app_data_agent.reply_run_interruption(jsonb),app_data_agent.create_session_branch(jsonb),
  app_data_agent.load_run_interruption(uuid),app_data_agent.list_session_branches(uuid)
  to data_agent_backend;

do $postconditions$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u8_recovery_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception using errcode='P0001',message='U8_RECOVERY_OWNER_FLAGS_UNSAFE'; end if;
  if exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('run_interruptions','run_interruption_replies','session_branches',
        'session_recovery_operation_receipts')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relowner<>(select oid from pg_catalog.pg_roles where rolname='data_agent_u8_recovery_owner')))
  then raise exception using errcode='P0001',message='U8_RECOVERY_RLS_OR_OWNER_UNSAFE'; end if;
end
$postconditions$;
commit;
