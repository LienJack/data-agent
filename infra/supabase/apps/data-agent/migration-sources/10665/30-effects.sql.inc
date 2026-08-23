create table app_data_agent.tool_effects (
  app_id uuid not null,tenant_id uuid not null,environment text not null,effect_id uuid not null,
  run_id uuid not null,principal_id uuid not null,attempt_id uuid not null,worker_fence bigint not null check(worker_fence>0),
  task_capability_hash text not null,projection_receipt_ref jsonb not null,
  server_id uuid not null,server_revision bigint not null,server_revision_hash text not null,tool_id text not null,
  effect_semantics text not null check(effect_semantics in ('READ_ONLY','IDEMPOTENT_REQUEST','OUTCOME_STATUS_QUERY')),
  remote_idempotency_key text,request_payload_hash text not null,policy_revision bigint not null,
  intent_hash text not null,state text not null check(state in (
    'INTENT_COMMITTED','DISPATCH_MARKED','RESPONSE_OBSERVED','COMPLETED','FAILED','TOOL_OUTCOME_UNKNOWN')),
  dispatch_hash text,response_hash text,current_transition_id uuid,current_transition_hash text,
  version bigint not null default 1 check(version>0),created_at timestamptz not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,effect_id),
  unique(app_id,tenant_id,environment,run_id,remote_idempotency_key),
  foreign key(app_id,tenant_id,environment,server_id,server_revision,server_revision_hash)
    references app_data_agent.mcp_server_revisions(app_id,tenant_id,environment,server_id,revision,revision_hash),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,principal_id)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict,
  check((effect_semantics='IDEMPOTENT_REQUEST')=(remote_idempotency_key is not null)),
  check(intent_hash ~ '^sha256:[0-9a-f]{64}$' and request_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  check((state='INTENT_COMMITTED' and dispatch_hash is null and response_hash is null)
    or (state in ('DISPATCH_MARKED','TOOL_OUTCOME_UNKNOWN') and dispatch_hash is not null and response_hash is null)
    or (state in ('RESPONSE_OBSERVED','COMPLETED','FAILED') and dispatch_hash is not null and response_hash is not null))
);
create table app_data_agent.tool_effect_transitions (
  app_id uuid not null,tenant_id uuid not null,environment text not null,effect_id uuid not null,
  transition_id uuid not null,sequence bigint not null check(sequence>0),expected_state text not null,target_state text not null,
  transition_hash text not null,transition_json jsonb not null,committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,effect_id,transition_id),
  unique(app_id,tenant_id,environment,effect_id,sequence),
  foreign key(app_id,tenant_id,environment,effect_id)
    references app_data_agent.tool_effects(app_id,tenant_id,environment,effect_id) on delete restrict,
  check(transition_hash ~ '^sha256:[0-9a-f]{64}$'
    and transition_hash=app_data_agent.u2_canonical_sha256(transition_json-'transition_hash'))
);
create trigger tool_effect_transitions_immutable before update or delete on app_data_agent.tool_effect_transitions
for each row execute function app_data_agent.reject_extension_immutable_mutation();
alter table app_data_agent.tool_effects enable row level security;
alter table app_data_agent.tool_effects force row level security;
alter table app_data_agent.tool_effect_transitions enable row level security;
alter table app_data_agent.tool_effect_transitions force row level security;
create policy tool_effects_owner on app_data_agent.tool_effects for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy tool_effect_transitions_owner on app_data_agent.tool_effect_transitions for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));

create function app_data_agent.begin_tool_effect(intent jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.tool_effects%rowtype; head_record app_data_agent.mcp_server_heads%rowtype;
  revision_record app_data_agent.mcp_server_revisions%rowtype; tool_document jsonb; now_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if intent is null or intent->>'schema_version' is distinct from 'tool-effect-intent@1.0.0'
    or intent->>'intent_hash' is distinct from app_data_agent.u2_canonical_sha256(intent-'intent_hash')
  then raise exception using errcode='22023',message='TOOL_EFFECT_INTENT_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if intent->'scope'<>pg_catalog.jsonb_build_object('app_id',authority.app_id,
    'tenant_id',authority.tenant_id,'environment',authority.environment)
    or intent#>>'{projection_receipt_ref,run_id}'<>intent->>'run_id'
    or intent#>'{projection_receipt_ref}' is null
  then raise exception using errcode='42501',message='TOOL_EFFECT_SCOPE_MISMATCH'; end if;
  if app_data_agent.lock_owned_run_fence((intent->>'run_id')::uuid)<>(intent->>'worker_fence')::bigint then
    raise exception using errcode='40001',message='TOOL_EFFECT_WORKER_FENCE_STALE'; end if;
  select * into head_record from app_data_agent.mcp_server_heads head
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment and head.server_id=(intent->>'server_id')::uuid
    and head.active_revision=(intent->>'server_revision')::bigint
    and head.active_revision_hash=intent->>'server_revision_hash' and head.lifecycle='ENABLED' for share;
  if not found then raise exception using errcode='40001',message='MCP_SERVER_REVISION_STALE'; end if;
  select * into revision_record from app_data_agent.mcp_server_revisions revision
  where revision.app_id=head_record.app_id and revision.tenant_id=head_record.tenant_id
    and revision.environment=head_record.environment and revision.server_id=head_record.server_id
    and revision.revision=head_record.active_revision and revision.revision_hash=head_record.active_revision_hash
    and revision.approval_status='APPROVED' for share;
  select candidate.value into tool_document from pg_catalog.jsonb_array_elements(revision_record.document_json->'tools') candidate(value)
  where candidate.value->>'tool_id'=intent->>'tool_id'
    and candidate.value->>'effect_semantics'=intent->>'effect_semantics';
  if tool_document is null then raise exception using errcode='42501',message='MCP_TOOL_NOT_AUTHORIZED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.tool_effects(app_id,tenant_id,environment,effect_id,run_id,principal_id,
    attempt_id,worker_fence,task_capability_hash,projection_receipt_ref,server_id,server_revision,
    server_revision_hash,tool_id,effect_semantics,remote_idempotency_key,request_payload_hash,
    policy_revision,intent_hash,state,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(intent->>'effect_id')::uuid,
    (intent->>'run_id')::uuid,authority.principal_id,(intent->>'attempt_id')::uuid,
    (intent->>'worker_fence')::bigint,intent->>'task_capability_hash',intent->'projection_receipt_ref',
    (intent->>'server_id')::uuid,(intent->>'server_revision')::bigint,intent->>'server_revision_hash',
    intent->>'tool_id',intent->>'effect_semantics',intent->>'remote_idempotency_key',
    intent->>'request_payload_hash',(intent->>'policy_revision')::bigint,intent->>'intent_hash',
    'INTENT_COMMITTED',now_at,now_at) on conflict do nothing;
  select * into existing from app_data_agent.tool_effects effect where effect.app_id=authority.app_id
    and effect.tenant_id=authority.tenant_id and effect.environment=authority.environment
    and effect.effect_id=(intent->>'effect_id')::uuid for share;
  if existing.intent_hash<>intent->>'intent_hash' then
    raise exception using errcode='23505',message='TOOL_EFFECT_IDEMPOTENCY_CONFLICT'; end if;
  return pg_catalog.jsonb_build_object('schema_version','tool-effect-result@1.0.0','disposition',
    case when existing.created_at=now_at then 'CREATED' else 'REPLAYED' end,
    'effect_id',existing.effect_id,'state',existing.state,'version',existing.version,'intent_hash',existing.intent_hash);
end
$function$;

create function app_data_agent.transition_tool_effect(transition jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; effect app_data_agent.tool_effects%rowtype; now_at timestamptz; next_sequence bigint;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if transition is null or transition->>'schema_version' is distinct from 'tool-effect-transition@1.0.0'
    or transition->>'transition_hash' is distinct from app_data_agent.u2_canonical_sha256(transition-'transition_hash')
  then raise exception using errcode='22023',message='TOOL_EFFECT_TRANSITION_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  select * into effect from app_data_agent.tool_effects candidate where candidate.app_id=authority.app_id
    and candidate.tenant_id=authority.tenant_id and candidate.environment=authority.environment
    and candidate.effect_id=(transition->>'effect_id')::uuid for update;
  if not found or effect.principal_id<>authority.principal_id then
    raise exception using errcode='42501',message='TOOL_EFFECT_NOT_FOUND'; end if;
  if effect.state<>transition->>'expected_state' then
    if effect.current_transition_hash=transition->>'transition_hash' then
      return pg_catalog.jsonb_build_object('schema_version','tool-effect-result@1.0.0',
        'disposition','REPLAYED','effect_id',effect.effect_id,'state',effect.state,'version',effect.version,
        'intent_hash',effect.intent_hash); end if;
    raise exception using errcode='40001',message='TOOL_EFFECT_STATE_CONFLICT';
  end if;
  if app_data_agent.lock_owned_run_fence(effect.run_id)<>effect.worker_fence then
    raise exception using errcode='40001',message='TOOL_EFFECT_WORKER_FENCE_STALE'; end if;
  if not ((effect.state='INTENT_COMMITTED' and transition->>'target_state' in ('DISPATCH_MARKED','FAILED'))
    or (effect.state='DISPATCH_MARKED' and transition->>'target_state' in ('RESPONSE_OBSERVED','TOOL_OUTCOME_UNKNOWN'))
    or (effect.state='RESPONSE_OBSERVED' and transition->>'target_state' in ('COMPLETED','FAILED'))
    or (effect.state='TOOL_OUTCOME_UNKNOWN' and transition->>'target_state' in ('COMPLETED','FAILED')))
  then raise exception using errcode='23514',message='TOOL_EFFECT_TRANSITION_INVALID'; end if;
  if (effect.state='TOOL_OUTCOME_UNKNOWN')<>(transition->>'reconciliation_of' is not null) then
    raise exception using errcode='23514',message='TOOL_EFFECT_RECONCILIATION_REQUIRED'; end if;
  now_at:=pg_catalog.clock_timestamp(); next_sequence:=effect.version;
  update app_data_agent.tool_effects current_effect set state=transition->>'target_state',
    dispatch_hash=coalesce(transition->>'dispatch_hash',dispatch_hash),
    response_hash=coalesce(transition->>'response_hash',response_hash),
    current_transition_id=(transition->>'transition_id')::uuid,
    current_transition_hash=transition->>'transition_hash',version=version+1,updated_at=now_at
  where current_effect.app_id=effect.app_id and current_effect.tenant_id=effect.tenant_id
    and current_effect.environment=effect.environment and current_effect.effect_id=effect.effect_id;
  insert into app_data_agent.tool_effect_transitions(app_id,tenant_id,environment,effect_id,
    transition_id,sequence,expected_state,target_state,transition_hash,transition_json,committed_at)
  values(effect.app_id,effect.tenant_id,effect.environment,effect.effect_id,
    (transition->>'transition_id')::uuid,next_sequence,transition->>'expected_state',
    transition->>'target_state',transition->>'transition_hash',transition,now_at);
  return pg_catalog.jsonb_build_object('schema_version','tool-effect-result@1.0.0','disposition','APPLIED',
    'effect_id',effect.effect_id,'state',transition->>'target_state','version',effect.version+1,
    'intent_hash',effect.intent_hash);
end
$function$;
