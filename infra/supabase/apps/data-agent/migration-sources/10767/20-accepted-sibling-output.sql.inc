create table app_data_agent.agent_team_accepted_sibling_output_attachments(
  app_id uuid not null,tenant_id uuid not null,environment text not null,run_id uuid not null,
  attachment_id uuid not null,root_task_id uuid not null,producer_task_id uuid not null,
  consumer_task_id uuid not null,artifact_id uuid not null,artifact_revision integer not null,
  artifact_content_hash text not null check(artifact_content_hash~'^sha256:[0-9a-f]{64}$'),
  completion_id uuid not null,verifier_decision_id uuid not null,
  acceptance_hash text not null check(acceptance_hash~'^sha256:[0-9a-f]{64}$'),
  worker_fence bigint not null check(worker_fence between 1 and 9007199254740991),
  attachment_hash text not null check(attachment_hash~'^sha256:[0-9a-f]{64}$'),
  command_id uuid not null,request_hash text not null check(request_hash~'^sha256:[0-9a-f]{64}$'),
  attachment_json jsonb not null check(
    pg_catalog.jsonb_typeof(attachment_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(attachment_json)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,attachment_id),
  unique(app_id,tenant_id,environment,command_id),
  unique(app_id,tenant_id,environment,root_task_id,consumer_task_id,artifact_id,artifact_revision,artifact_content_hash),
  foreign key(app_id,tenant_id,environment,root_task_id)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id),
  foreign key(app_id,tenant_id,environment,producer_task_id)
    references app_data_agent.agent_team_tasks(app_id,tenant_id,environment,task_id),
  foreign key(app_id,tenant_id,environment,completion_id)
    references app_data_agent.agent_team_completion_receipts(app_id,tenant_id,environment,completion_id),
  foreign key(app_id,tenant_id,environment,verifier_decision_id)
    references app_data_agent.agent_team_verifier_decisions(app_id,tenant_id,environment,decision_id),
  foreign key(app_id,tenant_id,environment,producer_task_id,acceptance_hash)
    references app_data_agent.agent_team_acceptance_receipts(app_id,tenant_id,environment,task_id,acceptance_hash),
  foreign key(app_id,tenant_id,environment,run_id,artifact_id,artifact_revision,artifact_content_hash)
    references app_data_agent.artifacts(app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash),
  check(root_task_id<>producer_task_id and root_task_id<>consumer_task_id
    and producer_task_id<>consumer_task_id)
);

alter table app_data_agent.agent_team_accepted_sibling_output_attachments owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_team_accepted_sibling_output_attachments enable row level security;
alter table app_data_agent.agent_team_accepted_sibling_output_attachments force row level security;
create policy agent_team_accepted_sibling_attachment_owner_all
on app_data_agent.agent_team_accepted_sibling_output_attachments for all to data_agent_u19_team_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create trigger agent_team_accepted_sibling_attachment_immutable before update or delete
on app_data_agent.agent_team_accepted_sibling_output_attachments for each row
execute function app_data_agent.reject_agent_team_authority_mutation();

create function app_data_agent.attach_agent_team_accepted_sibling_output(requested_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority jsonb; attachment jsonb;
  root_task app_data_agent.agent_team_tasks%rowtype;
  producer_task app_data_agent.agent_team_tasks%rowtype;
  existing app_data_agent.agent_team_accepted_sibling_output_attachments%rowtype;
begin
  authority:=app_data_agent.agent_team_assert_store_command(
    requested_command,'ATTACH_ACCEPTED_SIBLING_OUTPUT');
  attachment:=requested_command->'document';
  if not app_data_agent.provider_json_object_has_exact_keys(attachment,array[
    'schema_version','attachment_id','scope','run_id','root_task_id','root_task_hash',
    'producer_task_id','producer_task_hash','producer_profile_id','producer_tool_call_id',
    'consumer_task_id','consumer_tool_call_id','consumer_profile_id','consumer_profile_revision',
    'consumer_profile_hash','artifact_ref','completion_id','completion_hash',
    'verifier_decision_id','verifier_decision_hash','acceptance_hash','worker_fence',
    'attached_at','attachment_hash'])
    or attachment->>'schema_version'<>'agent-team-accepted-sibling-output-attachment@1.0.0'
    or attachment->>'attachment_hash'<>app_data_agent.u2_canonical_sha256(attachment-'attachment_hash')
    or attachment->'scope'<>requested_command->'scope'
    or attachment->>'run_id'<>requested_command->>'run_id'
    or attachment->>'root_task_id'<>requested_command->>'task_id'
    or pg_catalog.length(attachment->>'producer_tool_call_id') not between 1 and 256
    or pg_catalog.length(attachment->>'consumer_tool_call_id') not between 1 and 256
    or (attachment->>'attached_at')::timestamptz>pg_catalog.clock_timestamp()
  then raise exception using errcode='22023',message='AGENT_TEAM_ACCEPTED_SIBLING_OUTPUT_INVALID'; end if;

  select * into root_task from app_data_agent.agent_team_tasks task
  where task.app_id=(authority->>'app_id')::uuid and task.tenant_id=(authority->>'tenant_id')::uuid
    and task.environment=authority->>'environment'
    and task.task_id=(attachment->>'root_task_id')::uuid for share;
  select * into producer_task from app_data_agent.agent_team_tasks task
  where task.app_id=(authority->>'app_id')::uuid and task.tenant_id=(authority->>'tenant_id')::uuid
    and task.environment=authority->>'environment'
    and task.task_id=(attachment->>'producer_task_id')::uuid for share;
  if root_task.task_id is null or producer_task.task_id is null
    or root_task.depth<>0 or root_task.profile_id<>'data-agent-orchestrator'
    or producer_task.depth<>1 or producer_task.parent_task_id<>root_task.task_id
    or root_task.run_id<>producer_task.run_id or root_task.run_id<>(authority->>'run_id')::uuid
    or root_task.task_hash<>attachment->>'root_task_hash'
    or producer_task.task_hash<>attachment->>'producer_task_hash'
    or producer_task.profile_id<>attachment->>'producer_profile_id'
    or not exists(select 1 from app_data_agent.agent_profile_revisions profile
      where profile.profile_id=attachment->>'consumer_profile_id'
        and profile.profile_revision=(attachment->>'consumer_profile_revision')::integer
        and profile.profile_hash=attachment->>'consumer_profile_hash')
    or root_task.task_revision<>(requested_command->>'expected_revision')::integer
    or root_task.authority_attempt_id<>(authority->>'attempt_id')::uuid
    or producer_task.authority_attempt_id<>(authority->>'attempt_id')::uuid
    or root_task.worker_fence<>(authority->>'worker_fence')::bigint
    or producer_task.worker_fence<>root_task.worker_fence
    or (attachment->>'worker_fence')::bigint<>root_task.worker_fence
  then raise exception using errcode='40001',message='AGENT_TEAM_ACCEPTED_SIBLING_OUTPUT_INVALID'; end if;

  if not exists(
    select 1
    from app_data_agent.agent_team_completion_receipts completion
    join app_data_agent.agent_team_acceptance_receipts acceptance
      on acceptance.app_id=completion.app_id and acceptance.tenant_id=completion.tenant_id
     and acceptance.environment=completion.environment and acceptance.task_id=completion.task_id
     and acceptance.completion_id=completion.completion_id
    join app_data_agent.agent_team_verifier_decisions verifier
      on verifier.app_id=completion.app_id and verifier.tenant_id=completion.tenant_id
     and verifier.environment=completion.environment and verifier.task_id=completion.task_id
     and verifier.decision_id=(acceptance.receipt_json->>'verifier_decision_id')::uuid
    join app_data_agent.artifacts artifact
      on artifact.app_id=completion.app_id and artifact.tenant_id=completion.tenant_id
     and artifact.environment=completion.environment and artifact.run_id=completion.run_id
     and artifact.artifact_id=(attachment#>>'{artifact_ref,artifact_id}')::uuid
     and artifact.revision=(attachment#>>'{artifact_ref,revision}')::integer
     and artifact.content_hash=attachment#>>'{artifact_ref,content_hash}' and artifact.is_active
    where completion.app_id=producer_task.app_id and completion.tenant_id=producer_task.tenant_id
      and completion.environment=producer_task.environment and completion.task_id=producer_task.task_id
      and completion.completion_id=(attachment->>'completion_id')::uuid
      and completion.completion_hash=attachment->>'completion_hash'
      and completion.receipt_json->'output_ref'=attachment->'artifact_ref'
      and completion.receipt_json->>'profile_id'=producer_task.profile_id
      and completion.receipt_json->>'task_hash'=producer_task.task_hash
      and (completion.receipt_json->>'worker_fence')::bigint=producer_task.worker_fence
      and acceptance.status='ACCEPTED'
      and acceptance.acceptance_hash=attachment->>'acceptance_hash'
      and acceptance.receipt_json->>'completion_hash'=completion.completion_hash
      and acceptance.receipt_json->>'verifier_decision_id'=attachment->>'verifier_decision_id'
      and acceptance.receipt_json->>'verifier_decision_hash'=attachment->>'verifier_decision_hash'
      and verifier.decision_hash=attachment->>'verifier_decision_hash'
      and verifier.completion_hash=completion.completion_hash
      and verifier.decision_json->>'semantic_status'='VERIFIED'
      and verifier.decision_json->>'schema_valid'='PASS'
      and verifier.decision_json->>'scope_valid'='PASS'
      and verifier.decision_json->>'policy_valid'='PASS'
      and verifier.decision_json->>'provenance_valid'='PASS'
      and verifier.decision_json->>'execution_valid'='PASS'
      and verifier.decision_json->>'intent_grounded'='PASS'
      and verifier.decision_json->>'oracle_verified'='PASS'
      and artifact.worker_fence=producer_task.worker_fence
      and artifact.document_json->>'profile_id'=producer_task.profile_id
      and artifact.document_json->>'task_id'=producer_task.task_id::text
      and artifact.document_json->'artifact_ref'=attachment->'artifact_ref'
  ) then raise exception using errcode='55000',message='AGENT_TEAM_ACCEPTED_SIBLING_OUTPUT_REQUIRED'; end if;

  select * into existing from app_data_agent.agent_team_accepted_sibling_output_attachments row
  where row.app_id=root_task.app_id and row.tenant_id=root_task.tenant_id
    and row.environment=root_task.environment
    and row.command_id=(requested_command->>'command_id')::uuid;
  if found then
    if existing.request_hash<>requested_command->>'request_hash'
      or existing.attachment_json<>attachment
    then raise exception using errcode='23505',message='AGENT_TEAM_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.agent_team_store_result(requested_command,'REPLAYED',existing.attachment_json);
  end if;
  insert into app_data_agent.agent_team_accepted_sibling_output_attachments(
    app_id,tenant_id,environment,run_id,attachment_id,root_task_id,producer_task_id,
    consumer_task_id,artifact_id,artifact_revision,artifact_content_hash,completion_id,
    verifier_decision_id,acceptance_hash,worker_fence,attachment_hash,command_id,request_hash,
    attachment_json)
  values(root_task.app_id,root_task.tenant_id,root_task.environment,root_task.run_id,
    (attachment->>'attachment_id')::uuid,root_task.task_id,producer_task.task_id,
    (attachment->>'consumer_task_id')::uuid,(attachment#>>'{artifact_ref,artifact_id}')::uuid,
    (attachment#>>'{artifact_ref,revision}')::integer,attachment#>>'{artifact_ref,content_hash}',
    (attachment->>'completion_id')::uuid,(attachment->>'verifier_decision_id')::uuid,
    attachment->>'acceptance_hash',root_task.worker_fence,attachment->>'attachment_hash',
    (requested_command->>'command_id')::uuid,requested_command->>'request_hash',attachment);
  return app_data_agent.agent_team_store_result(requested_command,'CREATED',attachment);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='AGENT_TEAM_ACCEPTED_SIBLING_OUTPUT_INVALID';
end
$function$;
