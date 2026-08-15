-- semantic_authoring_migration_checksum: sha256:f0de260f57f65461376181db6c05f54db7be89dc88f7f7c8720ae5013e8f96c7
-- ============================================================
-- 10639: Agent semantic authoring runtime authority
-- ============================================================
-- Depends on: 20260725010638_app_data_agent_semantic_graph_v2
-- Provider output is only a proposal. PostgreSQL owns fenced authoring runs,
-- append-only turn/tool/patch/event evidence and review materialization.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_AUTHORING_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_AUTHORING_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010638_app_data_agent_semantic_graph_v2';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_BASELINE_10638_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010639_app_data_agent_semantic_authoring'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_MIGRATION_10639_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_candidate') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_source_revision') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
    or pg_catalog.to_regprocedure('semantic.lock_semantic_authority_fence(uuid,uuid,text,text)') is null
    or pg_catalog.to_regprocedure('platform.canonical_sha256(jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUTHORITY_SURFACE_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
-- ============================================================
-- 10639: Fenced runs and append-only authoring evidence
-- ============================================================

create table semantic.semantic_authoring_run (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  authoring_run_id uuid not null,
  candidate_id uuid not null,
  graph_id uuid not null,
  base_release_id uuid,
  base_release_generation bigint not null check (base_release_generation between 0 and 9007199254740991),
  principal_id uuid not null,
  policy_version text not null check (policy_version = 'semantic-authoring-policy@1.0.0'),
  status text not null check (status in (
    'RUNNING', 'WAITING_CLARIFICATION', 'READY_FOR_REVIEW', 'FAILED', 'CANCELLED'
  )),
  working_revision integer not null default 0 check (working_revision between 0 and 2147483647),
  graph_digest text not null check (graph_digest ~ '^sha256:[0-9a-f]{64}$'),
  writer_fence bigint not null default 1 check (writer_fence between 1 and 9007199254740991),
  current_turn integer not null default 0 check (current_turn between 0 and 2147483647),
  pending_request_digest text check (pending_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  used_tool_calls integer not null default 0 check (used_tool_calls between 0 and 2147483647),
  max_turns integer not null check (max_turns between 1 and 128),
  max_tool_calls integer not null check (max_tool_calls between 1 and 2048),
  validation_receipt_digest text check (validation_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  clarification jsonb check (clarification is null or pg_catalog.jsonb_typeof(clarification) = 'object'),
  working_graph jsonb not null check (pg_catalog.jsonb_typeof(working_graph) = 'object'),
  checkpoint jsonb not null check (pg_catalog.jsonb_typeof(checkpoint) = 'object'),
  event_sequence bigint not null default 0 check (event_sequence between 0 and 9007199254740991),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 256),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  materialized_source_revision_id uuid,
  materialized_candidate_revision_id uuid,
  failure_code text check (failure_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id),
  unique (app_id, tenant_id, environment, semantic_domain, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, semantic_domain, candidate_id)
    references semantic.semantic_candidate (app_id, tenant_id, environment, semantic_domain, candidate_id),
  check ((materialized_source_revision_id is null) = (materialized_candidate_revision_id is null)),
  check (
    (status = 'READY_FOR_REVIEW' and materialized_source_revision_id is not null and failure_code is null)
    or (status = 'FAILED' and materialized_source_revision_id is null and failure_code is not null)
    or (status not in ('READY_FOR_REVIEW', 'FAILED') and materialized_source_revision_id is null and failure_code is null)
  )
);

create unique index semantic_authoring_single_writer_idx
  on semantic.semantic_authoring_run (
    app_id, tenant_id, environment, semantic_domain, candidate_id
  ) where status in ('RUNNING', 'WAITING_CLARIFICATION');

create table semantic.semantic_authoring_turn (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  turn_index integer not null check (turn_index between 1 and 2147483647),
  request_digest text not null check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_payload jsonb not null check (pg_catalog.jsonb_typeof(request_payload) = 'object'),
  response_digest text check (response_digest ~ '^sha256:[0-9a-f]{64}$'),
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, turn_index),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
    references semantic.semantic_authoring_run (app_id, tenant_id, environment, semantic_domain, authoring_run_id),
  check ((response_digest is null) = (completed_at is null))
);

create table semantic.semantic_authoring_tool_receipt (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  tool_call_id text not null check (pg_catalog.length(tool_call_id) between 1 and 256),
  turn_index integer not null check (turn_index between 1 and 2147483647),
  tool_name text not null check (tool_name ~ '^[a-z][a-z0-9_]{0,127}$'),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_digest text not null check (output_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  mutation boolean not null,
  from_working_revision integer not null,
  to_working_revision integer not null,
  before_digest text not null check (before_digest ~ '^sha256:[0-9a-f]{64}$'),
  after_digest text not null check (after_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_payload jsonb not null check (pg_catalog.jsonb_typeof(receipt_payload) = 'object'),
  committed_at timestamptz not null,
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, tool_call_id),
  unique (app_id, tenant_id, environment, semantic_domain, receipt_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
    references semantic.semantic_authoring_run (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
);

create table semantic.semantic_authoring_patch (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  patch_id uuid not null,
  tool_call_id text not null,
  from_working_revision integer not null,
  to_working_revision integer not null,
  before_digest text not null check (before_digest ~ '^sha256:[0-9a-f]{64}$'),
  after_digest text not null check (after_digest ~ '^sha256:[0-9a-f]{64}$'),
  patch_digest text not null check (patch_digest ~ '^sha256:[0-9a-f]{64}$'),
  patch_payload jsonb not null check (pg_catalog.jsonb_typeof(patch_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, patch_id),
  unique (app_id, tenant_id, environment, semantic_domain, authoring_run_id, to_working_revision),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, tool_call_id)
    references semantic.semantic_authoring_tool_receipt (
      app_id, tenant_id, environment, semantic_domain, authoring_run_id, tool_call_id
    )
);

create table semantic.semantic_authoring_event (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  sequence bigint not null check (sequence between 1 and 9007199254740991),
  event_id uuid not null,
  event_type text not null check (event_type in (
    'stage', 'tool', 'graph_patch', 'validation', 'clarification', 'authoring_terminal'
  )),
  event_payload jsonb not null check (pg_catalog.jsonb_typeof(event_payload) = 'object'),
  occurred_at timestamptz not null,
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, sequence),
  unique (app_id, tenant_id, environment, semantic_domain, authoring_run_id, event_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
    references semantic.semantic_authoring_run (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
);

create table semantic.semantic_authoring_resume_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  authoring_run_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  clarification_id uuid not null,
  answer_digest text not null check (answer_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, authoring_run_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
    references semantic.semantic_authoring_run (app_id, tenant_id, environment, semantic_domain, authoring_run_id)
);

create index semantic_authoring_event_replay_idx
  on semantic.semantic_authoring_event (
    app_id, tenant_id, environment, semantic_domain, authoring_run_id, sequence
  );
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
-- ============================================================
-- 10639: RLS, ownership, narrow grants and postconditions
-- ============================================================

do $tables$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'semantic_authoring_run', 'semantic_authoring_turn',
    'semantic_authoring_tool_receipt', 'semantic_authoring_patch',
    'semantic_authoring_event', 'semantic_authoring_resume_idempotency'
  ] loop
    execute pg_catalog.format('alter table semantic.%I owner to data_agent_u6_data_owner', relation_name);
    execute pg_catalog.format('alter table semantic.%I enable row level security', relation_name);
    execute pg_catalog.format('alter table semantic.%I force row level security', relation_name);
    execute pg_catalog.format(
      'create policy %I on semantic.%I for all to data_agent_u6_rpc_owner using (
        app_id = nullif(pg_catalog.current_setting(''data_agent.app_id'', true), '''')::uuid
        and tenant_id = nullif(pg_catalog.current_setting(''data_agent.tenant_id'', true), '''')::uuid
        and environment = nullif(pg_catalog.current_setting(''data_agent.environment'', true), '''')
        and semantic_domain = nullif(pg_catalog.current_setting(''app.semantic_domain'', true), '''')
      ) with check (
        app_id = nullif(pg_catalog.current_setting(''data_agent.app_id'', true), '''')::uuid
        and tenant_id = nullif(pg_catalog.current_setting(''data_agent.tenant_id'', true), '''')::uuid
        and environment = nullif(pg_catalog.current_setting(''data_agent.environment'', true), '''')
        and semantic_domain = nullif(pg_catalog.current_setting(''app.semantic_domain'', true), '''')
      )',
      relation_name || '_rpc_scope_policy', relation_name
    );
    execute pg_catalog.format(
      'grant select, insert, update on table semantic.%I to data_agent_u6_rpc_owner', relation_name
    );
    execute pg_catalog.format('revoke all on table semantic.%I from public', relation_name);
    execute pg_catalog.format('revoke all on table semantic.%I from data_agent_backend', relation_name);
  end loop;
end
$tables$;

alter function semantic.build_authoring_state(uuid,uuid,text,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.append_authoring_events(uuid,uuid,text,text,uuid,bigint,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.start_semantic_authoring(uuid,uuid,text,uuid,text,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_semantic_authoring(uuid,uuid,text,uuid,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.begin_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.commit_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,text,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_semantic_authoring_tool_receipt(uuid,uuid,text,uuid,text,uuid,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.commit_semantic_authoring_tool(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.resume_semantic_authoring(uuid,uuid,text,uuid,text,uuid,uuid,text,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.complete_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.fail_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,text,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.build_authoring_state(uuid,uuid,text,text,uuid) from public;
revoke all on function semantic.append_authoring_events(uuid,uuid,text,text,uuid,bigint,jsonb) from public;
grant execute on function semantic.build_authoring_state(uuid,uuid,text,text,uuid) to data_agent_u6_rpc_owner;
grant execute on function semantic.append_authoring_events(uuid,uuid,text,text,uuid,bigint,jsonb) to data_agent_u6_rpc_owner;

do $grants$
declare
  signature text;
begin
  foreach signature in array array[
    'semantic.start_semantic_authoring(uuid,uuid,text,uuid,text,jsonb)',
    'semantic.get_semantic_authoring(uuid,uuid,text,uuid,text,uuid)',
    'semantic.begin_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb)',
    'semantic.commit_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,text,jsonb,jsonb)',
    'semantic.get_semantic_authoring_tool_receipt(uuid,uuid,text,uuid,text,uuid,text)',
    'semantic.commit_semantic_authoring_tool(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,jsonb,jsonb)',
    'semantic.resume_semantic_authoring(uuid,uuid,text,uuid,text,uuid,uuid,text,text)',
    'semantic.complete_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb)',
    'semantic.fail_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,text,jsonb)',
    'semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)'
  ] loop
    execute pg_catalog.format('revoke all on function %s from public', signature);
    execute pg_catalog.format('grant execute on function %s to data_agent_backend', signature);
  end loop;
end
$grants$;

-- Narrow security-definer RPCs fence every mutation before touching Candidate.
grant update on table semantic.semantic_candidate to data_agent_u6_rpc_owner;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'semantic_authoring_run', 'semantic_authoring_turn',
    'semantic_authoring_tool_receipt', 'semantic_authoring_patch',
    'semantic_authoring_event', 'semantic_authoring_resume_idempotency'
  ] loop
    if not (select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'semantic' and class.relname = relation_name)
      or pg_catalog.has_table_privilege(
        'data_agent_backend', pg_catalog.format('semantic.%I', relation_name),
        'SELECT,INSERT,UPDATE,DELETE'
      )
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_TABLE_HARDENING_FAILED';
    end if;
  end loop;
  foreach function_name in array array[
    'build_authoring_state', 'append_authoring_events', 'start_semantic_authoring',
    'get_semantic_authoring', 'begin_semantic_authoring_turn',
    'commit_semantic_authoring_turn', 'get_semantic_authoring_tool_receipt',
    'commit_semantic_authoring_tool', 'resume_semantic_authoring',
    'complete_semantic_authoring', 'fail_semantic_authoring',
    'list_semantic_authoring_events'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
-- ============================================================
-- 10639: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010639_app_data_agent_semantic_authoring',
  'sha256:f0de260f57f65461376181db6c05f54db7be89dc88f7f7c8720ae5013e8f96c7'
);

commit;
