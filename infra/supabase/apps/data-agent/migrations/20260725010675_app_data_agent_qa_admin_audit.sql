-- qa_admin_audit_migration_checksum: sha256:1a2e318e67746a82e07af35853780952b3572bb92f907005fdb92b7c48e22089
-- 10675 adds audited, read-only cross-owner Q&A inspection without weakening owner RLS.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='QA_ADMIN_AUDIT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='QA_ADMIN_AUDIT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010674_app_data_agent_adaptive_dispatch')
  then raise exception using errcode='P0001',message='QA_ADMIN_AUDIT_BASELINE_10674_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_qa_admin_audit_owner') then
    create role data_agent_qa_admin_audit_owner nologin noinherit nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010675_app_data_agent_qa_admin_audit','sha256:1a2e318e67746a82e07af35853780952b3572bb92f907005fdb92b7c48e22089');
create table app_data_agent.qa_admin_conversation_audit_receipts(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check(environment~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  receipt_id uuid not null,
  actor_principal_id uuid not null,
  actor_role text not null check(actor_role in('WORKSPACE_ADMIN','SUPER_ADMIN')),
  target_owner_principal_id uuid,
  resource_kind text not null check(resource_kind in(
    'DIRECTORY','CONVERSATION','MESSAGE','RUN','TRAJECTORY','SUBAGENT','ARTIFACT')),
  resource_id uuid,
  operation_kind text not null check(operation_kind in(
    'DIRECTORY_READ','CONVERSATION_READ','MESSAGES_READ','RUN_REPLAY',
    'TRAJECTORY_READ','SUBAGENT_READ','ARTIFACT_PREVIEW','ARTIFACT_EXPORT')),
  reason_code text not null check(reason_code in(
    'QA_ADMIN_DIRECTORY_REVIEW','QA_ADMIN_CONVERSATION_REVIEW','QA_ADMIN_MESSAGE_REVIEW',
    'QA_ADMIN_RUN_REPLAY','QA_ADMIN_TRAJECTORY_REVIEW','QA_ADMIN_SUBAGENT_REVIEW',
    'QA_ADMIN_ARTIFACT_PREVIEW','QA_ADMIN_ARTIFACT_EXPORT')),
  request_digest text not null check(request_digest~'^sha256:[0-9a-f]{64}$'),
  result_classification text not null check(result_classification in('AUTHORIZED','EMPTY')),
  occurred_at timestamptz not null,
  primary key(app_id,tenant_id,environment,receipt_id),
  check((operation_kind='DIRECTORY_READ') or target_owner_principal_id is not null),
  check((resource_kind='DIRECTORY' and resource_id is null)
    or (resource_kind<>'DIRECTORY' and resource_id is not null))
);

create index qa_admin_conversation_audit_actor_time
  on app_data_agent.qa_admin_conversation_audit_receipts(
    app_id,environment,actor_principal_id,occurred_at desc,receipt_id);
create index qa_admin_conversation_audit_target_time
  on app_data_agent.qa_admin_conversation_audit_receipts(
    app_id,tenant_id,environment,target_owner_principal_id,occurred_at desc,receipt_id);

create function app_data_agent.reject_qa_admin_audit_receipt_mutation()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='QA_ADMIN_AUDIT_RECEIPT_IMMUTABLE';
end
$function$;

create trigger qa_admin_conversation_audit_receipts_immutable
before update or delete on app_data_agent.qa_admin_conversation_audit_receipts
for each row execute function app_data_agent.reject_qa_admin_audit_receipt_mutation();

create function platform.resolve_qa_admin_audit_scope(requested_workspace_id uuid)
returns table(
  app_id uuid,tenant_id uuid,environment text,deployment_id uuid,
  actor_principal_id uuid,actor_role text
)
language plpgsql volatile security definer set search_path='' as $function$
declare context record; resolved record;
begin
  if requested_workspace_id is null then
    raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID';
  end if;
  select * into context from platform.current_backend_authority(false);
  if context.tenant_id<>requested_workspace_id then
    raise exception using errcode='42501',message='QA_ADMIN_ACCESS_DENIED';
  end if;
  select * into resolved from platform.resolve_workspace_authority(
    context.deployment_id,requested_workspace_id,context.principal_id,false);
  if resolved.workspace_role<>'WORKSPACE_ADMIN' and resolved.system_role<>'SUPER_ADMIN' then
    raise exception using errcode='42501',message='QA_ADMIN_ACCESS_DENIED';
  end if;
  return query select resolved.app_id,resolved.tenant_id,resolved.environment,
    resolved.deployment_id,resolved.principal_id,
    case when resolved.system_role='SUPER_ADMIN' then 'SUPER_ADMIN' else 'WORKSPACE_ADMIN' end;
end
$function$;

create function platform.qa_admin_audit_scope_matches(
  requested_app_id uuid,requested_tenant_id uuid,requested_environment text)
returns boolean language plpgsql volatile security definer set search_path='' as $function$
declare authority record;
begin
  select * into authority from platform.resolve_qa_admin_audit_scope(requested_tenant_id);
  return authority.app_id=requested_app_id and authority.tenant_id=requested_tenant_id
    and authority.environment=requested_environment;
exception when others then return false;
end
$function$;

create function app_data_agent.qa_admin_audit_receipt(
  request_document jsonb,requested_operation text,requested_reason text,
  requested_owner uuid,requested_resource_kind text,requested_resource_id uuid,
  requested_result_classification text default 'AUTHORIZED')
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; receipt_id uuid:=pg_catalog.gen_random_uuid(); occurred timestamptz:=pg_catalog.clock_timestamp();
  request_digest text;
begin
  select * into authority from platform.resolve_qa_admin_audit_scope((request_document->>'workspace_id')::uuid);
  request_digest:=app_data_agent.u2_canonical_sha256(request_document);
  insert into app_data_agent.qa_admin_conversation_audit_receipts(
    app_id,tenant_id,environment,receipt_id,actor_principal_id,actor_role,
    target_owner_principal_id,resource_kind,resource_id,operation_kind,reason_code,
    request_digest,result_classification,occurred_at)
  values(authority.app_id,authority.tenant_id,authority.environment,receipt_id,
    authority.actor_principal_id,authority.actor_role,requested_owner,requested_resource_kind,
    requested_resource_id,requested_operation,requested_reason,request_digest,
    requested_result_classification,occurred);
  return pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-audit-receipt-ref@1.0.0','receipt_id',receipt_id,
    'operation',requested_operation,'reason_code',requested_reason,
    'request_digest',request_digest,'occurred_at',occurred);
end
$function$;
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
create function app_data_agent.read_qa_admin_run_events(requested_query jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; requested_owner uuid; requested_conversation uuid; requested_run uuid;
  requested_operation text; requested_profile text; requested_task uuid; requested_after bigint;
  requested_limit integer; documents jsonb; next_sequence bigint; receipt jsonb; reason text; result_run uuid;
begin
  if requested_query is null or not app_data_agent.resolved_context_exact_keys(requested_query,array[
    'schema_version','operation','workspace_id','owner_principal_id','conversation_id','run_id',
    'profile_id','task_id','after_sequence','limit']::text[])
    or requested_query->>'schema_version'<>'qa-admin-run-events-query@1.0.0'
    or requested_query->>'operation' not in('RUN_REPLAY','TRAJECTORY_READ','SUBAGENT_READ')
  then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  select * into authority from platform.resolve_qa_admin_audit_scope((requested_query->>'workspace_id')::uuid);
  requested_owner:=(requested_query->>'owner_principal_id')::uuid;
  requested_conversation:=(requested_query->>'conversation_id')::uuid;
  requested_operation:=requested_query->>'operation';
  if requested_query->'run_id'<>'null'::jsonb then requested_run:=(requested_query->>'run_id')::uuid; end if;
  if requested_query->'profile_id'<>'null'::jsonb then requested_profile:=requested_query->>'profile_id'; end if;
  if requested_query->'task_id'<>'null'::jsonb then requested_task:=(requested_query->>'task_id')::uuid; end if;
  requested_after:=(requested_query->>'after_sequence')::bigint;
  requested_limit:=(requested_query->>'limit')::integer;
  if requested_after<0 or requested_limit not between 1 and 500
    or (requested_operation='RUN_REPLAY' and requested_run is null)
    or (requested_operation='SUBAGENT_READ' and (requested_run is null or requested_profile is null or requested_task is null))
    or (requested_operation<>'SUBAGENT_READ' and (requested_profile is not null or requested_task is not null))
  then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  if not exists(select 1 from app_data_agent.qa_conversations conversation
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment and conversation.owner_principal_id=requested_owner
      and conversation.conversation_id=requested_conversation)
  then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  if requested_run is not null and not exists(select 1 from app_data_agent.workspace_run_bindings binding
    where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
      and binding.environment=authority.environment and binding.principal_id=requested_owner
      and binding.conversation_id=requested_conversation and binding.run_id=requested_run)
  then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  if requested_operation='SUBAGENT_READ' and not exists(select 1 from app_data_agent.run_events event
    where event.app_id=authority.app_id and event.tenant_id=authority.tenant_id
      and event.environment=authority.environment and event.run_id=requested_run
      and event.event_document#>>'{payload,profile_id}'=requested_profile
      and event.event_document#>>'{payload,task_id}'=requested_task::text)
  then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  if requested_run is not null then
    select pg_catalog.coalesce(pg_catalog.jsonb_agg(event.event_document order by event.sequence),'[]'::jsonb),
      case when pg_catalog.count(*)=requested_limit then pg_catalog.max(event.sequence) else null end
    into documents,next_sequence from (select source.* from app_data_agent.run_events source
      where source.app_id=authority.app_id and source.tenant_id=authority.tenant_id
        and source.environment=authority.environment and source.run_id=requested_run
        and source.sequence>requested_after order by source.sequence limit requested_limit) event;
    result_run:=requested_run;
  else
    select pg_catalog.coalesce(pg_catalog.jsonb_agg(event.event_document
      order by event.created_at,event.run_id,event.sequence),'[]'::jsonb),null::bigint
    into documents,next_sequence from (select source.* from app_data_agent.run_events source
      join app_data_agent.workspace_run_bindings binding on binding.app_id=source.app_id
        and binding.tenant_id=source.tenant_id and binding.environment=source.environment
        and binding.run_id=source.run_id and binding.principal_id=requested_owner
      where source.app_id=authority.app_id and source.tenant_id=authority.tenant_id
        and source.environment=authority.environment and binding.conversation_id=requested_conversation
      order by source.created_at,source.run_id,source.sequence offset requested_after limit requested_limit) event;
  end if;
  reason:=case requested_operation when 'RUN_REPLAY' then 'QA_ADMIN_RUN_REPLAY'
    when 'TRAJECTORY_READ' then 'QA_ADMIN_TRAJECTORY_REVIEW' else 'QA_ADMIN_SUBAGENT_REVIEW' end;
  receipt:=app_data_agent.qa_admin_audit_receipt(requested_query,requested_operation,reason,requested_owner,
    case when requested_operation='TRAJECTORY_READ' then 'TRAJECTORY'
      when requested_operation='SUBAGENT_READ' then 'SUBAGENT' else 'RUN' end,
    pg_catalog.coalesce(requested_run,requested_conversation),
    case when documents='[]'::jsonb then 'EMPTY' else 'AUTHORIZED' end);
  return pg_catalog.jsonb_build_object('schema_version','qa-admin-run-events-raw-page@1.0.0',
    'workspace_id',authority.tenant_id,'owner_principal_id',requested_owner,
    'conversation_id',requested_conversation,'run_id',result_run,'read_only',true,
    'event_documents',documents,'next_sequence',next_sequence,'receipt',receipt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID';
end
$function$;

create function app_data_agent.authorize_qa_admin_artifact_access(requested_query jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; requested_owner uuid; requested_conversation uuid; requested_run uuid;
  requested_operation text; reference jsonb; receipt jsonb; reason text; artifact_document jsonb;
begin
  if requested_query is null or not app_data_agent.resolved_context_exact_keys(requested_query,array[
    'schema_version','operation','workspace_id','owner_principal_id','conversation_id','run_id','reference']::text[])
    or requested_query->>'schema_version'<>'qa-admin-artifact-access-query@1.0.0'
    or requested_query->>'operation' not in('ARTIFACT_PREVIEW','ARTIFACT_EXPORT')
    or not app_data_agent.resolved_context_exact_keys(requested_query->'reference',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash']::text[])
  then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  select * into authority from platform.resolve_qa_admin_audit_scope((requested_query->>'workspace_id')::uuid);
  requested_owner:=(requested_query->>'owner_principal_id')::uuid;
  requested_conversation:=(requested_query->>'conversation_id')::uuid;
  requested_run:=(requested_query->>'run_id')::uuid;
  requested_operation:=requested_query->>'operation'; reference:=requested_query->'reference';
  if reference->>'app_id'<>authority.app_id::text or reference->>'tenant_id'<>authority.tenant_id::text
    or reference->>'environment'<>authority.environment or reference->>'run_id'<>requested_run::text
    or not exists(select 1 from app_data_agent.workspace_run_bindings binding
      where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
        and binding.environment=authority.environment and binding.principal_id=requested_owner
        and binding.conversation_id=requested_conversation and binding.run_id=requested_run)
    or not exists(select 1 from app_data_agent.artifacts artifact
      where artifact.app_id=authority.app_id and artifact.tenant_id=authority.tenant_id
        and artifact.environment=authority.environment and artifact.run_id=requested_run
        and artifact.artifact_id=(reference->>'artifact_id')::uuid
        and artifact.artifact_type=reference->>'artifact_type'
        and artifact.revision=(reference->>'revision')::integer
        and artifact.content_hash=reference->>'content_hash')
  then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  select artifact.document_json into strict artifact_document
  from app_data_agent.artifacts artifact
  where artifact.app_id=authority.app_id and artifact.tenant_id=authority.tenant_id
    and artifact.environment=authority.environment and artifact.run_id=requested_run
    and artifact.artifact_id=(reference->>'artifact_id')::uuid
    and artifact.artifact_type=reference->>'artifact_type'
    and artifact.revision=(reference->>'revision')::integer
    and artifact.content_hash=reference->>'content_hash';
  reason:=case requested_operation when 'ARTIFACT_EXPORT' then 'QA_ADMIN_ARTIFACT_EXPORT'
    else 'QA_ADMIN_ARTIFACT_PREVIEW' end;
  receipt:=app_data_agent.qa_admin_audit_receipt(requested_query,requested_operation,reason,requested_owner,
    'ARTIFACT',(reference->>'artifact_id')::uuid,'AUTHORIZED');
  return pg_catalog.jsonb_build_object('schema_version','qa-admin-artifact-access-result@1.0.0',
    'workspace_id',authority.tenant_id,'owner_principal_id',requested_owner,
    'conversation_id',requested_conversation,'run_id',requested_run,'read_only',true,
    'reference',reference,'artifact_document',artifact_document,'receipt',receipt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID';
end
$function$;
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
commit;
