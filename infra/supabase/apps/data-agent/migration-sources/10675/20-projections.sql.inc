create function app_data_agent.qa_admin_conversation_document(
  conversation app_data_agent.qa_conversations,requested_query text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare message_count bigint; live_state text:='IDLE'; latest_status text; snippet text; effective_archived timestamptz;
begin
  select pg_catalog.count(*) into message_count from app_data_agent.qa_messages message
  where message.app_id=conversation.app_id and message.tenant_id=conversation.tenant_id
    and message.environment=conversation.environment and message.owner_principal_id=conversation.owner_principal_id
    and message.conversation_id=conversation.conversation_id;
  select run.status into latest_status from app_data_agent.workspace_run_bindings binding
  join app_data_agent.runs run on run.app_id=binding.app_id and run.tenant_id=binding.tenant_id
    and run.environment=binding.environment and run.run_id=binding.run_id and run.principal_id=binding.principal_id
  where binding.app_id=conversation.app_id and binding.tenant_id=conversation.tenant_id
    and binding.environment=conversation.environment and binding.principal_id=conversation.owner_principal_id
    and binding.conversation_id=conversation.conversation_id
  order by run.updated_at desc,run.run_id desc limit 1;
  live_state:=case latest_status when 'QUEUED' then 'RUNNING' when 'RUNNING' then 'RUNNING'
    when 'WAITING' then 'WAITING_ANSWER' when 'FAILED' then 'FAILED'
    when 'COMPLETED' then 'COMPLETED' when 'SUCCEEDED' then 'COMPLETED' else 'IDLE' end;
  if requested_query is not null then
    select pg_catalog.left(pg_catalog.regexp_replace(message.content,E'[\\n\\r\\t]+',' ','g'),180)
    into snippet from app_data_agent.qa_messages message
    where message.app_id=conversation.app_id and message.tenant_id=conversation.tenant_id
      and message.environment=conversation.environment and message.owner_principal_id=conversation.owner_principal_id
      and message.conversation_id=conversation.conversation_id and message.content ilike '%'||requested_query||'%'
    order by message.created_at desc,message.message_id desc limit 1;
  end if;
  select pg_catalog.coalesce(conversation.archived_at,folder.archived_at) into effective_archived
  from (select 1) singleton left join app_data_agent.qa_conversation_folders folder
    on folder.app_id=conversation.app_id and folder.tenant_id=conversation.tenant_id
    and folder.environment=conversation.environment and folder.owner_principal_id=conversation.owner_principal_id
    and folder.folder_id=conversation.folder_id;
  return pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation@2.0.0','workspace_id',conversation.tenant_id,
    'conversation_id',conversation.conversation_id,'owner_principal_id',conversation.owner_principal_id,
    'title',conversation.title,'datasource_id',conversation.datasource_id,'model_id',conversation.model_id,
    'model_profile_id',conversation.model_profile_id,'resource_version',conversation.resource_version,
    'message_count',message_count,'folder_id',conversation.folder_id,'sort_order',conversation.sort_order,
    'lifecycle',case when conversation.deleted_at is not null then 'TRASH'
      when effective_archived is not null then 'ARCHIVED' else 'ACTIVE' end,
    'archived_at',effective_archived,'deleted_at',conversation.deleted_at,'purge_after',conversation.purge_after,
    'live_state',live_state,'unread_completed',false,'search_snippet',snippet,
    'created_at',conversation.created_at,'updated_at',conversation.updated_at);
end
$function$;

create function app_data_agent.read_qa_admin_directory(requested_query jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; owner_filter uuid; folder_filter uuid; lifecycle_filter text; live_filter text;
  search_query text; requested_limit integer; requested_offset integer; total bigint; next_cursor text;
  folders jsonb; conversations jsonb; receipt jsonb;
begin
  if requested_query is null or not app_data_agent.resolved_context_exact_keys(requested_query,array[
    'schema_version','workspace_id','owner_principal_id','folder_id','lifecycle','live_state','query','cursor','limit']::text[])
    or requested_query->>'schema_version'<>'qa-admin-directory-query@1.0.0'
    or pg_catalog.jsonb_typeof(requested_query->'limit')<>'number'
  then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  select * into authority from platform.resolve_qa_admin_audit_scope((requested_query->>'workspace_id')::uuid);
  if requested_query->'owner_principal_id'<>'null'::jsonb then owner_filter:=(requested_query->>'owner_principal_id')::uuid; end if;
  if requested_query->'folder_id'<>'null'::jsonb then folder_filter:=(requested_query->>'folder_id')::uuid; end if;
  if requested_query->'lifecycle'<>'null'::jsonb then lifecycle_filter:=requested_query->>'lifecycle'; end if;
  if lifecycle_filter is not null and lifecycle_filter not in('ACTIVE','ARCHIVED','TRASH') then
    raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  if requested_query->'live_state'<>'null'::jsonb then live_filter:=requested_query->>'live_state'; end if;
  if live_filter is not null and live_filter not in('IDLE','RUNNING','WAITING_APPROVAL','WAITING_ANSWER','FAILED','COMPLETED') then
    raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  if requested_query->'query'<>'null'::jsonb then search_query:=pg_catalog.btrim(requested_query->>'query'); end if;
  if search_query is not null and pg_catalog.length(search_query) not between 1 and 120 then
    raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  requested_limit:=(requested_query->>'limit')::integer;
  if requested_limit not between 1 and 50 then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  requested_offset:=case when requested_query->'cursor'='null'::jsonb then 0 else (requested_query->>'cursor')::integer end;
  if requested_offset not between 0 and 100000 then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;

  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-folder@1.0.0','workspace_id',folder.tenant_id,
    'folder_id',folder.folder_id,'owner_principal_id',folder.owner_principal_id,'name',folder.name,
    'sort_order',folder.sort_order,'resource_version',folder.resource_version,'archived_at',folder.archived_at,
    'created_at',folder.created_at,'updated_at',folder.updated_at)
    order by folder.owner_principal_id,folder.sort_order,folder.folder_id),'[]'::jsonb)
  into folders from app_data_agent.qa_conversation_folders folder
  where folder.app_id=authority.app_id and folder.tenant_id=authority.tenant_id
    and folder.environment=authority.environment and (owner_filter is null or folder.owner_principal_id=owner_filter)
    and (folder_filter is null or folder.folder_id=folder_filter)
    and (lifecycle_filter is null or (lifecycle_filter='ARCHIVED')=(folder.archived_at is not null))
    and (search_query is null or folder.name ilike '%'||search_query||'%');

  with eligible as(
    select conversation.*,app_data_agent.qa_admin_conversation_document(conversation,search_query) document
    from app_data_agent.qa_conversations conversation
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment
      and (owner_filter is null or conversation.owner_principal_id=owner_filter)
      and (folder_filter is null or conversation.folder_id=folder_filter)
      and (search_query is null or conversation.title ilike '%'||search_query||'%'
        or exists(select 1 from app_data_agent.qa_conversation_folders folder
          where folder.app_id=conversation.app_id and folder.tenant_id=conversation.tenant_id
            and folder.environment=conversation.environment and folder.owner_principal_id=conversation.owner_principal_id
            and folder.folder_id=conversation.folder_id and folder.name ilike '%'||search_query||'%')
        or exists(select 1 from app_data_agent.qa_messages message
          where message.app_id=conversation.app_id and message.tenant_id=conversation.tenant_id
            and message.environment=conversation.environment and message.owner_principal_id=conversation.owner_principal_id
            and message.conversation_id=conversation.conversation_id and message.content ilike '%'||search_query||'%'))),
  filtered as(select * from eligible where (lifecycle_filter is null or document->>'lifecycle'=lifecycle_filter)
    and (live_filter is null or document->>'live_state'=live_filter)),
  page as(select * from filtered order by updated_at desc,conversation_id offset requested_offset limit requested_limit)
  select (select pg_catalog.count(*) from filtered),
    pg_catalog.coalesce(pg_catalog.jsonb_agg(document order by updated_at desc,conversation_id),'[]'::jsonb)
  into total,conversations from page;
  if requested_offset+requested_limit<total then next_cursor:=(requested_offset+requested_limit)::text; end if;
  receipt:=app_data_agent.qa_admin_audit_receipt(requested_query,'DIRECTORY_READ','QA_ADMIN_DIRECTORY_REVIEW',
    owner_filter,'DIRECTORY',null,case when total=0 then 'EMPTY' else 'AUTHORIZED' end);
  return pg_catalog.jsonb_build_object('schema_version','qa-admin-directory-page@1.0.0',
    'workspace_id',authority.tenant_id,'read_only',true,'folders',folders,'conversations',conversations,
    'next_cursor',next_cursor,'receipt',receipt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID';
end
$function$;

create function app_data_agent.read_qa_admin_conversation(requested_query jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; conversation app_data_agent.qa_conversations%rowtype; requested_owner uuid;
  requested_conversation uuid; requested_limit integer; requested_offset integer; total bigint;
  messages jsonb; next_cursor text; receipt jsonb; operation text; reason text;
begin
  if requested_query is null or not app_data_agent.resolved_context_exact_keys(requested_query,array[
    'schema_version','operation','workspace_id','owner_principal_id','conversation_id','cursor','limit']::text[])
    or requested_query->>'schema_version'<>'qa-admin-conversation-query@1.0.0'
    or requested_query->>'operation' not in('CONVERSATION_READ','MESSAGES_READ')
  then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  select * into authority from platform.resolve_qa_admin_audit_scope((requested_query->>'workspace_id')::uuid);
  requested_owner:=(requested_query->>'owner_principal_id')::uuid;
  requested_conversation:=(requested_query->>'conversation_id')::uuid;
  requested_limit:=(requested_query->>'limit')::integer;
  requested_offset:=case when requested_query->'cursor'='null'::jsonb then 0 else (requested_query->>'cursor')::integer end;
  if requested_limit not between 1 and 200 or requested_offset not between 0 and 100000 then
    raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  select * into conversation from app_data_agent.qa_conversations candidate
  where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
    and candidate.environment=authority.environment and candidate.owner_principal_id=requested_owner
    and candidate.conversation_id=requested_conversation;
  if not found then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema_version','workspace-conversation-message@1.0.0','workspace_id',message.tenant_id,
    'conversation_id',message.conversation_id,'message_id',message.message_id,'role',message.role,
    'content',message.content,'type',message.message_type,'run_id',message.run_id,
    'metadata',message.metadata,'created_at',message.created_at)
    order by message.created_at,message.message_id),'[]'::jsonb)
  into messages from (select * from app_data_agent.qa_messages candidate
    where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
      and candidate.environment=authority.environment and candidate.owner_principal_id=requested_owner
      and candidate.conversation_id=requested_conversation
    order by candidate.created_at,candidate.message_id offset requested_offset limit requested_limit) message;
  select pg_catalog.count(*) into total from app_data_agent.qa_messages candidate
    where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
      and candidate.environment=authority.environment and candidate.owner_principal_id=requested_owner
      and candidate.conversation_id=requested_conversation;
  if requested_offset+requested_limit<total then next_cursor:=(requested_offset+requested_limit)::text; end if;
  operation:=requested_query->>'operation';
  reason:=case operation when 'MESSAGES_READ' then 'QA_ADMIN_MESSAGE_REVIEW' else 'QA_ADMIN_CONVERSATION_REVIEW' end;
  receipt:=app_data_agent.qa_admin_audit_receipt(requested_query,operation,reason,requested_owner,
    case when operation='MESSAGES_READ' then 'MESSAGE' else 'CONVERSATION' end,requested_conversation,
    case when total=0 then 'EMPTY' else 'AUTHORIZED' end);
  return pg_catalog.jsonb_build_object('schema_version','qa-admin-conversation-page@1.0.0',
    'workspace_id',authority.tenant_id,'owner_principal_id',requested_owner,'read_only',true,
    'conversation',app_data_agent.qa_admin_conversation_document(conversation,null),
    'messages',messages,'next_cursor',next_cursor,'receipt',receipt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID';
end
$function$;
