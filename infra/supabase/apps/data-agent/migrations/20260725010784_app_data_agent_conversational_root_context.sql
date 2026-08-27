-- conversational_root_context_migration_checksum: sha256:8220cd1bc89728aab7091d5f7aa862995f6266f0d5c0d9ae5e5e780d8c3a01d6
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare task_definition text;acceptance_definition text;provider_lease_definition text;
  falcon_policy_definition text;qualification_completion_definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010782_app_data_agent_falcon24_analysis_publication')
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.load_provider_task_artifact(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.assert_provider_active_worker_lease(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.complete_falcon24_qualification_slot(jsonb)') is null
  then raise exception using errcode='P0001',
    message='CONVERSATIONAL_ROOT_CONTEXT_BASELINE_DRIFT'; end if;
  select procedure.prosrc into strict task_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict acceptance_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict provider_lease_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.assert_provider_active_worker_lease(jsonb)'::regprocedure;
  select procedure.prosrc into strict falcon_policy_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::regprocedure;
  select procedure.prosrc into strict qualification_completion_definition
    from pg_catalog.pg_proc procedure where procedure.oid=
      'app_data_agent.complete_falcon24_qualification_slot(jsonb)'::regprocedure;
  if pg_catalog.strpos(task_definition,'provider-task-artifact@1.0.0')=0
    or pg_catalog.strpos(acceptance_definition,
      $$'visible_message_refs',pg_catalog.jsonb_build_array(requested_command->>'event_id')$$)=0
    or pg_catalog.strpos(provider_lease_definition,$$'max_root_turns',2$$)=0
    or pg_catalog.strpos(falcon_policy_definition,$$'max_root_turns',1$$)=0
    or pg_catalog.strpos(qualification_completion_definition,
      $$execution_policy->>'max_root_turns' is distinct from '1'$$)=0
  then raise exception using errcode='P0001',
    message='CONVERSATIONAL_ROOT_CONTEXT_PREDECESSOR_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
do $patch_root_visible_message_refs$
declare definition text;repaired text;
  predecessor text;successor text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into strict definition;
  predecessor:=
    $$'visible_message_refs',pg_catalog.jsonb_build_array(requested_command->>'event_id')$$;
  successor:=
    $$'visible_message_refs',
        coalesce((select pg_catalog.jsonb_agg(prior.message_id order by
            prior.created_at,prior.message_id)
          from (select message.message_id,message.created_at
            from app_data_agent.qa_messages message
            where message.app_id=authority.app_id
              and message.tenant_id=authority.tenant_id
              and message.environment=authority.environment
              and message.conversation_id=requested_conversation_id
              and message.owner_principal_id=authority.principal_id
            order by message.created_at desc,message.message_id desc
            limit 63) prior),'[]'::jsonb)
          ||pg_catalog.jsonb_build_array(requested_command->>'event_id')$$;
  repaired:=pg_catalog.replace(definition,predecessor,successor);
  if repaired=definition or pg_catalog.strpos(repaired,successor)=0
  then raise exception using errcode='P0001',
    message='CONVERSATIONAL_ROOT_VISIBLE_REFS_REWRITE_MISSED'; end if;
  execute repaired;
end
$patch_root_visible_message_refs$;
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
      or (message.document->>'run_id' is not null
        and message.document->>'run_id'=''))
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          requested_document->'visible_messages'))<>
       (select pg_catalog.count(distinct message.document->>'message_id')
        from pg_catalog.jsonb_array_elements(requested_document->'visible_messages') message(document))
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
    'context_summary_ref',requested_document->'context_summary_ref');
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
  authoritative_document jsonb;visible_messages jsonb;selection_messages jsonb;
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
    conversation.resource_version
  into task_authority
  from app_data_agent.workspace_run_bindings binding
  join app_data_agent.run_events event
    on event.app_id=binding.app_id and event.tenant_id=binding.tenant_id
      and event.environment=binding.environment and event.run_id=binding.run_id
      and event.command_id=(lease_authority->>'command_id')::uuid
      and event.event_type='run.accepted'
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
    and conversation.resource_version=
      (requested_command#>>'{conversation_binding,resource_version}')::bigint
  for share of binding,message,event,conversation;
  if not found then raise exception using errcode='55000',
    message='PROVIDER_TASK_MESSAGE_NOT_FOUND_OR_FORBIDDEN'; end if;

  select pg_catalog.jsonb_agg(selected.document order by selected.created_at,selected.message_id),
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'message_id',selected.message_id,'content_hash',selected.document->>'content_hash')
      order by selected.created_at,selected.message_id)
  into visible_messages,selection_messages
  from (select recent.message_id,recent.created_at,
      pg_catalog.jsonb_build_object(
        'message_id',recent.message_id,'role',recent.role,'type',recent.message_type,
        'content',recent.content,'run_id',recent.run_id,
        'content_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
          'message_id',recent.message_id,'role',recent.role,'type',recent.message_type,
          'content',recent.content,'run_id',recent.run_id))) as document
    from (select candidate.message_id,candidate.created_at,candidate.role,
        candidate.message_type,candidate.content,candidate.run_id
      from app_data_agent.qa_messages candidate
      where candidate.app_id=task_authority.app_id
        and candidate.tenant_id=task_authority.tenant_id
        and candidate.environment=task_authority.environment
        and candidate.conversation_id=task_authority.conversation_id
        and candidate.owner_principal_id=task_authority.principal_id
        and (candidate.created_at,candidate.message_id)<=
          (task_authority.created_at,task_authority.message_id)
      order by candidate.created_at desc,candidate.message_id desc limit 64) recent) selected;

  selection_document:=pg_catalog.jsonb_build_object(
    'conversation_id',task_authority.conversation_id,
    'conversation_resource_version',task_authority.resource_version,
    'current_message_id',task_authority.message_id,
    'visible_messages',selection_messages,'context_summary_ref',null);
  authoritative_document:=pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact@2.0.0',
    'conversation_id',task_authority.conversation_id,
    'conversation_resource_version',task_authority.resource_version,
    'current_message',pg_catalog.jsonb_build_object(
      'message_id',task_authority.message_id,'content',task_authority.content),
    'visible_messages',visible_messages,'context_summary_ref',null,
    'context_selection_hash',app_data_agent.u2_canonical_sha256(selection_document));
  content_hash:=app_data_agent.u2_canonical_sha256(authoritative_document);
  authoritative_document:=authoritative_document||
    pg_catalog.jsonb_build_object('content_hash',content_hash);
  if not app_data_agent.provider_task_document_is_valid(authoritative_document,
      task_authority.message_id,task_authority.run_id,content_hash)
  then raise exception using errcode='22023',message='PROVIDER_TASK_ARTIFACT_DOCUMENT_INVALID'; end if;

  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id=task_authority.app_id and artifact.tenant_id=task_authority.tenant_id
    and artifact.environment=task_authority.environment and artifact.run_id=task_authority.run_id
    and artifact.artifact_id=task_authority.message_id
    and artifact.artifact_type='ProviderTaskArtifact' and artifact.revision=1 for share;
  if found then
    if artifact_record.content_hash<>content_hash
      or artifact_record.document_json<>authoritative_document
    then raise exception using errcode='23505',message='PROVIDER_TASK_ARTIFACT_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-task-artifact-commit-result@1.0.0','disposition','REPLAYED',
      'reference',pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
      'document',artifact_record.document_json,
      'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
  end if;
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
    'document',artifact_record.document_json,
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
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash']::text[])
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
    'reference',requested_command->'reference','document',artifact_record.document_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='PROVIDER_TASK_ARTIFACT_LOAD_INVALID';
end
$function$;
create or replace function app_data_agent.resolve_falcon24_run_execution_policy(
  requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; execution_policy jsonb; candidate_count bigint;
begin
  if requested_run_id is null then
    raise exception using errcode='22023',message='FALCON24_RUN_EXECUTION_POLICY_INPUT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  with candidates as (
    select pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind','CAMPAIGN',
      'campaign_id',campaign_run.campaign_id,'case_id',campaign_run.case_id,
      'run_variant',campaign_run.run_variant,'repetition',campaign_run.repetition,
      'policy_id',campaign.policy_id,'mode','FALCON24_STRICT','max_run_attempts',1,
      'max_provider_attempts_per_call',1,'max_root_turns',4,
      'max_text2sql_candidate_attempts',1,'analysis_repair_budget_per_category',0,
      'max_file_transfer_attempts',1,'allow_stage_recovery',false,'hold_on_failure',true) policy
    from app_data_agent.falcon24_acceptance_campaign_runs campaign_run
    join app_data_agent.falcon24_acceptance_campaigns campaign
      on campaign.app_id=campaign_run.app_id and campaign.tenant_id=campaign_run.tenant_id
      and campaign.environment=campaign_run.environment
      and campaign.principal_id=campaign_run.principal_id
      and campaign.campaign_id=campaign_run.campaign_id
    where campaign_run.app_id=authority.app_id and campaign_run.tenant_id=authority.tenant_id
      and campaign_run.environment=authority.environment
      and campaign_run.principal_id=authority.principal_id
      and campaign_run.run_id=requested_run_id
    union all
    select pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind','QUALIFICATION',
      'campaign_id',slot.qualification_id,'case_id',slot.case_id,
      'run_variant',slot.run_variant,'repetition',1,
      'policy_id','falcon24-strict-zero-retry@1.0.0','mode','FALCON24_STRICT',
      'max_run_attempts',1,'max_provider_attempts_per_call',1,'max_root_turns',4,
      'max_text2sql_candidate_attempts',1,'analysis_repair_budget_per_category',0,
      'max_file_transfer_attempts',1,'allow_stage_recovery',false,'hold_on_failure',true) policy
    from app_data_agent.falcon24_qualification_slots slot
    join app_data_agent.falcon24_qualifications qualification
      on qualification.app_id=slot.app_id and qualification.tenant_id=slot.tenant_id
      and qualification.environment=slot.environment
      and qualification.principal_id=slot.principal_id
      and qualification.qualification_id=slot.qualification_id
    where slot.app_id=authority.app_id and slot.tenant_id=authority.tenant_id
      and slot.environment=authority.environment and slot.principal_id=authority.principal_id
      and slot.run_id=requested_run_id), aggregate_candidates as (
    select pg_catalog.count(*) count_value,pg_catalog.jsonb_agg(policy) policies from candidates)
  select count_value,policies->0 into strict candidate_count,execution_policy
    from aggregate_candidates;
  if candidate_count>1 then
    raise exception using errcode='55000',message='FALCON24_RUN_EXECUTION_POLICY_AMBIGUOUS';
  end if;
  if candidate_count=0 then return null; end if;
  return execution_policy;
end
$function$;

do $root_policy_patch$
declare definition text;old_default text;new_default text;old_qualification text;
  new_qualification text;
begin
  old_default:=$$'max_root_turns',2$$;
  new_default:=$$'max_root_turns',4$$;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.assert_provider_active_worker_lease(jsonb)'::pg_catalog.regprocedure)
    into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_default,'')))
      /pg_catalog.length(old_default)<>1
  then raise exception using errcode='P0001',message='ROOT_DEFAULT_POLICY_PATCH_DRIFT'; end if;
  execute pg_catalog.replace(definition,old_default,new_default);

  old_qualification:=$$execution_policy->>'max_root_turns' is distinct from '1'$$;
  new_qualification:=$$execution_policy->>'max_root_turns' is distinct from '4'$$;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.complete_falcon24_qualification_slot(jsonb)'::pg_catalog.regprocedure)
    into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_qualification,'')))
      /pg_catalog.length(old_qualification)<>1
  then raise exception using errcode='P0001',message='ROOT_QUALIFICATION_POLICY_PATCH_DRIFT'; end if;
  execute pg_catalog.replace(definition,old_qualification,new_qualification);
end
$root_policy_patch$;
alter function app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_task_artifact(jsonb,jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_task_artifact(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;

revoke all on function app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)
  from public,data_agent_backend;
revoke all on function app_data_agent.commit_provider_task_artifact(jsonb,jsonb) from public;
revoke all on function app_data_agent.load_provider_task_artifact(jsonb) from public;
grant execute on function app_data_agent.commit_provider_task_artifact(jsonb,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.load_provider_task_artifact(jsonb)
  to data_agent_backend;

grant execute on function app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)
  to data_agent_provider_invocation_rpc_owner;
do $postconditions$
declare acceptance_definition text;commit_definition text;load_definition text;
  provider_lease_definition text;falcon_policy_definition text;
  qualification_completion_definition text;
begin
  select procedure.prosrc into strict acceptance_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict commit_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict load_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.load_provider_task_artifact(jsonb)'::regprocedure;
  select procedure.prosrc into strict provider_lease_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.assert_provider_active_worker_lease(jsonb)'::regprocedure;
  select procedure.prosrc into strict falcon_policy_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::regprocedure;
  select procedure.prosrc into strict qualification_completion_definition
    from pg_catalog.pg_proc procedure where procedure.oid=
      'app_data_agent.complete_falcon24_qualification_slot(jsonb)'::regprocedure;
  if pg_catalog.strpos(acceptance_definition,'limit 63')=0
    or pg_catalog.strpos(acceptance_definition,'visible_message_refs')=0
    or pg_catalog.strpos(commit_definition,'provider-task-artifact@2.0.0')=0
    or pg_catalog.strpos(commit_definition,'limit 64')=0
    or pg_catalog.strpos(commit_definition,'context_selection_hash')=0
    or pg_catalog.strpos(load_definition,'provider_task_document_is_valid')=0
    or pg_catalog.strpos(provider_lease_definition,$$'max_root_turns',4$$)=0
    or pg_catalog.strpos(provider_lease_definition,$$'max_root_turns',2$$)>0
    or pg_catalog.strpos(falcon_policy_definition,$$'max_root_turns',4$$)=0
    or pg_catalog.strpos(falcon_policy_definition,$$'max_root_turns',1$$)>0
    or pg_catalog.strpos(qualification_completion_definition,
      $$execution_policy->>'max_root_turns' is distinct from '4'$$)=0
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_provider_task_artifact(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.provider_task_document_is_valid(jsonb,uuid,uuid,text)','EXECUTE')
  then raise exception using errcode='P0001',
    message='CONVERSATIONAL_ROOT_CONTEXT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010784_app_data_agent_conversational_root_context',
  'sha256:8220cd1bc89728aab7091d5f7aa862995f6266f0d5c0d9ae5e5e780d8c3a01d6');
commit;
