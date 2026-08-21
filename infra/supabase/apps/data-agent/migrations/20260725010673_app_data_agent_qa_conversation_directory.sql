-- qa_directory_migration_checksum: sha256:a1f5306327147f2d1571c66d5eb7c286ce7da2c74a3183ca8a02ac179813d22a
-- 10673 adds owner-private Q&A folders, lifecycle commands and 30-day trash authority.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='QA_DIRECTORY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='QA_DIRECTORY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010672_app_data_agent_team_runtime_repairs')
  then raise exception using errcode='P0001',message='QA_DIRECTORY_BASELINE_10672_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_qa_directory_owner') then
    create role data_agent_qa_directory_owner nologin noinherit nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.qa_conversation_folders(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check(environment~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  owner_principal_id uuid not null,
  folder_id uuid not null,
  name text not null check(pg_catalog.length(pg_catalog.btrim(name)) between 1 and 80),
  sort_order bigint not null default 0 check(sort_order between 0 and 9007199254740991),
  resource_version bigint not null default 1 check(resource_version between 1 and 9007199254740991),
  archived_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,owner_principal_id,folder_id),
  unique(app_id,tenant_id,environment,folder_id),
  foreign key(app_id,tenant_id,environment,owner_principal_id)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id)
    on delete restrict,
  check(updated_at>=created_at),
  check(archived_at is null or archived_at>=created_at)
);

create unique index qa_conversation_folders_active_name
  on app_data_agent.qa_conversation_folders(
    app_id,tenant_id,environment,owner_principal_id,pg_catalog.lower(pg_catalog.btrim(name)))
  where archived_at is null;
create index qa_conversation_folders_owner_order
  on app_data_agent.qa_conversation_folders(
    app_id,tenant_id,environment,owner_principal_id,archived_at,sort_order,folder_id);

alter table app_data_agent.qa_conversations
  add column folder_id uuid,
  add column sort_order bigint not null default 0,
  add column archived_at timestamptz,
  add column deleted_at timestamptz,
  add column purge_after timestamptz;

alter table app_data_agent.qa_conversations
  add constraint qa_conversations_sort_order_check
    check(sort_order between 0 and 9007199254740991),
  add constraint qa_conversations_directory_state_check check(
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after=deleted_at+interval '30 days')
  ),
  add constraint qa_conversations_archived_time_check check(
    archived_at is null or archived_at>=created_at
  ),
  add constraint qa_conversations_deleted_time_check check(
    deleted_at is null or deleted_at>=created_at
  ),
  add constraint qa_conversations_owner_folder_fk
    foreign key(app_id,tenant_id,environment,owner_principal_id,folder_id)
    references app_data_agent.qa_conversation_folders(
      app_id,tenant_id,environment,owner_principal_id,folder_id)
    on delete restrict;

create index qa_conversations_owner_directory
  on app_data_agent.qa_conversations(
    app_id,tenant_id,environment,owner_principal_id,deleted_at,archived_at,
    folder_id,sort_order,updated_at desc,conversation_id);
create index qa_messages_owner_search
  on app_data_agent.qa_messages(
    app_id,tenant_id,environment,owner_principal_id,conversation_id,created_at desc);

create or replace function app_data_agent.guard_qa_conversation_update()
returns trigger language plpgsql set search_path='' as $function$
declare resources_changed boolean; directory_changed boolean;
begin
  if new.app_id<>old.app_id or new.tenant_id<>old.tenant_id
    or new.environment<>old.environment or new.conversation_id<>old.conversation_id
    or new.owner_principal_id<>old.owner_principal_id or new.created_at<>old.created_at
  then raise exception using errcode='42501',message='CONVERSATION_SCOPE_IMMUTABLE'; end if;
  resources_changed:=new.datasource_id is distinct from old.datasource_id
    or new.model_profile_id is distinct from old.model_profile_id
    or new.model_id is distinct from old.model_id;
  directory_changed:=new.title is distinct from old.title
    or new.folder_id is distinct from old.folder_id
    or new.sort_order is distinct from old.sort_order
    or new.archived_at is distinct from old.archived_at
    or new.deleted_at is distinct from old.deleted_at
    or new.purge_after is distinct from old.purge_after;
  if resources_changed and directory_changed then
    raise exception using errcode='42501',message='CONVERSATION_UPDATE_DOMAIN_MIXED'; end if;
  if resources_changed then
    if exists(select 1 from app_data_agent.qa_messages message
      where message.app_id=old.app_id and message.tenant_id=old.tenant_id
        and message.environment=old.environment and message.conversation_id=old.conversation_id)
    then raise exception using errcode='23514',message='CONVERSATION_RESOURCES_FROZEN'; end if;
    if new.datasource_id is null or not exists(select 1 from app_data_agent.datasource_connections datasource
      where datasource.app_id=new.app_id and datasource.tenant_id=new.tenant_id
        and datasource.environment=new.environment and datasource.datasource_id=new.datasource_id
        and datasource.status='ACTIVE')
    then raise exception using errcode='23503',message='DATASOURCE_NOT_FOUND_OR_DENIED'; end if;
    if new.model_profile_id is null or new.model_id is distinct from new.model_profile_id::text
      or not exists(select 1 from platform.list_active_model_catalog(
        nullif(pg_catalog.current_setting('data_agent.deployment_id',true),'')::uuid,
        nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid) catalog
        where catalog.app_id=new.app_id and catalog.environment=new.environment
          and catalog.model_profile_id=new.model_profile_id and catalog.status='ACTIVE')
    then raise exception using errcode='23503',message='MODEL_PROFILE_NOT_AVAILABLE'; end if;
  elsif directory_changed then
    if not pg_catalog.pg_has_role(current_user,'data_agent_qa_directory_owner','USAGE') then
      raise exception using errcode='42501',message='QA_DIRECTORY_OWNER_REQUIRED'; end if;
  end if;
  if (resources_changed or directory_changed) and new.resource_version<>old.resource_version+1 then
    raise exception using errcode='40001',message='CONVERSATION_RESOURCE_VERSION_CONFLICT';
  elsif not resources_changed and not directory_changed and new.resource_version<>old.resource_version then
    raise exception using errcode='42501',message='CONVERSATION_RESOURCE_VERSION_IMMUTABLE';
  end if;
  new.updated_at:=pg_catalog.clock_timestamp();
  return new;
end
$function$;

create table app_data_agent.qa_directory_operation_receipts(
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  actor_principal_id uuid not null,
  operation_id uuid not null,
  idempotency_key text not null check(
    pg_catalog.length(idempotency_key) between 1 and 128
    and idempotency_key~'^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  operation_kind text not null check(operation_kind in(
    'FOLDER_CREATE','FOLDER_RENAME','FOLDER_REORDER','FOLDER_ARCHIVE','FOLDER_RESTORE','FOLDER_DELETE',
    'CONVERSATION_RENAME','CONVERSATION_REORDER','CONVERSATION_MOVE','CONVERSATION_ARCHIVE',
    'CONVERSATION_RESTORE','CONVERSATION_TRASH','CONVERSATION_RESTORE_FROM_TRASH')),
  command_hash text not null check(command_hash~'^sha256:[0-9a-f]{64}$'),
  result_json jsonb not null check(pg_catalog.jsonb_typeof(result_json)='object'),
  committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,actor_principal_id,operation_id),
  unique(app_id,tenant_id,environment,actor_principal_id,idempotency_key)
);

create table app_data_agent.qa_conversation_retention_claims(
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  owner_principal_id uuid not null,
  conversation_id uuid not null,
  claim_id uuid not null,
  fence bigint not null check(fence between 1 and 9007199254740991),
  status text not null check(status in('LEASED','HELD','PURGED')),
  deleted_at timestamptz not null,
  purge_after timestamptz not null,
  lease_expires_at timestamptz not null,
  reason_code text,
  receipt_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,claim_id),
  unique(app_id,tenant_id,environment,owner_principal_id,conversation_id),
  check(purge_after=deleted_at+interval '30 days'),
  check((status='LEASED' and completed_at is null and receipt_id is null and reason_code is null)
    or (status in('HELD','PURGED') and completed_at is not null
      and receipt_id is not null and reason_code is not null))
);

create function app_data_agent.reject_qa_directory_receipt_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='42501',message='QA_DIRECTORY_RECEIPT_IMMUTABLE';
end
$function$;
create trigger qa_directory_operation_receipts_immutable
  before update or delete on app_data_agent.qa_directory_operation_receipts
  for each row execute function app_data_agent.reject_qa_directory_receipt_mutation();
create function app_data_agent.qa_folder_public_document(folder app_data_agent.qa_conversation_folders)
returns jsonb language sql stable set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-folder@1.0.0',
    'workspace_id',folder.tenant_id,'folder_id',folder.folder_id,
    'owner_principal_id',folder.owner_principal_id,'name',folder.name,
    'sort_order',folder.sort_order,'resource_version',folder.resource_version,
    'archived_at',folder.archived_at,'created_at',folder.created_at,'updated_at',folder.updated_at)
$function$;

create function app_data_agent.qa_conversation_public_document(
  conversation app_data_agent.qa_conversations,requested_query text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
  message_count bigint; live_state text:='IDLE'; snippet text; latest_status text;
  effective_archived_at timestamptz;
begin
  select pg_catalog.count(*) into message_count from app_data_agent.qa_messages message
  where message.app_id=conversation.app_id and message.tenant_id=conversation.tenant_id
    and message.environment=conversation.environment
    and message.owner_principal_id=conversation.owner_principal_id
    and message.conversation_id=conversation.conversation_id;
  select run.status into latest_status from app_data_agent.workspace_run_bindings binding
  join app_data_agent.runs run on run.app_id=binding.app_id and run.tenant_id=binding.tenant_id
    and run.environment=binding.environment and run.run_id=binding.run_id
    and run.principal_id=binding.principal_id
  where binding.app_id=conversation.app_id and binding.tenant_id=conversation.tenant_id
    and binding.environment=conversation.environment and binding.principal_id=conversation.owner_principal_id
    and binding.conversation_id=conversation.conversation_id
  order by run.updated_at desc,run.run_id desc limit 1;
  live_state:=case latest_status
    when 'QUEUED' then 'RUNNING' when 'RUNNING' then 'RUNNING'
    when 'WAITING' then 'WAITING_ANSWER' when 'FAILED' then 'FAILED'
    when 'COMPLETED' then 'COMPLETED' when 'SUCCEEDED' then 'COMPLETED' else 'IDLE' end;
  if requested_query is not null and pg_catalog.length(pg_catalog.btrim(requested_query))>0 then
    select pg_catalog.left(pg_catalog.regexp_replace(message.content,E'[\\n\\r\\t]+',' ','g'),180)
      into snippet from app_data_agent.qa_messages message
    where message.app_id=conversation.app_id and message.tenant_id=conversation.tenant_id
      and message.environment=conversation.environment
      and message.owner_principal_id=conversation.owner_principal_id
      and message.conversation_id=conversation.conversation_id
      and message.content ilike '%'||requested_query||'%'
    order by message.created_at desc,message.message_id desc limit 1;
  end if;
  select coalesce(conversation.archived_at,folder.archived_at) into effective_archived_at
  from (select 1) singleton
  left join app_data_agent.qa_conversation_folders folder
    on folder.app_id=conversation.app_id and folder.tenant_id=conversation.tenant_id
    and folder.environment=conversation.environment
    and folder.owner_principal_id=conversation.owner_principal_id
    and folder.folder_id=conversation.folder_id;
  return pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation@2.0.0','workspace_id',conversation.tenant_id,
    'conversation_id',conversation.conversation_id,'owner_principal_id',conversation.owner_principal_id,
    'title',conversation.title,'datasource_id',conversation.datasource_id,'model_id',conversation.model_id,
    'model_profile_id',conversation.model_profile_id,'resource_version',conversation.resource_version,
    'message_count',message_count,'folder_id',conversation.folder_id,'sort_order',conversation.sort_order,
    'lifecycle',case when conversation.deleted_at is not null then 'TRASH'
      when effective_archived_at is not null then 'ARCHIVED' else 'ACTIVE' end,
    'archived_at',effective_archived_at,'deleted_at',conversation.deleted_at,
    'purge_after',conversation.purge_after,'live_state',live_state,
    'unread_completed',false,'search_snippet',snippet,
    'created_at',conversation.created_at,'updated_at',conversation.updated_at);
end
$function$;

create function app_data_agent.list_qa_conversation_directory(requested_query jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
  authority record; requested_view text; requested_folder uuid; search_query text;
  requested_limit integer; requested_offset integer; folder_documents jsonb; conversation_documents jsonb;
  total_count bigint; next_cursor text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if requested_query is null or not app_data_agent.resolved_context_exact_keys(requested_query,array[
    'schema_version','view','folder_id','query','cursor','limit']::text[])
    or requested_query->>'schema_version'<>'workspace-conversation-directory-query@1.0.0'
    or requested_query->>'view' not in('active','archived','trash')
    or pg_catalog.jsonb_typeof(requested_query->'limit')<>'number'
  then raise exception using errcode='22023',message='QA_DIRECTORY_QUERY_INVALID'; end if;
  requested_view:=requested_query->>'view';
  requested_limit:=(requested_query->>'limit')::integer;
  if requested_limit not between 1 and 50 then
    raise exception using errcode='22023',message='QA_DIRECTORY_QUERY_INVALID'; end if;
  if requested_query->'folder_id'<>'null'::jsonb then requested_folder:=(requested_query->>'folder_id')::uuid; end if;
  if requested_query->'query'<>'null'::jsonb then
    search_query:=pg_catalog.btrim(requested_query->>'query');
    if pg_catalog.length(search_query) not between 1 and 120 then
      raise exception using errcode='22023',message='QA_DIRECTORY_QUERY_INVALID'; end if;
  end if;
  requested_offset:=case when requested_query->'cursor'='null'::jsonb then 0
    else (requested_query->>'cursor')::integer end;
  if requested_offset<0 or requested_offset>100000 then
    raise exception using errcode='22023',message='QA_DIRECTORY_QUERY_INVALID'; end if;
  select * into authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(app_data_agent.qa_folder_public_document(folder)
      order by folder.sort_order,folder.folder_id),'[]'::jsonb)
    into folder_documents from app_data_agent.qa_conversation_folders folder
  where folder.app_id=authority.app_id and folder.tenant_id=authority.tenant_id
    and folder.environment=authority.environment and folder.owner_principal_id=authority.principal_id
    and ((requested_view='archived' and folder.archived_at is not null)
      or (requested_view<>'archived' and folder.archived_at is null))
    and (search_query is null or folder.name ilike '%'||search_query||'%');
  with eligible as(
    select conversation.* from app_data_agent.qa_conversations conversation
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment
      and conversation.owner_principal_id=authority.principal_id
      and (requested_folder is null or conversation.folder_id=requested_folder)
      and ((requested_view='active' and conversation.deleted_at is null and conversation.archived_at is null
          and (conversation.folder_id is null or exists(select 1 from app_data_agent.qa_conversation_folders folder
            where folder.app_id=conversation.app_id and folder.tenant_id=conversation.tenant_id
              and folder.environment=conversation.environment
              and folder.owner_principal_id=conversation.owner_principal_id
              and folder.folder_id=conversation.folder_id and folder.archived_at is null)))
        or (requested_view='archived' and conversation.deleted_at is null
          and (conversation.archived_at is not null or exists(select 1 from app_data_agent.qa_conversation_folders folder
            where folder.app_id=conversation.app_id and folder.tenant_id=conversation.tenant_id
              and folder.environment=conversation.environment
              and folder.owner_principal_id=conversation.owner_principal_id
              and folder.folder_id=conversation.folder_id and folder.archived_at is not null)))
        or (requested_view='trash' and conversation.deleted_at is not null))
      and (search_query is null or conversation.title ilike '%'||search_query||'%'
        or exists(select 1 from app_data_agent.qa_conversation_folders folder
          where folder.app_id=conversation.app_id and folder.tenant_id=conversation.tenant_id
            and folder.environment=conversation.environment
            and folder.owner_principal_id=conversation.owner_principal_id
            and folder.folder_id=conversation.folder_id and folder.name ilike '%'||search_query||'%')
        or exists(select 1 from app_data_agent.qa_messages message
          where message.app_id=conversation.app_id and message.tenant_id=conversation.tenant_id
            and message.environment=conversation.environment
            and message.owner_principal_id=conversation.owner_principal_id
            and message.conversation_id=conversation.conversation_id
            and message.content ilike '%'||search_query||'%'))),
  page as(select * from eligible order by sort_order,updated_at desc,conversation_id
    offset requested_offset limit requested_limit)
  select (select pg_catalog.count(*) from eligible),
    coalesce(pg_catalog.jsonb_agg(app_data_agent.qa_conversation_public_document(page,search_query)
      order by page.sort_order,page.updated_at desc,page.conversation_id),'[]'::jsonb)
  into total_count,conversation_documents from page;
  if requested_offset+requested_limit<total_count then
    next_cursor:=(requested_offset+requested_limit)::text; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-page@1.0.0',
    'workspace_id',authority.tenant_id,'view',requested_view,'folders',folder_documents,
    'conversations',conversation_documents,'next_cursor',next_cursor);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_DIRECTORY_QUERY_INVALID';
end
$function$;
create function app_data_agent.qa_directory_command_is_valid(command jsonb)
returns boolean language plpgsql immutable set search_path='' as $function$
declare action_value text; required_keys text[];
begin
  if command is null or pg_catalog.jsonb_typeof(command)<>'object'
    or command->>'schema_version'<>'workspace-conversation-directory-command@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or command->>'operation_id' is null or command->>'idempotency_key' is null
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 128
    or command->>'idempotency_key'!~'^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  then return false; end if;
  action_value:=command->>'action';
  required_keys:=case action_value
    when 'FOLDER_CREATE' then array['schema_version','operation_id','idempotency_key','action','folder_id','name','sort_order','command_hash']
    when 'FOLDER_RENAME' then array['schema_version','operation_id','idempotency_key','action','folder_id','expected_resource_version','name','command_hash']
    when 'FOLDER_REORDER' then array['schema_version','operation_id','idempotency_key','action','folder_id','expected_resource_version','sort_order','command_hash']
    when 'FOLDER_ARCHIVE' then array['schema_version','operation_id','idempotency_key','action','folder_id','expected_resource_version','command_hash']
    when 'FOLDER_RESTORE' then array['schema_version','operation_id','idempotency_key','action','folder_id','expected_resource_version','command_hash']
    when 'FOLDER_DELETE' then array['schema_version','operation_id','idempotency_key','action','folder_id','expected_resource_version','confirmed','command_hash']
    when 'CONVERSATION_RENAME' then array['schema_version','operation_id','idempotency_key','action','conversation_id','expected_resource_version','title','command_hash']
    when 'CONVERSATION_REORDER' then array['schema_version','operation_id','idempotency_key','action','conversation_id','expected_resource_version','sort_order','command_hash']
    when 'CONVERSATION_MOVE' then array['schema_version','operation_id','idempotency_key','action','conversation_id','expected_resource_version','folder_id','command_hash']
    when 'CONVERSATION_ARCHIVE' then array['schema_version','operation_id','idempotency_key','action','conversation_id','expected_resource_version','command_hash']
    when 'CONVERSATION_RESTORE' then array['schema_version','operation_id','idempotency_key','action','conversation_id','expected_resource_version','command_hash']
    when 'CONVERSATION_TRASH' then array['schema_version','operation_id','idempotency_key','action','conversation_id','expected_resource_version','confirmed','command_hash']
    when 'CONVERSATION_RESTORE_FROM_TRASH' then array['schema_version','operation_id','idempotency_key','action','conversation_id','expected_resource_version','command_hash']
    else null end;
  if required_keys is null or not app_data_agent.resolved_context_exact_keys(command,required_keys)
    or (command?'expected_resource_version' and (
      pg_catalog.jsonb_typeof(command->'expected_resource_version')<>'number'
      or (command->>'expected_resource_version')::bigint<1))
    or (command?'sort_order' and (
      pg_catalog.jsonb_typeof(command->'sort_order')<>'number'
      or (command->>'sort_order')::bigint not between 0 and 9007199254740991))
    or (command?'name' and pg_catalog.length(pg_catalog.btrim(command->>'name')) not between 1 and 80)
    or (command?'title' and pg_catalog.length(pg_catalog.btrim(command->>'title')) not between 1 and 255)
    or (action_value in('FOLDER_DELETE','CONVERSATION_TRASH') and command->>'confirmed'<>'true')
  then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end
$function$;

create function app_data_agent.apply_qa_directory_command(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record; existing_receipt app_data_agent.qa_directory_operation_receipts%rowtype;
  folder_record app_data_agent.qa_conversation_folders%rowtype;
  conversation_record app_data_agent.qa_conversations%rowtype;
  action_value text; expected_version bigint; now_at timestamptz;
  folder_document jsonb:='null'::jsonb; conversation_document jsonb:='null'::jsonb;
  affected_ids jsonb:='[]'::jsonb; result_document jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if not app_data_agent.qa_directory_command_is_valid(command) then
    raise exception using errcode='22023',message='QA_DIRECTORY_COMMAND_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if pg_catalog.lower(authority.membership_role) not in('owner','analyst') then
    raise exception using errcode='42501',message='QA_DIRECTORY_MUTATION_REQUIRED'; end if;
  action_value:=command->>'action';
  select * into existing_receipt from app_data_agent.qa_directory_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing_receipt.command_hash<>command->>'command_hash'
      or existing_receipt.operation_kind<>action_value then
      raise exception using errcode='23505',message='DIRECTORY_OPERATION_REPLAY_MISMATCH'; end if;
    return pg_catalog.jsonb_set(existing_receipt.result_json,'{replayed}','true'::jsonb,false);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':'||authority.principal_id::text||':QA_DIRECTORY',0));
  now_at:=pg_catalog.clock_timestamp();
  if command?'expected_resource_version' then
    expected_version:=(command->>'expected_resource_version')::bigint; end if;

  if action_value like 'FOLDER_%' then
    if action_value='FOLDER_CREATE' then
      insert into app_data_agent.qa_conversation_folders(
        app_id,tenant_id,environment,owner_principal_id,folder_id,name,sort_order,created_at,updated_at)
      values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
        (command->>'folder_id')::uuid,pg_catalog.btrim(command->>'name'),
        (command->>'sort_order')::bigint,now_at,now_at)
      returning * into folder_record;
    else
      select * into folder_record from app_data_agent.qa_conversation_folders folder
      where folder.app_id=authority.app_id and folder.tenant_id=authority.tenant_id
        and folder.environment=authority.environment and folder.owner_principal_id=authority.principal_id
        and folder.folder_id=(command->>'folder_id')::uuid for update;
      if not found then raise exception using errcode='42501',message='FOLDER_NOT_FOUND_OR_DENIED'; end if;
      if folder_record.resource_version<>expected_version then
        raise exception using errcode='40001',message='DIRECTORY_RESOURCE_VERSION_CONFLICT'; end if;
      if action_value='FOLDER_RENAME' then
        update app_data_agent.qa_conversation_folders set name=pg_catalog.btrim(command->>'name'),
          resource_version=resource_version+1,updated_at=now_at
        where app_id=folder_record.app_id and tenant_id=folder_record.tenant_id
          and environment=folder_record.environment and owner_principal_id=folder_record.owner_principal_id
          and folder_id=folder_record.folder_id returning * into folder_record;
      elsif action_value='FOLDER_REORDER' then
        update app_data_agent.qa_conversation_folders set sort_order=(command->>'sort_order')::bigint,
          resource_version=resource_version+1,updated_at=now_at
        where app_id=folder_record.app_id and tenant_id=folder_record.tenant_id
          and environment=folder_record.environment and owner_principal_id=folder_record.owner_principal_id
          and folder_id=folder_record.folder_id returning * into folder_record;
      elsif action_value='FOLDER_ARCHIVE' then
        if folder_record.archived_at is not null then
          raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
        update app_data_agent.qa_conversation_folders set archived_at=now_at,
          resource_version=resource_version+1,updated_at=now_at
        where app_id=folder_record.app_id and tenant_id=folder_record.tenant_id
          and environment=folder_record.environment and owner_principal_id=folder_record.owner_principal_id
          and folder_id=folder_record.folder_id returning * into folder_record;
      elsif action_value='FOLDER_RESTORE' then
        if folder_record.archived_at is null then
          raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
        update app_data_agent.qa_conversation_folders set archived_at=null,
          resource_version=resource_version+1,updated_at=now_at
        where app_id=folder_record.app_id and tenant_id=folder_record.tenant_id
          and environment=folder_record.environment and owner_principal_id=folder_record.owner_principal_id
          and folder_id=folder_record.folder_id returning * into folder_record;
      elsif action_value='FOLDER_DELETE' then
        with moved as(
          update app_data_agent.qa_conversations conversation set folder_id=null,
            archived_at=coalesce(conversation.archived_at,folder_record.archived_at),
            resource_version=conversation.resource_version+1,updated_at=now_at
          where conversation.app_id=folder_record.app_id and conversation.tenant_id=folder_record.tenant_id
            and conversation.environment=folder_record.environment
            and conversation.owner_principal_id=folder_record.owner_principal_id
            and conversation.folder_id=folder_record.folder_id returning conversation_id)
        select coalesce(pg_catalog.jsonb_agg(conversation_id order by conversation_id),'[]'::jsonb)
          into affected_ids from moved;
        delete from app_data_agent.qa_conversation_folders folder
        where folder.app_id=folder_record.app_id and folder.tenant_id=folder_record.tenant_id
          and folder.environment=folder_record.environment and folder.owner_principal_id=folder_record.owner_principal_id
          and folder.folder_id=folder_record.folder_id;
        folder_document:='null'::jsonb;
      end if;
    end if;
    if action_value<>'FOLDER_DELETE' then
      folder_document:=app_data_agent.qa_folder_public_document(folder_record); end if;
  else
    select * into conversation_record from app_data_agent.qa_conversations conversation
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment
      and conversation.owner_principal_id=authority.principal_id
      and conversation.conversation_id=(command->>'conversation_id')::uuid for update;
    if not found then raise exception using errcode='42501',message='CONVERSATION_NOT_FOUND_OR_DENIED'; end if;
    if conversation_record.resource_version<>expected_version then
      raise exception using errcode='40001',message='DIRECTORY_RESOURCE_VERSION_CONFLICT'; end if;
    if action_value='CONVERSATION_RENAME' then
      if conversation_record.deleted_at is not null then
        raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
      update app_data_agent.qa_conversations set title=pg_catalog.btrim(command->>'title'),
        resource_version=resource_version+1 where app_id=conversation_record.app_id
        and tenant_id=conversation_record.tenant_id and environment=conversation_record.environment
        and conversation_id=conversation_record.conversation_id returning * into conversation_record;
    elsif action_value='CONVERSATION_REORDER' then
      if conversation_record.deleted_at is not null then
        raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
      update app_data_agent.qa_conversations set sort_order=(command->>'sort_order')::bigint,
        resource_version=resource_version+1 where app_id=conversation_record.app_id
        and tenant_id=conversation_record.tenant_id and environment=conversation_record.environment
        and conversation_id=conversation_record.conversation_id returning * into conversation_record;
    elsif action_value='CONVERSATION_MOVE' then
      if conversation_record.deleted_at is not null then
        raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
      if command->'folder_id'<>'null'::jsonb and not exists(
        select 1 from app_data_agent.qa_conversation_folders folder
        where folder.app_id=authority.app_id and folder.tenant_id=authority.tenant_id
          and folder.environment=authority.environment and folder.owner_principal_id=authority.principal_id
          and folder.folder_id=(command->>'folder_id')::uuid) then
        raise exception using errcode='42501',message='FOLDER_NOT_FOUND_OR_DENIED'; end if;
      update app_data_agent.qa_conversations set
        folder_id=case when command->'folder_id'='null'::jsonb then null else (command->>'folder_id')::uuid end,
        resource_version=resource_version+1 where app_id=conversation_record.app_id
        and tenant_id=conversation_record.tenant_id and environment=conversation_record.environment
        and conversation_id=conversation_record.conversation_id returning * into conversation_record;
    elsif action_value='CONVERSATION_ARCHIVE' then
      if conversation_record.deleted_at is not null or conversation_record.archived_at is not null then
        raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
      update app_data_agent.qa_conversations set archived_at=now_at,resource_version=resource_version+1
      where app_id=conversation_record.app_id and tenant_id=conversation_record.tenant_id
        and environment=conversation_record.environment and conversation_id=conversation_record.conversation_id
      returning * into conversation_record;
    elsif action_value='CONVERSATION_RESTORE' then
      if conversation_record.deleted_at is not null or conversation_record.archived_at is null then
        raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
      update app_data_agent.qa_conversations set archived_at=null,resource_version=resource_version+1
      where app_id=conversation_record.app_id and tenant_id=conversation_record.tenant_id
        and environment=conversation_record.environment and conversation_id=conversation_record.conversation_id
      returning * into conversation_record;
    elsif action_value='CONVERSATION_TRASH' then
      if conversation_record.deleted_at is not null then
        raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
      if exists(select 1 from app_data_agent.workspace_run_bindings binding
        join app_data_agent.runs run on run.app_id=binding.app_id and run.tenant_id=binding.tenant_id
          and run.environment=binding.environment and run.run_id=binding.run_id
          and run.principal_id=binding.principal_id
        where binding.app_id=conversation_record.app_id and binding.tenant_id=conversation_record.tenant_id
          and binding.environment=conversation_record.environment
          and binding.principal_id=conversation_record.owner_principal_id
          and binding.conversation_id=conversation_record.conversation_id
          and run.status in('QUEUED','RUNNING','WAITING')) then
        raise exception using errcode='55000',message='CONVERSATION_DELETE_BLOCKED_BY_ACTIVE_RUN'; end if;
      update app_data_agent.qa_conversations set deleted_at=now_at,
        purge_after=now_at+interval '30 days',resource_version=resource_version+1
      where app_id=conversation_record.app_id and tenant_id=conversation_record.tenant_id
        and environment=conversation_record.environment and conversation_id=conversation_record.conversation_id
      returning * into conversation_record;
    elsif action_value='CONVERSATION_RESTORE_FROM_TRASH' then
      if conversation_record.deleted_at is null then
        raise exception using errcode='23514',message='DIRECTORY_STATE_TRANSITION_INVALID'; end if;
      update app_data_agent.qa_conversations set deleted_at=null,purge_after=null,
        resource_version=resource_version+1
      where app_id=conversation_record.app_id and tenant_id=conversation_record.tenant_id
        and environment=conversation_record.environment and conversation_id=conversation_record.conversation_id
      returning * into conversation_record;
    end if;
    conversation_document:=app_data_agent.qa_conversation_public_document(conversation_record,null);
  end if;
  result_document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-directory-command-result@1.0.0',
    'operation_id',command->>'operation_id','action',action_value,
    'command_hash',command->>'command_hash','replayed',false,'folder',folder_document,
    'conversation',conversation_document,'affected_conversation_ids',affected_ids,
    'committed_at',now_at);
  insert into app_data_agent.qa_directory_operation_receipts(
    app_id,tenant_id,environment,actor_principal_id,operation_id,idempotency_key,
    operation_kind,command_hash,result_json,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (command->>'operation_id')::uuid,command->>'idempotency_key',action_value,
    command->>'command_hash',result_document,now_at);
  return result_document;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_DIRECTORY_COMMAND_INVALID';
end
$function$;
create function app_data_agent.claim_qa_conversation_retention(
  requested_limit integer,requested_lease_duration_ms integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record; now_at timestamptz:=pg_catalog.clock_timestamp();
  candidate app_data_agent.qa_conversations%rowtype;
  claim app_data_agent.qa_conversation_retention_claims%rowtype;
  claims jsonb:='[]'::jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if requested_limit not between 1 and 50 or requested_lease_duration_ms not between 1000 and 300000 then
    raise exception using errcode='22023',message='QA_RETENTION_CLAIM_INPUT_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if pg_catalog.lower(authority.membership_role) not in('owner','analyst') then
    raise exception using errcode='42501',message='QA_RETENTION_JOB_REQUIRED'; end if;
  for candidate in
    select conversation.* from app_data_agent.qa_conversations conversation
    left join app_data_agent.qa_conversation_retention_claims existing
      on existing.app_id=conversation.app_id and existing.tenant_id=conversation.tenant_id
      and existing.environment=conversation.environment
      and existing.owner_principal_id=conversation.owner_principal_id
      and existing.conversation_id=conversation.conversation_id
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment
      and conversation.owner_principal_id=authority.principal_id
      and conversation.deleted_at is not null and conversation.purge_after<=now_at
      and (existing.claim_id is null or (existing.status<>'PURGED'
        and (existing.status='HELD' or existing.lease_expires_at<=now_at)))
    order by conversation.purge_after,conversation.conversation_id
    for update of conversation skip locked limit requested_limit
  loop
    insert into app_data_agent.qa_conversation_retention_claims(
      app_id,tenant_id,environment,owner_principal_id,conversation_id,claim_id,fence,status,
      deleted_at,purge_after,lease_expires_at,created_at,updated_at)
    values(candidate.app_id,candidate.tenant_id,candidate.environment,candidate.owner_principal_id,
      candidate.conversation_id,pg_catalog.gen_random_uuid(),1,'LEASED',candidate.deleted_at,
      candidate.purge_after,now_at+pg_catalog.make_interval(secs=>requested_lease_duration_ms/1000.0),
      now_at,now_at)
    on conflict(app_id,tenant_id,environment,owner_principal_id,conversation_id) do update set
      claim_id=pg_catalog.gen_random_uuid(),fence=app_data_agent.qa_conversation_retention_claims.fence+1,
      status='LEASED',deleted_at=excluded.deleted_at,purge_after=excluded.purge_after,
      lease_expires_at=excluded.lease_expires_at,reason_code=null,receipt_id=null,completed_at=null,
      updated_at=now_at
    where app_data_agent.qa_conversation_retention_claims.status<>'PURGED'
      and (app_data_agent.qa_conversation_retention_claims.status='HELD'
        or app_data_agent.qa_conversation_retention_claims.lease_expires_at<=now_at)
    returning * into claim;
    if found then
      claims:=claims||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'schema_version','conversation-trash-retention-claim@1.0.0','claim_id',claim.claim_id,
        'workspace_id',claim.tenant_id,'owner_principal_id',claim.owner_principal_id,
        'conversation_id',claim.conversation_id,'deleted_at',claim.deleted_at,
        'purge_after',claim.purge_after,'fence',claim.fence,
        'lease_expires_at',claim.lease_expires_at));
    end if;
  end loop;
  return claims;
end
$function$;

create function app_data_agent.complete_qa_conversation_retention(requested_completion jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record; claim app_data_agent.qa_conversation_retention_claims%rowtype;
  now_at timestamptz:=pg_catalog.clock_timestamp(); requested_outcome text;
  actual_outcome text; actual_reason text; receipt_id_value uuid:=pg_catalog.gen_random_uuid();
  receipt jsonb; has_references boolean;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if requested_completion is null or not app_data_agent.resolved_context_exact_keys(
      requested_completion,array['schema_version','claim_id','fence','outcome','reason_code']::text[])
    or requested_completion->>'schema_version'<>'conversation-trash-retention-complete@1.0.0'
    or requested_completion->>'outcome' not in('PURGED','HELD')
    or requested_completion->>'reason_code'!~'^[A-Z][A-Z0-9_]*$'
    or pg_catalog.length(requested_completion->>'reason_code') not between 1 and 128
  then raise exception using errcode='22023',message='QA_RETENTION_COMPLETION_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  select * into claim from app_data_agent.qa_conversation_retention_claims current_claim
  where current_claim.app_id=authority.app_id and current_claim.tenant_id=authority.tenant_id
    and current_claim.environment=authority.environment
    and current_claim.owner_principal_id=authority.principal_id
    and current_claim.claim_id=(requested_completion->>'claim_id')::uuid for update;
  if not found or claim.status<>'LEASED' or claim.fence<>(requested_completion->>'fence')::bigint
    or claim.lease_expires_at<=now_at then
    raise exception using errcode='40001',message='QA_RETENTION_CLAIM_STALE'; end if;
  requested_outcome:=requested_completion->>'outcome';
  actual_outcome:=requested_outcome; actual_reason:=requested_completion->>'reason_code';
  if requested_outcome='PURGED' then
    select exists(select 1 from app_data_agent.qa_messages message
        where message.app_id=claim.app_id and message.tenant_id=claim.tenant_id
          and message.environment=claim.environment and message.owner_principal_id=claim.owner_principal_id
          and message.conversation_id=claim.conversation_id)
      or exists(select 1 from app_data_agent.workspace_run_bindings binding
        where binding.app_id=claim.app_id and binding.tenant_id=claim.tenant_id
          and binding.environment=claim.environment and binding.principal_id=claim.owner_principal_id
          and binding.conversation_id=claim.conversation_id)
      into has_references;
    if has_references then
      actual_outcome:='HELD'; actual_reason:='CONVERSATION_RETENTION_REFERENCES_HELD';
    else
      begin
        delete from app_data_agent.qa_conversations conversation
        where conversation.app_id=claim.app_id and conversation.tenant_id=claim.tenant_id
          and conversation.environment=claim.environment
          and conversation.owner_principal_id=claim.owner_principal_id
          and conversation.conversation_id=claim.conversation_id
          and conversation.deleted_at=claim.deleted_at and conversation.purge_after<=now_at;
        if not found then
          actual_outcome:='HELD'; actual_reason:='CONVERSATION_RETENTION_STATE_CHANGED'; end if;
      exception when foreign_key_violation then
        actual_outcome:='HELD'; actual_reason:='CONVERSATION_RETENTION_REFERENCES_HELD';
      end;
    end if;
  end if;
  update app_data_agent.qa_conversation_retention_claims current_claim set
    status=actual_outcome,reason_code=actual_reason,receipt_id=receipt_id_value,
    completed_at=now_at,updated_at=now_at
  where current_claim.app_id=claim.app_id and current_claim.tenant_id=claim.tenant_id
    and current_claim.environment=claim.environment and current_claim.claim_id=claim.claim_id;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','conversation-trash-retention-receipt@1.0.0',
    'receipt_id',receipt_id_value,'claim_id',claim.claim_id,
    'conversation_id',claim.conversation_id,'fence',claim.fence,
    'outcome',actual_outcome,'reason_code',actual_reason,'committed_at',now_at);
  return receipt;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_RETENTION_COMPLETION_INVALID';
end
$function$;
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
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010673_app_data_agent_qa_conversation_directory','sha256:a1f5306327147f2d1571c66d5eb7c286ce7da2c74a3183ca8a02ac179813d22a');
commit;
