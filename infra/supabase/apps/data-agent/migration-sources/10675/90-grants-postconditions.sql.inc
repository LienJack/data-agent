alter table app_data_agent.qa_admin_conversation_audit_receipts owner to data_agent_qa_admin_audit_owner;
alter function app_data_agent.reject_qa_admin_audit_receipt_mutation() owner to data_agent_qa_admin_audit_owner;
alter function platform.resolve_qa_admin_audit_scope(uuid) owner to data_agent_qa_admin_audit_owner;
alter function platform.qa_admin_audit_scope_matches(uuid,uuid,text) owner to data_agent_qa_admin_audit_owner;
alter function app_data_agent.qa_admin_audit_receipt(jsonb,text,text,uuid,text,uuid,text) owner to data_agent_qa_admin_audit_owner;
alter function app_data_agent.qa_admin_conversation_document(app_data_agent.qa_conversations,text) owner to data_agent_qa_admin_audit_owner;
alter function app_data_agent.read_qa_admin_directory(jsonb) owner to data_agent_qa_admin_audit_owner;
alter function app_data_agent.read_qa_admin_conversation(jsonb) owner to data_agent_qa_admin_audit_owner;
alter function app_data_agent.read_qa_admin_run_events(jsonb) owner to data_agent_qa_admin_audit_owner;
alter function app_data_agent.authorize_qa_admin_artifact_access(jsonb) owner to data_agent_qa_admin_audit_owner;

alter table app_data_agent.qa_admin_conversation_audit_receipts enable row level security;
alter table app_data_agent.qa_admin_conversation_audit_receipts force row level security;

create policy qa_admin_audit_receipts_owner_all on app_data_agent.qa_admin_conversation_audit_receipts
for all to data_agent_qa_admin_audit_owner
using(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment))
with check(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment));

create policy qa_conversation_folders_admin_audit_select on app_data_agent.qa_conversation_folders
for select to data_agent_qa_admin_audit_owner
using(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment));
create policy qa_conversations_admin_audit_select on app_data_agent.qa_conversations
for select to data_agent_qa_admin_audit_owner
using(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment));
create policy qa_messages_admin_audit_select on app_data_agent.qa_messages
for select to data_agent_qa_admin_audit_owner
using(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment));
create policy workspace_run_bindings_admin_audit_select on app_data_agent.workspace_run_bindings
for select to data_agent_qa_admin_audit_owner
using(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment));
create policy runs_admin_audit_select on app_data_agent.runs
for select to data_agent_qa_admin_audit_owner
using(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment));
create policy run_events_admin_audit_select on app_data_agent.run_events
for select to data_agent_qa_admin_audit_owner
using(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment));
create policy artifacts_admin_audit_select on app_data_agent.artifacts
for select to data_agent_qa_admin_audit_owner
using(platform.qa_admin_audit_scope_matches(app_id,tenant_id,environment));

grant usage on schema app_data_agent,platform to data_agent_qa_admin_audit_owner;
grant select,insert on app_data_agent.qa_admin_conversation_audit_receipts to data_agent_qa_admin_audit_owner;
grant select on app_data_agent.qa_conversation_folders,app_data_agent.qa_conversations,
  app_data_agent.qa_messages,app_data_agent.workspace_run_bindings,app_data_agent.runs,
  app_data_agent.run_events,app_data_agent.artifacts to data_agent_qa_admin_audit_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.resolve_workspace_authority(uuid,uuid,uuid,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.resolved_context_exact_keys(jsonb,text[]) to data_agent_qa_admin_audit_owner;

revoke all on app_data_agent.qa_admin_conversation_audit_receipts
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.reject_qa_admin_audit_receipt_mutation(),
  platform.resolve_qa_admin_audit_scope(uuid),
  platform.qa_admin_audit_scope_matches(uuid,uuid,text),
  app_data_agent.qa_admin_audit_receipt(jsonb,text,text,uuid,text,uuid,text),
  app_data_agent.qa_admin_conversation_document(app_data_agent.qa_conversations,text),
  app_data_agent.read_qa_admin_directory(jsonb),app_data_agent.read_qa_admin_conversation(jsonb),
  app_data_agent.read_qa_admin_run_events(jsonb),app_data_agent.authorize_qa_admin_artifact_access(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.read_qa_admin_directory(jsonb),
  app_data_agent.read_qa_admin_conversation(jsonb),app_data_agent.read_qa_admin_run_events(jsonb),
  app_data_agent.authorize_qa_admin_artifact_access(jsonb) to data_agent_backend;

do $postconditions$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_qa_admin_audit_owner'
      and not rolcanlogin and not rolinherit and not rolbypassrls)
    or not exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
      on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname='qa_admin_conversation_audit_receipts'
      and relation.relrowsecurity and relation.relforcerowsecurity)
    or pg_catalog.has_table_privilege('authenticated','app_data_agent.qa_admin_conversation_audit_receipts','SELECT')
    or pg_catalog.has_table_privilege('service_role','app_data_agent.qa_admin_conversation_audit_receipts','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.qa_admin_conversation_audit_receipts','SELECT')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.read_qa_admin_directory(jsonb)','EXECUTE')
    or pg_catalog.pg_has_role('data_agent_qa_admin_audit_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='QA_ADMIN_AUDIT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
