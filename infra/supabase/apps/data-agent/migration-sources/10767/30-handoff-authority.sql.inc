create or replace function app_data_agent.prepare_agent_team_handoff(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  authority jsonb;
  handoff jsonb;
  child jsonb;
  parent app_data_agent.agent_team_tasks%rowtype;
  existing app_data_agent.agent_team_handoffs%rowtype;
begin
  authority := app_data_agent.agent_team_assert_store_command(requested_command,'PREPARE_HANDOFF');
  handoff := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(handoff,array[
    'schema_version','parent_task_id','parent_expected_revision','parent_task_hash',
    'capability_id','capability_hash','request_hash','child_task','idempotency_key'
  ]) or handoff ->> 'schema_version' <> 'subagent-delegation-command@2.0.0'
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;
  child := handoff -> 'child_task';
  if not app_data_agent.provider_json_object_has_exact_keys(child,array[
    'schema_version','task_id','parent_task_id','parent_handoff_id','depth','scope','run_id',
    'profile_id','profile_revision','profile_hash','task_revision','goal_revision','attempt_id',
    'worker_fence','artifact_refs','context_epoch_ref','bounds','acceptance','task_hash'
  ]) or child ->> 'schema_version' <> 'agent-team-task@2.0.0'
    or child ->> 'task_hash' <> app_data_agent.u2_canonical_sha256(child-'task_hash')
    or (child ->> 'depth')::integer <> 1
    or child ->> 'parent_task_id' <> handoff ->> 'parent_task_id'
    or child ->> 'profile_id' = 'data-agent-orchestrator'
    or child -> 'scope' <> requested_command -> 'scope'
    or child ->> 'run_id' <> requested_command ->> 'run_id'
    or (child ->> 'worker_fence')::bigint <> (authority ->> 'worker_fence')::bigint
    or pg_catalog.jsonb_typeof(child -> 'artifact_refs')<>'array'
    or pg_catalog.jsonb_typeof(child -> 'bounds')<>'object'
    or pg_catalog.jsonb_typeof(child -> 'acceptance')<>'object'
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(child -> 'artifact_refs') reference
      where reference ->> 'app_id'<>authority ->> 'app_id'
        or reference ->> 'tenant_id'<>authority ->> 'tenant_id'
        or reference ->> 'environment'<>authority ->> 'environment'
        or reference ->> 'run_id'<>authority ->> 'run_id'
    )
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(child -> 'artifact_refs') reference
      group by reference having pg_catalog.count(*)>1
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions p
      where p.profile_id=child ->> 'profile_id'
        and p.profile_revision=(child ->> 'profile_revision')::integer
        and p.profile_hash=child ->> 'profile_hash'
    )
  then raise exception using errcode='22023',message='AGENT_TEAM_COMMAND_INVALID'; end if;

  select * into parent from app_data_agent.agent_team_tasks
  where app_id=(authority ->> 'app_id')::uuid and tenant_id=(authority ->> 'tenant_id')::uuid
    and environment=authority ->> 'environment' and task_id=(handoff ->> 'parent_task_id')::uuid
  for update;
  if not found or parent.depth<>0 or parent.profile_id<>'data-agent-orchestrator'
    or parent.task_revision<>(handoff ->> 'parent_expected_revision')::integer
    or parent.task_hash<>handoff ->> 'parent_task_hash'
    or parent.authority_attempt_id<>(authority ->> 'attempt_id')::uuid
    or parent.worker_fence<>(authority ->> 'worker_fence')::bigint
  then raise exception using errcode='40001',message='AGENT_TEAM_REVISION_CONFLICT'; end if;
  if (child ->> 'goal_revision')::integer<>parent.goal_revision
    or (child #>> '{bounds,max_context_bytes}')::integer>(parent.task_json #>> '{bounds,max_context_bytes}')::integer
    or (child #>> '{bounds,max_input_tokens}')::integer>(parent.task_json #>> '{bounds,max_input_tokens}')::integer
    or (child #>> '{bounds,max_output_tokens}')::integer>(parent.task_json #>> '{bounds,max_output_tokens}')::integer
    or (child #>> '{bounds,max_tool_calls}')::integer>(parent.task_json #>> '{bounds,max_tool_calls}')::integer
    or (child #>> '{bounds,timeout_ms}')::integer>(parent.task_json #>> '{bounds,timeout_ms}')::integer
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(child -> 'artifact_refs') child_reference
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(parent.task_json -> 'artifact_refs') parent_reference
        where parent_reference=child_reference
      ) and not exists (
        select 1
        from app_data_agent.agent_team_accepted_sibling_output_attachments attachment
        where attachment.app_id=parent.app_id and attachment.tenant_id=parent.tenant_id
          and attachment.environment=parent.environment and attachment.run_id=parent.run_id
          and attachment.root_task_id=parent.task_id
          and attachment.consumer_task_id=(child->>'task_id')::uuid
          and attachment.worker_fence=parent.worker_fence
          and attachment.attachment_json->>'consumer_profile_id'=child->>'profile_id'
          and (attachment.attachment_json->>'consumer_profile_revision')::integer=
            (child->>'profile_revision')::integer
          and attachment.attachment_json->>'consumer_profile_hash'=child->>'profile_hash'
          and attachment.attachment_json->'artifact_ref'=child_reference
      )
    )
  then raise exception using errcode='42501',message='AGENT_TEAM_CAPABILITY_REQUIRED'; end if;
  if child -> 'context_epoch_ref' <> 'null'::jsonb and (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(child -> 'artifact_refs') reference
    join app_data_agent.sensitive_execution_artifacts artifact
      on artifact.app_id=parent.app_id
     and artifact.tenant_id=parent.tenant_id
     and artifact.environment=parent.environment
     and artifact.run_id=parent.run_id
     and artifact.artifact_id=(reference ->> 'artifact_id')::uuid
     and artifact.artifact_revision=(reference ->> 'revision')::integer
     and artifact.plaintext_hash=reference ->> 'content_hash'
     and artifact.lifecycle_status='ACTIVE'
     and artifact.expires_at>pg_catalog.clock_timestamp()
    where reference ->> 'artifact_type'='SensitiveExecutionArtifact'
  ) <> 1 then
    raise exception using errcode='42501',message='AGENT_TEAM_CAPABILITY_REQUIRED';
  end if;
  if not exists (
    select 1 from app_data_agent.agent_team_task_capabilities c
    where c.app_id=parent.app_id and c.tenant_id=parent.tenant_id and c.environment=parent.environment
      and c.capability_id=(handoff ->> 'capability_id')::uuid
      and c.capability_hash=handoff ->> 'capability_hash'
      and c.task_id=parent.task_id and c.expires_at>pg_catalog.clock_timestamp()
      and c.worker_fence=parent.worker_fence
  ) then raise exception using errcode='42501',message='AGENT_TEAM_CAPABILITY_REQUIRED'; end if;

  select * into existing from app_data_agent.agent_team_handoffs
  where app_id=parent.app_id and tenant_id=parent.tenant_id and environment=parent.environment
    and command_id=(requested_command ->> 'command_id')::uuid;
  if found then
    if existing.handoff_json<>handoff or existing.request_hash<>requested_command ->> 'request_hash'
    then raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',existing.handoff_json);
  end if;

  insert into app_data_agent.agent_team_tasks(
    app_id,tenant_id,environment,run_id,principal_id,task_id,parent_task_id,parent_handoff_id,
    depth,profile_id,profile_revision,profile_hash,task_revision,goal_revision,task_attempt_id,
    authority_attempt_id,outbox_id,command_id,worker_id,lease_token,worker_fence,task_hash,
    create_command_id,create_request_hash,task_json
  ) values (
    parent.app_id,parent.tenant_id,parent.environment,parent.run_id,parent.principal_id,
    (child ->> 'task_id')::uuid,parent.task_id,(child ->> 'parent_handoff_id')::uuid,1,
    child ->> 'profile_id',(child ->> 'profile_revision')::integer,child ->> 'profile_hash',
    (child ->> 'task_revision')::integer,(child ->> 'goal_revision')::integer,
    (child ->> 'attempt_id')::uuid,(authority ->> 'attempt_id')::uuid,(authority ->> 'outbox_id')::uuid,
    (authority ->> 'command_id')::uuid,authority ->> 'worker_id',(authority ->> 'lease_token')::bigint,
    (authority ->> 'worker_fence')::bigint,child ->> 'task_hash',
    (requested_command ->> 'command_id')::uuid,requested_command ->> 'request_hash',child
  );
  insert into app_data_agent.agent_team_handoffs(
    app_id,tenant_id,environment,run_id,handoff_id,parent_task_id,child_task_id,
    parent_expected_revision,request_hash,command_id,handoff_json
  ) values (
    parent.app_id,parent.tenant_id,parent.environment,parent.run_id,
    (child ->> 'parent_handoff_id')::uuid,parent.task_id,(child ->> 'task_id')::uuid,
    (handoff ->> 'parent_expected_revision')::integer,requested_command ->> 'request_hash',
    (requested_command ->> 'command_id')::uuid,handoff
  );
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',handoff);
end
$function$;
