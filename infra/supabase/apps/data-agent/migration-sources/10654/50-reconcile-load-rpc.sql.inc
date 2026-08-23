create function app_data_agent.commit_provider_task_artifact(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  task_authority record;
  artifact_record app_data_agent.artifacts%rowtype;
  authoritative_document jsonb;
  content_hash text;
  committed_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','conversation_binding'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-task-artifact-commit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'conversation_binding',array[
        'conversation_id','resource_version'
      ]::text[])
  then
    raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_COMMAND_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',lease_authority -> 'app_id','tenant_id',lease_authority -> 'tenant_id',
      'environment',lease_authority -> 'environment','workspace_id',lease_authority -> 'workspace_id',
      'principal_id',lease_authority -> 'principal_id')
    or requested_command ->> 'run_id' <> lease_authority ->> 'run_id'
  then
    raise exception using errcode = '40001', message = 'PROVIDER_TASK_ARTIFACT_LEASE_MISMATCH';
  end if;
  select binding.app_id,binding.tenant_id,binding.environment,binding.run_id,
    binding.conversation_id,binding.principal_id,message.message_id,message.content,
    message.role,message.message_type,event.event_id,event.command_id,
    conversation.resource_version
  into task_authority
  from app_data_agent.workspace_run_bindings binding
  join app_data_agent.run_events event
    on event.app_id = binding.app_id and event.tenant_id = binding.tenant_id
   and event.environment = binding.environment and event.run_id = binding.run_id
   and event.command_id = (lease_authority ->> 'command_id')::uuid
   and event.event_type = 'run.accepted'
  join app_data_agent.qa_conversations conversation
    on conversation.app_id = binding.app_id and conversation.tenant_id = binding.tenant_id
   and conversation.environment = binding.environment
   and conversation.conversation_id = binding.conversation_id
   and conversation.owner_principal_id = binding.principal_id
  join app_data_agent.qa_messages message
    on message.app_id = binding.app_id and message.tenant_id = binding.tenant_id
   and message.environment = binding.environment
   and message.conversation_id = binding.conversation_id
   and message.message_id = event.event_id
   and message.owner_principal_id = binding.principal_id
   and message.run_id = binding.run_id and message.role = 'user'
  where binding.app_id = (lease_authority ->> 'app_id')::uuid
    and binding.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and binding.environment = lease_authority ->> 'environment'
    and binding.run_id = (lease_authority ->> 'run_id')::uuid
    and binding.principal_id = (lease_authority ->> 'principal_id')::uuid
    and binding.conversation_id =
      (requested_command #>> '{conversation_binding,conversation_id}')::uuid
    and conversation.resource_version =
      (requested_command #>> '{conversation_binding,resource_version}')::bigint
  for share of binding,message,event,conversation;
  if not found
  then
    raise exception using errcode = '55000', message = 'PROVIDER_TASK_MESSAGE_NOT_FOUND_OR_FORBIDDEN';
  end if;
  authoritative_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact@1.0.0','message_id',task_authority.message_id,
    'accepted_event_id',task_authority.event_id,
    'conversation_id',task_authority.conversation_id,
    'conversation_resource_version',task_authority.resource_version,
    'command_id',task_authority.command_id,'run_id',task_authority.run_id,
    'message_role',task_authority.role,'message_type',task_authority.message_type,
    'question',task_authority.content);
  content_hash := app_data_agent.u2_canonical_sha256(authoritative_document);
  authoritative_document := authoritative_document ||
    pg_catalog.jsonb_build_object('content_hash',content_hash);
  if task_authority.message_id <> task_authority.event_id
    or task_authority.role <> 'user'
    or task_authority.message_type <> 'text'
    or app_data_agent.contains_potential_plaintext_secret(
      authoritative_document - 'question')
  then
    raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_DOCUMENT_INVALID';
  end if;
  select artifact.* into artifact_record
  from app_data_agent.artifacts artifact
  where artifact.app_id = task_authority.app_id
    and artifact.tenant_id = task_authority.tenant_id
    and artifact.environment = task_authority.environment
    and artifact.run_id = task_authority.run_id
    and artifact.artifact_id = task_authority.message_id
    and artifact.artifact_type = 'ProviderTaskArtifact'
    and artifact.revision = 1
  for share;
  if found then
    if artifact_record.content_hash <> content_hash
      or artifact_record.document_json <> authoritative_document
    then
      raise exception using errcode = '23505', message = 'PROVIDER_TASK_ARTIFACT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-task-artifact-commit-result@1.0.0',
      'disposition','REPLAYED','reference',pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
      'document',artifact_record.document_json,
      'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
  end if;
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
    document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
  ) values (
    task_authority.app_id,task_authority.tenant_id,task_authority.environment,task_authority.run_id,
    task_authority.message_id,'ProviderTaskArtifact',1,content_hash,authoritative_document,
    (lease_authority ->> 'worker_fence')::bigint,true,null,null,committed_at
  ) returning * into artifact_record;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact-commit-result@1.0.0',
    'disposition','CREATED','reference',pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
    'document',artifact_record.document_json,
    'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_provider_task_artifact(requested_command jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  artifact_record app_data_agent.artifacts%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','reference'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-task-artifact-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'reference',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
      ]::text[])
    or requested_command #>> '{reference,artifact_type}' <> 'ProviderTaskArtifact'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_LOAD_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id)
  then
    raise exception using errcode = '42501', message = 'PROVIDER_TASK_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id = authority.app_id and artifact.tenant_id = authority.tenant_id
    and artifact.environment = authority.environment
    and artifact.run_id = (requested_command ->> 'run_id')::uuid
    and artifact.artifact_id = (requested_command #>> '{reference,artifact_id}')::uuid
    and artifact.artifact_type = 'ProviderTaskArtifact'
    and artifact.revision = (requested_command #>> '{reference,revision}')::integer
    and artifact.content_hash = requested_command #>> '{reference,content_hash}'
    and artifact.is_active;
  if not found
    or requested_command -> 'reference' <> pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash)
    or not app_data_agent.provider_json_object_has_exact_keys(
      artifact_record.document_json,array[
        'schema_version','message_id','accepted_event_id','conversation_id',
        'conversation_resource_version','command_id','run_id','message_role',
        'message_type','question','content_hash'
      ]::text[])
    or artifact_record.document_json ->> 'schema_version' <> 'provider-task-artifact@1.0.0'
    or artifact_record.document_json ->> 'message_id' <> artifact_record.artifact_id::text
    or artifact_record.document_json ->> 'accepted_event_id' <>
      artifact_record.document_json ->> 'message_id'
    or artifact_record.document_json ->> 'run_id' <> artifact_record.run_id::text
    or artifact_record.document_json ->> 'message_role' <> 'user'
    or artifact_record.document_json ->> 'message_type' <> 'text'
    or pg_catalog.length(pg_catalog.btrim(
      artifact_record.document_json ->> 'question')) not between 1 and 200000
    or artifact_record.content_hash <>
      app_data_agent.u2_canonical_sha256(artifact_record.document_json - 'content_hash')
  then
    raise exception using errcode = '42501', message = 'PROVIDER_TASK_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact-load-result@1.0.0',
    'reference',requested_command -> 'reference','document',artifact_record.document_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_LOAD_INVALID';
end
$function$;

create function app_data_agent.commit_provider_response_artifact(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
  document jsonb;
  artifact_id uuid;
  committed_at timestamptz;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','invocation_id','intent_id','dispatch_hash',
      'attempt_id','worker_fence','document'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-response-artifact-commit@1.0.0'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_COMMAND_INVALID';
  end if;
  document := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(document,array[
      'schema_version','invocation_id','response_hash','output_text','tool_calls','content_hash'
    ]::text[])
    or document ->> 'schema_version' <> 'provider-response-artifact@1.0.0'
    or document ->> 'invocation_id' <> requested_command ->> 'invocation_id'
    or document ->> 'response_hash' <> app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'output_text',document -> 'output_text','tool_calls',document -> 'tool_calls'))
    or document ->> 'content_hash' <> app_data_agent.u2_canonical_sha256(document - 'content_hash')
    or pg_catalog.jsonb_typeof(document -> 'output_text') <> 'string'
    or pg_catalog.jsonb_typeof(document -> 'tool_calls') <> 'array'
    or pg_catalog.jsonb_array_length(document -> 'tool_calls') > 256
    or app_data_agent.contains_potential_plaintext_secret(document)
  then
    raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_DOCUMENT_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  select intent.* into intent_record
  from app_data_agent.provider_invocation_intents as intent
  where intent.app_id = (lease_authority ->> 'app_id')::uuid
    and intent.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and intent.environment = lease_authority ->> 'environment'
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.admission = 'READY'
  for update;
  if not found or requested_command -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}' then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits as permit
  where permit.app_id = intent_record.app_id and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment and permit.intent_id = intent_record.intent_id
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint
    and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint;
  if not found or not exists (
      select 1 from app_data_agent.provider_invocation_outcomes marker
      where marker.app_id = intent_record.app_id and marker.tenant_id = intent_record.tenant_id
        and marker.environment = intent_record.environment and marker.intent_id = intent_record.intent_id
        and marker.dispatch_hash = permit_record.dispatch_hash and marker.attempt_id = permit_record.attempt_id
        and marker.worker_fence = permit_record.worker_fence and marker.state = 'DISPATCH_MARKED'
    )
  then
    raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_MARK_NOT_COMMITTED';
  end if;
  if exists (select 1 from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
      and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')) then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
  end if;

  select artifact.* into artifact_record
  from app_data_agent.artifacts artifact
  where artifact.app_id = intent_record.app_id and artifact.tenant_id = intent_record.tenant_id
    and artifact.environment = intent_record.environment and artifact.run_id = intent_record.run_id
    and artifact.artifact_type = 'ProviderResponseArtifact' and artifact.revision = 1
    and artifact.document_json ->> 'invocation_id' = intent_record.invocation_id::text
  for share;
  if found then
    if artifact_record.content_hash <> document ->> 'content_hash'
      or artifact_record.document_json <> document then
      raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-response-artifact-commit-result@1.0.0',
      'disposition','REPLAYED','reference',pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,'artifact_type',artifact_record.artifact_type,
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
      'document_hash',artifact_record.content_hash,
      'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
  end if;
  artifact_id := pg_catalog.gen_random_uuid();
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
  ) values (
    intent_record.app_id,intent_record.tenant_id,intent_record.environment,intent_record.run_id,
    artifact_id,'ProviderResponseArtifact',1,document ->> 'content_hash',document,
    permit_record.worker_fence,true,null,null,committed_at
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-response-artifact-commit-result@1.0.0',
    'disposition','CREATED','reference',pg_catalog.jsonb_build_object(
      'artifact_id',artifact_id,'artifact_type','ProviderResponseArtifact',
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'run_id',intent_record.run_id,
      'revision',1,'content_hash',document ->> 'content_hash'),
    'document_hash',document ->> 'content_hash',
    'committed_at',app_data_agent.runtime_iso_timestamp(committed_at));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_provider_invocation(requested_command jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  terminal_record app_data_agent.provider_invocation_outcomes%rowtype;
  usage_record app_data_agent.provider_invocation_usage_receipts%rowtype;
  projection_document jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','invocation_id','permit_id','permit_hash',
      'dispatch_hash','attempt_id','worker_fence'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-invocation-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
  then raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment,
      'workspace_id',authority.tenant_id,'principal_id',authority.principal_id) then
    raise exception using errcode = '42501', message = 'PROVIDER_INVOCATION_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select intent.* into intent_record from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment and intent.principal_id = authority.principal_id
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid;
  if not found then raise exception using errcode = '42501', message = 'PROVIDER_INVOCATION_NOT_FOUND_OR_FORBIDDEN'; end if;
  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id
    and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment
    and permit.intent_id = intent_record.intent_id
    and permit.invocation_id = intent_record.invocation_id
    and permit.run_id = intent_record.run_id
    and permit.permit_id = (requested_command ->> 'permit_id')::uuid
    and permit.permit_hash = requested_command ->> 'permit_hash'
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint;
  if not found
    or permit_record.permit_json ->> 'permit_id' <> permit_record.permit_id::text
    or permit_record.permit_json ->> 'intent_id' <> intent_record.intent_id::text
    or permit_record.permit_json ->> 'invocation_id' <> intent_record.invocation_id::text
    or permit_record.permit_json ->> 'run_id' <> intent_record.run_id::text
    or permit_record.permit_json -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or permit_record.permit_json ->> 'dispatch_hash' <> permit_record.dispatch_hash
    or permit_record.permit_json ->> 'attempt_id' <> permit_record.attempt_id::text
    or permit_record.permit_json ->> 'worker_fence' <> permit_record.worker_fence::text
    or permit_record.permit_json ->> 'permit_hash' <> permit_record.permit_hash
    or permit_record.permit_hash <>
      app_data_agent.u2_canonical_sha256(permit_record.permit_json - 'permit_hash')
  then
    raise exception using errcode = '42501', message = 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED';
  end if;
  select outcome.* into marker_record from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash
    and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence
    and outcome.state = 'DISPATCH_MARKED';
  select outcome.* into response_marker_record
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash
    and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence
    and outcome.state = 'RESPONSE_OBSERVED';
  select outcome.* into terminal_record from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash
    and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence
    and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')
  order by outcome.transition_revision desc limit 1;
  if marker_record.outcome_id is null
    and response_marker_record.outcome_id is null
    and terminal_record.outcome_id is null
  then
    return 'null'::jsonb;
  end if;
  if terminal_record.outcome_id is not null then
    select usage.* into strict usage_record from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = terminal_record.app_id and usage.tenant_id = terminal_record.tenant_id
      and usage.environment = terminal_record.environment and usage.outcome_id = terminal_record.outcome_id;
    if (terminal_record.provider_call_count = 1) <> (marker_record.outcome_id is not null) then
      raise exception using errcode = 'P0001', message = 'PROVIDER_LOAD_RESULT_CLOSURE_INVALID';
    end if;
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0','invocation_id',intent_record.invocation_id,
    'run_id',intent_record.run_id,'provider',intent_record.provider,
    'model_profile_id',intent_record.model_profile_id,'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,'artifact_type','ModelCertificationReceipt',
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'run_id',intent_record.certification_run_id,
      'revision',intent_record.certification_revision,'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,
    'attempt_no',permit_record.attempt_no,
    'recovery_action',case when terminal_record.outcome_id is null then null
      else terminal_record.outcome_json #> '{candidate,recovery_action}' end,
    'status',case when terminal_record.outcome_id is null then 'STARTED'
      else terminal_record.outcome_json #>> '{candidate,status}' end,
    'reason_code',case when terminal_record.outcome_id is null then null
      else terminal_record.outcome_json #> '{candidate,reason_code}' end,
    'dispatch_hash',permit_record.dispatch_hash,
    'response_hash',case when terminal_record.outcome_id is null then null
      else terminal_record.outcome_json #> '{candidate,response_hash}' end,
    'usage_availability',case when usage_record.usage_receipt_id is null then null
      else usage_record.usage_json -> 'availability' end,
    'usage_source',case when usage_record.usage_receipt_id is null then null
      else usage_record.usage_json -> 'source' end,
    'input_tokens',usage_record.usage_json -> 'input_tokens',
    'output_tokens',usage_record.usage_json -> 'output_tokens',
    'total_tokens',usage_record.usage_json -> 'total_tokens',
    'tool_calls',usage_record.usage_json -> 'tool_calls',
    'provider_call_count',case when terminal_record.outcome_id is null then 1
      else (usage_record.usage_json ->> 'provider_call_count')::integer end,
    'retry_after_ms',terminal_record.outcome_json #> '{candidate,retry_after_ms}',
    'latency_ms',terminal_record.outcome_json -> 'latency_ms',
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',terminal_record.outcome_json -> 'terminal_at');
  if intent_record.intent_json ->> 'intent_id' <> intent_record.intent_id::text
    or intent_record.intent_json #>> '{invocation_spec,invocation_id}' <>
      intent_record.invocation_id::text
    or intent_record.intent_json #>> '{invocation_spec,run_id}' <> intent_record.run_id::text
    or intent_record.intent_json #> '{invocation_spec,scope}' <> pg_catalog.jsonb_build_object(
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'workspace_id',intent_record.workspace_id,
      'principal_id',intent_record.principal_id)
    or intent_record.intent_json ->> 'intent_hash' <>
      app_data_agent.u2_canonical_sha256(intent_record.intent_json - 'intent_hash')
    or permit_record.intent_id <> intent_record.intent_id
    or permit_record.invocation_id <> intent_record.invocation_id
    or permit_record.run_id <> intent_record.run_id
    or permit_record.permit_json ->> 'permit_hash' <>
      app_data_agent.u2_canonical_sha256(permit_record.permit_json - 'permit_hash')
    or projection_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or projection_document ->> 'run_id' <> intent_record.run_id::text
    or projection_document ->> 'provider' <> intent_record.provider
    or projection_document ->> 'model_profile_id' <> intent_record.model_profile_id::text
    or projection_document ->> 'model_config_version' <> intent_record.model_config_version::text
    or projection_document ->> 'profile_version' <> intent_record.profile_version
    or projection_document ->> 'model_id' <> intent_record.model_id
    or projection_document ->> 'attempt_id' <> permit_record.attempt_id::text
    or projection_document ->> 'attempt_no' <> permit_record.attempt_no::text
    or projection_document ->> 'dispatch_hash' <> permit_record.dispatch_hash
    or (marker_record.outcome_id is not null and (
      marker_record.intent_id <> intent_record.intent_id
      or marker_record.invocation_id <> intent_record.invocation_id
      or marker_record.run_id <> intent_record.run_id
      or marker_record.dispatch_hash <> permit_record.dispatch_hash
      or marker_record.outcome_json ->> 'marker_hash' <>
        app_data_agent.u2_canonical_sha256(marker_record.outcome_json - 'marker_hash')))
    or (response_marker_record.outcome_id is not null and (
      marker_record.outcome_id is null
      or not app_data_agent.provider_json_object_has_exact_keys(
        response_marker_record.outcome_json,array[
          'schema_version','marker_id','intent_id','invocation_id','scope','run_id',
          'dispatch_hash','attempt_id','worker_fence','state','observation_kind',
          'response_hash','delivery_certainty','response_observed_at','marker_hash'
        ]::text[])
      or response_marker_record.intent_id <> intent_record.intent_id
      or response_marker_record.invocation_id <> intent_record.invocation_id
      or response_marker_record.run_id <> intent_record.run_id
      or response_marker_record.dispatch_hash <> permit_record.dispatch_hash
      or response_marker_record.outcome_json ->> 'schema_version' <>
        'provider-invocation-response-observed-marker@1.0.0'
      or response_marker_record.outcome_json ->> 'intent_id' <> intent_record.intent_id::text
      or response_marker_record.outcome_json ->> 'invocation_id' <> intent_record.invocation_id::text
      or response_marker_record.outcome_json -> 'scope' <>
        intent_record.intent_json #> '{invocation_spec,scope}'
      or response_marker_record.outcome_json ->> 'run_id' <> intent_record.run_id::text
      or response_marker_record.outcome_json ->> 'dispatch_hash' <> permit_record.dispatch_hash
      or response_marker_record.outcome_json ->> 'attempt_id' <> permit_record.attempt_id::text
      or response_marker_record.outcome_json ->> 'worker_fence' <> permit_record.worker_fence::text
      or response_marker_record.outcome_json ->> 'state' <> 'RESPONSE_OBSERVED'
      or response_marker_record.parent_outcome_hash <> marker_record.outcome_hash
      or response_marker_record.outcome_json ->> 'marker_hash' <>
        app_data_agent.u2_canonical_sha256(response_marker_record.outcome_json - 'marker_hash')))
    or (terminal_record.outcome_id is not null and (
      terminal_record.intent_id <> intent_record.intent_id
      or terminal_record.invocation_id <> intent_record.invocation_id
      or terminal_record.run_id <> intent_record.run_id
      or terminal_record.dispatch_hash <> permit_record.dispatch_hash
      or terminal_record.outcome_json #>> '{candidate,intent_id}' <> intent_record.intent_id::text
      or terminal_record.outcome_json #>> '{candidate,invocation_id}' <>
        intent_record.invocation_id::text
      or terminal_record.outcome_json #>> '{candidate,run_id}' <> intent_record.run_id::text
      or terminal_record.outcome_json #> '{candidate,scope}' <>
        intent_record.intent_json #> '{invocation_spec,scope}'
      or terminal_record.outcome_json #>> '{candidate,dispatch_hash}' <> permit_record.dispatch_hash
      or (terminal_record.transition_from = 'RESPONSE_OBSERVED' and (
        response_marker_record.outcome_id is null
        or terminal_record.parent_outcome_hash <> response_marker_record.outcome_hash
        or terminal_record.state <> response_marker_record.observation_kind
        or terminal_record.delivery_certainty <> response_marker_record.delivery_certainty
        or terminal_record.outcome_json #> '{candidate,response_hash}' <>
          response_marker_record.outcome_json -> 'response_hash'))
      or terminal_record.outcome_json ->> 'outcome_hash' <>
        app_data_agent.u2_canonical_sha256(terminal_record.outcome_json - 'outcome_hash')))
    or (usage_record.usage_receipt_id is not null and (
      usage_record.intent_id <> intent_record.intent_id
      or usage_record.invocation_id <> intent_record.invocation_id
      or usage_record.outcome_id <> terminal_record.outcome_id
      or usage_record.usage_json ->> 'intent_id' <> intent_record.intent_id::text
      or usage_record.usage_json ->> 'invocation_id' <> intent_record.invocation_id::text
      or usage_record.usage_json ->> 'run_id' <> intent_record.run_id::text
      or usage_record.usage_json -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
      or usage_record.usage_json ->> 'usage_hash' <>
        app_data_agent.u2_canonical_sha256(usage_record.usage_json - 'usage_hash')))
  then
    raise exception using errcode = 'P0001', message = 'PROVIDER_LOAD_RESULT_CLOSURE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-load-result@1.0.0','intent',intent_record.intent_json,
    'permit',permit_record.permit_json,
    'marker',case when marker_record.outcome_id is null then null else marker_record.outcome_json end,
    'response_observed',case when response_marker_record.outcome_id is null
      then null else response_marker_record.outcome_json end,
    'outcome',case when terminal_record.outcome_id is null then null else terminal_record.outcome_json end,
    'usage',case when usage_record.usage_receipt_id is null then null else usage_record.usage_json end,
    'projection',projection_document);
exception when invalid_text_representation then
  raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_LOAD_INVALID';
end
$function$;

create function app_data_agent.commit_provider_invocation_worker_transition_internal(
  requested_lease jsonb,
  requested_command jsonb,
  requested_usage jsonb,
  requested_mode text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  existing_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  existing_usage app_data_agent.provider_invocation_usage_receipts%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
  candidate jsonb;
  usage_candidate jsonb;
  response_document jsonb;
  response_ref jsonb;
  outcome_document jsonb;
  usage_document jsonb;
  projection_document jsonb;
  outcome_id uuid;
  usage_id uuid;
  artifact_id uuid;
  terminal_at timestamptz;
  dispatch_marked_at timestamptz;
  latency_ms bigint;
  transition_revision bigint;
  result_schema text;
  disposition text := 'CREATED';
begin
  if requested_mode not in ('COMPLETED','TERMINAL','UNKNOWN') then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_INVALID';
  end if;
  if requested_mode = 'COMPLETED' then
    if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
        'attempt_id','worker_fence','response_document','outcome','usage'
      ]::text[])
      or requested_command ->> 'schema_version' <> 'provider-invocation-commit-completed@1.0.0'
    then raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_COMPLETED_COMMAND_INVALID'; end if;
    result_schema := 'provider-invocation-commit-completed-result@1.0.0';
    response_document := requested_command -> 'response_document';
  elsif requested_mode = 'TERMINAL' then
    if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
        'attempt_id','worker_fence','outcome','usage'
      ]::text[])
      or requested_command ->> 'schema_version' <> 'provider-invocation-commit-terminal@1.0.0'
    then raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TERMINAL_COMMAND_INVALID'; end if;
    result_schema := 'provider-invocation-commit-terminal-result@1.0.0';
  else
    if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
        'attempt_id','worker_fence','outcome','usage'
      ]::text[])
      or requested_command ->> 'schema_version' <> 'provider-invocation-mark-unknown@1.0.0'
    then raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_UNKNOWN_COMMAND_INVALID'; end if;
    result_schema := 'provider-invocation-mark-unknown-result@1.0.0';
  end if;
  candidate := requested_command -> 'outcome';
  usage_candidate := requested_command -> 'usage';
  if not app_data_agent.provider_json_object_has_exact_keys(usage_candidate,array[
      'schema_version','availability','source','input_tokens','output_tokens','total_tokens',
      'tool_calls','provider_call_count','capacity_status','unavailable_reason'
    ]::text[])
    or usage_candidate ->> 'schema_version' <> 'provider-invocation-usage-candidate@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or (requested_mode = 'COMPLETED' and not
      app_data_agent.provider_json_object_has_exact_keys(candidate,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
        'reason_code','response_hash','delivery_certainty','transition_from','recovery_action',
        'provider_call_count','retry_after_ms','reconciliation_of'
      ]::text[]))
    or (requested_mode <> 'COMPLETED' and not
      app_data_agent.provider_json_object_has_exact_keys(candidate,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
        'reason_code','response_artifact_ref','response_hash','delivery_certainty','transition_from',
        'recovery_action','provider_call_count','retry_after_ms','reconciliation_of'
      ]::text[]))
    or candidate -> 'scope' <> requested_command -> 'scope'
    or usage_candidate <> requested_usage
    or candidate ->> 'intent_id' <> requested_command ->> 'intent_id'
    or candidate ->> 'invocation_id' <> requested_command ->> 'invocation_id'
    or candidate ->> 'run_id' <> requested_command ->> 'run_id'
    or candidate ->> 'dispatch_hash' <> requested_command ->> 'dispatch_hash'
    or candidate -> 'scope' <> requested_command -> 'scope'
    or candidate ->> 'provider_call_count' <> usage_candidate ->> 'provider_call_count'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_CLOSURE_INVALID';
  end if;
  if (usage_candidate ->> 'availability' = 'AVAILABLE' and (
      usage_candidate ->> 'source' not in ('PROVIDER_REPORTED','ESTIMATED')
      or (usage_candidate ->> 'input_tokens')::bigint not between 0 and 9007199254740991
      or (usage_candidate ->> 'output_tokens')::bigint not between 0 and 9007199254740991
      or (usage_candidate ->> 'total_tokens')::bigint <>
        (usage_candidate ->> 'input_tokens')::bigint +
        (usage_candidate ->> 'output_tokens')::bigint
      or (usage_candidate ->> 'tool_calls')::bigint not between 0 and 9007199254740991
      or usage_candidate ->> 'provider_call_count' <> '1'
      or usage_candidate ->> 'capacity_status' <> 'WITHIN_LIMIT'
      or usage_candidate -> 'unavailable_reason' <> 'null'::jsonb))
    or (usage_candidate ->> 'availability' = 'NOT_APPLICABLE' and (
      usage_candidate ->> 'source' <> 'UNAVAILABLE'
      or usage_candidate -> 'input_tokens' <> 'null'::jsonb
      or usage_candidate -> 'output_tokens' <> 'null'::jsonb
      or usage_candidate -> 'total_tokens' <> 'null'::jsonb
      or usage_candidate -> 'tool_calls' <> 'null'::jsonb
      or usage_candidate ->> 'provider_call_count' <> '0'
      or usage_candidate ->> 'capacity_status' <> 'NOT_APPLICABLE'
      or usage_candidate ->> 'unavailable_reason' <> 'PROVIDER_NOT_DISPATCHED'))
    or (usage_candidate ->> 'availability' = 'UNAVAILABLE' and (
      usage_candidate ->> 'source' <> 'UNAVAILABLE'
      or usage_candidate -> 'input_tokens' <> 'null'::jsonb
      or usage_candidate -> 'output_tokens' <> 'null'::jsonb
      or usage_candidate -> 'total_tokens' <> 'null'::jsonb
      or usage_candidate -> 'tool_calls' <> 'null'::jsonb
      or usage_candidate ->> 'provider_call_count' <> '1'
      or usage_candidate ->> 'capacity_status' <> 'UNAVAILABLE'
      or usage_candidate ->> 'unavailable_reason' not in (
        'PROVIDER_DID_NOT_REPORT_USAGE','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
        'PROVIDER_PROTOCOL_VIOLATION'
      )))
    or usage_candidate ->> 'availability' not in ('AVAILABLE','NOT_APPLICABLE','UNAVAILABLE')
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_USAGE_TRUTH_INVALID';
  end if;
  if (requested_mode = 'COMPLETED' and (
      candidate ->> 'schema_version' <> 'provider-invocation-completed-candidate@1.0.0'
      or candidate ->> 'status' <> 'COMPLETED'))
    or (requested_mode = 'TERMINAL' and (
      candidate ->> 'schema_version' <> 'provider-invocation-outcome-candidate@1.0.0'
      or candidate ->> 'status' not in ('FAILED','THROTTLED')))
    or (requested_mode = 'UNKNOWN' and (
      candidate ->> 'status' <> 'OUTCOME_UNKNOWN'
      or candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED'
      or usage_candidate ->> 'availability' <> 'UNAVAILABLE'
      or usage_candidate ->> 'unavailable_reason' <> 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'))
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_TRUTH_INVALID';
  end if;
  if candidate ->> 'recovery_action' not in (
      'NONE','SAFE_RETRY','STATUS_QUERY_REQUIRED','RECONCILIATION_REQUIRED',
      'MANUAL_REVIEW_REQUIRED'
    )
    or (candidate ->> 'reason_code' is not null and candidate ->> 'reason_code' not in (
      'PROVIDER_CREDENTIAL_UNAVAILABLE','PROVIDER_LOCAL_PREPARATION_FAILED',
      'PROVIDER_THROTTLED','PROVIDER_TIMEOUT','PROVIDER_PROTOCOL_VIOLATION',
      'PROVIDER_INVOCATION_FAILED','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
      'PROVIDER_RECONCILIATION_REQUIRED'
    ))
    or (requested_mode <> 'COMPLETED' and (
      candidate -> 'response_artifact_ref' <> 'null'::jsonb
      or candidate -> 'response_hash' <> 'null'::jsonb))
    or (candidate ->> 'status' = 'FAILED' and (
      candidate ->> 'reason_code' is null
      or candidate ->> 'delivery_certainty' = 'DISPATCHED_OUTCOME_UNKNOWN'
      or ((candidate ->> 'transition_from') = 'INTENT_COMMITTED') <>
        ((candidate ->> 'provider_call_count') = '0')))
    or (candidate ->> 'status' = 'THROTTLED' and (
      candidate ->> 'reason_code' <> 'PROVIDER_THROTTLED'
      or candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED'
      or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_KNOWN'
      or candidate ->> 'provider_call_count' <> '1'
      or candidate -> 'retry_after_ms' = 'null'::jsonb))
    or (candidate ->> 'status' = 'OUTCOME_UNKNOWN' and (
      candidate ->> 'reason_code' <> 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'
      or candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED'
      or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_UNKNOWN'
      or candidate ->> 'provider_call_count' <> '1'
      or candidate ->> 'recovery_action' not in (
        'RECONCILIATION_REQUIRED','MANUAL_REVIEW_REQUIRED'
      )))
    or ((candidate ->> 'status') = 'THROTTLED') <>
      (candidate -> 'retry_after_ms' <> 'null'::jsonb)
    or candidate -> 'reconciliation_of' <> 'null'::jsonb
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_TRUTH_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  select intent.* into intent_record from app_data_agent.provider_invocation_intents intent
  where intent.app_id = (lease_authority ->> 'app_id')::uuid
    and intent.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and intent.environment = lease_authority ->> 'environment'
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.admission = 'READY' for update;
  if not found or requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'workspace_id',intent_record.tenant_id,
      'principal_id',intent_record.principal_id) then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select permit.* into permit_record from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment and permit.intent_id = intent_record.intent_id
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint
    and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint;
  if not found then raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED'; end if;
  select outcome.* into marker_record from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence and outcome.state = 'DISPATCH_MARKED';
  select outcome.* into response_marker_record
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence and outcome.state = 'RESPONSE_OBSERVED';

  if candidate ->> 'transition_from' = 'INTENT_COMMITTED' then
    if marker_record.outcome_id is not null or response_marker_record.outcome_id is not null
      or requested_mode <> 'TERMINAL'
      or candidate ->> 'status' <> 'FAILED' or candidate ->> 'provider_call_count' <> '0'
      or usage_candidate ->> 'availability' <> 'NOT_APPLICABLE' then
      raise exception using errcode = '55000', message = 'PROVIDER_PREDISPATCH_TRUTH_INVALID';
    end if;
    dispatch_marked_at := null; transition_revision := 1;
  else
    if marker_record.outcome_id is null
      or response_marker_record.outcome_id is null
      or candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED'
      or response_marker_record.observation_kind <> candidate ->> 'status'
      or response_marker_record.delivery_certainty <> candidate ->> 'delivery_certainty'
      or response_marker_record.outcome_json -> 'response_hash' <>
        candidate -> 'response_hash'
    then
      raise exception using errcode = '55000',
        message = 'PROVIDER_RESPONSE_OBSERVED_MARK_NOT_COMMITTED';
    end if;
    dispatch_marked_at := marker_record.started_at;
    transition_revision := response_marker_record.transition_revision + 1;
  end if;
  if candidate ->> 'transition_from' = 'OUTCOME_UNKNOWN' then
    raise exception using errcode = '55000', message = 'PROVIDER_RECONCILIATION_JOB_REQUIRED';
  end if;

  select outcome.* into existing_outcome from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN');
  if found then
    select usage.* into strict existing_usage from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = existing_outcome.app_id and usage.tenant_id = existing_outcome.tenant_id
      and usage.environment = existing_outcome.environment and usage.outcome_id = existing_outcome.outcome_id;
    if requested_mode = 'COMPLETED' then
      if not app_data_agent.provider_json_object_has_exact_keys(response_document,array[
          'schema_version','invocation_id','output_text','tool_calls','response_hash','content_hash'
        ]::text[])
        or response_document ->> 'schema_version' <> 'provider-response-artifact@1.0.0'
        or pg_catalog.jsonb_typeof(response_document -> 'output_text') <> 'string'
        or pg_catalog.length(response_document ->> 'output_text') > 1000000
        or pg_catalog.jsonb_typeof(response_document -> 'tool_calls') <> 'array'
        or pg_catalog.jsonb_array_length(response_document -> 'tool_calls') > 256
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(response_document -> 'tool_calls') call
          where not app_data_agent.provider_json_object_has_exact_keys(
            call,array['tool_call_id','tool_name','arguments']::text[])
            or pg_catalog.length(call ->> 'tool_call_id') not between 1 and 256
            or call ->> 'tool_name' !~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
        )
        or response_document ->> 'invocation_id' <> intent_record.invocation_id::text
        or response_document ->> 'response_hash' <> app_data_agent.u2_canonical_sha256(
          pg_catalog.jsonb_build_object(
            'output_text',response_document -> 'output_text','tool_calls',response_document -> 'tool_calls'))
        or response_document ->> 'content_hash' <>
          app_data_agent.u2_canonical_sha256(response_document - 'content_hash')
        or candidate ->> 'response_hash' <> response_document ->> 'response_hash'
      then
        raise exception using errcode = '22023',
          message = 'PROVIDER_RESPONSE_ARTIFACT_DOCUMENT_INVALID';
      end if;
      select artifact.* into strict artifact_record from app_data_agent.artifacts artifact
      where artifact.app_id = existing_outcome.app_id
        and artifact.tenant_id = existing_outcome.tenant_id
        and artifact.environment = existing_outcome.environment
        and artifact.run_id = existing_outcome.run_id
        and artifact.artifact_id = existing_outcome.response_artifact_id
        and artifact.artifact_type = 'ProviderResponseArtifact'
        and artifact.revision = existing_outcome.response_artifact_revision
        and artifact.content_hash = existing_outcome.response_artifact_content_hash;
      response_ref := existing_outcome.outcome_json #> '{candidate,response_artifact_ref}';
      candidate := (candidate - 'schema_version') || pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'response_artifact_ref',response_ref);
      if artifact_record.document_json <> response_document then
        raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
      end if;
    end if;
    if existing_outcome.outcome_json -> 'candidate' <> candidate
      or existing_usage.usage_json - array['schema_version','usage_receipt_id','outcome_id','intent_id',
          'invocation_id','scope','run_id','observed_at','usage_hash']::text[] <>
        usage_candidate - 'schema_version'
    then raise exception using errcode = '23505', message = 'PROVIDER_INVOCATION_TERMINAL_CONFLICT'; end if;
    outcome_document := existing_outcome.outcome_json;
    usage_document := existing_usage.usage_json;
    disposition := 'REPLAYED';
  else
    terminal_at := pg_catalog.clock_timestamp();
    outcome_id := pg_catalog.gen_random_uuid();
    usage_id := pg_catalog.gen_random_uuid();
    if requested_mode = 'COMPLETED' then
      if not app_data_agent.provider_json_object_has_exact_keys(response_document,array[
          'schema_version','invocation_id','output_text','tool_calls','response_hash','content_hash'
        ]::text[])
        or response_document ->> 'schema_version' <> 'provider-response-artifact@1.0.0'
        or pg_catalog.jsonb_typeof(response_document -> 'output_text') <> 'string'
        or pg_catalog.length(response_document ->> 'output_text') > 1000000
        or pg_catalog.jsonb_typeof(response_document -> 'tool_calls') <> 'array'
        or pg_catalog.jsonb_array_length(response_document -> 'tool_calls') > 256
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(response_document -> 'tool_calls') call
          where not app_data_agent.provider_json_object_has_exact_keys(
            call,array['tool_call_id','tool_name','arguments']::text[])
            or pg_catalog.length(call ->> 'tool_call_id') not between 1 and 256
            or call ->> 'tool_name' !~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
        )
        or response_document ->> 'invocation_id' <> intent_record.invocation_id::text
        or response_document ->> 'response_hash' <> app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
          'output_text',response_document -> 'output_text','tool_calls',response_document -> 'tool_calls'))
        or response_document ->> 'content_hash' <> app_data_agent.u2_canonical_sha256(response_document - 'content_hash')
        or candidate ->> 'response_hash' <> response_document ->> 'response_hash'
      then raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_DOCUMENT_INVALID'; end if;
      select artifact.* into artifact_record from app_data_agent.artifacts artifact
      where artifact.app_id = intent_record.app_id and artifact.tenant_id = intent_record.tenant_id
        and artifact.environment = intent_record.environment and artifact.run_id = intent_record.run_id
        and artifact.artifact_type = 'ProviderResponseArtifact' and artifact.revision = 1
        and artifact.document_json ->> 'invocation_id' = intent_record.invocation_id::text;
      if found and (artifact_record.content_hash <> response_document ->> 'content_hash'
          or artifact_record.document_json <> response_document) then
        raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
      elsif not found then
        artifact_id := pg_catalog.gen_random_uuid();
        insert into app_data_agent.artifacts (
          app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
          document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
        ) values (intent_record.app_id,intent_record.tenant_id,intent_record.environment,
          intent_record.run_id,artifact_id,'ProviderResponseArtifact',1,
          response_document ->> 'content_hash',response_document,permit_record.worker_fence,
          true,null,null,terminal_at) returning * into artifact_record;
      end if;
      response_ref := pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderResponseArtifact',
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash);
      candidate := (candidate - 'schema_version') || pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'response_artifact_ref',response_ref);
    end if;
    latency_ms := case when dispatch_marked_at is null then null else
      pg_catalog.greatest(0,pg_catalog.floor(
        extract(epoch from terminal_at - dispatch_marked_at) * 1000
      )::bigint) end;
    outcome_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome@1.0.0','outcome_id',outcome_id,
      'candidate',candidate,'dispatch_marked_at',case when dispatch_marked_at is null then null
        else app_data_agent.runtime_iso_timestamp(dispatch_marked_at) end,
      'terminal_at',app_data_agent.runtime_iso_timestamp(terminal_at),'latency_ms',latency_ms);
    outcome_document := outcome_document || pg_catalog.jsonb_build_object(
      'outcome_hash',app_data_agent.u2_canonical_sha256(outcome_document));
    usage_document := (usage_candidate - 'schema_version') || pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-usage@1.0.0','usage_receipt_id',usage_id,
      'outcome_id',outcome_id,'intent_id',intent_record.intent_id,
      'invocation_id',intent_record.invocation_id,
      'scope',requested_command -> 'scope','run_id',intent_record.run_id,
      'observed_at',app_data_agent.runtime_iso_timestamp(terminal_at));
    usage_document := usage_document || pg_catalog.jsonb_build_object(
      'usage_hash',app_data_agent.u2_canonical_sha256(usage_document));
    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
      transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,
      worker_id,lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
      response_artifact_id,response_artifact_type,response_artifact_revision,
      response_artifact_content_hash,response_hash,reason_code,provider_call_count,retry_after_ms,
      delivery_certainty,started_at,terminal_at,latency_ms,reconciliation_of,
      outcome_json,outcome_hash,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,outcome_id,
      intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,permit_record.dispatch_hash,
      transition_revision,response_marker_record.transition_revision,response_marker_record.outcome_hash,
      candidate ->> 'status','WORKER',candidate ->> 'transition_from',candidate ->> 'recovery_action',
      permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,permit_record.command_id,
      permit_record.worker_id,permit_record.lease_token,permit_record.worker_fence,
      marker_record.outcome_id is not null,marker_record.outcome_id is not null,
      artifact_record.artifact_id,case when artifact_record.artifact_id is null then null
        else 'ProviderResponseArtifact' end,artifact_record.revision,artifact_record.content_hash,
      candidate ->> 'response_hash',candidate ->> 'reason_code',
      (candidate ->> 'provider_call_count')::integer,(candidate ->> 'retry_after_ms')::bigint,
      candidate ->> 'delivery_certainty',dispatch_marked_at,terminal_at,latency_ms,
      (candidate ->> 'reconciliation_of')::uuid,outcome_document,outcome_document ->> 'outcome_hash',terminal_at
    );
    insert into app_data_agent.provider_invocation_usage_receipts (
      app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
      outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,output_tokens,
      total_tokens,tool_calls,provider_call_count,capacity_status,unavailable_reason,
      usage_json,usage_hash,observed_at,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,usage_id,
      intent_record.intent_id,intent_record.invocation_id,outcome_id,transition_revision,
      outcome_document ->> 'outcome_hash',usage_document ->> 'availability',usage_document ->> 'source',
      (usage_document ->> 'input_tokens')::bigint,(usage_document ->> 'output_tokens')::bigint,
      (usage_document ->> 'total_tokens')::bigint,(usage_document ->> 'tool_calls')::bigint,
      (usage_document ->> 'provider_call_count')::integer,usage_document ->> 'capacity_status',
      usage_document ->> 'unavailable_reason',usage_document,usage_document ->> 'usage_hash',terminal_at,terminal_at
    );
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0',
    'invocation_id',intent_record.invocation_id,'run_id',intent_record.run_id,
    'provider',intent_record.provider,'model_profile_id',intent_record.model_profile_id,
    'model_config_version',intent_record.model_config_version,'profile_version',intent_record.profile_version,
    'model_id',intent_record.model_id,'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,'artifact_type','ModelCertificationReceipt',
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'run_id',intent_record.certification_run_id,
      'revision',intent_record.certification_revision,'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,'attempt_no',permit_record.attempt_no,
    'recovery_action',outcome_document #> '{candidate,recovery_action}',
    'status',outcome_document #>> '{candidate,status}',
    'reason_code',outcome_document #> '{candidate,reason_code}',
    'dispatch_hash',permit_record.dispatch_hash,
    'response_hash',outcome_document #> '{candidate,response_hash}',
    'usage_availability',usage_document -> 'availability','usage_source',usage_document -> 'source',
    'input_tokens',usage_document -> 'input_tokens','output_tokens',usage_document -> 'output_tokens',
    'total_tokens',usage_document -> 'total_tokens','tool_calls',usage_document -> 'tool_calls',
    'provider_call_count',usage_document -> 'provider_call_count',
    'retry_after_ms',outcome_document #> '{candidate,retry_after_ms}',
    'latency_ms',outcome_document -> 'latency_ms',
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',outcome_document -> 'terminal_at');
  if outcome_document #>> '{candidate,intent_id}' <> intent_record.intent_id::text
    or outcome_document #>> '{candidate,invocation_id}' <> intent_record.invocation_id::text
    or outcome_document #>> '{candidate,run_id}' <> intent_record.run_id::text
    or outcome_document #> '{candidate,scope}' <> pg_catalog.jsonb_build_object(
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'workspace_id',intent_record.workspace_id,
      'principal_id',intent_record.principal_id)
    or outcome_document #>> '{candidate,dispatch_hash}' <> permit_record.dispatch_hash
    or usage_document ->> 'intent_id' <> intent_record.intent_id::text
    or usage_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or usage_document ->> 'run_id' <> intent_record.run_id::text
    or usage_document -> 'scope' <> outcome_document #> '{candidate,scope}'
    or projection_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or projection_document ->> 'run_id' <> intent_record.run_id::text
    or projection_document ->> 'provider' <> intent_record.provider
    or projection_document ->> 'model_profile_id' <> intent_record.model_profile_id::text
    or projection_document ->> 'model_config_version' <> intent_record.model_config_version::text
    or projection_document ->> 'profile_version' <> intent_record.profile_version
    or projection_document ->> 'model_id' <> intent_record.model_id
    or projection_document ->> 'attempt_id' <> permit_record.attempt_id::text
    or projection_document ->> 'attempt_no' <> permit_record.attempt_no::text
    or projection_document ->> 'dispatch_hash' <> permit_record.dispatch_hash
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_TERMINAL_RESULT_CLOSURE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version',result_schema,'disposition',disposition,
    'intent',intent_record.intent_json,'permit',permit_record.permit_json,
    'response_artifact_ref',case when requested_mode = 'COMPLETED'
      then outcome_document #> '{candidate,response_artifact_ref}' else null end,
    'outcome',outcome_document,'usage',usage_document,'projection',projection_document)
    - case when requested_mode = 'COMPLETED' then '' else 'response_artifact_ref' end;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_INVALID';
end
$function$;

create function app_data_agent.commit_provider_invocation_completed(
  requested_lease jsonb, requested_command jsonb
)
returns jsonb language sql volatile security definer set search_path = ''
as $function$
  select app_data_agent.commit_provider_invocation_worker_transition_internal(
    requested_lease,requested_command,requested_command -> 'usage','COMPLETED');
$function$;

create function app_data_agent.commit_provider_invocation_terminal(
  requested_lease jsonb, requested_command jsonb, requested_usage jsonb
)
returns jsonb language sql volatile security definer set search_path = ''
as $function$
  select app_data_agent.commit_provider_invocation_worker_transition_internal(
    requested_lease,requested_command,requested_usage,'TERMINAL');
$function$;

create function app_data_agent.mark_provider_invocation_outcome_unknown(
  requested_lease jsonb, requested_command jsonb, requested_usage jsonb
)
returns jsonb language sql volatile security definer set search_path = ''
as $function$
  select app_data_agent.commit_provider_invocation_worker_transition_internal(
    requested_lease,requested_command,requested_usage,'UNKNOWN');
$function$;

create function app_data_agent.commit_provider_reconciliation_evidence(
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  run_record app_data_agent.runs%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
  document jsonb := requested_command -> 'document';
  content_hash text;
  committed_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501', message = 'PROVIDER_RECONCILIATION_JOB_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','evidence_id','document'
    ]::text[])
    or requested_command ->> 'schema_version' <>
      'provider-reconciliation-evidence-commit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(document,array[
      'schema_version','evidence_id','scope','run_id','reconciliation_id','invocation_id',
      'unknown_outcome_id','recovery_capability_used','evidence_status'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      document -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or document ->> 'schema_version' <> 'provider-reconciliation-evidence@1.0.0'
    or document ->> 'evidence_id' <> requested_command ->> 'evidence_id'
    or document -> 'scope' <> requested_command -> 'scope'
    or document ->> 'run_id' <> requested_command ->> 'run_id'
    or document ->> 'evidence_status' <> 'OUTCOME_KNOWN'
    or document ->> 'recovery_capability_used' not in (
      'IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION'
    )
    or app_data_agent.contains_potential_plaintext_secret(document)
  then
    raise exception using errcode = '22023',
      message = 'PROVIDER_RECONCILIATION_EVIDENCE_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id)
  then
    raise exception using errcode = '42501',
      message = 'PROVIDER_RECONCILIATION_EVIDENCE_NOT_OWNED';
  end if;
  select run.* into run_record from app_data_agent.runs run
  where run.app_id = authority.app_id and run.tenant_id = authority.tenant_id
    and run.environment = authority.environment
    and run.run_id = (requested_command ->> 'run_id')::uuid
  for share;
  if not found then
    raise exception using errcode = '42501',
      message = 'PROVIDER_RECONCILIATION_EVIDENCE_NOT_OWNED';
  end if;
  content_hash := app_data_agent.u2_canonical_sha256(document);
  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id = authority.app_id and artifact.tenant_id = authority.tenant_id
    and artifact.environment = authority.environment and artifact.run_id = run_record.run_id
    and artifact.artifact_id = (requested_command ->> 'evidence_id')::uuid
    and artifact.artifact_type = 'ProviderReconciliationEvidence'
    and artifact.revision = 1
  for share;
  if found then
    if artifact_record.content_hash <> content_hash or artifact_record.document_json <> document then
      raise exception using errcode = '23505',
        message = 'PROVIDER_RECONCILIATION_EVIDENCE_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-reconciliation-evidence-commit-result@1.0.0',
      'disposition','REPLAYED','reference',pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,
        'artifact_type','ProviderReconciliationEvidence',
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash));
  end if;
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,run_record.run_id,
    (requested_command ->> 'evidence_id')::uuid,'ProviderReconciliationEvidence',1,
    content_hash,document,0,true,null,null,committed_at
  ) returning * into artifact_record;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-reconciliation-evidence-commit-result@1.0.0',
    'disposition','CREATED','reference',pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,
      'artifact_type','ProviderReconciliationEvidence',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023',
    message = 'PROVIDER_RECONCILIATION_EVIDENCE_INVALID';
end
$function$;

create function app_data_agent.reconcile_provider_invocation_unknown(
  requested_reconciliation_authority jsonb,
  requested_command jsonb,
  requested_usage jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  unknown_record app_data_agent.provider_invocation_outcomes%rowtype;
  existing_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  existing_usage app_data_agent.provider_invocation_usage_receipts%rowtype;
  evidence_record app_data_agent.artifacts%rowtype;
  response_record app_data_agent.artifacts%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  candidate jsonb := requested_command -> 'outcome';
  usage_candidate jsonb := requested_command -> 'usage';
  response_document jsonb := requested_command -> 'response_document';
  response_ref jsonb;
  outcome_document jsonb;
  usage_document jsonb;
  projection_document jsonb;
  outcome_id uuid;
  usage_id uuid;
  response_artifact_id uuid;
  terminal_at timestamptz;
  latency_ms bigint;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501', message = 'PROVIDER_RECONCILIATION_JOB_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_reconciliation_authority,array[
      'schema_version','reconciliation_id','evidence_hash'
    ]::text[])
    or requested_reconciliation_authority ->> 'schema_version' <>
      'provider-reconciliation-authority@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
      'attempt_id','worker_fence','actor','reconciliation_id','unknown_outcome_ref',
      'evidence_ref','evidence_hash','recovery_capability_used','response_document','outcome','usage'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-invocation-reconcile-unknown@1.0.0'
    or requested_command ->> 'actor' <> 'RECONCILIATION_JOB'
    or requested_command ->> 'reconciliation_id' <>
      requested_reconciliation_authority ->> 'reconciliation_id'
    or requested_command ->> 'evidence_hash' <>
      requested_reconciliation_authority ->> 'evidence_hash'
    or requested_command ->> 'evidence_hash' <> requested_command #>> '{evidence_ref,content_hash}'
    or requested_usage <> usage_candidate
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'unknown_outcome_ref',array['outcome_id','outcome_hash']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'evidence_ref',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
      ]::text[])
    or ((candidate ->> 'status') = 'COMPLETED' and not
      app_data_agent.provider_json_object_has_exact_keys(candidate,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
        'reason_code','response_hash','delivery_certainty','transition_from','recovery_action',
        'provider_call_count','retry_after_ms','reconciliation_of'
      ]::text[]))
    or ((candidate ->> 'status') <> 'COMPLETED' and not
      app_data_agent.provider_json_object_has_exact_keys(candidate,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
        'reason_code','response_artifact_ref','response_hash','delivery_certainty','transition_from',
        'recovery_action','provider_call_count','retry_after_ms','reconciliation_of'
      ]::text[]))
    or not app_data_agent.provider_json_object_has_exact_keys(usage_candidate,array[
      'schema_version','availability','source','input_tokens','output_tokens','total_tokens',
      'tool_calls','provider_call_count','capacity_status','unavailable_reason'
    ]::text[])
    or ((candidate ->> 'status') = 'COMPLETED' and
      candidate ->> 'schema_version' <> 'provider-invocation-completed-candidate@1.0.0')
    or ((candidate ->> 'status') <> 'COMPLETED' and
      candidate ->> 'schema_version' <> 'provider-invocation-outcome-candidate@1.0.0')
    or usage_candidate ->> 'schema_version' <> 'provider-invocation-usage-candidate@1.0.0'
    or candidate -> 'scope' <> requested_command -> 'scope'
    or ((candidate ->> 'status') = 'COMPLETED' and (
      not app_data_agent.provider_json_object_has_exact_keys(response_document,array[
        'schema_version','invocation_id','output_text','tool_calls','response_hash','content_hash'
      ]::text[])
      or response_document ->> 'schema_version' <> 'provider-response-artifact@1.0.0'
      or response_document ->> 'invocation_id' <> requested_command ->> 'invocation_id'
      or response_document ->> 'response_hash' <> candidate ->> 'response_hash'
      or response_document ->> 'response_hash' <> app_data_agent.u2_canonical_sha256(
        pg_catalog.jsonb_build_object(
          'output_text',response_document -> 'output_text',
          'tool_calls',response_document -> 'tool_calls'))
      or response_document ->> 'content_hash' <>
        app_data_agent.u2_canonical_sha256(response_document - 'content_hash')
      or pg_catalog.jsonb_typeof(response_document -> 'output_text') <> 'string'
      or pg_catalog.length(response_document ->> 'output_text') > 1000000
      or pg_catalog.jsonb_typeof(response_document -> 'tool_calls') <> 'array'
      or pg_catalog.jsonb_array_length(response_document -> 'tool_calls') > 256
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(response_document -> 'tool_calls') call
        where not app_data_agent.provider_json_object_has_exact_keys(
          call,array['tool_call_id','tool_name','arguments']::text[])
          or pg_catalog.length(call ->> 'tool_call_id') not between 1 and 256
          or call ->> 'tool_name' !~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
      )))
    or ((candidate ->> 'status') <> 'COMPLETED' and response_document <> 'null'::jsonb)
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then raise exception using errcode = '22023', message = 'PROVIDER_RECONCILIATION_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id)
  then
    raise exception using errcode = '42501', message = 'PROVIDER_RECONCILIATION_NOT_AUTHORIZED';
  end if;
  select intent.* into intent_record from app_data_agent.provider_invocation_intents intent
  where intent.app_id = (requested_command #>> '{scope,app_id}')::uuid
    and intent.tenant_id = (requested_command #>> '{scope,tenant_id}')::uuid
    and intent.environment = requested_command #>> '{scope,environment}'
    and intent.workspace_id = (requested_command #>> '{scope,workspace_id}')::uuid
    and intent.principal_id = (requested_command #>> '{scope,principal_id}')::uuid
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid for update;
  if not found or not ((requested_command ->> 'recovery_capability_used') = any(intent_record.recovery_capabilities)) then
    raise exception using errcode = '42501', message = 'PROVIDER_RECONCILIATION_NOT_AUTHORIZED';
  end if;
  select outcome.* into unknown_record from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.outcome_id = (requested_command #>> '{unknown_outcome_ref,outcome_id}')::uuid
    and outcome.outcome_hash = requested_command #>> '{unknown_outcome_ref,outcome_hash}'
    and outcome.dispatch_hash = requested_command ->> 'dispatch_hash'
    and outcome.state = 'OUTCOME_UNKNOWN' for share;
  if not found or candidate ->> 'transition_from' <> 'OUTCOME_UNKNOWN'
    or unknown_record.attempt_id <> (requested_command ->> 'attempt_id')::uuid
    or unknown_record.worker_fence <> (requested_command ->> 'worker_fence')::bigint
    or candidate ->> 'reconciliation_of' <> unknown_record.outcome_id::text
    or candidate ->> 'status' not in ('COMPLETED','FAILED','THROTTLED')
    or candidate ->> 'recovery_action' <> 'NONE'
    or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_KNOWN'
    or candidate ->> 'intent_id' <> intent_record.intent_id::text
    or candidate ->> 'invocation_id' <> intent_record.invocation_id::text
    or candidate ->> 'run_id' <> intent_record.run_id::text
    or candidate -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or candidate ->> 'dispatch_hash' <> unknown_record.dispatch_hash
    or candidate ->> 'provider_call_count' <> usage_candidate ->> 'provider_call_count'
    or candidate ->> 'recovery_action' <> 'NONE'
    or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_KNOWN'
    or (candidate ->> 'status' = 'COMPLETED' and (
      candidate -> 'reason_code' <> 'null'::jsonb
      or candidate ->> 'provider_call_count' <> '1'
      or candidate -> 'retry_after_ms' <> 'null'::jsonb))
    or (candidate ->> 'status' = 'FAILED' and (
      candidate ->> 'reason_code' is null
      or candidate ->> 'provider_call_count' <> '1'
      or candidate -> 'retry_after_ms' <> 'null'::jsonb))
    or (candidate ->> 'status' = 'THROTTLED' and (
      candidate ->> 'reason_code' <> 'PROVIDER_THROTTLED'
      or candidate ->> 'provider_call_count' <> '1'
      or (candidate ->> 'retry_after_ms')::bigint not between 1 and 86400000))
    or (candidate ->> 'status' <> 'COMPLETED' and (
      candidate -> 'response_artifact_ref' <> 'null'::jsonb
      or candidate -> 'response_hash' <> 'null'::jsonb))
    or (usage_candidate ->> 'availability' = 'AVAILABLE' and (
      usage_candidate ->> 'source' not in ('PROVIDER_REPORTED','ESTIMATED')
      or (usage_candidate ->> 'input_tokens')::bigint not between 0 and 9007199254740991
      or (usage_candidate ->> 'output_tokens')::bigint not between 0 and 9007199254740991
      or (usage_candidate ->> 'total_tokens')::bigint <>
        (usage_candidate ->> 'input_tokens')::bigint +
        (usage_candidate ->> 'output_tokens')::bigint
      or (usage_candidate ->> 'tool_calls')::bigint not between 0 and 9007199254740991
      or usage_candidate ->> 'provider_call_count' <> '1'
      or usage_candidate ->> 'capacity_status' <> 'WITHIN_LIMIT'
      or usage_candidate -> 'unavailable_reason' <> 'null'::jsonb))
    or (usage_candidate ->> 'availability' = 'UNAVAILABLE' and (
      usage_candidate ->> 'source' <> 'UNAVAILABLE'
      or usage_candidate -> 'input_tokens' <> 'null'::jsonb
      or usage_candidate -> 'output_tokens' <> 'null'::jsonb
      or usage_candidate -> 'total_tokens' <> 'null'::jsonb
      or usage_candidate -> 'tool_calls' <> 'null'::jsonb
      or usage_candidate ->> 'provider_call_count' <> '1'
      or usage_candidate ->> 'capacity_status' <> 'UNAVAILABLE'
      or usage_candidate ->> 'unavailable_reason' not in (
        'PROVIDER_DID_NOT_REPORT_USAGE','PROVIDER_PROTOCOL_VIOLATION')))
    or usage_candidate ->> 'availability' not in ('AVAILABLE','UNAVAILABLE')
  then raise exception using errcode = '55000', message = 'PROVIDER_RECONCILIATION_PARENT_MISMATCH'; end if;
  select artifact.* into evidence_record from app_data_agent.artifacts artifact
  where artifact.app_id = intent_record.app_id and artifact.tenant_id = intent_record.tenant_id
    and artifact.environment = intent_record.environment
    and artifact.run_id = (requested_command #>> '{evidence_ref,run_id}')::uuid
    and artifact.artifact_id = (requested_command #>> '{evidence_ref,artifact_id}')::uuid
    and artifact.artifact_type = 'ProviderReconciliationEvidence'
    and artifact.revision = (requested_command #>> '{evidence_ref,revision}')::integer
    and artifact.content_hash = requested_command ->> 'evidence_hash' and artifact.is_active;
  if not found
    or requested_command #>> '{evidence_ref,artifact_type}' <> 'ProviderReconciliationEvidence'
    or requested_command -> 'evidence_ref' <> pg_catalog.jsonb_build_object(
      'artifact_id',evidence_record.artifact_id,
      'artifact_type','ProviderReconciliationEvidence',
      'app_id',evidence_record.app_id,'tenant_id',evidence_record.tenant_id,
      'environment',evidence_record.environment,'run_id',evidence_record.run_id,
      'revision',evidence_record.revision,'content_hash',evidence_record.content_hash)
    or evidence_record.content_hash <> app_data_agent.u2_canonical_sha256(evidence_record.document_json)
    or not app_data_agent.provider_json_object_has_exact_keys(evidence_record.document_json,array[
      'schema_version','evidence_id','scope','run_id','reconciliation_id','invocation_id',
      'unknown_outcome_id','recovery_capability_used','evidence_status'
    ]::text[])
    or evidence_record.document_json ->> 'schema_version' <>
      'provider-reconciliation-evidence@1.0.0'
    or evidence_record.document_json ->> 'evidence_id' <> evidence_record.artifact_id::text
    or evidence_record.document_json -> 'scope' <> requested_command -> 'scope'
    or evidence_record.document_json ->> 'run_id' <> evidence_record.run_id::text
    or evidence_record.document_json ->> 'evidence_status' <> 'OUTCOME_KNOWN'
    or evidence_record.document_json ->> 'reconciliation_id' <> requested_command ->> 'reconciliation_id'
    or evidence_record.document_json ->> 'invocation_id' <> intent_record.invocation_id::text
    or evidence_record.document_json ->> 'unknown_outcome_id' <> unknown_record.outcome_id::text
    or evidence_record.document_json ->> 'recovery_capability_used' <>
      requested_command ->> 'recovery_capability_used'
  then raise exception using errcode = '55000', message = 'PROVIDER_RECONCILIATION_EVIDENCE_INVALID'; end if;
  select permit.* into permit_record from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment and permit.intent_id = intent_record.intent_id
    and permit.dispatch_hash = unknown_record.dispatch_hash;
  select outcome.* into existing_outcome from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.reconciliation_id = (requested_command ->> 'reconciliation_id')::uuid;
  if found then
    select usage.* into strict existing_usage from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = existing_outcome.app_id and usage.tenant_id = existing_outcome.tenant_id
      and usage.environment = existing_outcome.environment and usage.outcome_id = existing_outcome.outcome_id;
    if candidate ->> 'status' = 'COMPLETED' then
      select artifact.* into strict response_record
      from app_data_agent.artifacts artifact
      where artifact.app_id = existing_outcome.app_id
        and artifact.tenant_id = existing_outcome.tenant_id
        and artifact.environment = existing_outcome.environment
        and artifact.run_id = existing_outcome.run_id
        and artifact.artifact_id = existing_outcome.response_artifact_id
        and artifact.artifact_type = 'ProviderResponseArtifact'
        and artifact.revision = existing_outcome.response_artifact_revision
        and artifact.content_hash = existing_outcome.response_artifact_content_hash;
      if response_record.document_json <> response_document then
        raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
      end if;
      response_ref := existing_outcome.outcome_json #> '{candidate,response_artifact_ref}';
      candidate := (candidate - 'schema_version') || pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'response_artifact_ref',response_ref);
    end if;
    if existing_outcome.outcome_json -> 'candidate' <> candidate
      or existing_usage.usage_json - array[
        'schema_version','usage_receipt_id','outcome_id','intent_id','invocation_id',
        'scope','run_id','observed_at','usage_hash'
      ]::text[] <> usage_candidate - 'schema_version'
    then
      raise exception using errcode = '23505', message = 'PROVIDER_RECONCILIATION_CONFLICT';
    end if;
    outcome_document := existing_outcome.outcome_json; usage_document := existing_usage.usage_json;
  else
    terminal_at := pg_catalog.clock_timestamp(); outcome_id := pg_catalog.gen_random_uuid();
    usage_id := pg_catalog.gen_random_uuid();
    if candidate ->> 'status' = 'COMPLETED' then
      select artifact.* into response_record from app_data_agent.artifacts artifact
      where artifact.app_id = intent_record.app_id
        and artifact.tenant_id = intent_record.tenant_id
        and artifact.environment = intent_record.environment
        and artifact.run_id = intent_record.run_id
        and artifact.artifact_type = 'ProviderResponseArtifact'
        and artifact.revision = 1
        and artifact.document_json ->> 'invocation_id' = intent_record.invocation_id::text
      for share;
      if found and (response_record.content_hash <> response_document ->> 'content_hash'
          or response_record.document_json <> response_document) then
        raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
      elsif not found then
        response_artifact_id := pg_catalog.gen_random_uuid();
        insert into app_data_agent.artifacts (
          app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
          document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
        ) values (
          intent_record.app_id,intent_record.tenant_id,intent_record.environment,
          intent_record.run_id,response_artifact_id,'ProviderResponseArtifact',1,
          response_document ->> 'content_hash',response_document,unknown_record.worker_fence,
          true,null,null,terminal_at
        ) returning * into response_record;
      end if;
      response_ref := pg_catalog.jsonb_build_object(
        'artifact_id',response_record.artifact_id,'artifact_type','ProviderResponseArtifact',
        'app_id',response_record.app_id,'tenant_id',response_record.tenant_id,
        'environment',response_record.environment,'run_id',response_record.run_id,
        'revision',response_record.revision,'content_hash',response_record.content_hash);
      candidate := (candidate - 'schema_version') || pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'response_artifact_ref',response_ref);
    end if;
    latency_ms := greatest(0::bigint,pg_catalog.floor(
      extract(epoch from terminal_at - unknown_record.started_at) * 1000)::bigint);
    outcome_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome@1.0.0','outcome_id',outcome_id,
      'candidate',candidate,'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(unknown_record.started_at),
      'terminal_at',app_data_agent.runtime_iso_timestamp(terminal_at),'latency_ms',latency_ms);
    outcome_document := outcome_document || pg_catalog.jsonb_build_object(
      'outcome_hash',app_data_agent.u2_canonical_sha256(outcome_document));
    usage_document := (usage_candidate - 'schema_version') || pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-usage@1.0.0','usage_receipt_id',usage_id,
      'outcome_id',outcome_id,'intent_id',intent_record.intent_id,'invocation_id',intent_record.invocation_id,
      'scope',requested_command -> 'scope','run_id',intent_record.run_id,
      'observed_at',app_data_agent.runtime_iso_timestamp(terminal_at));
    usage_document := usage_document || pg_catalog.jsonb_build_object(
      'usage_hash',app_data_agent.u2_canonical_sha256(usage_document));
    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
      transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,worker_id,
      lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
      response_artifact_id,response_artifact_type,response_artifact_revision,
      response_artifact_content_hash,response_hash,evidence_run_id,evidence_artifact_id,
      evidence_artifact_type,evidence_artifact_revision,evidence_hash,reason_code,provider_call_count,
      retry_after_ms,delivery_certainty,started_at,terminal_at,latency_ms,reconciliation_id,
      recovery_capability_used,reconciliation_of,outcome_json,outcome_hash,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,outcome_id,
      intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,unknown_record.dispatch_hash,
      unknown_record.transition_revision + 1,unknown_record.transition_revision,unknown_record.outcome_hash,
      candidate ->> 'status','RECONCILER','OUTCOME_UNKNOWN',candidate ->> 'recovery_action',
      permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,permit_record.command_id,
      permit_record.worker_id,permit_record.lease_token,permit_record.worker_fence,true,true,
      response_record.artifact_id,case when response_record.artifact_id is null then null else 'ProviderResponseArtifact' end,
      response_record.revision,response_record.content_hash,candidate ->> 'response_hash',
      evidence_record.run_id,evidence_record.artifact_id,evidence_record.artifact_type,
      evidence_record.revision,evidence_record.content_hash,candidate ->> 'reason_code',
      (candidate ->> 'provider_call_count')::integer,(candidate ->> 'retry_after_ms')::bigint,
      candidate ->> 'delivery_certainty',unknown_record.started_at,terminal_at,latency_ms,
      (requested_command ->> 'reconciliation_id')::uuid,requested_command ->> 'recovery_capability_used',
      unknown_record.outcome_id,outcome_document,outcome_document ->> 'outcome_hash',terminal_at);
    insert into app_data_agent.provider_invocation_usage_receipts (
      app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
      outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,output_tokens,
      total_tokens,tool_calls,provider_call_count,capacity_status,unavailable_reason,usage_json,usage_hash,
      observed_at,committed_at
    ) values (intent_record.app_id,intent_record.tenant_id,intent_record.environment,usage_id,
      intent_record.intent_id,intent_record.invocation_id,outcome_id,unknown_record.transition_revision + 1,
      outcome_document ->> 'outcome_hash',usage_document ->> 'availability',usage_document ->> 'source',
      (usage_document ->> 'input_tokens')::bigint,(usage_document ->> 'output_tokens')::bigint,
      (usage_document ->> 'total_tokens')::bigint,(usage_document ->> 'tool_calls')::bigint,
      (usage_document ->> 'provider_call_count')::integer,usage_document ->> 'capacity_status',
      usage_document ->> 'unavailable_reason',usage_document,usage_document ->> 'usage_hash',terminal_at,terminal_at);
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0','invocation_id',intent_record.invocation_id,
    'run_id',intent_record.run_id,'provider',intent_record.provider,
    'model_profile_id',intent_record.model_profile_id,'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,'artifact_type','ModelCertificationReceipt',
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'run_id',intent_record.certification_run_id,
      'revision',intent_record.certification_revision,'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,
    'attempt_no',permit_record.attempt_no,'recovery_action',outcome_document #> '{candidate,recovery_action}',
    'status',outcome_document #>> '{candidate,status}','reason_code',outcome_document #> '{candidate,reason_code}',
    'dispatch_hash',unknown_record.dispatch_hash,'response_hash',outcome_document #> '{candidate,response_hash}',
    'usage_availability',usage_document -> 'availability','usage_source',usage_document -> 'source',
    'input_tokens',usage_document -> 'input_tokens','output_tokens',usage_document -> 'output_tokens',
    'total_tokens',usage_document -> 'total_tokens','tool_calls',usage_document -> 'tool_calls',
    'provider_call_count',usage_document -> 'provider_call_count',
    'retry_after_ms',outcome_document #> '{candidate,retry_after_ms}',
    'latency_ms',outcome_document -> 'latency_ms',
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' || intent_record.run_id::text ||
      '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',outcome_document -> 'terminal_at');
  if outcome_document #>> '{candidate,intent_id}' <> intent_record.intent_id::text
    or outcome_document #>> '{candidate,invocation_id}' <> intent_record.invocation_id::text
    or outcome_document #>> '{candidate,run_id}' <> intent_record.run_id::text
    or outcome_document #> '{candidate,scope}' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or outcome_document #>> '{candidate,dispatch_hash}' <> unknown_record.dispatch_hash
    or usage_document ->> 'intent_id' <> intent_record.intent_id::text
    or usage_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or usage_document ->> 'run_id' <> intent_record.run_id::text
    or usage_document -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or projection_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or projection_document ->> 'run_id' <> intent_record.run_id::text
    or projection_document ->> 'provider' <> intent_record.provider
    or projection_document ->> 'model_profile_id' <> intent_record.model_profile_id::text
    or projection_document ->> 'model_config_version' <> intent_record.model_config_version::text
    or projection_document ->> 'profile_version' <> intent_record.profile_version
    or projection_document ->> 'model_id' <> intent_record.model_id
    or projection_document ->> 'attempt_id' <> permit_record.attempt_id::text
    or projection_document ->> 'attempt_no' <> permit_record.attempt_no::text
    or projection_document ->> 'dispatch_hash' <> unknown_record.dispatch_hash
    or ((outcome_document #>> '{candidate,status}' = 'COMPLETED') <>
      (outcome_document #> '{candidate,response_artifact_ref}' <> 'null'::jsonb))
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_RECONCILIATION_RESULT_CLOSURE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-reconcile-unknown-result@1.0.0',
    'disposition',case when existing_outcome.outcome_id is null then 'CREATED' else 'REPLAYED' end,
    'reconciliation_id',(requested_command ->> 'reconciliation_id')::uuid,
    'intent',intent_record.intent_json,'permit',permit_record.permit_json,
    'response_artifact_ref',case when outcome_document #>> '{candidate,status}' = 'COMPLETED'
      then outcome_document #> '{candidate,response_artifact_ref}' else null end,
    'outcome',outcome_document,'usage',usage_document,'projection',projection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_RECONCILIATION_COMMAND_INVALID';
end
$function$;

create function app_data_agent.recover_stale_provider_invocation_marker(
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  existing_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  usage_record app_data_agent.provider_invocation_usage_receipts%rowtype;
  attempt_record app_data_agent.run_attempts%rowtype;
  outbox_record app_data_agent.outbox%rowtype;
  recovery_artifact app_data_agent.artifacts%rowtype;
  candidate jsonb := requested_command -> 'outcome';
  usage_candidate jsonb := requested_command -> 'usage';
  receipt_document jsonb;
  receipt_reference jsonb;
  outcome_document jsonb;
  usage_document jsonb;
  projection_document jsonb;
  inactive_observation jsonb;
  recovery_action text;
  disposition text := 'CREATED';
  observed_at timestamptz;
  outcome_id uuid;
  usage_id uuid;
  latency_ms bigint;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_JOB_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','actor','recovery_id','intent','permit','marker',
      'recovery_capability_used','recovery_resolution','outcome','usage'
    ]::text[])
    or requested_command ->> 'schema_version' <>
      'provider-invocation-recover-stale-marker@1.0.0'
    or requested_command ->> 'actor' <> 'STALE_MARKER_RECOVERY_JOB'
    or requested_command ->> 'recovery_resolution' <> 'MARK_OUTCOME_UNKNOWN'
    or not app_data_agent.provider_json_object_has_exact_keys(candidate,array[
      'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
      'reason_code','response_artifact_ref','response_hash','delivery_certainty','transition_from',
      'recovery_action','provider_call_count','retry_after_ms','reconciliation_of'
    ]::text[])
    or candidate ->> 'schema_version' <> 'provider-invocation-outcome-candidate@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(usage_candidate,array[
      'schema_version','availability','source','input_tokens','output_tokens','total_tokens',
      'tool_calls','provider_call_count','capacity_status','unavailable_reason'
    ]::text[])
    or usage_candidate ->> 'schema_version' <> 'provider-invocation-usage-candidate@1.0.0'
    or candidate ->> 'status' <> 'OUTCOME_UNKNOWN'
    or candidate ->> 'reason_code' <> 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'
    or candidate -> 'response_artifact_ref' <> 'null'::jsonb
    or candidate -> 'response_hash' <> 'null'::jsonb
    or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_UNKNOWN'
    or (candidate ->> 'transition_from') not in ('DISPATCH_MARKED','RESPONSE_OBSERVED')
    or candidate ->> 'provider_call_count' <> '1'
    or candidate -> 'retry_after_ms' <> 'null'::jsonb
    or candidate -> 'reconciliation_of' <> 'null'::jsonb
    or usage_candidate ->> 'availability' <> 'UNAVAILABLE'
    or usage_candidate ->> 'source' <> 'UNAVAILABLE'
    or usage_candidate -> 'input_tokens' <> 'null'::jsonb
    or usage_candidate -> 'output_tokens' <> 'null'::jsonb
    or usage_candidate -> 'total_tokens' <> 'null'::jsonb
    or usage_candidate -> 'tool_calls' <> 'null'::jsonb
    or usage_candidate ->> 'provider_call_count' <> '1'
    or usage_candidate ->> 'capacity_status' <> 'UNAVAILABLE'
    or usage_candidate ->> 'unavailable_reason' <> 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'
  then
    raise exception using errcode = '22023',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_COMMAND_INVALID';
  end if;

  recovery_action := case requested_command ->> 'recovery_capability_used'
    when 'IDEMPOTENT_REQUEST' then 'SAFE_RETRY'
    when 'INVOCATION_STATUS_QUERY' then 'STATUS_QUERY_REQUIRED'
    when 'INVOCATION_RECONCILIATION' then 'RECONCILIATION_REQUIRED'
    when 'AT_LEAST_ONCE_ONLY' then 'MANUAL_REVIEW_REQUIRED'
    else null
  end;
  if recovery_action is null or candidate ->> 'recovery_action' <> recovery_action then
    raise exception using errcode = '22023',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_CAPABILITY_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(true);
  select intent.* into intent_record
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id
    and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment
    and intent.principal_id = authority.principal_id
    and intent.intent_id = (requested_command #>> '{intent,intent_id}')::uuid
  for update;
  if not found
    or intent_record.intent_json <> requested_command -> 'intent'
    or intent_record.intent_hash <> requested_command #>> '{intent,intent_hash}'
    or candidate ->> 'intent_id' <> intent_record.intent_id::text
    or candidate ->> 'invocation_id' <> intent_record.invocation_id::text
    or candidate ->> 'run_id' <> intent_record.run_id::text
    or candidate -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or not (intent_record.intent_json #> '{invocation_spec,certification,recovery_capabilities}'
      @> pg_catalog.jsonb_build_array(requested_command ->> 'recovery_capability_used'))
  then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_INTENT_INVALID';
  end if;

  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id
    and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment
    and permit.intent_id = intent_record.intent_id
    and permit.permit_id = (requested_command #>> '{permit,permit_id}')::uuid
  for update;
  if not found
    or permit_record.permit_json <> requested_command -> 'permit'
    or permit_record.permit_hash <> requested_command #>> '{permit,permit_hash}'
    or permit_record.invocation_id <> intent_record.invocation_id
    or permit_record.run_id <> intent_record.run_id
    or candidate ->> 'dispatch_hash' <> permit_record.dispatch_hash
  then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_PERMIT_INVALID';
  end if;

  select marker.* into marker_record
  from app_data_agent.provider_invocation_outcomes marker
  where marker.app_id = intent_record.app_id
    and marker.tenant_id = intent_record.tenant_id
    and marker.environment = intent_record.environment
    and marker.intent_id = intent_record.intent_id
    and marker.outcome_id = (requested_command #>> '{marker,marker_id}')::uuid
    and marker.state = 'DISPATCH_MARKED'
  for share;
  if not found
    or marker_record.outcome_json <> requested_command -> 'marker'
    or marker_record.outcome_hash <> requested_command #>> '{marker,marker_hash}'
    or marker_record.dispatch_hash <> permit_record.dispatch_hash
    or marker_record.attempt_id <> permit_record.attempt_id
    or marker_record.worker_fence <> permit_record.worker_fence
  then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_MARKER_INVALID';
  end if;
  select marker.* into response_marker_record
  from app_data_agent.provider_invocation_outcomes marker
  where marker.app_id = intent_record.app_id
    and marker.tenant_id = intent_record.tenant_id
    and marker.environment = intent_record.environment
    and marker.intent_id = intent_record.intent_id
    and marker.dispatch_hash = permit_record.dispatch_hash
    and marker.attempt_id = permit_record.attempt_id
    and marker.worker_fence = permit_record.worker_fence
    and marker.state = 'RESPONSE_OBSERVED';
  if (response_marker_record.outcome_id is null
      and candidate ->> 'transition_from' <> 'DISPATCH_MARKED')
    or (response_marker_record.outcome_id is not null
      and candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED')
  then
    raise exception using errcode = '55000',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_PARENT_MISMATCH';
  end if;

  select outcome.* into existing_outcome
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id
    and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.reconciliation_id = (requested_command ->> 'recovery_id')::uuid;
  if found then
    select usage.* into strict usage_record
    from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = existing_outcome.app_id
      and usage.tenant_id = existing_outcome.tenant_id
      and usage.environment = existing_outcome.environment
      and usage.outcome_id = existing_outcome.outcome_id;
    select artifact.* into strict recovery_artifact
    from app_data_agent.artifacts artifact
    where artifact.app_id = existing_outcome.app_id
      and artifact.tenant_id = existing_outcome.tenant_id
      and artifact.environment = existing_outcome.environment
      and artifact.run_id = existing_outcome.run_id
      and artifact.artifact_id = (requested_command ->> 'recovery_id')::uuid
      and artifact.artifact_type = 'ProviderStaleMarkerRecoveryReceipt'
      and artifact.revision = 1
      and artifact.content_hash = existing_outcome.evidence_hash;
    if existing_outcome.state <> 'OUTCOME_UNKNOWN'
      or existing_outcome.parent_outcome_hash <>
        coalesce(response_marker_record.outcome_hash,marker_record.outcome_hash)
      or existing_outcome.outcome_json -> 'candidate' <> candidate
      or usage_record.usage_json - array[
        'schema_version','usage_receipt_id','outcome_id','intent_id','invocation_id',
        'scope','run_id','observed_at','usage_hash'
      ]::text[] <> usage_candidate - 'schema_version'
      or recovery_artifact.document_json ->> 'content_hash' <> recovery_artifact.content_hash
      or recovery_artifact.content_hash <>
        app_data_agent.u2_canonical_sha256(recovery_artifact.document_json - 'content_hash')
    then
      raise exception using errcode = '23505',
        message = 'PROVIDER_STALE_MARKER_RECOVERY_CONFLICT';
    end if;
    disposition := 'REPLAYED';
    outcome_document := existing_outcome.outcome_json;
    usage_document := usage_record.usage_json;
    receipt_document := recovery_artifact.document_json;
  else
    if exists (
      select 1 from app_data_agent.provider_invocation_outcomes outcome
      where outcome.app_id = intent_record.app_id
        and outcome.tenant_id = intent_record.tenant_id
        and outcome.environment = intent_record.environment
        and outcome.intent_id = intent_record.intent_id
        and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')
    ) then
      raise exception using errcode = '55000',
        message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
    end if;

    select attempt.* into strict attempt_record
    from app_data_agent.run_attempts attempt
    where attempt.app_id = permit_record.app_id
      and attempt.tenant_id = permit_record.tenant_id
      and attempt.environment = permit_record.environment
      and attempt.run_id = permit_record.run_id
      and attempt.attempt_id = permit_record.attempt_id
      and attempt.outbox_id = permit_record.outbox_id
      and attempt.command_id = permit_record.command_id
    for update;
    select message.* into strict outbox_record
    from app_data_agent.outbox message
    where message.app_id = permit_record.app_id
      and message.tenant_id = permit_record.tenant_id
      and message.environment = permit_record.environment
      and message.run_id = permit_record.run_id
      and message.outbox_id = permit_record.outbox_id
      and message.command_id = permit_record.command_id
    for update;
    observed_at := pg_catalog.clock_timestamp();
    if attempt_record.status = 'ACTIVE'
      and attempt_record.worker_id = permit_record.worker_id
      and attempt_record.lease_token = permit_record.lease_token
      and attempt_record.worker_fence = permit_record.worker_fence
      and attempt_record.lease_expires_at > observed_at
      and outbox_record.status = 'LEASED'
      and outbox_record.active_attempt_id = permit_record.attempt_id
      and outbox_record.lease_owner = permit_record.worker_id
      and outbox_record.lease_token = permit_record.lease_token
      and outbox_record.run_fence = permit_record.worker_fence
      and outbox_record.lease_expires_at > observed_at
    then
      raise exception using errcode = '40001',
        message = 'PROVIDER_STALE_MARKER_LEASE_STILL_ACTIVE';
    end if;

    inactive_observation := pg_catalog.jsonb_build_object(
      'permit_id',permit_record.permit_id,'permit_hash',permit_record.permit_hash,
      'old_attempt_id',permit_record.attempt_id,'old_worker_fence',permit_record.worker_fence,
      'lease_status','INACTIVE','observed_at',app_data_agent.runtime_iso_timestamp(observed_at));
    receipt_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-stale-marker-recovery-receipt@1.0.0',
      'recovery_id',(requested_command ->> 'recovery_id')::uuid,
      'actor','STALE_MARKER_RECOVERY_JOB','intent_id',intent_record.intent_id,
      'intent_hash',intent_record.intent_hash,'invocation_id',intent_record.invocation_id,
      'scope',intent_record.intent_json #> '{invocation_spec,scope}','run_id',intent_record.run_id,
      'permit_id',permit_record.permit_id,'permit_hash',permit_record.permit_hash,
      'marker_id',marker_record.outcome_id,'marker_hash',marker_record.outcome_hash,
      'old_attempt_id',permit_record.attempt_id,'old_worker_fence',permit_record.worker_fence,
      'recovery_capability_used',requested_command ->> 'recovery_capability_used',
      'recovery_action',recovery_action,'lease_status','INACTIVE',
      'inactive_observed_at',app_data_agent.runtime_iso_timestamp(observed_at),
      'inactive_observation_hash',app_data_agent.u2_canonical_sha256(inactive_observation),
      'recovered_at',app_data_agent.runtime_iso_timestamp(observed_at));
    receipt_document := receipt_document || pg_catalog.jsonb_build_object(
      'content_hash',app_data_agent.u2_canonical_sha256(receipt_document));
    insert into app_data_agent.artifacts (
      app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
      document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,intent_record.run_id,
      (requested_command ->> 'recovery_id')::uuid,'ProviderStaleMarkerRecoveryReceipt',1,
      receipt_document ->> 'content_hash',receipt_document,0,true,null,null,observed_at
    ) returning * into recovery_artifact;

    outcome_id := pg_catalog.gen_random_uuid();
    usage_id := pg_catalog.gen_random_uuid();
    latency_ms := greatest(0::bigint,pg_catalog.floor(
      extract(epoch from observed_at - marker_record.started_at) * 1000)::bigint);
    outcome_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome@1.0.0','outcome_id',outcome_id,
      'candidate',candidate,
      'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(marker_record.started_at),
      'terminal_at',app_data_agent.runtime_iso_timestamp(observed_at),'latency_ms',latency_ms);
    outcome_document := outcome_document || pg_catalog.jsonb_build_object(
      'outcome_hash',app_data_agent.u2_canonical_sha256(outcome_document));
    usage_document := (usage_candidate - 'schema_version') || pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-usage@1.0.0','usage_receipt_id',usage_id,
      'outcome_id',outcome_id,'intent_id',intent_record.intent_id,
      'invocation_id',intent_record.invocation_id,
      'scope',intent_record.intent_json #> '{invocation_spec,scope}','run_id',intent_record.run_id,
      'observed_at',app_data_agent.runtime_iso_timestamp(observed_at));
    usage_document := usage_document || pg_catalog.jsonb_build_object(
      'usage_hash',app_data_agent.u2_canonical_sha256(usage_document));

    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
      transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,worker_id,
      lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
      response_artifact_id,response_artifact_type,response_artifact_revision,
      response_artifact_content_hash,response_hash,evidence_run_id,evidence_artifact_id,
      evidence_artifact_type,evidence_artifact_revision,evidence_hash,reason_code,provider_call_count,
      retry_after_ms,delivery_certainty,started_at,terminal_at,latency_ms,reconciliation_id,
      recovery_capability_used,reconciliation_of,outcome_json,outcome_hash,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,outcome_id,
      intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,permit_record.dispatch_hash,
      coalesce(response_marker_record.transition_revision,marker_record.transition_revision) + 1,
      coalesce(response_marker_record.transition_revision,marker_record.transition_revision),
      coalesce(response_marker_record.outcome_hash,marker_record.outcome_hash),
      'OUTCOME_UNKNOWN','RECONCILER',candidate ->> 'transition_from',recovery_action,
      permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,
      permit_record.command_id,permit_record.worker_id,permit_record.lease_token,
      permit_record.worker_fence,true,true,null,null,null,null,null,
      recovery_artifact.run_id,recovery_artifact.artifact_id,recovery_artifact.artifact_type,
      recovery_artifact.revision,recovery_artifact.content_hash,
      'PROVIDER_INVOCATION_OUTCOME_UNKNOWN',1,null,'DISPATCHED_OUTCOME_UNKNOWN',
      marker_record.started_at,observed_at,latency_ms,(requested_command ->> 'recovery_id')::uuid,
      requested_command ->> 'recovery_capability_used',null,outcome_document,
      outcome_document ->> 'outcome_hash',observed_at);
    insert into app_data_agent.provider_invocation_usage_receipts (
      app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
      outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,output_tokens,
      total_tokens,tool_calls,provider_call_count,capacity_status,unavailable_reason,usage_json,usage_hash,
      observed_at,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,usage_id,
      intent_record.intent_id,intent_record.invocation_id,outcome_id,
      coalesce(response_marker_record.transition_revision,marker_record.transition_revision) + 1,
      outcome_document ->> 'outcome_hash','UNAVAILABLE','UNAVAILABLE',null,null,null,null,1,
      'UNAVAILABLE','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',usage_document,
      usage_document ->> 'usage_hash',observed_at,observed_at);
  end if;

  receipt_reference := pg_catalog.jsonb_build_object(
    'artifact_id',recovery_artifact.artifact_id,
    'artifact_type','ProviderStaleMarkerRecoveryReceipt',
    'app_id',recovery_artifact.app_id,'tenant_id',recovery_artifact.tenant_id,
    'environment',recovery_artifact.environment,'run_id',recovery_artifact.run_id,
    'revision',recovery_artifact.revision,'content_hash',recovery_artifact.content_hash);
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0','invocation_id',intent_record.invocation_id,
    'run_id',intent_record.run_id,'provider',intent_record.provider,
    'model_profile_id',intent_record.model_profile_id,
    'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,
      'artifact_type','ModelCertificationReceipt','app_id',intent_record.app_id,
      'tenant_id',intent_record.tenant_id,'environment',intent_record.environment,
      'run_id',intent_record.certification_run_id,'revision',intent_record.certification_revision,
      'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,'attempt_no',permit_record.attempt_no,
    'recovery_action',outcome_document #> '{candidate,recovery_action}',
    'status','OUTCOME_UNKNOWN','reason_code','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
    'dispatch_hash',permit_record.dispatch_hash,'response_hash',null,
    'usage_availability','UNAVAILABLE','usage_source','UNAVAILABLE',
    'input_tokens',null,'output_tokens',null,'total_tokens',null,'tool_calls',null,
    'provider_call_count',1,'retry_after_ms',null,
    'latency_ms',outcome_document -> 'latency_ms',
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',outcome_document -> 'terminal_at');
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-recover-stale-marker-result@1.0.0',
    'disposition',disposition,'recovery_receipt_ref',receipt_reference,
    'recovery_receipt',receipt_document,'intent',intent_record.intent_json,
    'permit',permit_record.permit_json,'marker',marker_record.outcome_json,
    'outcome',outcome_document,'usage',usage_document,'projection',projection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023',
    message = 'PROVIDER_STALE_MARKER_RECOVERY_COMMAND_INVALID';
end
$function$;

create function app_data_agent.recover_next_stale_provider_invocation_marker()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  recovery_id uuid;
  recovery_capability text;
  recovery_action text;
  candidate jsonb;
  usage_candidate jsonb;
  command jsonb;
  result jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_JOB_ROLE_REQUIRED';
  end if;
  select * into strict authority from platform.current_backend_authority(true);

  select marker.*
  into marker_record
  from app_data_agent.provider_invocation_outcomes marker
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = marker.app_id
   and intent.tenant_id = marker.tenant_id
   and intent.environment = marker.environment
   and intent.intent_id = marker.intent_id
   and intent.invocation_id = marker.invocation_id
  join app_data_agent.provider_invocation_dispatch_permits permit
    on permit.app_id = marker.app_id
   and permit.tenant_id = marker.tenant_id
   and permit.environment = marker.environment
   and permit.intent_id = marker.intent_id
   and permit.invocation_id = marker.invocation_id
   and permit.run_id = marker.run_id
   and permit.dispatch_hash = marker.dispatch_hash
   and permit.attempt_id = marker.attempt_id
   and permit.outbox_id = marker.outbox_id
   and permit.command_id = marker.command_id
   and permit.worker_id = marker.worker_id
   and permit.lease_token = marker.lease_token
   and permit.worker_fence = marker.worker_fence
  join app_data_agent.run_attempts attempt
    on attempt.app_id = permit.app_id
   and attempt.tenant_id = permit.tenant_id
   and attempt.environment = permit.environment
   and attempt.run_id = permit.run_id
   and attempt.attempt_id = permit.attempt_id
   and attempt.outbox_id = permit.outbox_id
   and attempt.command_id = permit.command_id
  join app_data_agent.outbox message
    on message.app_id = permit.app_id
   and message.tenant_id = permit.tenant_id
   and message.environment = permit.environment
   and message.run_id = permit.run_id
   and message.outbox_id = permit.outbox_id
   and message.command_id = permit.command_id
  where marker.app_id = authority.app_id
    and marker.tenant_id = authority.tenant_id
    and marker.environment = authority.environment
    and intent.principal_id = authority.principal_id
    and marker.state = 'DISPATCH_MARKED'
    and not exists (
      select 1
      from app_data_agent.provider_invocation_outcomes later
      where later.app_id = marker.app_id
        and later.tenant_id = marker.tenant_id
        and later.environment = marker.environment
        and later.intent_id = marker.intent_id
        and later.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')
    )
    and not (
      attempt.status = 'ACTIVE'
      and attempt.worker_id = permit.worker_id
      and attempt.lease_token = permit.lease_token
      and attempt.worker_fence = permit.worker_fence
      and attempt.lease_expires_at > pg_catalog.clock_timestamp()
      and message.status = 'LEASED'
      and message.active_attempt_id = permit.attempt_id
      and message.lease_owner = permit.worker_id
      and message.lease_token = permit.lease_token
      and message.run_fence = permit.worker_fence
      and message.lease_expires_at > pg_catalog.clock_timestamp()
    )
  order by marker.committed_at,marker.outcome_id
  for update of marker skip locked
  limit 1;

  if not found then
    return null;
  end if;

  select intent.* into strict intent_record
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = marker_record.app_id
    and intent.tenant_id = marker_record.tenant_id
    and intent.environment = marker_record.environment
    and intent.intent_id = marker_record.intent_id
    and intent.invocation_id = marker_record.invocation_id;
  select permit.* into strict permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = marker_record.app_id
    and permit.tenant_id = marker_record.tenant_id
    and permit.environment = marker_record.environment
    and permit.intent_id = marker_record.intent_id
    and permit.invocation_id = marker_record.invocation_id
    and permit.run_id = marker_record.run_id
    and permit.dispatch_hash = marker_record.dispatch_hash
    and permit.attempt_id = marker_record.attempt_id
    and permit.worker_fence = marker_record.worker_fence;
  select marker.* into response_marker_record
  from app_data_agent.provider_invocation_outcomes marker
  where marker.app_id = marker_record.app_id
    and marker.tenant_id = marker_record.tenant_id
    and marker.environment = marker_record.environment
    and marker.intent_id = marker_record.intent_id
    and marker.dispatch_hash = marker_record.dispatch_hash
    and marker.attempt_id = marker_record.attempt_id
    and marker.worker_fence = marker_record.worker_fence
    and marker.state = 'RESPONSE_OBSERVED'
  for share;

  recovery_capability := case
    when intent_record.recovery_capabilities @> array['IDEMPOTENT_REQUEST']::text[]
      then 'IDEMPOTENT_REQUEST'
    when intent_record.recovery_capabilities @> array['INVOCATION_STATUS_QUERY']::text[]
      then 'INVOCATION_STATUS_QUERY'
    when intent_record.recovery_capabilities @> array['INVOCATION_RECONCILIATION']::text[]
      then 'INVOCATION_RECONCILIATION'
    when intent_record.recovery_capabilities = array['AT_LEAST_ONCE_ONLY']::text[]
      then 'AT_LEAST_ONCE_ONLY'
    else null
  end;
  recovery_action := case recovery_capability
    when 'IDEMPOTENT_REQUEST' then 'SAFE_RETRY'
    when 'INVOCATION_STATUS_QUERY' then 'STATUS_QUERY_REQUIRED'
    when 'INVOCATION_RECONCILIATION' then 'RECONCILIATION_REQUIRED'
    when 'AT_LEAST_ONCE_ONLY' then 'MANUAL_REVIEW_REQUIRED'
    else null
  end;
  if recovery_action is null then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_CAPABILITY_INVALID';
  end if;

  recovery_id := pg_catalog.gen_random_uuid();
  candidate := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-outcome-candidate@1.0.0',
    'intent_id',intent_record.intent_id,'invocation_id',intent_record.invocation_id,
    'scope',intent_record.intent_json #> '{invocation_spec,scope}',
    'run_id',intent_record.run_id,'dispatch_hash',permit_record.dispatch_hash,
    'status','OUTCOME_UNKNOWN','reason_code','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
    'response_artifact_ref',null,'response_hash',null,
    'delivery_certainty','DISPATCHED_OUTCOME_UNKNOWN','transition_from',case
      when response_marker_record.outcome_id is null then 'DISPATCH_MARKED'
      else 'RESPONSE_OBSERVED' end,
    'recovery_action',recovery_action,'provider_call_count',1,
    'retry_after_ms',null,'reconciliation_of',null);
  usage_candidate := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-usage-candidate@1.0.0',
    'availability','UNAVAILABLE','source','UNAVAILABLE','input_tokens',null,
    'output_tokens',null,'total_tokens',null,'tool_calls',null,'provider_call_count',1,
    'capacity_status','UNAVAILABLE',
    'unavailable_reason','PROVIDER_INVOCATION_OUTCOME_UNKNOWN');
  command := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-recover-stale-marker@1.0.0',
    'actor','STALE_MARKER_RECOVERY_JOB','recovery_id',recovery_id,
    'intent',intent_record.intent_json,'permit',permit_record.permit_json,
    'marker',marker_record.outcome_json,'recovery_capability_used',recovery_capability,
    'recovery_resolution','MARK_OUTCOME_UNKNOWN','outcome',candidate,'usage',usage_candidate);
  result := app_data_agent.recover_stale_provider_invocation_marker(command);
  if result ->> 'schema_version' <>
      'provider-invocation-recover-stale-marker-result@1.0.0'
    or result ->> 'disposition' <> 'CREATED'
    or result #>> '{recovery_receipt,recovery_id}' <> recovery_id::text
    or result -> 'intent' <> intent_record.intent_json
    or result -> 'permit' <> permit_record.permit_json
    or result -> 'marker' <> marker_record.outcome_json
    or result #>> '{outcome,candidate,status}' <> 'OUTCOME_UNKNOWN'
    or result #>> '{usage,availability}' <> 'UNAVAILABLE'
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_RESULT_CLOSURE_INVALID';
  end if;
  return result;
end
$function$;

create function app_data_agent.claim_provider_invocation_smoke_work(
  requested_worker_id text,
  requested_lease_duration_ms integer,
  expected_run_id uuid,
  expected_command_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  candidate record;
  claimed_at timestamptz;
  next_attempt_id uuid;
  next_attempt_no integer;
  next_lease_token bigint;
  next_worker_fence bigint;
  next_expires_at timestamptz;
  intent_count integer;
  permit_count integer;
  marker_count integer;
  outcome_count integer;
  usage_count integer;
  response_artifact_count integer;
  precondition jsonb;
  lease_document jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501',
      message = 'PROVIDER_SMOKE_JOB_ROLE_REQUIRED';
  end if;
  if requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_duration_ms not between 5000 and 900000
    or expected_run_id is null
    or expected_command_id is null
  then
    raise exception using errcode = '22023', message = 'PROVIDER_SMOKE_CLAIM_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  claimed_at := pg_catalog.clock_timestamp();

  select message.*,run.active_fence,run.principal_id,
    command.payload_json as command_payload,
    command.payload_json ->> 'kind' as resolved_command_kind
  into candidate
  from app_data_agent.outbox message
  join app_data_agent.runs run
    on run.app_id = message.app_id
   and run.tenant_id = message.tenant_id
   and run.environment = message.environment
   and run.run_id = message.run_id
  join app_data_agent.commands command
    on command.app_id = message.app_id
   and command.tenant_id = message.tenant_id
   and command.environment = message.environment
   and command.run_id = message.run_id
   and command.command_id = message.command_id
  where message.app_id = authority.app_id
    and message.tenant_id = authority.tenant_id
    and message.environment = authority.environment
    and message.run_id = expected_run_id
    and message.command_id = expected_command_id
    and message.topic = 'run.command.accepted'
    and message.status in ('PENDING','FAILED')
    and message.attempt_count = 0
    and message.claimable_at <= claimed_at
    and run.principal_id = authority.principal_id
    and run.status = 'QUEUED'
    and command.status = 'ACCEPTED'
    and app_data_agent.provider_json_object_has_exact_keys(
      command.payload_json,array['kind','effective_config_ref']::text[])
    and command.payload_json ->> 'kind' = 'START_L2_RESEARCH'
    and app_data_agent.provider_json_object_has_exact_keys(
      command.payload_json -> 'effective_config_ref',
      array['config_id','config_revision','config_hash']::text[])
    and not exists (
      select 1 from app_data_agent.outbox earlier
      where earlier.app_id = message.app_id
        and earlier.tenant_id = message.tenant_id
        and earlier.environment = message.environment
        and earlier.run_id = message.run_id
        and earlier.topic in ('run.command.accepted','run.work.resume')
        and earlier.status in ('PENDING','FAILED','LEASED')
        and earlier.queue_sequence < message.queue_sequence)
  for update of message,run,command skip locked;
  if not found then
    return null;
  end if;

  select pg_catalog.count(*)::integer into intent_count
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id
    and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment
    and intent.run_id = expected_run_id
    and intent.logical_call_id = expected_command_id;
  select pg_catalog.count(*)::integer into permit_count
  from app_data_agent.provider_invocation_dispatch_permits permit
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = permit.app_id and intent.tenant_id = permit.tenant_id
   and intent.environment = permit.environment and intent.intent_id = permit.intent_id
  where intent.run_id = expected_run_id and intent.logical_call_id = expected_command_id;
  select pg_catalog.count(*) filter (where outcome.state = 'DISPATCH_MARKED')::integer,
    pg_catalog.count(*) filter (where outcome.state <> 'DISPATCH_MARKED')::integer
  into marker_count,outcome_count
  from app_data_agent.provider_invocation_outcomes outcome
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = outcome.app_id and intent.tenant_id = outcome.tenant_id
   and intent.environment = outcome.environment and intent.intent_id = outcome.intent_id
  where intent.run_id = expected_run_id and intent.logical_call_id = expected_command_id;
  select pg_catalog.count(*)::integer into usage_count
  from app_data_agent.provider_invocation_usage_receipts usage
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = usage.app_id and intent.tenant_id = usage.tenant_id
   and intent.environment = usage.environment and intent.intent_id = usage.intent_id
  where intent.run_id = expected_run_id and intent.logical_call_id = expected_command_id;
  select pg_catalog.count(*)::integer into response_artifact_count
  from app_data_agent.artifacts artifact
  where artifact.app_id = authority.app_id
    and artifact.tenant_id = authority.tenant_id
    and artifact.environment = authority.environment
    and artifact.run_id = expected_run_id
    and artifact.artifact_type = 'ProviderResponseArtifact'
    and artifact.document_json ->> 'invocation_id' = expected_command_id::text;
  precondition := pg_catalog.jsonb_build_object(
    'run_id',expected_run_id,'command_id',expected_command_id,
    'logical_invocation_id',expected_command_id,
    'intent_count',intent_count,'permit_count',permit_count,'marker_count',marker_count,
    'outcome_count',outcome_count,'usage_count',usage_count,
    'response_artifact_count',response_artifact_count);
  if intent_count <> 0 or permit_count <> 0 or marker_count <> 0
    or outcome_count <> 0 or usage_count <> 0 or response_artifact_count <> 0
  then
    raise exception using errcode = '55000',
      message = 'PROVIDER_SMOKE_PRECONDITION_NOT_EMPTY';
  end if;

  select coalesce(pg_catalog.max(attempt.attempt_no),0)::integer + 1
  into next_attempt_no
  from app_data_agent.run_attempts attempt
  where attempt.app_id = authority.app_id
    and attempt.tenant_id = authority.tenant_id
    and attempt.environment = authority.environment
    and attempt.run_id = expected_run_id;
  next_attempt_id := pg_catalog.gen_random_uuid();
  next_lease_token := candidate.lease_token + 1;
  next_worker_fence := candidate.active_fence + 1;
  next_expires_at := claimed_at +
    (requested_lease_duration_ms * interval '1 millisecond');

  update app_data_agent.runs run
  set status = 'RUNNING',active_fence = next_worker_fence,updated_at = claimed_at
  where run.app_id = authority.app_id and run.tenant_id = authority.tenant_id
    and run.environment = authority.environment and run.run_id = expected_run_id
    and run.principal_id = authority.principal_id
    and run.status = 'QUEUED' and run.active_fence = candidate.active_fence;
  if not found then
    raise exception using errcode = '40001', message = 'PROVIDER_SMOKE_CLAIM_CONFLICT';
  end if;
  insert into app_data_agent.run_attempts (
    app_id,tenant_id,environment,run_id,outbox_id,command_id,attempt_id,attempt_no,
    worker_id,lease_token,worker_fence,lease_expires_at,last_heartbeat_at,started_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,expected_run_id,
    candidate.outbox_id,expected_command_id,next_attempt_id,next_attempt_no,
    requested_worker_id,next_lease_token,next_worker_fence,next_expires_at,claimed_at,claimed_at);
  update app_data_agent.outbox message
  set status = 'LEASED',attempt_count = 1,lease_owner = requested_worker_id,
    lease_token = next_lease_token,lease_expires_at = next_expires_at,published_at = null,
    active_attempt_id = next_attempt_id,run_fence = next_worker_fence,
    last_heartbeat_at = claimed_at
  where message.app_id = authority.app_id and message.tenant_id = authority.tenant_id
    and message.environment = authority.environment and message.outbox_id = candidate.outbox_id
    and message.run_id = expected_run_id and message.command_id = expected_command_id
    and message.status in ('PENDING','FAILED') and message.attempt_count = 0;
  if not found then
    raise exception using errcode = '40001', message = 'PROVIDER_SMOKE_CLAIM_CONFLICT';
  end if;
  update app_data_agent.commands command
  set status = 'PROCESSING'
  where command.app_id = authority.app_id and command.tenant_id = authority.tenant_id
    and command.environment = authority.environment and command.run_id = expected_run_id
    and command.command_id = expected_command_id and command.status = 'ACCEPTED';
  if not found then
    raise exception using errcode = '40001', message = 'PROVIDER_SMOKE_CLAIM_CONFLICT';
  end if;

  lease_document := pg_catalog.jsonb_build_object(
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment),
    'principal_id',authority.principal_id,'outbox_id',candidate.outbox_id,
    'run_id',expected_run_id,'command_id',expected_command_id,
    'command_kind',candidate.resolved_command_kind,'attempt_id',next_attempt_id,
    'attempt_no',next_attempt_no,'delivery_attempt_no',1,
    'lease_duration_ms',requested_lease_duration_ms,'worker_id',requested_worker_id,
    'lease_token',next_lease_token,'worker_fence',next_worker_fence,
    'expires_at',app_data_agent.runtime_iso_timestamp(next_expires_at),
    'payload',candidate.command_payload);
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-smoke-claim@1.0.0',
    'lease',lease_document,'precondition',precondition);
end
$function$;

create function app_data_agent.verify_provider_invocation_smoke_completion(
  requested_run_id uuid,
  requested_command_id uuid,
  requested_attempt_id uuid,
  expected_worker_fence bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  outcome_record app_data_agent.provider_invocation_outcomes%rowtype;
  usage_record app_data_agent.provider_invocation_usage_receipts%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
  intent_count integer;
  permit_count integer;
  marker_count integer;
  response_marker_count integer;
  outcome_count integer;
  usage_count integer;
  response_artifact_count integer;
  response_reference jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501', message = 'PROVIDER_SMOKE_JOB_ROLE_REQUIRED';
  end if;
  if requested_run_id is null or requested_command_id is null
    or requested_attempt_id is null or expected_worker_fence < 1
  then
    raise exception using errcode = '22023', message = 'PROVIDER_SMOKE_PROOF_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);

  select pg_catalog.count(*)::integer into intent_count
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment and intent.principal_id = authority.principal_id
    and intent.run_id = requested_run_id and intent.logical_call_id = requested_command_id;
  if intent_count = 1 then
    select intent.* into strict intent_record
    from app_data_agent.provider_invocation_intents intent
    where intent.app_id = authority.app_id and intent.tenant_id = authority.tenant_id
      and intent.environment = authority.environment and intent.principal_id = authority.principal_id
      and intent.run_id = requested_run_id and intent.logical_call_id = requested_command_id;
  end if;
  select pg_catalog.count(*)::integer into permit_count
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = authority.app_id and permit.tenant_id = authority.tenant_id
    and permit.environment = authority.environment
    and permit.intent_id = intent_record.intent_id;
  if permit_count = 1 then
    select permit.* into strict permit_record
    from app_data_agent.provider_invocation_dispatch_permits permit
    where permit.app_id = authority.app_id and permit.tenant_id = authority.tenant_id
      and permit.environment = authority.environment and permit.intent_id = intent_record.intent_id;
  end if;
  select pg_catalog.count(*) filter (where outcome.state = 'DISPATCH_MARKED')::integer,
    pg_catalog.count(*) filter (where outcome.state = 'RESPONSE_OBSERVED')::integer,
    pg_catalog.count(*) filter (where outcome.state in (
      'COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN'
    ))::integer
  into marker_count,response_marker_count,outcome_count
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
    and outcome.environment = authority.environment and outcome.intent_id = intent_record.intent_id;
  if marker_count = 1 then
    select outcome.* into strict marker_record
    from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
      and outcome.environment = authority.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state = 'DISPATCH_MARKED';
  end if;
  if response_marker_count = 1 then
    select outcome.* into strict response_marker_record
    from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
      and outcome.environment = authority.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state = 'RESPONSE_OBSERVED';
  end if;
  if outcome_count = 1 then
    select outcome.* into strict outcome_record
    from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
      and outcome.environment = authority.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN');
  end if;
  select pg_catalog.count(*)::integer into usage_count
  from app_data_agent.provider_invocation_usage_receipts usage
  where usage.app_id = authority.app_id and usage.tenant_id = authority.tenant_id
    and usage.environment = authority.environment and usage.intent_id = intent_record.intent_id;
  if usage_count = 1 then
    select usage.* into strict usage_record
    from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = authority.app_id and usage.tenant_id = authority.tenant_id
      and usage.environment = authority.environment and usage.intent_id = intent_record.intent_id;
  end if;
  select pg_catalog.count(*)::integer into response_artifact_count
  from app_data_agent.artifacts artifact
  where artifact.app_id = authority.app_id and artifact.tenant_id = authority.tenant_id
    and artifact.environment = authority.environment and artifact.run_id = requested_run_id
    and artifact.artifact_type = 'ProviderResponseArtifact'
    and artifact.artifact_id = outcome_record.response_artifact_id
    and artifact.revision = outcome_record.response_artifact_revision
    and artifact.content_hash = outcome_record.response_artifact_content_hash
    and artifact.is_active;
  if response_artifact_count = 1 then
    select artifact.* into strict artifact_record
    from app_data_agent.artifacts artifact
    where artifact.app_id = authority.app_id and artifact.tenant_id = authority.tenant_id
      and artifact.environment = authority.environment and artifact.run_id = requested_run_id
      and artifact.artifact_type = 'ProviderResponseArtifact'
      and artifact.artifact_id = outcome_record.response_artifact_id
      and artifact.revision = outcome_record.response_artifact_revision
      and artifact.content_hash = outcome_record.response_artifact_content_hash
      and artifact.is_active;
    response_reference := pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderResponseArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash);
  end if;

  if intent_count <> 1 or permit_count <> 1 or marker_count <> 1
    or response_marker_count <> 1
    or outcome_count <> 1 or usage_count <> 1 or response_artifact_count <> 1
    or intent_record.invocation_id <> requested_command_id
    or intent_record.provider <> 'deepseek' or intent_record.model_id <> 'deepseek-v4-flash'
    or permit_record.attempt_id <> requested_attempt_id
    or permit_record.worker_fence <> expected_worker_fence
    or permit_record.run_id <> requested_run_id
    or marker_record.dispatch_hash <> permit_record.dispatch_hash
    or marker_record.attempt_id <> requested_attempt_id
    or marker_record.worker_fence <> expected_worker_fence
    or marker_record.provider_call_count <> 1
    or response_marker_record.parent_outcome_hash <> marker_record.outcome_hash
    or response_marker_record.outcome_json ->> 'attempt_id' <> requested_attempt_id::text
    or response_marker_record.outcome_json ->> 'worker_fence' <> expected_worker_fence::text
    or response_marker_record.observation_kind <> 'COMPLETED'
    or response_marker_record.outcome_json ->> 'response_hash' <> outcome_record.response_hash
    or outcome_record.parent_outcome_hash <> response_marker_record.outcome_hash
    or outcome_record.transition_from <> 'RESPONSE_OBSERVED'
    or outcome_record.state <> 'COMPLETED'
    or outcome_record.dispatch_hash <> permit_record.dispatch_hash
    or outcome_record.attempt_id <> requested_attempt_id
    or outcome_record.worker_fence <> expected_worker_fence
    or outcome_record.provider_call_count <> 1
    or usage_record.outcome_id <> outcome_record.outcome_id
    or usage_record.outcome_hash <> outcome_record.outcome_hash
    or usage_record.provider_call_count <> 1
    or usage_record.availability not in ('AVAILABLE','UNAVAILABLE')
    or artifact_record.document_json ->> 'invocation_id' <> intent_record.invocation_id::text
    or artifact_record.document_json ->> 'response_hash' <> outcome_record.response_hash
    or artifact_record.content_hash <>
      app_data_agent.u2_canonical_sha256(artifact_record.document_json - 'content_hash')
    or outcome_record.outcome_json #> '{candidate,response_artifact_ref}' <>
      response_reference
  then
    raise exception using errcode = '55000', message = 'PROVIDER_SMOKE_PROOF_NOT_READY';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-smoke-proof@1.0.0',
    'run_id',requested_run_id,'command_id',requested_command_id,
    'logical_invocation_id',requested_command_id,'provider','deepseek',
    'model_id','deepseek-v4-flash','intent_id',intent_record.intent_id,
    'intent_hash',intent_record.intent_hash,'permit_id',permit_record.permit_id,
    'permit_hash',permit_record.permit_hash,'marker_id',marker_record.outcome_id,
    'marker_hash',marker_record.outcome_hash,'outcome_id',outcome_record.outcome_id,
    'outcome_hash',outcome_record.outcome_hash,'outcome_status','COMPLETED',
    'usage_receipt_id',usage_record.usage_receipt_id,
    'usage_receipt_hash',usage_record.usage_hash,
    'usage_availability',usage_record.availability,'provider_call_count',1,
    'response_artifact_ref',response_reference);
end
$function$;

create function app_data_agent.discover_next_provider_invocation_unknown()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  outcome_record app_data_agent.provider_invocation_outcomes%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501',
      message = 'PROVIDER_UNKNOWN_CLASSIFICATION_JOB_ROLE_REQUIRED';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  select outcome.* into outcome_record
  from app_data_agent.provider_invocation_outcomes outcome
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = outcome.app_id and intent.tenant_id = outcome.tenant_id
   and intent.environment = outcome.environment and intent.intent_id = outcome.intent_id
  where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
    and outcome.environment = authority.environment and intent.principal_id = authority.principal_id
    and outcome.state = 'OUTCOME_UNKNOWN'
    and intent.recovery_capabilities = array['AT_LEAST_ONCE_ONLY']::text[]
    and outcome.recovery_capability_used = 'AT_LEAST_ONCE_ONLY'
    and outcome.recovery_action = 'MANUAL_REVIEW_REQUIRED'
    and not exists (
      select 1 from app_data_agent.provider_invocation_outcomes terminal
      where terminal.app_id = outcome.app_id and terminal.tenant_id = outcome.tenant_id
        and terminal.environment = outcome.environment and terminal.intent_id = outcome.intent_id
        and terminal.state in ('COMPLETED','FAILED','THROTTLED'))
  order by outcome.committed_at,outcome.outcome_id
  for share of outcome skip locked
  limit 1;
  if not found then return null; end if;
  select intent.* into strict intent_record
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = outcome_record.app_id and intent.tenant_id = outcome_record.tenant_id
    and intent.environment = outcome_record.environment
    and intent.intent_id = outcome_record.intent_id;
  select permit.* into strict permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = outcome_record.app_id and permit.tenant_id = outcome_record.tenant_id
    and permit.environment = outcome_record.environment
    and permit.intent_id = outcome_record.intent_id
    and permit.dispatch_hash = outcome_record.dispatch_hash
    and permit.attempt_id = outcome_record.attempt_id
    and permit.worker_fence = outcome_record.worker_fence;
  if intent_record.recovery_capabilities <> array['AT_LEAST_ONCE_ONLY']::text[]
    or outcome_record.recovery_capability_used <> 'AT_LEAST_ONCE_ONLY'
    or outcome_record.recovery_action <> 'MANUAL_REVIEW_REQUIRED'
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_UNKNOWN_CLASSIFICATION_CLOSURE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-unknown-classification@1.0.0',
    'invocation_id',intent_record.invocation_id,'intent_id',intent_record.intent_id,
    'intent_hash',intent_record.intent_hash,'permit_id',permit_record.permit_id,
    'permit_hash',permit_record.permit_hash,'outcome_id',outcome_record.outcome_id,
    'outcome_hash',outcome_record.outcome_hash,
    'recovery_capability_used',outcome_record.recovery_capability_used,
    'recovery_action',outcome_record.recovery_action,
    'required_action',outcome_record.recovery_action);
end
$function$;

create function app_data_agent.load_provider_response_artifact(requested_command jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','invocation_id','reference'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-response-artifact-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'reference',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id',
        'revision','content_hash'
      ]::text[])
    or requested_command #>> '{reference,artifact_type}' <> 'ProviderResponseArtifact'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_LOAD_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id) then
    raise exception using errcode = '42501', message = 'PROVIDER_RESPONSE_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select intent.* into intent_record from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment and intent.principal_id = authority.principal_id
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid;
  if not found then
    raise exception using errcode = '42501', message = 'PROVIDER_RESPONSE_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id = intent_record.app_id and artifact.tenant_id = intent_record.tenant_id
    and artifact.environment = intent_record.environment and artifact.run_id = intent_record.run_id
    and artifact.artifact_id = (requested_command #>> '{reference,artifact_id}')::uuid
    and artifact.artifact_type = 'ProviderResponseArtifact'
    and artifact.revision = (requested_command #>> '{reference,revision}')::integer
    and artifact.content_hash = requested_command #>> '{reference,content_hash}'
    and artifact.document_json ->> 'invocation_id' = intent_record.invocation_id::text
    and artifact.is_active
    and exists (select 1 from app_data_agent.provider_invocation_outcomes outcome
      where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
        and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
        and outcome.state = 'COMPLETED' and outcome.response_artifact_id = artifact.artifact_id
        and outcome.response_artifact_revision = artifact.revision
        and outcome.response_artifact_content_hash = artifact.content_hash
        and outcome.response_hash = artifact.document_json ->> 'response_hash');
  if not found
    or requested_command -> 'reference' <> pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderResponseArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash)
    or artifact_record.content_hash <>
      app_data_agent.u2_canonical_sha256(artifact_record.document_json - 'content_hash')
    or artifact_record.document_json ->> 'response_hash' <>
      app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'output_text',artifact_record.document_json -> 'output_text',
        'tool_calls',artifact_record.document_json -> 'tool_calls'))
  then
    raise exception using errcode = '42501', message = 'PROVIDER_RESPONSE_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-response-artifact-load-result@1.0.0',
    'invocation_id',intent_record.invocation_id,
    'reference',requested_command -> 'reference','document',artifact_record.document_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_LOAD_INVALID';
end
$function$;
