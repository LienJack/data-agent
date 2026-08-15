-- ============================================================
-- 10639: Atomic tool commit, clarification, completion and replay
-- ============================================================

create function semantic.commit_semantic_authoring_tool(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_expected_writer_fence bigint,
  p_expected_working_revision integer,
  p_expected_graph_digest text,
  p_receipt jsonb,
  p_next_graph jsonb,
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
  v_existing semantic.semantic_authoring_tool_receipt%rowtype;
  v_patch jsonb;
  v_event_sequence bigint;
  v_mutation boolean;
  v_status text;
  v_clarification jsonb;
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
    or v_run.working_revision <> p_expected_working_revision
    or v_run.graph_digest <> p_expected_graph_digest
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_TOOL_CONFLICT';
  end if;
  if p_receipt is null or pg_catalog.jsonb_typeof(p_receipt) <> 'object'
    or p_receipt ->> 'receipt_version' <> 'semantic-authoring-tool-receipt@1.0.0'
    or p_receipt ->> 'authoring_run_id' <> p_authoring_run_id::text
    or p_receipt ->> 'candidate_id' <> v_run.candidate_id::text
    or platform.canonical_sha256(p_receipt - 'receipt_digest') <> p_receipt ->> 'receipt_digest'
    or p_receipt ->> 'before_digest' <> v_run.graph_digest
    or (p_receipt ->> 'from_working_revision')::integer <> v_run.working_revision
    or platform.canonical_sha256(p_next_graph) <> p_receipt ->> 'after_digest'
    or pg_catalog.jsonb_typeof(p_checkpoint) <> 'object'
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_TOOL_RECEIPT_INVALID';
  end if;
  select receipt.* into v_existing
  from semantic.semantic_authoring_tool_receipt as receipt
  where receipt.app_id = p_app_id and receipt.tenant_id = p_tenant_id
    and receipt.environment = p_environment and receipt.semantic_domain = p_semantic_domain
    and receipt.authoring_run_id = p_authoring_run_id
    and receipt.tool_call_id = p_receipt ->> 'tool_call_id'
  for update;
  if found then
    if v_existing.input_digest <> p_receipt ->> 'input_digest' then
      raise exception using errcode = '23505', message = 'SEMANTIC_AUTHORING_TOOL_IDEMPOTENCY_CONFLICT';
    end if;
    return semantic.build_authoring_state(
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
    );
  end if;
  v_mutation := (p_receipt ->> 'mutation')::boolean;
  if (p_receipt ->> 'to_working_revision')::integer <>
      v_run.working_revision + (case when v_mutation then 1 else 0 end)
    or v_run.used_tool_calls >= v_run.max_tool_calls
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_TOOL_REVISION_INVALID';
  end if;
  v_patch := p_receipt -> 'patch';
  if v_mutation and (
    v_patch is null or pg_catalog.jsonb_typeof(v_patch) <> 'object'
    or platform.canonical_sha256(v_patch - 'patch_digest') <> v_patch ->> 'patch_digest'
    or v_patch ->> 'before_digest' <> v_run.graph_digest
    or v_patch ->> 'after_digest' <> p_receipt ->> 'after_digest'
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(v_patch -> 'operations') as operation(value)
      where (
        operation.value ->> 'operation' in ('ADD_NODE', 'UPDATE_NODE')
        and operation.value #>> '{node,node_type}' in ('PHYSICAL_TABLE', 'PHYSICAL_COLUMN')
      ) or (
        operation.value ->> 'operation' in ('ADD_EDGE', 'UPDATE_EDGE')
        and operation.value #>> '{edge,edge_type}' in ('CONTAINS_COLUMN', 'FOREIGN_KEY_TO')
      ) or (
        operation.value ->> 'operation' = 'ADD_EDGE_TYPE'
        and operation.value #>> '{edge_type_definition,authoring_policy}' <> 'AGENT_AUTHORED'
      ) or (
        operation.value ->> 'operation' = 'RETIRE_NODE'
        and exists (
          select 1 from pg_catalog.jsonb_array_elements(v_run.working_graph -> 'nodes') as node(value)
          where node.value ->> 'node_id' = operation.value ->> 'node_id'
            and node.value ->> 'node_type' in ('PHYSICAL_TABLE', 'PHYSICAL_COLUMN')
        )
      ) or (
        operation.value ->> 'operation' = 'RETIRE_EDGE'
        and exists (
          select 1 from pg_catalog.jsonb_array_elements(v_run.working_graph -> 'edges') as edge(value)
          where edge.value ->> 'edge_id' = operation.value ->> 'edge_id'
            and edge.value ->> 'edge_type' in ('CONTAINS_COLUMN', 'FOREIGN_KEY_TO')
        )
      )
    )
  ) then
    raise exception using errcode = '42501', message = 'SEMANTIC_AUTHORING_SYSTEM_MANAGED_MUTATION';
  end if;
  if not v_mutation and v_patch is not null and v_patch <> 'null'::jsonb then
    raise exception using errcode = '22023', message = 'SEMANTIC_AUTHORING_TOOL_RECEIPT_INVALID';
  end if;

  insert into semantic.semantic_authoring_tool_receipt (
    app_id, tenant_id, environment, semantic_domain, authoring_run_id,
    tool_call_id, turn_index, tool_name, input_digest, output_digest, receipt_digest,
    mutation, from_working_revision, to_working_revision, before_digest, after_digest,
    receipt_payload, committed_at
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    p_receipt ->> 'tool_call_id', (p_receipt ->> 'turn_index')::integer,
    p_receipt ->> 'tool_name', p_receipt ->> 'input_digest', p_receipt ->> 'output_digest',
    p_receipt ->> 'receipt_digest', v_mutation,
    (p_receipt ->> 'from_working_revision')::integer,
    (p_receipt ->> 'to_working_revision')::integer,
    p_receipt ->> 'before_digest', p_receipt ->> 'after_digest', p_receipt,
    (p_receipt ->> 'committed_at')::timestamptz
  );
  if v_mutation then
    insert into semantic.semantic_authoring_patch (
      app_id, tenant_id, environment, semantic_domain, authoring_run_id, patch_id,
      tool_call_id, from_working_revision, to_working_revision, before_digest,
      after_digest, patch_digest, patch_payload
    ) values (
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
      (v_patch ->> 'patch_id')::uuid, p_receipt ->> 'tool_call_id',
      (v_patch ->> 'from_working_revision')::integer,
      (v_patch ->> 'to_working_revision')::integer,
      v_patch ->> 'before_digest', v_patch ->> 'after_digest',
      v_patch ->> 'patch_digest', v_patch
    );
  end if;
  v_event_sequence := semantic.append_authoring_events(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    v_run.event_sequence, p_events
  );
  v_status := case
    when p_receipt ->> 'status' = 'CLARIFICATION_REQUIRED' then 'WAITING_CLARIFICATION'
    else 'RUNNING'
  end;
  v_clarification := case
    when v_status = 'WAITING_CLARIFICATION' then pg_catalog.jsonb_build_object(
      'clarification_id', p_receipt #>> '{result,clarification_id}',
      'question', p_receipt #>> '{result,question}',
      'options', p_receipt #> '{result,options}',
      'answer', null
    )
    else v_run.clarification
  end;
  update semantic.semantic_authoring_run set
    status = v_status,
    working_revision = (p_receipt ->> 'to_working_revision')::integer,
    graph_digest = p_receipt ->> 'after_digest',
    used_tool_calls = used_tool_calls + 1,
    validation_receipt_digest = nullif(p_checkpoint #>> '{last_validation,receipt_digest}', ''),
    clarification = v_clarification,
    working_graph = p_next_graph,
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

create function semantic.resume_semantic_authoring(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_clarification_id uuid,
  p_answer text,
  p_idempotency_key text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_authoring_run%rowtype;
  v_answer_digest text;
  v_event jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select run.* into v_run from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.authoring_run_id = p_authoring_run_id and run.principal_id = p_principal_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_AUTHORING_RUN_NOT_FOUND';
  end if;
  v_answer_digest := platform.canonical_sha256(pg_catalog.to_jsonb(p_answer));
  if exists (
    select 1 from semantic.semantic_authoring_resume_idempotency as item
    where item.app_id = p_app_id and item.tenant_id = p_tenant_id
      and item.environment = p_environment and item.semantic_domain = p_semantic_domain
      and item.authoring_run_id = p_authoring_run_id and item.idempotency_key = p_idempotency_key
      and item.clarification_id = p_clarification_id and item.answer_digest = v_answer_digest
  ) then
    return semantic.build_authoring_state(
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
    );
  end if;
  if v_run.status <> 'WAITING_CLARIFICATION'
    or (v_run.clarification ->> 'clarification_id')::uuid <> p_clarification_id
    or pg_catalog.length(p_answer) not between 1 and 2048
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_CLARIFICATION_CONFLICT';
  end if;
  insert into semantic.semantic_authoring_resume_idempotency (
    app_id, tenant_id, environment, semantic_domain, authoring_run_id,
    idempotency_key, clarification_id, answer_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    p_idempotency_key, p_clarification_id, v_answer_digest
  );
  v_event := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-authoring-public-event@1.0.0',
    'event_id', extensions.gen_random_uuid(),
    'run_id', p_authoring_run_id,
    'sequence', v_run.event_sequence + 1,
    'occurred_at', pg_catalog.clock_timestamp(),
    'type', 'clarification',
    'payload', pg_catalog.jsonb_build_object(
      'clarification_id', p_clarification_id,
      'question', v_run.clarification ->> 'question',
      'options', v_run.clarification -> 'options',
      'status', 'ANSWERED'
    )
  );
  perform semantic.append_authoring_events(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    v_run.event_sequence, pg_catalog.jsonb_build_array(v_event)
  );
  update semantic.semantic_authoring_run set
    status = 'RUNNING',
    writer_fence = writer_fence + 1,
    clarification = pg_catalog.jsonb_set(clarification, '{answer}', pg_catalog.to_jsonb(p_answer)),
    checkpoint = pg_catalog.jsonb_set(
      checkpoint,
      '{messages}',
      (checkpoint -> 'messages') || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'role', 'user', 'content', '澄清答复：' || p_answer
      ))
    ),
    event_sequence = event_sequence + 1,
    updated_at = pg_catalog.clock_timestamp()
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = p_authoring_run_id;
  return semantic.build_authoring_state(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
  );
end;
$function$;

create function semantic.complete_semantic_authoring(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_expected_writer_fence bigint,
  p_expected_working_revision integer,
  p_expected_graph_digest text,
  p_validation_receipt jsonb,
  p_final_graph jsonb,
  p_summary text,
  p_event jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_authoring_run%rowtype;
  v_candidate semantic.semantic_candidate%rowtype;
  v_source_revision_id uuid := extensions.gen_random_uuid();
  v_candidate_revision_id uuid := extensions.gen_random_uuid();
  v_source_revision_number integer;
  v_candidate_revision_number integer;
  v_source_payload jsonb;
  v_source_digest text;
  v_revision_payload jsonb;
  v_revision_digest text;
  v_event_sequence bigint;
  v_patch_summary jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  perform semantic.lock_semantic_authority_fence(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain
  );
  select run.* into v_run from semantic.semantic_authoring_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.authoring_run_id = p_authoring_run_id and run.principal_id = p_principal_id
  for update;
  if not found or v_run.status <> 'RUNNING'
    or v_run.writer_fence <> p_expected_writer_fence
    or v_run.working_revision <> p_expected_working_revision
    or v_run.graph_digest <> p_expected_graph_digest
    or p_validation_receipt ->> 'receipt_digest' is distinct from v_run.validation_receipt_digest
    or p_validation_receipt ->> 'graph_digest' <> v_run.graph_digest
    or coalesce((p_validation_receipt ->> 'valid')::boolean, false) is not true
    or platform.canonical_sha256(p_final_graph) <> v_run.graph_digest
    or p_final_graph <> v_run.working_graph
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_COMPLETE_CONFLICT';
  end if;
  select candidate.* into v_candidate from semantic.semantic_candidate as candidate
  where candidate.app_id = p_app_id and candidate.tenant_id = p_tenant_id
    and candidate.environment = p_environment and candidate.semantic_domain = p_semantic_domain
    and candidate.candidate_id = v_run.candidate_id
    and candidate.proposer_principal = p_principal_id::text
    and candidate.candidate_status = 'DRAFT'
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_CANDIDATE_STALE';
  end if;
  select coalesce(pg_catalog.max(source.revision_number), 0) + 1 into v_source_revision_number
  from semantic.semantic_source_revision as source
  where source.app_id = p_app_id and source.tenant_id = p_tenant_id
    and source.environment = p_environment and source.semantic_domain = p_semantic_domain;
  select coalesce(pg_catalog.max(revision.revision_number), 0) + 1 into v_candidate_revision_number
  from semantic.semantic_candidate_revision as revision
  where revision.app_id = p_app_id and revision.tenant_id = p_tenant_id
    and revision.environment = p_environment and revision.semantic_domain = p_semantic_domain
    and revision.candidate_id = v_run.candidate_id;
  select coalesce(pg_catalog.jsonb_agg(patch.patch_payload order by patch.to_working_revision), '[]'::jsonb)
  into v_patch_summary from semantic.semantic_authoring_patch as patch
  where patch.app_id = p_app_id and patch.tenant_id = p_tenant_id
    and patch.environment = p_environment and patch.semantic_domain = p_semantic_domain
    and patch.authoring_run_id = p_authoring_run_id;
  v_source_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-candidate-source-revision@1.0.0',
    'title', p_summary,
    'description', 'Agent-authored Semantic Graph v2 candidate',
    'risk_level', 'MEDIUM',
    'source', pg_catalog.jsonb_build_object(
      'schema_version', 'semantic-source-payload@1.0.0',
      'source_kind', 'AGENT',
      'content', p_final_graph
    )
  );
  v_source_digest := semantic.semantic_sha256(
    'semantic-agent-authoring-source@1.0.0',
    pg_catalog.jsonb_build_object(
      'scope', pg_catalog.jsonb_build_array(p_app_id, p_tenant_id, p_environment, p_semantic_domain),
      'candidate_id', v_run.candidate_id,
      'authoring_run_id', p_authoring_run_id,
      'graph_digest', v_run.graph_digest,
      'source_payload', v_source_payload
    )
  );
  v_revision_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-candidate-revision@1.0.0',
    'title', p_summary,
    'description', 'Agent-authored Semantic Graph v2 candidate',
    'risk_level', 'MEDIUM',
    'source_revision_id', v_source_revision_id,
    'diff', pg_catalog.jsonb_build_object(
      'schema_version', 'semantic-diff@1.0.0',
      'summary', p_summary,
      'operations', v_patch_summary
    ),
    'authoring_run_id', p_authoring_run_id,
    'validation_receipt', p_validation_receipt
  );
  v_revision_digest := semantic.semantic_sha256(
    v_run.candidate_id::text,
    pg_catalog.jsonb_build_object(
      'revision_number', v_candidate_revision_number,
      'source_revision_id', v_source_revision_id,
      'revision_payload', v_revision_payload,
      'author_principal', p_principal_id,
      'change_description', p_summary,
      'change_class', 'MINOR'
    )
  );
  insert into semantic.semantic_source_revision (
    app_id, tenant_id, environment, semantic_domain, revision_id, revision_number,
    base_release_id, base_release_generation, source_payload, source_digest,
    author_principal, change_description, change_class
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, v_source_revision_id,
    v_source_revision_number, v_run.base_release_id, v_run.base_release_generation,
    v_source_payload, v_source_digest, p_principal_id::text, p_summary, 'MINOR'
  );
  insert into semantic.semantic_candidate_revision (
    app_id, tenant_id, environment, semantic_domain, candidate_id, revision_id,
    revision_number, source_revision_id, revision_payload, revision_digest,
    author_principal, change_description, change_class
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, v_run.candidate_id,
    v_candidate_revision_id, v_candidate_revision_number, v_source_revision_id,
    v_revision_payload, v_revision_digest, p_principal_id::text, p_summary, 'MINOR'
  );
  update semantic.semantic_candidate set
    current_revision_id = v_candidate_revision_id,
    candidate_status = 'REVIEW_SUBMITTED',
    updated_at = pg_catalog.clock_timestamp()
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and candidate_id = v_run.candidate_id;
  v_event_sequence := semantic.append_authoring_events(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    v_run.event_sequence, pg_catalog.jsonb_build_array(p_event)
  );
  update semantic.semantic_authoring_run set
    status = 'READY_FOR_REVIEW',
    materialized_source_revision_id = v_source_revision_id,
    materialized_candidate_revision_id = v_candidate_revision_id,
    event_sequence = v_event_sequence,
    updated_at = pg_catalog.clock_timestamp()
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = p_authoring_run_id;
  insert into app_data_agent.audit_log (
    app_id, tenant_id, environment, audit_id, principal_id, action,
    resource_type, resource_id, details
  ) values (
    p_app_id, p_tenant_id, p_environment, extensions.gen_random_uuid(), p_principal_id,
    'SEMANTIC_AUTHORING_READY_FOR_REVIEW', 'semantic_authoring_run', p_authoring_run_id::text,
    pg_catalog.jsonb_build_object(
      'candidate_id', v_run.candidate_id,
      'source_revision_id', v_source_revision_id,
      'candidate_revision_id', v_candidate_revision_id,
      'graph_digest', v_run.graph_digest
    )
  );
  return semantic.build_authoring_state(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
  );
end;
$function$;

create function semantic.fail_semantic_authoring(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_expected_writer_fence bigint,
  p_error_code text,
  p_event jsonb
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
  if not found or v_run.writer_fence <> p_expected_writer_fence
    or v_run.status not in ('RUNNING', 'WAITING_CLARIFICATION')
    or p_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_AUTHORING_FAIL_CONFLICT';
  end if;
  v_event_sequence := semantic.append_authoring_events(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id,
    v_run.event_sequence, pg_catalog.jsonb_build_array(p_event)
  );
  update semantic.semantic_authoring_run set
    status = 'FAILED', failure_code = p_error_code, event_sequence = v_event_sequence,
    updated_at = pg_catalog.clock_timestamp()
  where app_id = p_app_id and tenant_id = p_tenant_id and environment = p_environment
    and semantic_domain = p_semantic_domain and authoring_run_id = p_authoring_run_id;
  return semantic.build_authoring_state(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_authoring_run_id
  );
end;
$function$;

create function semantic.list_semantic_authoring_events(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_after_sequence bigint,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_events jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if not exists (
    select 1 from semantic.semantic_authoring_run as run
    where run.app_id = p_app_id and run.tenant_id = p_tenant_id
      and run.environment = p_environment and run.semantic_domain = p_semantic_domain
      and run.authoring_run_id = p_authoring_run_id
  ) then
    return '[]'::jsonb;
  end if;
  select coalesce(pg_catalog.jsonb_agg(event.event_payload order by event.sequence), '[]'::jsonb)
  into v_events
  from (
    select item.sequence, item.event_payload
    from semantic.semantic_authoring_event as item
    where item.app_id = p_app_id and item.tenant_id = p_tenant_id
      and item.environment = p_environment and item.semantic_domain = p_semantic_domain
      and item.authoring_run_id = p_authoring_run_id
      and item.sequence > coalesce(p_after_sequence, 0)
    order by item.sequence
    limit pg_catalog.least(pg_catalog.greatest(coalesce(p_limit, 1000), 1), 5000)
  ) as event;
  return v_events;
end;
$function$;
