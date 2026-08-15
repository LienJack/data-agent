-- ============================================================
-- 10639: State assembly, event append, start and turn/tool RPCs
-- ============================================================

create function semantic.build_authoring_state(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_authoring_run_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'run', pg_catalog.jsonb_build_object(
      'schema_version', 'semantic-authoring-run@1.0.0',
      'authority', 'POSTGRESQL',
      'scope', pg_catalog.jsonb_build_object(
        'app_id', run.app_id,
        'tenant_id', run.tenant_id,
        'environment', run.environment
      ),
      'semantic_domain', run.semantic_domain,
      'authoring_run_id', run.authoring_run_id,
      'candidate_id', run.candidate_id,
      'graph_id', run.graph_id,
      'base_release_id', run.base_release_id,
      'principal_id', run.principal_id,
      'policy_version', run.policy_version,
      'status', run.status,
      'working_revision', run.working_revision,
      'graph_digest', run.graph_digest,
      'writer_fence', run.writer_fence,
      'current_turn', run.current_turn,
      'pending_request_digest', run.pending_request_digest,
      'used_tool_calls', run.used_tool_calls,
      'budget', pg_catalog.jsonb_build_object(
        'max_turns', run.max_turns,
        'max_tool_calls', run.max_tool_calls
      ),
      'validation_receipt_digest', run.validation_receipt_digest,
      'clarification', run.clarification,
      'created_at', run.created_at,
      'updated_at', run.updated_at
    ),
    'working_graph', run.working_graph,
    'checkpoint', run.checkpoint,
    'event_sequence', run.event_sequence
  )
  from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id
    and run.tenant_id = p_tenant_id
    and run.environment = p_environment
    and run.semantic_domain = p_semantic_domain
    and run.authoring_run_id = p_authoring_run_id
$function$;

create function semantic.append_authoring_events(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_current_sequence bigint,
  p_events jsonb
) returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_event jsonb;
  v_sequence bigint := p_current_sequence;
begin
  if p_events is null or pg_catalog.jsonb_typeof(p_events) <> 'array' then
    raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_EVENTS_INVALID';
  end if;
  for v_event in select value from pg_catalog.jsonb_array_elements(p_events)
  loop
    v_sequence := v_sequence + 1;
    if pg_catalog.jsonb_typeof(v_event) <> 'object'
      or (v_event ->> 'run_id')::uuid <> p_authoring_run_id
      or coalesce(v_event ->> 'sequence', '') !~ '^[1-9][0-9]{0,15}$'
      or (v_event ->> 'sequence')::bigint <> v_sequence
      or v_event ->> 'type' not in (
        'stage', 'tool', 'graph_patch', 'validation', 'clarification', 'authoring_terminal'
      )
      or coalesce(v_event ->> 'schema_version', '') <> 'semantic-authoring-public-event@1.0.0'
      or pg_catalog.jsonb_typeof(v_event -> 'payload') <> 'object'
    then
      raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_EVENT_INVALID';
    end if;
    insert into semantic.semantic_authoring_event (
      app_id, tenant_id, environment, semantic_domain, authoring_run_id,
      sequence, event_id, event_type, event_payload, occurred_at
    ) values (
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
      v_sequence, (v_event ->> 'event_id')::uuid, v_event ->> 'type', v_event,
      (v_event ->> 'occurred_at')::timestamptz
    );
  end loop;
  return v_sequence;
end;
$function$;

create function semantic.start_semantic_authoring(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_input jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run_id uuid;
  v_candidate_id uuid;
  v_graph_id uuid;
  v_base_release_id uuid;
  v_base_generation bigint := 0;
  v_input_digest text;
  v_graph_digest text;
  v_existing semantic.semantic_authoring_run%rowtype;
  v_checkpoint jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  perform semantic.lock_semantic_authority_fence(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain
  );
  if p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object'
    or p_input ->> 'schema_version' <> 'semantic-authoring-start@1.0.0'
    or p_input #>> '{scope,app_id}' <> p_app_id::text
    or p_input #>> '{scope,tenant_id}' <> p_tenant_id::text
    or p_input #>> '{scope,environment}' <> p_environment
    or p_input ->> 'semantic_domain' <> p_semantic_domain
    or p_input ->> 'principal_id' <> p_principal_id::text
    or p_input ->> 'policy_version' <> 'semantic-authoring-policy@1.0.0'
    or pg_catalog.jsonb_typeof(p_input -> 'base_graph') <> 'object'
    or p_input #>> '{base_graph,metadata,graph_version}' <> 'semantic-graph-source@2'
    or pg_catalog.jsonb_typeof(p_input #> '{base_graph,nodes}') <> 'array'
    or pg_catalog.jsonb_typeof(p_input #> '{base_graph,edges}') <> 'array'
    or pg_catalog.length(p_input ->> 'instruction') not between 1 and 20000
    or pg_catalog.length(p_input ->> 'idempotency_key') not between 8 and 256
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_START_INVALID';
  end if;
  v_run_id := (p_input ->> 'authoring_run_id')::uuid;
  v_candidate_id := (p_input ->> 'candidate_id')::uuid;
  v_graph_id := (p_input #>> '{base_graph,metadata,graph_id}')::uuid;
  v_base_release_id := nullif(p_input ->> 'base_release_id', '')::uuid;
  v_input_digest := platform.canonical_sha256(p_input);
  v_graph_digest := platform.canonical_sha256(p_input -> 'base_graph');

  select run.* into v_existing
  from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id
    and run.tenant_id = p_tenant_id
    and run.environment = p_environment
    and run.semantic_domain = p_semantic_domain
    and run.principal_id = p_principal_id
    and run.idempotency_key = p_input ->> 'idempotency_key'
  for update;
  if found then
    if v_existing.input_digest <> v_input_digest then
      raise exception using errcode = '23505', message = 'SEMANTIC_AUTHORING_IDEMPOTENCY_CONFLICT';
    end if;
    return semantic.build_authoring_state(
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, v_existing.authoring_run_id
    );
  end if;

  perform 1 from semantic.semantic_candidate as candidate
  where candidate.app_id = p_app_id
    and candidate.tenant_id = p_tenant_id
    and candidate.environment = p_environment
    and candidate.semantic_domain = p_semantic_domain
    and candidate.candidate_id = v_candidate_id
    and candidate.proposer_principal = p_principal_id::text
    and candidate.candidate_status = 'DRAFT'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_AUTHORING_CANDIDATE_NOT_DRAFT';
  end if;
  if v_base_release_id is not null then
    select release.release_generation into v_base_generation
    from semantic.semantic_source_release as release
    where release.app_id = p_app_id
      and release.tenant_id = p_tenant_id
      and release.environment = p_environment
      and release.semantic_domain = p_semantic_domain
      and release.release_id = v_base_release_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'SEMANTIC_AUTHORING_BASE_RELEASE_NOT_FOUND';
    end if;
  end if;
  v_checkpoint := pg_catalog.jsonb_build_object(
    'checkpoint_version', 'semantic-authoring-checkpoint@1.0.0',
    'messages', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', 'user', 'content', p_input ->> 'instruction'
    )),
    'pending_agent_request', null,
    'read_node_ids', '[]'::jsonb,
    'read_edge_ids', '[]'::jsonb,
    'searches', '[]'::jsonb,
    'pending_tool_calls', '[]'::jsonb,
    'last_validation', null
  );
  insert into semantic.semantic_authoring_run (
    app_id, tenant_id, environment, semantic_domain, authoring_run_id, candidate_id,
    graph_id, base_release_id, base_release_generation, principal_id, policy_version,
    status, graph_digest, max_turns, max_tool_calls, working_graph, checkpoint,
    idempotency_key, input_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, v_run_id, v_candidate_id,
    v_graph_id, v_base_release_id, v_base_generation, p_principal_id,
    'semantic-authoring-policy@1.0.0', 'RUNNING', v_graph_digest,
    (p_input #>> '{budget,max_turns}')::integer,
    (p_input #>> '{budget,max_tool_calls}')::integer,
    p_input -> 'base_graph', v_checkpoint, p_input ->> 'idempotency_key', v_input_digest
  );
  return semantic.build_authoring_state(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, v_run_id
  );
end;
$function$;

create function semantic.get_semantic_authoring(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  return semantic.build_authoring_state(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
  );
end;
$function$;

create function semantic.begin_semantic_authoring_turn(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_expected_writer_fence bigint,
  p_expected_turn integer,
  p_request_digest text,
  p_checkpoint jsonb,
  p_events jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_authoring_run%rowtype;
  v_event_sequence bigint;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select run.* into v_run from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.authoring_run_id = p_authoring_run_id and run.principal_id = p_principal_id
  for update;
  if not found or v_run.status <> 'RUNNING'
    or v_run.writer_fence <> p_expected_writer_fence or v_run.current_turn <> p_expected_turn
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_TURN_CONFLICT';
  end if;
  if v_run.pending_request_digest is not null then
    if v_run.pending_request_digest <> p_request_digest then
      raise exception using errcode = '23505', message = 'SEMANTIC_AUTHORING_PENDING_REQUEST_CONFLICT';
    end if;
    return semantic.build_authoring_state(
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
    );
  end if;
  if p_checkpoint #>> '{pending_agent_request,request_id}' is null
    or platform.canonical_sha256(p_checkpoint -> 'pending_agent_request') <> p_request_digest
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_REQUEST_DIGEST_MISMATCH';
  end if;
  insert into semantic.semantic_authoring_turn (
    app_id, tenant_id, environment, semantic_domain, authoring_run_id,
    turn_index, request_digest, request_payload
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    p_expected_turn + 1, p_request_digest, p_checkpoint -> 'pending_agent_request'
  );
  v_event_sequence := semantic.append_authoring_events(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    v_run.event_sequence, p_events
  );
  update semantic.semantic_authoring_run set
    pending_request_digest = p_request_digest,
    checkpoint = p_checkpoint,
    event_sequence = v_event_sequence,
    updated_at = pg_catalog.clock_timestamp()
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = p_authoring_run_id;
  return semantic.build_authoring_state(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
  );
end;
$function$;

create function semantic.commit_semantic_authoring_turn(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_expected_writer_fence bigint,
  p_expected_turn integer,
  p_request_digest text,
  p_response_digest text,
  p_checkpoint jsonb,
  p_events jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_authoring_run%rowtype;
  v_event_sequence bigint;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select run.* into v_run from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.authoring_run_id = p_authoring_run_id and run.principal_id = p_principal_id
  for update;
  if not found or v_run.status <> 'RUNNING'
    or v_run.writer_fence <> p_expected_writer_fence
    or v_run.current_turn <> p_expected_turn
    or v_run.pending_request_digest is distinct from p_request_digest
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_TURN_CONFLICT';
  end if;
  update semantic.semantic_authoring_turn set
    response_digest = p_response_digest,
    completed_at = pg_catalog.clock_timestamp()
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = p_authoring_run_id
    and turn_index = p_expected_turn + 1 and response_digest is null;
  if not found then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_TURN_CONFLICT';
  end if;
  v_event_sequence := semantic.append_authoring_events(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    v_run.event_sequence, p_events
  );
  update semantic.semantic_authoring_run set
    current_turn = current_turn + 1,
    pending_request_digest = null,
    checkpoint = p_checkpoint,
    event_sequence = v_event_sequence,
    updated_at = pg_catalog.clock_timestamp()
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = p_authoring_run_id;
  return semantic.build_authoring_state(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
  );
end;
$function$;

create function semantic.get_semantic_authoring_tool_receipt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_tool_call_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_receipt jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select receipt.receipt_payload into v_receipt
  from semantic.semantic_authoring_tool_receipt as receipt
  join semantic.semantic_authoring_run as run
    on run.app_id = receipt.app_id and run.tenant_id = receipt.tenant_id
    and run.environment = receipt.environment and run.semantic_domain = receipt.semantic_domain
    and run.authoring_run_id = receipt.authoring_run_id
  where receipt.app_id = p_app_id and receipt.tenant_id = p_tenant_id
    and receipt.environment = p_environment and receipt.semantic_domain = p_semantic_domain
    and receipt.authoring_run_id = p_authoring_run_id
    and receipt.tool_call_id = p_tool_call_id and run.principal_id = p_principal_id;
  return v_receipt;
end;
$function$;
