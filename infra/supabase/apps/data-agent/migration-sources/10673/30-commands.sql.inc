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
