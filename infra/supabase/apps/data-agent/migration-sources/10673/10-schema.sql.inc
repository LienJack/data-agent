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
