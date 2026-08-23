alter table app_data_agent.qa_conversation_folders owner to data_agent_qa_directory_owner;
alter table app_data_agent.qa_directory_operation_receipts owner to data_agent_qa_directory_owner;
alter table app_data_agent.qa_conversation_retention_claims owner to data_agent_qa_directory_owner;

alter function app_data_agent.reject_qa_directory_receipt_mutation() owner to data_agent_qa_directory_owner;
alter function app_data_agent.qa_folder_public_document(app_data_agent.qa_conversation_folders)
  owner to data_agent_qa_directory_owner;
alter function app_data_agent.qa_conversation_public_document(app_data_agent.qa_conversations,text)
  owner to data_agent_qa_directory_owner;
alter function app_data_agent.list_qa_conversation_directory(jsonb) owner to data_agent_qa_directory_owner;
alter function app_data_agent.qa_directory_command_is_valid(jsonb) owner to data_agent_qa_directory_owner;
alter function app_data_agent.apply_qa_directory_command(jsonb) owner to data_agent_qa_directory_owner;
alter function app_data_agent.claim_qa_conversation_retention(integer,integer)
  owner to data_agent_qa_directory_owner;
alter function app_data_agent.complete_qa_conversation_retention(jsonb)
  owner to data_agent_qa_directory_owner;

alter table app_data_agent.qa_conversation_folders enable row level security;
alter table app_data_agent.qa_conversation_folders force row level security;
alter table app_data_agent.qa_directory_operation_receipts enable row level security;
alter table app_data_agent.qa_directory_operation_receipts force row level security;
alter table app_data_agent.qa_conversation_retention_claims enable row level security;
alter table app_data_agent.qa_conversation_retention_claims force row level security;

create policy qa_conversation_folders_owner_backend_select
  on app_data_agent.qa_conversation_folders for select to data_agent_backend
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,owner_principal_id,false));
create policy qa_conversation_folders_directory_owner_all
  on app_data_agent.qa_conversation_folders for all to data_agent_qa_directory_owner
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,owner_principal_id,true))
  with check(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,owner_principal_id,true));
create policy qa_directory_operation_receipts_owner_select
  on app_data_agent.qa_directory_operation_receipts for select to data_agent_backend
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,actor_principal_id,false));
create policy qa_directory_operation_receipts_directory_owner_all
  on app_data_agent.qa_directory_operation_receipts for all to data_agent_qa_directory_owner
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,actor_principal_id,true))
  with check(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,actor_principal_id,true));
create policy qa_conversation_retention_claims_directory_owner_all
  on app_data_agent.qa_conversation_retention_claims for all to data_agent_qa_directory_owner
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,owner_principal_id,true))
  with check(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,owner_principal_id,true));

create policy qa_conversations_directory_owner_all
  on app_data_agent.qa_conversations for all to data_agent_qa_directory_owner
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,owner_principal_id,true))
  with check(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,owner_principal_id,true));
create policy qa_messages_directory_owner_select
  on app_data_agent.qa_messages for select to data_agent_qa_directory_owner
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,owner_principal_id,false));
create policy workspace_run_bindings_directory_owner_select
  on app_data_agent.workspace_run_bindings for select to data_agent_qa_directory_owner
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,principal_id,false));
create policy runs_directory_owner_select
  on app_data_agent.runs for select to data_agent_qa_directory_owner
  using(platform.backend_exact_principal_object_matches(
    app_id,tenant_id,environment,principal_id,false));

grant usage on schema app_data_agent,platform to data_agent_qa_directory_owner;
grant select,insert,update,delete on app_data_agent.qa_conversation_folders,
  app_data_agent.qa_directory_operation_receipts,
  app_data_agent.qa_conversation_retention_claims to data_agent_qa_directory_owner;
grant select,update,delete on app_data_agent.qa_conversations to data_agent_qa_directory_owner;
grant select on app_data_agent.qa_messages,app_data_agent.workspace_run_bindings,
  app_data_agent.runs to data_agent_qa_directory_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.resolved_context_exact_keys(jsonb,text[]) to data_agent_qa_directory_owner;

revoke all on app_data_agent.qa_conversation_folders,
  app_data_agent.qa_directory_operation_receipts,
  app_data_agent.qa_conversation_retention_claims from public,anon,authenticated,service_role,data_agent_backend;
grant select on app_data_agent.qa_conversation_folders,
  app_data_agent.qa_directory_operation_receipts to data_agent_backend;
revoke delete on app_data_agent.qa_conversations from data_agent_backend;

revoke all on function
  app_data_agent.reject_qa_directory_receipt_mutation(),
  app_data_agent.qa_folder_public_document(app_data_agent.qa_conversation_folders),
  app_data_agent.qa_conversation_public_document(app_data_agent.qa_conversations,text),
  app_data_agent.qa_directory_command_is_valid(jsonb),
  app_data_agent.list_qa_conversation_directory(jsonb),
  app_data_agent.apply_qa_directory_command(jsonb),
  app_data_agent.claim_qa_conversation_retention(integer,integer),
  app_data_agent.complete_qa_conversation_retention(jsonb) from public;
grant execute on function app_data_agent.list_qa_conversation_directory(jsonb),
  app_data_agent.apply_qa_directory_command(jsonb),
  app_data_agent.claim_qa_conversation_retention(integer,integer),
  app_data_agent.complete_qa_conversation_retention(jsonb) to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'qa_conversation_folders','qa_directory_operation_receipts','qa_conversation_retention_claims'
  ] loop
    if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity)
      or pg_catalog.has_table_privilege('authenticated',
        pg_catalog.format('app_data_agent.%I',relation_name),'SELECT,INSERT,UPDATE,DELETE')
    then raise exception using errcode='P0001',message='QA_DIRECTORY_RLS_POSTCONDITION_FAILED'; end if;
  end loop;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.qa_conversations','DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.list_qa_conversation_directory(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.apply_qa_directory_command(jsonb)','EXECUTE')
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.qa_conversations'::regclass
        and conname='qa_conversations_owner_folder_fk')
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.qa_conversations'::regclass
        and conname='qa_conversations_directory_state_check')
    or pg_catalog.pg_has_role('data_agent_qa_directory_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='QA_DIRECTORY_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
