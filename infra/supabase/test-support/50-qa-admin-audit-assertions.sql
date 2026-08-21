\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $surface$
begin
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010675_app_data_agent_qa_admin_audit')
    or pg_catalog.to_regclass('app_data_agent.qa_admin_conversation_audit_receipts') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_qa_admin_directory(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_qa_admin_conversation(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_qa_admin_run_events(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.authorize_qa_admin_artifact_access(jsonb)') is null
  then raise exception 'QA_ADMIN_AUDIT_SURFACE_INCOMPLETE'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_qa_admin_audit_owner'
      and not rolcanlogin and not rolinherit and not rolbypassrls)
    or pg_catalog.has_table_privilege('authenticated','app_data_agent.qa_admin_conversation_audit_receipts','SELECT')
    or pg_catalog.has_table_privilege('service_role','app_data_agent.qa_admin_conversation_audit_receipts','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.qa_admin_conversation_audit_receipts','SELECT')
    or pg_catalog.pg_has_role('data_agent_qa_admin_audit_owner','data_agent_backend','MEMBER')
  then raise exception 'QA_ADMIN_AUDIT_AUTHORITY_SURFACE_INVALID'; end if;
end
$surface$;
rollback;

begin;
set local session_replication_role=replica;
insert into data_agent_auth."user"("id","name","email","emailVerified") values
  ('00000000-0000-4000-8000-000000003001','U25 workspace admin','u25-admin@example.invalid',true),
  ('00000000-0000-4000-8000-000000003002','U25 owner','u25-owner@example.invalid',true),
  ('00000000-0000-4000-8000-000000003003','U25 viewer','u25-viewer@example.invalid',true),
  ('00000000-0000-4000-8000-000000003004','U25 super admin','u25-super@example.invalid',true);
insert into app_data_agent.app_users(
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role,status,authz_epoch)
values
  ('00000000-0000-4000-8000-00000000da01','test','00000000-0000-4000-8000-000000003001',
    '00000000-0000-4000-8000-000000003001','u25-admin@example.invalid','U25 workspace admin','USER','ACTIVE',1),
  ('00000000-0000-4000-8000-00000000da01','test','00000000-0000-4000-8000-000000003002',
    '00000000-0000-4000-8000-000000003002','u25-owner@example.invalid','U25 owner','USER','ACTIVE',1),
  ('00000000-0000-4000-8000-00000000da01','test','00000000-0000-4000-8000-000000003003',
    '00000000-0000-4000-8000-000000003003','u25-viewer@example.invalid','U25 viewer','USER','ACTIVE',1),
  ('00000000-0000-4000-8000-00000000da01','test','00000000-0000-4000-8000-000000003004',
    '00000000-0000-4000-8000-000000003004','u25-super@example.invalid','U25 super admin','SUPER_ADMIN','ACTIVE',1);
insert into app_data_agent.memberships(
  app_id,tenant_id,environment,principal_id,membership_role,workspace_role,membership_source,system_override)
values
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000003001','owner','WORKSPACE_ADMIN','EXPLICIT',false),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000003002','analyst','ANALYST','EXPLICIT',false),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000003003','viewer','VIEWER','EXPLICIT',false),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000003004','owner','WORKSPACE_ADMIN','SYSTEM_ROLE',true);
insert into app_data_agent.datasource_connections(
  app_id,tenant_id,environment,datasource_id,name,datasource_type,file_path,status,created_by_principal_id)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-000000003005','U25 SQLite','sqlite','/tmp/u25.db','ACTIVE',
  '00000000-0000-4000-8000-000000003002');
insert into app_data_agent.qa_conversation_folders(
  app_id,tenant_id,environment,owner_principal_id,folder_id,name,sort_order)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-000000003002','00000000-0000-4000-8000-000000003008',
  'U25 private folder',0);
insert into app_data_agent.qa_conversations(
  app_id,tenant_id,environment,conversation_id,owner_principal_id,title,datasource_id,folder_id,
  resource_version,sort_order,deleted_at,purge_after,created_at)
values
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000003006','00000000-0000-4000-8000-000000003002',
    'U25 audited conversation','00000000-0000-4000-8000-000000003005',
    '00000000-0000-4000-8000-000000003008',1,0,null,null,pg_catalog.clock_timestamp()-interval '10 days'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000003007','00000000-0000-4000-8000-000000003002',
    'U25 trash audit','00000000-0000-4000-8000-000000003005',null,1,0,
    pg_catalog.statement_timestamp()-interval '5 days',pg_catalog.statement_timestamp()+interval '25 days',
    pg_catalog.clock_timestamp()-interval '10 days');
insert into app_data_agent.qa_messages(
  app_id,tenant_id,environment,conversation_id,message_id,owner_principal_id,role,content,message_type,metadata)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-000000003006','00000000-0000-4000-8000-000000003009',
  '00000000-0000-4000-8000-000000003002','user','U25 synthetic audit message','text','{}'::jsonb);
insert into app_data_agent.runs(app_id,tenant_id,environment,run_id,principal_id,status,active_fence,question)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000003010','00000000-0000-4000-8000-000000003002','RUNNING',1,
  'U25 synthetic run');
insert into app_data_agent.workspace_run_bindings(
  app_id,tenant_id,environment,run_id,datasource_id,conversation_id,principal_id)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000003010','00000000-0000-4000-8000-000000003005',
  '00000000-0000-4000-8000-000000003006','00000000-0000-4000-8000-000000003002');
insert into app_data_agent.artifacts(
  app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,document_json,worker_fence)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000003010','00000000-0000-4000-8000-000000003012','SqlArtifact',1,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{"sql":"select 1"}',1);
do $event$
declare scope jsonb:='{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-00000000aa11","environment":"test"}'::jsonb;
  payload jsonb:='{"profile_id":"report-writing-agent","task_id":"00000000-0000-4000-8000-000000003013","status":"RUNNING","phase":"draft.report","title":"Report","summary":"drafting","duration_ms":null,"error_code":null}'::jsonb;
  document jsonb;
begin
  document:=pg_catalog.jsonb_build_object('schema_version','run-runtime-event@2.0.0',
    'event_id','00000000-0000-4000-8000-000000003011','scope',scope,
    'run_id','00000000-0000-4000-8000-000000003010','sequence',1,'worker_fence',1,
    'idempotency_key','u25:agent:running','occurred_at','2026-08-22T00:00:00.000Z',
    'event_type','run.agent_status','payload',payload);
  insert into app_data_agent.run_events(app_id,tenant_id,environment,event_id,run_id,sequence,event_type,
    payload_json,dedupe_key,event_hash,worker_fence,event_document,created_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    '00000000-0000-4000-8000-000000003011','00000000-0000-4000-8000-000000003010',1,'run.agent_status',
    payload,'u25:agent:running',app_data_agent.runtime_canonical_sha256(document),1,document,
    '2026-08-22T00:00:00.000Z');
end
$event$;
set local session_replication_role=origin;
do $role$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u25_behavior_session') then
    create role data_agent_u25_behavior_session login inherit;
  end if;
end
$role$;
grant data_agent_backend to data_agent_u25_behavior_session with inherit true;
commit;

begin;
set session authorization data_agent_u25_behavior_session;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa11',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000003001',true);
select pg_catalog.set_config('data_agent.role','owner',true);

do $behavior$
declare page jsonb; detail jsonb; events jsonb; subagent jsonb; artifact jsonb; artifact_export jsonb;
  selected_receipt_id uuid; viewer_denied boolean:=false; cross_scope_denied boolean:=false;
begin
  page:=app_data_agent.read_qa_admin_directory(pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-directory-query@1.0.0','workspace_id','00000000-0000-4000-8000-00000000aa11',
    'owner_principal_id','null'::jsonb,'folder_id','null'::jsonb,'lifecycle','null'::jsonb,
    'live_state','null'::jsonb,'query','null'::jsonb,'cursor','null'::jsonb,'limit',50));
  if page->>'read_only'<>'true' or pg_catalog.jsonb_array_length(page->'conversations')<>2
    or not exists(select 1 from pg_catalog.jsonb_array_elements(page->'conversations') value
      where value->>'owner_principal_id'='00000000-0000-4000-8000-000000003002'
        and value->>'lifecycle'='TRASH')
  then raise exception 'QA_ADMIN_DIRECTORY_READ_FAILED'; end if;

  detail:=app_data_agent.read_qa_admin_conversation(pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-conversation-query@1.0.0','operation','MESSAGES_READ',
    'workspace_id','00000000-0000-4000-8000-00000000aa11',
    'owner_principal_id','00000000-0000-4000-8000-000000003002',
    'conversation_id','00000000-0000-4000-8000-000000003006','cursor','null'::jsonb,'limit',50));
  if pg_catalog.jsonb_array_length(detail->'messages')<>1
    or detail#>>'{receipt,reason_code}'<>'QA_ADMIN_MESSAGE_REVIEW'
  then raise exception 'QA_ADMIN_MESSAGE_READ_FAILED'; end if;

  events:=app_data_agent.read_qa_admin_run_events(pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-run-events-query@1.0.0','operation','RUN_REPLAY',
    'workspace_id','00000000-0000-4000-8000-00000000aa11',
    'owner_principal_id','00000000-0000-4000-8000-000000003002',
    'conversation_id','00000000-0000-4000-8000-000000003006',
    'run_id','00000000-0000-4000-8000-000000003010','profile_id','null'::jsonb,
    'task_id','null'::jsonb,'after_sequence',0,'limit',50));
  if pg_catalog.jsonb_array_length(events->'event_documents')<>1
    or events#>>'{receipt,operation}'<>'RUN_REPLAY'
  then raise exception 'QA_ADMIN_RUN_REPLAY_FAILED'; end if;

  subagent:=app_data_agent.read_qa_admin_run_events(pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-run-events-query@1.0.0','operation','SUBAGENT_READ',
    'workspace_id','00000000-0000-4000-8000-00000000aa11',
    'owner_principal_id','00000000-0000-4000-8000-000000003002',
    'conversation_id','00000000-0000-4000-8000-000000003006',
    'run_id','00000000-0000-4000-8000-000000003010','profile_id','report-writing-agent',
    'task_id','00000000-0000-4000-8000-000000003013','after_sequence',0,'limit',50));
  if subagent#>>'{receipt,reason_code}'<>'QA_ADMIN_SUBAGENT_REVIEW'
  then raise exception 'QA_ADMIN_SUBAGENT_READ_FAILED'; end if;

  artifact:=app_data_agent.authorize_qa_admin_artifact_access(pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-artifact-access-query@1.0.0','operation','ARTIFACT_PREVIEW',
    'workspace_id','00000000-0000-4000-8000-00000000aa11',
    'owner_principal_id','00000000-0000-4000-8000-000000003002',
    'conversation_id','00000000-0000-4000-8000-000000003006',
    'run_id','00000000-0000-4000-8000-000000003010','reference',pg_catalog.jsonb_build_object(
      'artifact_id','00000000-0000-4000-8000-000000003012','artifact_type','SqlArtifact',
      'app_id','00000000-0000-4000-8000-00000000da01','tenant_id','00000000-0000-4000-8000-00000000aa11',
      'environment','test','run_id','00000000-0000-4000-8000-000000003010','revision',1,
      'content_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')));
  if artifact#>>'{receipt,operation}'<>'ARTIFACT_PREVIEW'
  then raise exception 'QA_ADMIN_ARTIFACT_ACCESS_FAILED'; end if;

  artifact_export:=app_data_agent.authorize_qa_admin_artifact_access(pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-artifact-access-query@1.0.0','operation','ARTIFACT_EXPORT',
    'workspace_id','00000000-0000-4000-8000-00000000aa11',
    'owner_principal_id','00000000-0000-4000-8000-000000003002',
    'conversation_id','00000000-0000-4000-8000-000000003006',
    'run_id','00000000-0000-4000-8000-000000003010','reference',pg_catalog.jsonb_build_object(
      'artifact_id','00000000-0000-4000-8000-000000003012','artifact_type','SqlArtifact',
      'app_id','00000000-0000-4000-8000-00000000da01','tenant_id','00000000-0000-4000-8000-00000000aa11',
      'environment','test','run_id','00000000-0000-4000-8000-000000003010','revision',1,
      'content_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')));
  if artifact_export#>>'{receipt,operation}'<>'ARTIFACT_EXPORT'
    or artifact_export#>>'{receipt,reason_code}'<>'QA_ADMIN_ARTIFACT_EXPORT'
  then raise exception 'QA_ADMIN_ARTIFACT_EXPORT_AUDIT_FAILED'; end if;

  selected_receipt_id:=(detail#>>'{receipt,receipt_id}')::uuid;
  begin
    update app_data_agent.qa_admin_conversation_audit_receipts set result_classification='EMPTY'
    where qa_admin_conversation_audit_receipts.receipt_id=selected_receipt_id;
    raise exception 'QA_ADMIN_RECEIPT_MUTATION_ACCEPTED';
  exception
    when insufficient_privilege then null;
    when object_not_in_prerequisite_state then
      if sqlerrm<>'QA_ADMIN_AUDIT_RECEIPT_IMMUTABLE' then raise; end if;
  end;

  begin
    perform app_data_agent.read_qa_admin_directory(pg_catalog.jsonb_build_object(
      'schema_version','qa-admin-directory-query@1.0.0','workspace_id','00000000-0000-4000-8000-00000000aa22',
      'owner_principal_id','null'::jsonb,'folder_id','null'::jsonb,'lifecycle','null'::jsonb,
      'live_state','null'::jsonb,'query','null'::jsonb,'cursor','null'::jsonb,'limit',50));
  exception when insufficient_privilege then cross_scope_denied:=true;
  end;
  if not cross_scope_denied then raise exception 'QA_ADMIN_CROSS_SCOPE_ACCEPTED'; end if;
end
$behavior$;

select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000003003',true);
select pg_catalog.set_config('data_agent.role','viewer',true);
do $viewer$
declare denied boolean:=false;
begin
  begin
    perform app_data_agent.read_qa_admin_directory(pg_catalog.jsonb_build_object(
      'schema_version','qa-admin-directory-query@1.0.0','workspace_id','00000000-0000-4000-8000-00000000aa11',
      'owner_principal_id','null'::jsonb,'folder_id','null'::jsonb,'lifecycle','null'::jsonb,
      'live_state','null'::jsonb,'query','null'::jsonb,'cursor','null'::jsonb,'limit',50));
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'QA_ADMIN_VIEWER_ACCEPTED'; end if;
end
$viewer$;

select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000003004',true);
select pg_catalog.set_config('data_agent.role','owner',true);
do $super$
declare page jsonb;
begin
  page:=app_data_agent.read_qa_admin_directory(pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-directory-query@1.0.0','workspace_id','00000000-0000-4000-8000-00000000aa11',
    'owner_principal_id','00000000-0000-4000-8000-000000003002','folder_id','null'::jsonb,
    'lifecycle','ACTIVE','live_state','null'::jsonb,'query','null'::jsonb,'cursor','null'::jsonb,'limit',50));
  if page#>>'{receipt,operation}'<>'DIRECTORY_READ' then raise exception 'QA_ADMIN_SUPER_READ_FAILED'; end if;
end
$super$;

reset session authorization;
create function pg_temp.u25_reject_admin_receipt()
returns trigger language plpgsql as $failure$
begin
  raise exception using errcode='P0001',message='U25_SYNTHETIC_RECEIPT_FAILURE';
end
$failure$;
create trigger u25_reject_admin_receipt
before insert on app_data_agent.qa_admin_conversation_audit_receipts
for each row execute function pg_temp.u25_reject_admin_receipt();
set session authorization data_agent_u25_behavior_session;
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000003001',true);
select pg_catalog.set_config('data_agent.role','owner',true);
do $receipt_failure$
declare denied boolean:=false;
begin
  begin
    perform app_data_agent.read_qa_admin_directory(pg_catalog.jsonb_build_object(
      'schema_version','qa-admin-directory-query@1.0.0','workspace_id','00000000-0000-4000-8000-00000000aa11',
      'owner_principal_id','null'::jsonb,'folder_id','null'::jsonb,'lifecycle','null'::jsonb,
      'live_state','null'::jsonb,'query','null'::jsonb,'cursor','null'::jsonb,'limit',50));
  exception when raise_exception then
    if sqlerrm='QA_ADMIN_AUDIT_UNAVAILABLE' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'QA_ADMIN_RECEIPT_FAILURE_RETURNED_CONTENT'; end if;
end
$receipt_failure$;

reset session authorization;
drop trigger u25_reject_admin_receipt on app_data_agent.qa_admin_conversation_audit_receipts;
delete from app_data_agent.qa_conversations
where conversation_id='00000000-0000-4000-8000-000000003007'::uuid;
set session authorization data_agent_u25_behavior_session;
do $purged$
declare denied boolean:=false;
begin
  begin
    perform app_data_agent.read_qa_admin_conversation(pg_catalog.jsonb_build_object(
      'schema_version','qa-admin-conversation-query@1.0.0','operation','MESSAGES_READ',
      'workspace_id','00000000-0000-4000-8000-00000000aa11',
      'owner_principal_id','00000000-0000-4000-8000-000000003002',
      'conversation_id','00000000-0000-4000-8000-000000003007','cursor','null'::jsonb,'limit',50));
  exception when no_data_found then
    if sqlerrm='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'QA_ADMIN_PURGED_CONVERSATION_RETURNED'; end if;
end
$purged$;

reset session authorization;
delete from app_data_agent.memberships
where app_id='00000000-0000-4000-8000-00000000da01'::uuid
  and tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
  and environment='test'
  and principal_id='00000000-0000-4000-8000-000000003001'::uuid;
set session authorization data_agent_u25_behavior_session;
do $revoked$
declare denied boolean:=false;
begin
  begin
    perform app_data_agent.read_qa_admin_run_events(pg_catalog.jsonb_build_object(
      'schema_version','qa-admin-run-events-query@1.0.0','operation','RUN_REPLAY',
      'workspace_id','00000000-0000-4000-8000-00000000aa11',
      'owner_principal_id','00000000-0000-4000-8000-000000003002',
      'conversation_id','00000000-0000-4000-8000-000000003006',
      'run_id','00000000-0000-4000-8000-000000003010','profile_id','null'::jsonb,
      'task_id','null'::jsonb,'after_sequence',1,'limit',50));
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'QA_ADMIN_REVOKED_SSE_REPLAY_ACCEPTED'; end if;
end
$revoked$;

reset session authorization;
rollback;
revoke data_agent_backend from data_agent_u25_behavior_session;
drop role data_agent_u25_behavior_session;

select 'U25_QA_ADMIN_AUDIT_ASSERTIONS_PASSED' as result;
