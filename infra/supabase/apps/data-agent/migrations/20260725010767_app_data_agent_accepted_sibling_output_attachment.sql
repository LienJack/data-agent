-- agent_team_accepted_sibling_output_attachment_migration_checksum: sha256:2e00283ef9e76fc977642ef80caef3f02e58f6d6b1fd352b95778acb62960617
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='AGENT_TEAM_SIBLING_ATTACHMENT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='AGENT_TEAM_SIBLING_ATTACHMENT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010766_app_data_agent_falcon24_acceptance_campaign_authority')
  then raise exception using errcode='P0001',message='AGENT_TEAM_SIBLING_ATTACHMENT_BASELINE_10766_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
alter function app_data_agent.attach_agent_team_accepted_sibling_output(jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.prepare_agent_team_handoff(jsonb)
  owner to data_agent_u19_team_owner;

revoke all on app_data_agent.agent_team_accepted_sibling_output_attachments
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.attach_agent_team_accepted_sibling_output(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.prepare_agent_team_handoff(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant select on app_data_agent.artifacts to data_agent_u19_team_owner;
grant execute on function app_data_agent.attach_agent_team_accepted_sibling_output(jsonb),
  app_data_agent.prepare_agent_team_handoff(jsonb)
to data_agent_backend;
do $postconditions$
begin
  if not exists(
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent'
      and relation.relname='agent_team_accepted_sibling_output_attachments'
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.agent_team_accepted_sibling_output_attachments','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.attach_agent_team_accepted_sibling_output(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.prepare_agent_team_handoff(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'app_data_agent.attach_agent_team_accepted_sibling_output(jsonb)','EXECUTE')
    or pg_catalog.position(
      'agent_team_accepted_sibling_output_attachments' in
      pg_catalog.pg_get_functiondef('app_data_agent.prepare_agent_team_handoff(jsonb)'::regprocedure)
    )=0
  then raise exception using errcode='P0001',message='AGENT_TEAM_SIBLING_ATTACHMENT_AUTHORITY_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010767_app_data_agent_accepted_sibling_output_attachment',
  'sha256:2e00283ef9e76fc977642ef80caef3f02e58f6d6b1fd352b95778acb62960617');
commit;
