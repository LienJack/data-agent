create or replace function app_data_agent.conversation_context_summary_document_is_valid(
  requested_document jsonb,
  requested_artifact_id uuid,
  requested_run_id uuid,
  requested_content_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $function$
declare last_covered jsonb;
begin
  if requested_document is null
    or pg_catalog.jsonb_typeof(requested_document)<>'object'
    or requested_document->>'schema_version'<>'conversation-context-summary@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_document,array[
      'schema_version','summary_id','conversation_id','conversation_resource_version','run_id',
      'covered_through_message_id','covered_messages','summary','active_terms',
      'user_confirmed_constraints','content_hash']::text[])
    or requested_document->>'summary_id'<>requested_artifact_id::text
    or requested_document->>'run_id'<>requested_run_id::text
    or requested_document->>'content_hash'<>requested_content_hash
    or requested_content_hash<>app_data_agent.u2_canonical_sha256(
      requested_document-'content_hash')
    or (requested_document->>'conversation_resource_version')::bigint<1
    or pg_catalog.length(pg_catalog.btrim(requested_document->>'summary')) not between 1 and 50000
    or pg_catalog.jsonb_typeof(requested_document->'covered_messages')<>'array'
    or pg_catalog.jsonb_array_length(requested_document->'covered_messages') not between 1 and 48
    or requested_document->'active_terms'<>'[]'::jsonb
    or requested_document->'user_confirmed_constraints'<>'[]'::jsonb
  then return false; end if;
  if exists(select 1
      from pg_catalog.jsonb_array_elements(requested_document->'covered_messages')
        covered(document)
      where not app_data_agent.provider_json_object_has_exact_keys(
          covered.document,array['message_id','content_hash']::text[])
        or covered.document->>'message_id' is null
        or covered.document->>'content_hash'!~'^sha256:[0-9a-f]{64}$')
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          requested_document->'covered_messages'))<>
       (select pg_catalog.count(distinct covered.document->>'message_id')
        from pg_catalog.jsonb_array_elements(
          requested_document->'covered_messages') covered(document))
  then return false; end if;
  select covered.document into last_covered
  from pg_catalog.jsonb_array_elements(requested_document->'covered_messages')
    with ordinality covered(document,ordinal)
  order by covered.ordinal desc limit 1;
  return requested_document->>'covered_through_message_id'=last_covered->>'message_id';
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end
$function$;

create or replace function app_data_agent.provider_task_document_is_valid(
  requested_document jsonb,
  requested_artifact_id uuid,
  requested_run_id uuid,
  requested_content_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $function$
declare current_message jsonb;last_message jsonb;selection_document jsonb;
  summary_ref jsonb;
begin
  if requested_document is null
    or pg_catalog.jsonb_typeof(requested_document)<>'object'
    or requested_document->>'schema_version'<>'provider-task-artifact@2.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_document,array[
      'schema_version','conversation_id','conversation_resource_version','current_message',
      'visible_messages','context_summary_ref','context_selection_hash','content_hash']::text[])
    or requested_document->>'content_hash'<>requested_content_hash
    or requested_content_hash<>app_data_agent.u2_canonical_sha256(
      requested_document-'content_hash')
    or requested_document->>'context_selection_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(requested_document->'visible_messages')<>'array'
    or pg_catalog.jsonb_array_length(requested_document->'visible_messages') not between 1 and 64
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_document->'current_message',array['message_id','content']::text[])
    or requested_document#>>'{current_message,message_id}'<>requested_artifact_id::text
    or pg_catalog.length(pg_catalog.btrim(
      requested_document#>>'{current_message,content}')) not between 1 and 4000
  then return false; end if;

  summary_ref:=requested_document->'context_summary_ref';
  if summary_ref<>'null'::jsonb and (
      not app_data_agent.provider_json_object_has_exact_keys(summary_ref,array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
        'content_hash']::text[])
      or summary_ref->>'artifact_type'<>'ConversationContextSummary'
      or summary_ref->>'run_id'<>requested_run_id::text
      or (summary_ref->>'revision')::integer<>1
      or summary_ref->>'content_hash'!~'^sha256:[0-9a-f]{64}$')
  then return false; end if;

  if exists(select 1
    from pg_catalog.jsonb_array_elements(requested_document->'visible_messages')
      with ordinality message(document,ordinal)
    where not app_data_agent.provider_json_object_has_exact_keys(message.document,array[
        'message_id','role','type','content','run_id','content_hash']::text[])
      or message.document->>'role' not in ('user','agent')
      or message.document->>'type' not in ('text','table','report','hypothesis','error')
      or pg_catalog.length(pg_catalog.btrim(message.document->>'content')) not between 1 and 200000
      or message.document->>'content_hash'<>app_data_agent.u2_canonical_sha256(
        message.document-'content_hash')
      or message.document->>'content_hash'!~'^sha256:[0-9a-f]{64}$'
      or message.document->>'message_id' is null
      or (message.document->>'run_id' is not null and message.document->>'run_id'=''))
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          requested_document->'visible_messages'))<>
       (select pg_catalog.count(distinct message.document->>'message_id')
        from pg_catalog.jsonb_array_elements(requested_document->'visible_messages')
          message(document))
  then return false; end if;

  select message.document into last_message
  from pg_catalog.jsonb_array_elements(requested_document->'visible_messages')
    with ordinality message(document,ordinal)
  order by message.ordinal desc limit 1;
  current_message:=requested_document->'current_message';
  if last_message->>'message_id'<>current_message->>'message_id'
    or last_message->>'content'<>current_message->>'content'
    or last_message->>'role'<>'user'
    or last_message->>'type'<>'text'
    or last_message->>'run_id'<>requested_run_id::text
  then return false; end if;

  selection_document:=pg_catalog.jsonb_build_object(
    'conversation_id',requested_document->>'conversation_id',
    'conversation_resource_version',(requested_document->>'conversation_resource_version')::bigint,
    'current_message_id',requested_document#>>'{current_message,message_id}',
    'visible_messages',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'message_id',message.document->>'message_id',
        'content_hash',message.document->>'content_hash') order by message.ordinal)
      from pg_catalog.jsonb_array_elements(requested_document->'visible_messages')
        with ordinality message(document,ordinal)),
    'context_summary_ref',summary_ref);
  return requested_document->>'context_selection_hash'=
    app_data_agent.u2_canonical_sha256(selection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end
$function$;

create or replace function app_data_agent.commit_provider_task_artifact(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare lease_authority jsonb;task_authority record;
  artifact_record app_data_agent.artifacts%rowtype;
  summary_record app_data_agent.artifacts%rowtype;
  authoritative_document jsonb;visible_messages jsonb;selection_messages jsonb;
  selected_message_refs jsonb;covered_messages jsonb;summary_document jsonb;
  summary_ref jsonb:=null;summary_text text;summary_id uuid;summary_hash text;
  selection_document jsonb;content_hash text;committed_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','conversation_binding','context_summary_ref']::text[])
    or requested_command->>'schema_version'<>'provider-task-artifact-commit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'scope',array[
      'app_id','tenant_id','environment','workspace_id','principal_id']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command->'conversation_binding',array['conversation_id','resource_version']::text[])
    or requested_command->'context_summary_ref'<>'null'::jsonb
  then raise exception using errcode='22023',message='PROVIDER_TASK_ARTIFACT_COMMAND_INVALID'; end if;

  lease_authority:=app_data_agent.assert_provider_active_worker_lease(requested_lease);
  if requested_command->'scope'<>pg_catalog.jsonb_build_object(
      'app_id',lease_authority->'app_id','tenant_id',lease_authority->'tenant_id',
      'environment',lease_authority->'environment','workspace_id',lease_authority->'workspace_id',
      'principal_id',lease_authority->'principal_id')
    or requested_command->>'run_id'<>lease_authority->>'run_id'
  then raise exception using errcode='40001',message='PROVIDER_TASK_ARTIFACT_LEASE_MISMATCH'; end if;

  select binding.app_id,binding.tenant_id,binding.environment,binding.run_id,
    binding.conversation_id,binding.principal_id,message.message_id,message.content,
    message.role,message.message_type,message.created_at,event.event_id,event.command_id,
    (receipt.effective_config_json#>>'{conversation_binding,resource_version}')::bigint
      as resource_version
  into task_authority
  from app_data_agent.workspace_run_bindings binding
  join app_data_agent.run_events event
    on event.app_id=binding.app_id and event.tenant_id=binding.tenant_id
      and event.environment=binding.environment and event.run_id=binding.run_id
      and event.command_id=(lease_authority->>'command_id')::uuid
      and event.event_type='run.accepted'
  join app_data_agent.effective_run_config_receipts receipt
    on receipt.app_id=binding.app_id and receipt.tenant_id=binding.tenant_id
      and receipt.environment=binding.environment and receipt.run_id=binding.run_id
      and receipt.config_id=(requested_lease#>>'{payload,effective_config_ref,config_id}')::uuid
      and receipt.config_revision=
        (requested_lease#>>'{payload,effective_config_ref,config_revision}')::bigint
      and receipt.config_hash=requested_lease#>>'{payload,effective_config_ref,config_hash}'
      and receipt.effective_config_json->'conversation_binding'=
        requested_command->'conversation_binding'
  join app_data_agent.qa_conversations conversation
    on conversation.app_id=binding.app_id and conversation.tenant_id=binding.tenant_id
      and conversation.environment=binding.environment
      and conversation.conversation_id=binding.conversation_id
      and conversation.owner_principal_id=binding.principal_id
      and conversation.deleted_at is null
  join app_data_agent.qa_messages message
    on message.app_id=binding.app_id and message.tenant_id=binding.tenant_id
      and message.environment=binding.environment
      and message.conversation_id=binding.conversation_id
      and message.message_id=event.event_id
      and message.owner_principal_id=binding.principal_id
      and message.run_id=binding.run_id and message.role='user' and message.message_type='text'
  where binding.app_id=(lease_authority->>'app_id')::uuid
    and binding.tenant_id=(lease_authority->>'tenant_id')::uuid
    and binding.environment=lease_authority->>'environment'
    and binding.run_id=(lease_authority->>'run_id')::uuid
    and binding.principal_id=(lease_authority->>'principal_id')::uuid
    and binding.conversation_id=
      (requested_command#>>'{conversation_binding,conversation_id}')::uuid
  for share of binding,message,event,receipt,conversation;
  if not found then raise exception using errcode='55000',
    message='PROVIDER_TASK_MESSAGE_NOT_FOUND_OR_FORBIDDEN'; end if;

  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id=task_authority.app_id and artifact.tenant_id=task_authority.tenant_id
    and artifact.environment=task_authority.environment and artifact.run_id=task_authority.run_id
    and artifact.artifact_id=task_authority.message_id
    and artifact.artifact_type='ProviderTaskArtifact' and artifact.revision=1 for share;
  if found then
    if not app_data_agent.provider_task_document_is_valid(artifact_record.document_json,
        artifact_record.artifact_id,artifact_record.run_id,artifact_record.content_hash)
      or artifact_record.document_json->>'conversation_id'<>task_authority.conversation_id::text
      or artifact_record.document_json#>>'{current_message,message_id}'<>
        task_authority.message_id::text
    then raise exception using errcode='23505',message='PROVIDER_TASK_ARTIFACT_CONFLICT'; end if;
    if artifact_record.document_json->'context_summary_ref'<>'null'::jsonb then
      select summary.* into strict summary_record from app_data_agent.artifacts summary
      where summary.app_id=artifact_record.app_id and summary.tenant_id=artifact_record.tenant_id
        and summary.environment=artifact_record.environment and summary.run_id=artifact_record.run_id
        and summary.artifact_id=
          (artifact_record.document_json#>>'{context_summary_ref,artifact_id}')::uuid
        and summary.artifact_type='ConversationContextSummary'
        and summary.revision=1 and summary.content_hash=
          artifact_record.document_json#>>'{context_summary_ref,content_hash}' and summary.is_active;
      if not app_data_agent.conversation_context_summary_document_is_valid(
          summary_record.document_json,summary_record.artifact_id,summary_record.run_id,
          summary_record.content_hash)
      then raise exception using errcode='23505',message='PROVIDER_TASK_SUMMARY_CONFLICT'; end if;
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-task-artifact-commit-result@1.0.0','disposition','REPLAYED',
      'reference',pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
      'document',artifact_record.document_json,
      'context_summary',case when summary_record.artifact_id is null then null
        else summary_record.document_json end,
      'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
  end if;

  with recent as (
    select candidate.message_id,candidate.created_at,candidate.role,
      candidate.message_type,candidate.content,candidate.run_id
    from app_data_agent.qa_messages candidate
    where candidate.app_id=task_authority.app_id
      and candidate.tenant_id=task_authority.tenant_id
      and candidate.environment=task_authority.environment
      and candidate.conversation_id=task_authority.conversation_id
      and candidate.owner_principal_id=task_authority.principal_id
      and (candidate.created_at,candidate.message_id)<=
        (task_authority.created_at,task_authority.message_id)
    order by candidate.created_at desc,candidate.message_id desc limit 64
  ), ordered as (
    select recent.*,row_number() over(order by recent.created_at,recent.message_id) ordinal,
      count(*) over() total_count,
      pg_catalog.jsonb_build_object(
        'message_id',recent.message_id,'role',recent.role,'type',recent.message_type,
        'content',recent.content,'run_id',recent.run_id,
        'content_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
          'message_id',recent.message_id,'role',recent.role,'type',recent.message_type,
          'content',recent.content,'run_id',recent.run_id))) document
    from recent
  ), cutoff as (
    select case when bounds.total_count<=16 then 1
      else coalesce((select pg_catalog.max(candidate.ordinal) from ordered candidate
          where candidate.ordinal<=bounds.total_count-15 and candidate.role='user'),
        bounds.total_count-15) end as visible_start
    from (select pg_catalog.max(ordered.total_count) total_count from ordered) bounds
  )
  select
    coalesce(pg_catalog.jsonb_agg(ordered.document order by ordered.ordinal)
      filter(where ordered.ordinal>=cutoff.visible_start),'[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'message_id',ordered.message_id,'content_hash',ordered.document->>'content_hash')
      order by ordered.ordinal)
      filter(where ordered.ordinal>=cutoff.visible_start),'[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'message_id',ordered.message_id,'content_hash',ordered.document->>'content_hash')
      order by ordered.ordinal)
      filter(where ordered.ordinal<cutoff.visible_start),'[]'::jsonb),
    pg_catalog.string_agg(pg_catalog.format('[%s/%s] %s',ordered.role,
        ordered.message_type,pg_catalog.left(pg_catalog.regexp_replace(
          ordered.content,E'[\\r\\n\\t ]+',' ','g'),900)),E'\n' order by ordered.ordinal)
      filter(where ordered.ordinal<cutoff.visible_start),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ordered.message_id::text)
      order by ordered.ordinal),'[]'::jsonb)
  into visible_messages,selection_messages,covered_messages,summary_text,selected_message_refs
  from ordered cross join cutoff;

  if selected_message_refs<>requested_lease#>'{payload,visible_message_refs}' then
    raise exception using errcode='40001',message='PROVIDER_TASK_VISIBLE_REFS_MISMATCH'; end if;

  if pg_catalog.jsonb_array_length(covered_messages)>0 then
    summary_id:=app_data_agent.u6_uuid_v5(task_authority.message_id,
      pg_catalog.convert_to('conversation-context-summary@1.0.0|'||
        task_authority.conversation_id::text||'|'||task_authority.resource_version::text||'|'||
        covered_messages::text,'UTF8'));
    summary_document:=pg_catalog.jsonb_build_object(
      'schema_version','conversation-context-summary@1.0.0','summary_id',summary_id,
      'conversation_id',task_authority.conversation_id,
      'conversation_resource_version',task_authority.resource_version,
      'run_id',task_authority.run_id,
      'covered_through_message_id',covered_messages#>>'{-1,message_id}',
      'covered_messages',covered_messages,'summary',summary_text,
      'active_terms','[]'::jsonb,'user_confirmed_constraints','[]'::jsonb);
    summary_hash:=app_data_agent.u2_canonical_sha256(summary_document);
    summary_document:=summary_document||pg_catalog.jsonb_build_object('content_hash',summary_hash);
    if not app_data_agent.conversation_context_summary_document_is_valid(summary_document,
        summary_id,task_authority.run_id,summary_hash)
    then raise exception using errcode='22023',message='CONVERSATION_CONTEXT_SUMMARY_INVALID'; end if;
    select summary.* into summary_record from app_data_agent.artifacts summary
    where summary.app_id=task_authority.app_id and summary.tenant_id=task_authority.tenant_id
      and summary.environment=task_authority.environment and summary.run_id=task_authority.run_id
      and summary.artifact_id=summary_id and summary.artifact_type='ConversationContextSummary'
      and summary.revision=1 for share;
    if found then
      if summary_record.content_hash<>summary_hash
        or summary_record.document_json<>summary_document
      then raise exception using errcode='23505',message='PROVIDER_TASK_SUMMARY_CONFLICT'; end if;
    else
      insert into app_data_agent.artifacts(
        app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
        document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at)
      values(task_authority.app_id,task_authority.tenant_id,task_authority.environment,
        task_authority.run_id,summary_id,'ConversationContextSummary',1,summary_hash,
        summary_document,(lease_authority->>'worker_fence')::bigint,true,null,null,
        pg_catalog.clock_timestamp()) returning * into summary_record;
    end if;
    summary_ref:=pg_catalog.jsonb_build_object(
      'artifact_id',summary_record.artifact_id,'artifact_type','ConversationContextSummary',
      'app_id',summary_record.app_id,'tenant_id',summary_record.tenant_id,
      'environment',summary_record.environment,'run_id',summary_record.run_id,
      'revision',summary_record.revision,'content_hash',summary_record.content_hash);
  end if;

  selection_document:=pg_catalog.jsonb_build_object(
    'conversation_id',task_authority.conversation_id,
    'conversation_resource_version',task_authority.resource_version,
    'current_message_id',task_authority.message_id,
    'visible_messages',selection_messages,'context_summary_ref',summary_ref);
  authoritative_document:=pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact@2.0.0',
    'conversation_id',task_authority.conversation_id,
    'conversation_resource_version',task_authority.resource_version,
    'current_message',pg_catalog.jsonb_build_object(
      'message_id',task_authority.message_id,'content',task_authority.content),
    'visible_messages',visible_messages,'context_summary_ref',summary_ref,
    'context_selection_hash',app_data_agent.u2_canonical_sha256(selection_document));
  content_hash:=app_data_agent.u2_canonical_sha256(authoritative_document);
  authoritative_document:=authoritative_document||
    pg_catalog.jsonb_build_object('content_hash',content_hash);
  if not app_data_agent.provider_task_document_is_valid(authoritative_document,
      task_authority.message_id,task_authority.run_id,content_hash)
  then raise exception using errcode='22023',message='PROVIDER_TASK_ARTIFACT_DOCUMENT_INVALID'; end if;

  committed_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
    document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at)
  values(task_authority.app_id,task_authority.tenant_id,task_authority.environment,
    task_authority.run_id,task_authority.message_id,'ProviderTaskArtifact',1,content_hash,
    authoritative_document,(lease_authority->>'worker_fence')::bigint,true,null,null,committed_at)
  returning * into artifact_record;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact-commit-result@1.0.0','disposition','CREATED',
    'reference',pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
    'document',artifact_record.document_json,'context_summary',summary_document,
    'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='PROVIDER_TASK_ARTIFACT_COMMAND_INVALID';
end
$function$;

create or replace function app_data_agent.load_provider_task_artifact(requested_command jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare authority record;artifact_record app_data_agent.artifacts%rowtype;
  summary_record app_data_agent.artifacts%rowtype;
  legacy_valid boolean:=false;v2_valid boolean:=false;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','reference']::text[])
    or requested_command->>'schema_version'<>'provider-task-artifact-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'scope',array[
      'app_id','tenant_id','environment','workspace_id','principal_id']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'reference',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
      'content_hash']::text[])
    or requested_command#>>'{reference,artifact_type}'<>'ProviderTaskArtifact'
  then raise exception using errcode='22023',message='PROVIDER_TASK_ARTIFACT_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  if requested_command->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,
    'environment',authority.environment,'workspace_id',authority.tenant_id,
    'principal_id',authority.principal_id)
  then raise exception using errcode='42501',
    message='PROVIDER_TASK_ARTIFACT_NOT_FOUND_OR_FORBIDDEN'; end if;
  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id=authority.app_id and artifact.tenant_id=authority.tenant_id
    and artifact.environment=authority.environment
    and artifact.run_id=(requested_command->>'run_id')::uuid
    and artifact.artifact_id=(requested_command#>>'{reference,artifact_id}')::uuid
    and artifact.artifact_type='ProviderTaskArtifact'
    and artifact.revision=(requested_command#>>'{reference,revision}')::integer
    and artifact.content_hash=requested_command#>>'{reference,content_hash}' and artifact.is_active;
  if found and artifact_record.document_json->>'schema_version'='provider-task-artifact@1.0.0' then
    legacy_valid:=app_data_agent.provider_json_object_has_exact_keys(
        artifact_record.document_json,array[
          'schema_version','message_id','accepted_event_id','conversation_id',
          'conversation_resource_version','command_id','run_id','message_role',
          'message_type','question','content_hash']::text[])
      and artifact_record.document_json->>'message_id'=artifact_record.artifact_id::text
      and artifact_record.document_json->>'accepted_event_id'=
        artifact_record.document_json->>'message_id'
      and artifact_record.document_json->>'run_id'=artifact_record.run_id::text
      and artifact_record.document_json->>'message_role'='user'
      and artifact_record.document_json->>'message_type'='text'
      and artifact_record.content_hash=
        app_data_agent.u2_canonical_sha256(artifact_record.document_json-'content_hash');
  elsif found then
    v2_valid:=app_data_agent.provider_task_document_is_valid(artifact_record.document_json,
      artifact_record.artifact_id,artifact_record.run_id,artifact_record.content_hash);
    if v2_valid and artifact_record.document_json->'context_summary_ref'<>'null'::jsonb then
      select summary.* into summary_record from app_data_agent.artifacts summary
      where summary.app_id=artifact_record.app_id and summary.tenant_id=artifact_record.tenant_id
        and summary.environment=artifact_record.environment and summary.run_id=artifact_record.run_id
        and summary.artifact_id=
          (artifact_record.document_json#>>'{context_summary_ref,artifact_id}')::uuid
        and summary.artifact_type='ConversationContextSummary'
        and summary.revision=1 and summary.content_hash=
          artifact_record.document_json#>>'{context_summary_ref,content_hash}' and summary.is_active;
      v2_valid:=found and app_data_agent.conversation_context_summary_document_is_valid(
        summary_record.document_json,summary_record.artifact_id,summary_record.run_id,
        summary_record.content_hash);
    end if;
  end if;
  if not found or requested_command->'reference'<>pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash)
    or not (legacy_valid or v2_valid)
  then raise exception using errcode='42501',
    message='PROVIDER_TASK_ARTIFACT_NOT_FOUND_OR_FORBIDDEN'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact-load-result@1.0.0',
    'reference',requested_command->'reference','document',artifact_record.document_json,
    'context_summary',case when summary_record.artifact_id is null then null
      else summary_record.document_json end);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='PROVIDER_TASK_ARTIFACT_LOAD_INVALID';
end
$function$;
