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
