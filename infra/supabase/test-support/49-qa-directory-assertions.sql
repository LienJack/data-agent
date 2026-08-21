\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $surface$
begin
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010673_app_data_agent_qa_conversation_directory')
    or pg_catalog.to_regclass('app_data_agent.qa_conversation_folders') is null
    or pg_catalog.to_regclass('app_data_agent.qa_directory_operation_receipts') is null
    or pg_catalog.to_regclass('app_data_agent.qa_conversation_retention_claims') is null
    or pg_catalog.to_regprocedure('app_data_agent.list_qa_conversation_directory(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.apply_qa_directory_command(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.claim_qa_conversation_retention(integer,integer)') is null
    or pg_catalog.to_regprocedure('app_data_agent.complete_qa_conversation_retention(jsonb)') is null
  then raise exception 'QA_DIRECTORY_SURFACE_INCOMPLETE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.qa_conversations','DELETE')
    or pg_catalog.has_table_privilege('authenticated','app_data_agent.qa_conversation_folders','SELECT')
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.qa_conversations'::regclass
        and conname='qa_conversations_owner_folder_fk')
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.qa_conversations'::regclass
        and conname='qa_conversations_directory_state_check')
  then raise exception 'QA_DIRECTORY_AUTHORITY_SURFACE_INVALID'; end if;
end
$surface$;
rollback;

begin;
set local session_replication_role=replica;
insert into app_data_agent.app_users(
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role,status,authz_epoch)
values
  ('00000000-0000-4000-8000-00000000da01','test','00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000001001','u24-owner@example.invalid','U24 owner','USER','ACTIVE',1),
  ('00000000-0000-4000-8000-00000000da01','test','00000000-0000-4000-8000-000000001006',
    '00000000-0000-4000-8000-000000001006','u24-analyst@example.invalid','U24 analyst','USER','ACTIVE',1)
on conflict(app_id,environment,principal_id) do update set status='ACTIVE',authz_epoch=1;

insert into app_data_agent.datasource_connections(
  app_id,tenant_id,environment,datasource_id,name,datasource_type,file_path,status,
  created_by_principal_id,resource_version)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-000000002901','U24 SQLite','sqlite','/tmp/u24.db',
  'ACTIVE','00000000-0000-4000-8000-000000001001',1);

insert into app_data_agent.qa_conversations(
  app_id,tenant_id,environment,conversation_id,owner_principal_id,title,datasource_id,
  resource_version,sort_order,deleted_at,purge_after,created_at)
values
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000002902','00000000-0000-4000-8000-000000001001',
    'U24 owner active','00000000-0000-4000-8000-000000002901',1,0,null,null,
    pg_catalog.clock_timestamp()-interval '60 days'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000002903','00000000-0000-4000-8000-000000001006',
    'U24 other owner','00000000-0000-4000-8000-000000002901',1,0,null,null,
    pg_catalog.clock_timestamp()-interval '60 days'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000002904','00000000-0000-4000-8000-000000001001',
    'U24 active run','00000000-0000-4000-8000-000000002901',1,0,null,null,
    pg_catalog.clock_timestamp()-interval '60 days'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000002905','00000000-0000-4000-8000-000000001001',
    'U24 due empty','00000000-0000-4000-8000-000000002901',1,0,
    pg_catalog.statement_timestamp()-interval '31 days',pg_catalog.statement_timestamp()-interval '1 day',
    pg_catalog.clock_timestamp()-interval '60 days'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000002906','00000000-0000-4000-8000-000000001001',
    'U24 due referenced','00000000-0000-4000-8000-000000002901',1,0,
    pg_catalog.statement_timestamp()-interval '31 days',pg_catalog.statement_timestamp()-interval '1 day',
    pg_catalog.clock_timestamp()-interval '60 days'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000002907','00000000-0000-4000-8000-000000001001',
    'U24 not due','00000000-0000-4000-8000-000000002901',1,0,
    pg_catalog.statement_timestamp()-interval '29 days',pg_catalog.statement_timestamp()+interval '1 day',
    pg_catalog.clock_timestamp()-interval '60 days');

insert into app_data_agent.qa_conversation_folders(
  app_id,tenant_id,environment,owner_principal_id,folder_id,name,sort_order)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-000000001006','00000000-0000-4000-8000-000000002908',
  'Other private folder',0);

insert into app_data_agent.runs(
  app_id,tenant_id,environment,run_id,principal_id,status,question)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-000000002909','00000000-0000-4000-8000-000000001001',
  'RUNNING','U24 active run guard');
insert into app_data_agent.workspace_run_bindings(
  app_id,tenant_id,environment,run_id,datasource_id,conversation_id,principal_id)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-000000002909','00000000-0000-4000-8000-000000002901',
  '00000000-0000-4000-8000-000000002904','00000000-0000-4000-8000-000000001001');
insert into app_data_agent.qa_messages(
  app_id,tenant_id,environment,conversation_id,message_id,owner_principal_id,
  role,content,message_type,metadata)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-000000002906','00000000-0000-4000-8000-000000002910',
  '00000000-0000-4000-8000-000000001001','user','U24 retained evidence','text','{}'::jsonb);
set local session_replication_role=origin;

do $role$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u24_behavior_session') then
    create role data_agent_u24_behavior_session login inherit;
  end if;
end
$role$;
grant data_agent_backend to data_agent_u24_behavior_session with inherit true;
grant execute on function app_data_agent.u2_canonical_sha256(jsonb)
  to data_agent_u24_behavior_session;
commit;

begin;
select * from platform.revalidate_backend_authority(
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-000000001001',
  'owner',1,1,true);
set session authorization data_agent_u24_behavior_session;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa11',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000001001',true);
select pg_catalog.set_config('data_agent.role','owner',true);

do $behavior$
declare
  draft jsonb; command jsonb; result jsonb; replay jsonb; page jsonb;
  folder_version bigint; conversation_version bigint; claims jsonb; item jsonb; receipt jsonb;
  active_blocked boolean:=false; foreign_folder_blocked boolean:=false;
  mismatch_blocked boolean:=false; due_empty_seen boolean:=false; due_referenced_seen boolean:=false;
begin
  page:=app_data_agent.list_qa_conversation_directory(pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-query@1.0.0','view','active',
    'folder_id','null'::jsonb,'query','null'::jsonb,'cursor','null'::jsonb,'limit',50));
  if pg_catalog.jsonb_array_length(page->'conversations')<>2
    or exists(select 1 from pg_catalog.jsonb_array_elements(page->'conversations') value
      where value->>'owner_principal_id'<>'00000000-0000-4000-8000-000000001001')
  then raise exception 'QA_DIRECTORY_OWNER_ISOLATION_FAILED'; end if;

  draft:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002911',
    'idempotency_key','u24-folder-create','action','FOLDER_CREATE',
    'folder_id','00000000-0000-4000-8000-000000002912','name','Owner research','sort_order',0);
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  result:=app_data_agent.apply_qa_directory_command(command);
  replay:=app_data_agent.apply_qa_directory_command(command);
  if result->'folder'->>'owner_principal_id'<>'00000000-0000-4000-8000-000000001001'
    or replay->>'replayed'<>'true' then raise exception 'QA_DIRECTORY_CREATE_REPLAY_FAILED'; end if;
  draft:=pg_catalog.jsonb_set(draft,'{name}',pg_catalog.to_jsonb('Replay mismatch'::text),false);
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  begin
    perform app_data_agent.apply_qa_directory_command(command);
    raise exception 'QA_DIRECTORY_MISMATCH_ACCEPTED';
  exception when unique_violation then
    if sqlerrm='DIRECTORY_OPERATION_REPLAY_MISMATCH' then mismatch_blocked:=true; else raise; end if;
  end;
  if not mismatch_blocked then raise exception 'QA_DIRECTORY_REPLAY_MISMATCH_FAILED'; end if;

  conversation_version:=1;
  draft:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002913',
    'idempotency_key','u24-conversation-move','action','CONVERSATION_MOVE',
    'conversation_id','00000000-0000-4000-8000-000000002902',
    'expected_resource_version',conversation_version,
    'folder_id','00000000-0000-4000-8000-000000002912');
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  result:=app_data_agent.apply_qa_directory_command(command);
  conversation_version:=(result->'conversation'->>'resource_version')::bigint;
  if result->'conversation'->>'folder_id'<>'00000000-0000-4000-8000-000000002912'
  then raise exception 'QA_DIRECTORY_MOVE_FAILED'; end if;

  draft:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002914',
    'idempotency_key','u24-conversation-rename','action','CONVERSATION_RENAME',
    'conversation_id','00000000-0000-4000-8000-000000002902',
    'expected_resource_version',conversation_version,'title','Renamed owner conversation');
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  result:=app_data_agent.apply_qa_directory_command(command);
  conversation_version:=(result->'conversation'->>'resource_version')::bigint;
  if result->'conversation'->>'title'<>'Renamed owner conversation'
  then raise exception 'QA_DIRECTORY_RENAME_FAILED'; end if;

  draft:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002915',
    'idempotency_key','u24-foreign-folder','action','CONVERSATION_MOVE',
    'conversation_id','00000000-0000-4000-8000-000000002902',
    'expected_resource_version',conversation_version,
    'folder_id','00000000-0000-4000-8000-000000002908');
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  begin
    perform app_data_agent.apply_qa_directory_command(command);
  exception when insufficient_privilege then
    if sqlerrm='FOLDER_NOT_FOUND_OR_DENIED' then foreign_folder_blocked:=true; else raise; end if;
  end;
  if not foreign_folder_blocked then raise exception 'QA_DIRECTORY_FOREIGN_FOLDER_ACCEPTED'; end if;

  draft:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002916',
    'idempotency_key','u24-active-trash','action','CONVERSATION_TRASH',
    'conversation_id','00000000-0000-4000-8000-000000002904',
    'expected_resource_version',1,'confirmed',true);
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  begin
    perform app_data_agent.apply_qa_directory_command(command);
  exception when object_not_in_prerequisite_state then
    if sqlerrm='CONVERSATION_DELETE_BLOCKED_BY_ACTIVE_RUN' then active_blocked:=true; else raise; end if;
  end;
  if not active_blocked then raise exception 'QA_DIRECTORY_ACTIVE_RUN_TRASH_ACCEPTED'; end if;

  folder_version:=(result->'conversation'->>'resource_version')::bigint;
  select resource_version into strict folder_version from app_data_agent.qa_conversation_folders
    where folder_id='00000000-0000-4000-8000-000000002912';
  draft:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002917',
    'idempotency_key','u24-folder-archive','action','FOLDER_ARCHIVE',
    'folder_id','00000000-0000-4000-8000-000000002912','expected_resource_version',folder_version);
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  result:=app_data_agent.apply_qa_directory_command(command);
  folder_version:=(result->'folder'->>'resource_version')::bigint;
  draft:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002918',
    'idempotency_key','u24-folder-restore','action','FOLDER_RESTORE',
    'folder_id','00000000-0000-4000-8000-000000002912','expected_resource_version',folder_version);
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  result:=app_data_agent.apply_qa_directory_command(command);
  folder_version:=(result->'folder'->>'resource_version')::bigint;
  draft:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002919',
    'idempotency_key','u24-folder-delete','action','FOLDER_DELETE',
    'folder_id','00000000-0000-4000-8000-000000002912',
    'expected_resource_version',folder_version,'confirmed',true);
  command:=draft||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(draft));
  result:=app_data_agent.apply_qa_directory_command(command);
  if result->'affected_conversation_ids'<>pg_catalog.jsonb_build_array(
      '00000000-0000-4000-8000-000000002902')
    or exists(select 1 from app_data_agent.qa_conversations
      where conversation_id='00000000-0000-4000-8000-000000002902' and folder_id is not null)
  then raise exception 'QA_DIRECTORY_FOLDER_DELETE_UNGROUP_FAILED'; end if;

  claims:=app_data_agent.claim_qa_conversation_retention(10,60000);
  if pg_catalog.jsonb_array_length(claims)<>2
    or exists(select 1 from pg_catalog.jsonb_array_elements(claims) value
      where value->>'conversation_id'='00000000-0000-4000-8000-000000002907')
  then raise exception 'QA_DIRECTORY_RETENTION_DB_TIME_FAILED'; end if;
  for item in select value from pg_catalog.jsonb_array_elements(claims) loop
    if item->>'conversation_id'='00000000-0000-4000-8000-000000002905' then due_empty_seen:=true; end if;
    if item->>'conversation_id'='00000000-0000-4000-8000-000000002906' then due_referenced_seen:=true; end if;
    receipt:=app_data_agent.complete_qa_conversation_retention(pg_catalog.jsonb_build_object(
      'schema_version','conversation-trash-retention-complete@1.0.0',
      'claim_id',item->>'claim_id','fence',(item->>'fence')::bigint,
      'outcome','PURGED','reason_code','CONVERSATION_RETENTION_DUE'));
    if item->>'conversation_id'='00000000-0000-4000-8000-000000002905'
      and receipt->>'outcome'<>'PURGED' then raise exception 'QA_DIRECTORY_EMPTY_PURGE_FAILED'; end if;
    if item->>'conversation_id'='00000000-0000-4000-8000-000000002906'
      and (receipt->>'outcome'<>'HELD'
        or receipt->>'reason_code'<>'CONVERSATION_RETENTION_REFERENCES_HELD')
    then raise exception 'QA_DIRECTORY_REFERENCE_HOLD_FAILED'; end if;
  end loop;
  if not due_empty_seen or not due_referenced_seen
    or exists(select 1 from app_data_agent.qa_conversations
      where conversation_id='00000000-0000-4000-8000-000000002905')
    or not exists(select 1 from app_data_agent.qa_conversations
      where conversation_id='00000000-0000-4000-8000-000000002906')
  then raise exception 'QA_DIRECTORY_RETENTION_COMPLETION_FAILED'; end if;
end
$behavior$;

reset session authorization;
rollback;
revoke execute on function app_data_agent.u2_canonical_sha256(jsonb)
  from data_agent_u24_behavior_session;
revoke data_agent_backend from data_agent_u24_behavior_session;
drop role data_agent_u24_behavior_session;

select 'U24_QA_DIRECTORY_ASSERTIONS_PASSED' as result;
