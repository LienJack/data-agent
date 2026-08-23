-- ============================================================
-- 10626: Drift evidence, begin, finish, read and candidate-link RPCs
-- ============================================================

create function semantic.get_schema_candidate_drift_evidence(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_datasource_id text,
  p_drift_event_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select pg_catalog.jsonb_build_object(
    'event', drift.event_payload,
    'event_storage_digest', drift.event_storage_digest
  ) into v_result
  from catalog.schema_drift_event as drift
  where drift.app_id = p_app_id and drift.tenant_id = p_tenant_id
    and drift.environment = p_environment and drift.datasource_id = p_datasource_id
    and drift.drift_event_id = p_drift_event_id;
  return v_result;
end;
$function$;

create function semantic.begin_schema_candidate_compile(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_compile_run_id uuid,
  p_source_revision_id uuid,
  p_idempotency_key uuid,
  p_input_digest text,
  p_packet jsonb,
  p_agent_receipt jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_existing semantic.semantic_candidate_compile_run%rowtype;
  v_source semantic.semantic_source_revision%rowtype;
  v_source_digest text;
  v_source_revision_number integer;
  v_packet_storage_digest text;
  v_snapshot_id uuid;
  v_snapshot_digest text;
  v_drift_event_id uuid;
  v_drift_digest text;
  v_base jsonb;
  v_active semantic.semantic_active_pointer%rowtype;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_compile_run_id is null or p_source_revision_id is null or p_idempotency_key is null
    or p_input_digest !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_packet) <> 'object'
    or p_packet ->> 'schema_version' <> 'schema-feature-packet@1.0.0'
    or p_packet ->> 'feature_digest' !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_packet -> 'features') <> 'array'
    or pg_catalog.jsonb_array_length(p_packet -> 'features') > 250000
    or p_packet - array[
      'schema_version', 'scope', 'snapshot_id', 'snapshot_digest',
      'drift_event_id', 'drift_digest', 'base_release', 'features', 'feature_digest'
    ] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_agent_receipt) <> 'object'
    or p_agent_receipt - array[
      'provider_id', 'model_id', 'model_profile_digest', 'prompt_digest',
      'tool_policy_digest', 'compiler_digest', 'candidate_policy_digest'
    ] <> '{}'::jsonb
    or not (p_agent_receipt ?& array[
      'provider_id', 'model_id', 'model_profile_digest', 'prompt_digest',
      'tool_policy_digest', 'compiler_digest', 'candidate_policy_digest'
    ])
    or pg_catalog.length(p_agent_receipt ->> 'provider_id') not between 1 and 128
    or pg_catalog.length(p_agent_receipt ->> 'model_id') not between 1 and 256
    or exists (
      select 1 from pg_catalog.jsonb_each_text(p_agent_receipt) as field(key, value)
      where field.key like '%digest' and field.value !~ '^sha256:[0-9a-f]{64}$'
    )
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_COMPILE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        p_app_id, p_tenant_id, p_environment, p_semantic_domain,
        p_principal_id, p_idempotency_key
      )::text,
      0
    )
  );

  select run.* into v_existing
  from semantic.semantic_candidate_compile_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.principal_id = p_principal_id and run.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.input_digest <> p_input_digest or v_existing.agent_receipt <> p_agent_receipt then
      raise exception using errcode = '23505', message = 'SEMANTIC_CANDIDATE_COMPILE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'compile_run_id', v_existing.compile_run_id,
      'source_revision_id', v_existing.source_revision_id,
      'terminal', v_existing.terminal,
      'proposal_digest', v_existing.proposal_digest,
      'created', false
    );
  end if;

  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);
  v_snapshot_id := (p_packet ->> 'snapshot_id')::uuid;
  v_snapshot_digest := p_packet ->> 'snapshot_digest';
  v_drift_event_id := nullif(p_packet ->> 'drift_event_id', '')::uuid;
  v_drift_digest := nullif(p_packet ->> 'drift_digest', '');
  v_base := p_packet -> 'base_release';

  if p_packet -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id', p_app_id, 'tenant_id', p_tenant_id,
      'environment', p_environment, 'semantic_domain', p_semantic_domain
    )
    or v_snapshot_digest !~ '^sha256:[0-9a-f]{64}$'
    or not exists (
      select 1 from catalog.schema_scan_run as scan
      where scan.app_id = p_app_id and scan.tenant_id = p_tenant_id
        and scan.environment = p_environment and scan.snapshot_id = v_snapshot_id
        and scan.snapshot_content_hash = v_snapshot_digest and scan.terminal = 'SUCCEEDED'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_COMPILE_SNAPSHOT_STALE';
  end if;
  if v_drift_event_id is not null and not exists (
    select 1 from catalog.schema_drift_event as drift
    where drift.app_id = p_app_id and drift.tenant_id = p_tenant_id
      and drift.environment = p_environment and drift.drift_event_id = v_drift_event_id
      and drift.event_storage_digest = v_drift_digest
      and drift.current_snapshot_content_hash = v_snapshot_digest
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_COMPILE_DRIFT_STALE';
  end if;

  select pointer.* into v_active
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment and pointer.semantic_domain = p_semantic_domain
  for share;
  if (v_base is null or v_base = 'null'::jsonb) then
    if found and v_active.current_release_id is not null then
      raise exception using errcode = '40001', message = 'SEMANTIC_CANDIDATE_COMPILE_BASE_STALE';
    end if;
  elsif not found
    or v_active.current_release_id::text is distinct from v_base ->> 'release_id'
    or v_active.current_release_generation::text is distinct from v_base ->> 'generation'
    or v_active.current_release_digest is distinct from v_base ->> 'release_digest'
  then
    raise exception using errcode = '40001', message = 'SEMANTIC_CANDIDATE_COMPILE_BASE_STALE';
  end if;

  v_packet_storage_digest := platform.canonical_sha256(p_packet);
  v_source_digest := semantic.semantic_sha256(
    'semantic-schema-compile-source@1.0.0',
    pg_catalog.jsonb_build_object(
      'scope', p_packet -> 'scope', 'packet_storage_digest', v_packet_storage_digest,
      'feature_digest', p_packet ->> 'feature_digest', 'author_principal', p_principal_id
    )
  );
  select source.* into v_source
  from semantic.semantic_source_revision as source
  where source.app_id = p_app_id and source.tenant_id = p_tenant_id
    and source.environment = p_environment and source.semantic_domain = p_semantic_domain
    and source.source_digest = v_source_digest
  for share;
  if found then
    p_source_revision_id := v_source.revision_id;
  else
    select coalesce(pg_catalog.max(source.revision_number), 0) + 1
    into v_source_revision_number
    from semantic.semantic_source_revision as source
    where source.app_id = p_app_id and source.tenant_id = p_tenant_id
      and source.environment = p_environment and source.semantic_domain = p_semantic_domain;
    insert into semantic.semantic_source_revision (
      app_id, tenant_id, environment, semantic_domain, revision_id, revision_number,
      base_release_id, base_release_generation, source_payload, source_digest,
      author_principal, change_description, change_class
    ) values (
      p_app_id, p_tenant_id, p_environment, p_semantic_domain,
      p_source_revision_id, v_source_revision_number,
      nullif(v_base ->> 'release_id', '')::uuid,
      nullif(v_base ->> 'generation', '')::bigint,
      pg_catalog.jsonb_build_object(
        'schema_version', 'semantic-schema-compile-source@1.0.0',
        'feature_packet', p_packet
      ),
      v_source_digest, p_principal_id::text,
      'Agent schema-to-semantic candidate generation', 'MINOR'
    );
  end if;

  insert into semantic.semantic_schema_feature_packet (
    app_id, tenant_id, environment, semantic_domain, compile_run_id,
    snapshot_id, snapshot_digest, drift_event_id, drift_digest,
    base_release_id, base_release_generation, base_release_digest,
    feature_digest, packet_payload, packet_storage_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_compile_run_id,
    v_snapshot_id, v_snapshot_digest, v_drift_event_id, v_drift_digest,
    nullif(v_base ->> 'release_id', '')::uuid,
    nullif(v_base ->> 'generation', '')::bigint,
    nullif(v_base ->> 'release_digest', ''),
    p_packet ->> 'feature_digest', p_packet, v_packet_storage_digest
  );
  insert into semantic.semantic_candidate_compile_run (
    app_id, tenant_id, environment, semantic_domain, compile_run_id,
    principal_id, idempotency_key, input_digest, source_revision_id,
    feature_digest, agent_receipt
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_compile_run_id,
    p_principal_id, p_idempotency_key, p_input_digest, p_source_revision_id,
    p_packet ->> 'feature_digest', p_agent_receipt
  );
  return pg_catalog.jsonb_build_object(
    'compile_run_id', p_compile_run_id,
    'source_revision_id', p_source_revision_id,
    'terminal', 'RUNNING', 'proposal_digest', null, 'created', true
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'SEMANTIC_CANDIDATE_COMPILE_IDEMPOTENCY_CONFLICT';
end;
$function$;

create function semantic.finish_schema_candidate_compile(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_compile_run_id uuid,
  p_terminal text,
  p_proposal jsonb,
  p_failure_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_candidate_compile_run%rowtype;
  v_packet semantic.semantic_schema_feature_packet%rowtype;
  v_active semantic.semantic_active_pointer%rowtype;
  v_storage_digest text;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_terminal not in (
    'COMPILED', 'AGENT_UNAVAILABLE', 'TIMEOUT', 'INVALID_OUTPUT',
    'VALIDATION_FAILED', 'STALE_BASE', 'IDEMPOTENCY_CONFLICT'
  ) then
    raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_COMPILE_INVALID';
  end if;
  select run.* into v_run
  from semantic.semantic_candidate_compile_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.compile_run_id = p_compile_run_id and run.principal_id = p_principal_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_CANDIDATE_COMPILE_NOT_FOUND';
  end if;
  if v_run.terminal <> 'RUNNING' then
    if v_run.terminal <> p_terminal
      or v_run.proposal_digest is distinct from p_proposal ->> 'proposal_digest'
      or v_run.failure_code is distinct from p_failure_code
    then
      raise exception using errcode = '23505', message = 'SEMANTIC_CANDIDATE_COMPILE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'compile_run_id', v_run.compile_run_id, 'terminal', v_run.terminal,
      'proposal_digest', v_run.proposal_digest, 'created', false
    );
  end if;
  select packet.* into v_packet
  from semantic.semantic_schema_feature_packet as packet
  where packet.app_id = p_app_id and packet.tenant_id = p_tenant_id
    and packet.environment = p_environment and packet.semantic_domain = p_semantic_domain
    and packet.compile_run_id = p_compile_run_id;

  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);
  select pointer.* into v_active
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment and pointer.semantic_domain = p_semantic_domain
  for share;
  if (v_packet.base_release_id is null and found and v_active.current_release_id is not null)
    or (v_packet.base_release_id is not null and (
      not found
      or v_active.current_release_id is distinct from v_packet.base_release_id
      or v_active.current_release_generation is distinct from v_packet.base_release_generation
      or v_active.current_release_digest is distinct from v_packet.base_release_digest
    ))
  then
    p_terminal := 'STALE_BASE';
    p_proposal := null;
    p_failure_code := 'SEMANTIC_CANDIDATE_COMPILE_BASE_STALE';
  end if;

  if p_terminal = 'COMPILED' then
    if pg_catalog.jsonb_typeof(p_proposal) <> 'object'
      or p_failure_code is not null
      or p_proposal ->> 'schema_version' <> 'semantic-change-proposal@1.0.0'
      or p_proposal ->> 'compile_run_id' is distinct from p_compile_run_id::text
      or p_proposal ->> 'source_revision_id' is distinct from v_run.source_revision_id::text
      or p_proposal ->> 'feature_digest' is distinct from v_run.feature_digest
      or p_proposal ->> 'snapshot_id' is distinct from v_packet.snapshot_id::text
      or p_proposal ->> 'snapshot_digest' is distinct from v_packet.snapshot_digest
      or p_proposal ->> 'proposal_digest' !~ '^sha256:[0-9a-f]{64}$'
      or p_proposal - array[
        'schema_version', 'compile_run_id', 'source_revision_id', 'feature_digest',
        'snapshot_id', 'snapshot_digest', 'drift_event_id', 'drift_digest',
        'base_release', 'agent_receipt', 'evidence', 'operations', 'summary', 'proposal_digest'
      ] <> '{}'::jsonb
      or not (p_proposal ?& array[
        'schema_version', 'compile_run_id', 'source_revision_id', 'feature_digest',
        'snapshot_id', 'snapshot_digest', 'drift_event_id', 'drift_digest',
        'base_release', 'agent_receipt', 'evidence', 'operations', 'summary', 'proposal_digest'
      ])
      or pg_catalog.jsonb_typeof(p_proposal -> 'evidence') <> 'array'
      or pg_catalog.jsonb_typeof(p_proposal -> 'operations') <> 'array'
      or pg_catalog.jsonb_array_length(p_proposal -> 'operations') not between 1 and 256
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(p_proposal -> 'operations') as operation(value)
        where pg_catalog.jsonb_typeof(operation.value) <> 'object'
          or not (operation.value ?& array[
            'schema_version', 'operation_id', 'action', 'target_type', 'target_id',
            'payload', 'evidence_refs', 'field_evidence', 'confidence',
            'assumptions', 'open_questions', 'impact'
          ])
          or operation.value ->> 'action' not in ('CREATE', 'UPDATE', 'MARK_STALE')
          or operation.value ->> 'target_type' not in (
            'BUSINESS_ENTITY_TYPE', 'DIMENSION', 'METRIC', 'RELATIONSHIP', 'PHYSICAL_BINDING'
          )
      )
    then
      raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_PROPOSAL_INVALID';
    end if;
    v_storage_digest := platform.canonical_sha256(p_proposal);
    insert into semantic.semantic_change_proposal (
      app_id, tenant_id, environment, semantic_domain, compile_run_id,
      proposal_digest, proposal_payload, proposal_storage_digest
    ) values (
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_compile_run_id,
      p_proposal ->> 'proposal_digest', p_proposal, v_storage_digest
    );
    update semantic.semantic_candidate_compile_run as run
    set terminal = 'COMPILED', proposal_digest = p_proposal ->> 'proposal_digest',
        completed_at = pg_catalog.clock_timestamp()
    where run.app_id = p_app_id and run.tenant_id = p_tenant_id
      and run.environment = p_environment and run.semantic_domain = p_semantic_domain
      and run.compile_run_id = p_compile_run_id;
  else
    if p_proposal is not null or p_failure_code !~ '^[A-Z][A-Z0-9_]{0,127}$' then
      raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_COMPILE_INVALID';
    end if;
    update semantic.semantic_candidate_compile_run as run
    set terminal = p_terminal, failure_code = p_failure_code,
        completed_at = pg_catalog.clock_timestamp()
    where run.app_id = p_app_id and run.tenant_id = p_tenant_id
      and run.environment = p_environment and run.semantic_domain = p_semantic_domain
      and run.compile_run_id = p_compile_run_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'compile_run_id', p_compile_run_id, 'terminal', p_terminal,
    'proposal_digest', p_proposal ->> 'proposal_digest', 'created', true
  );
end;
$function$;

create function semantic.get_schema_candidate_compile(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_compile_run_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select pg_catalog.jsonb_build_object(
    'compile_run_id', run.compile_run_id,
    'source_revision_id', run.source_revision_id,
    'input_digest', run.input_digest,
    'feature_packet', packet.packet_payload,
    'agent_receipt', run.agent_receipt,
    'terminal', run.terminal,
    'proposal', proposal.proposal_payload,
    'candidate_id', run.candidate_id,
    'candidate_revision_id', run.candidate_revision_id,
    'failure_code', run.failure_code,
    'created_at', run.created_at,
    'completed_at', run.completed_at
  ) into v_result
  from semantic.semantic_candidate_compile_run as run
  join semantic.semantic_schema_feature_packet as packet
    on packet.app_id = run.app_id and packet.tenant_id = run.tenant_id
    and packet.environment = run.environment and packet.semantic_domain = run.semantic_domain
    and packet.compile_run_id = run.compile_run_id
  left join semantic.semantic_change_proposal as proposal
    on proposal.app_id = run.app_id and proposal.tenant_id = run.tenant_id
    and proposal.environment = run.environment and proposal.semantic_domain = run.semantic_domain
    and proposal.compile_run_id = run.compile_run_id
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.compile_run_id = p_compile_run_id;
  return v_result;
end;
$function$;

create function semantic.attach_schema_compile_candidate(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_compile_run_id uuid,
  p_candidate_id uuid,
  p_candidate_revision_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run semantic.semantic_candidate_compile_run%rowtype;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select run.* into v_run
  from semantic.semantic_candidate_compile_run as run
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.compile_run_id = p_compile_run_id and run.principal_id = p_principal_id
  for update;
  if not found or v_run.terminal <> 'COMPILED' then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_CANDIDATE_COMPILE_NOT_FOUND';
  end if;
  if v_run.candidate_id is not null then
    if v_run.candidate_id is distinct from p_candidate_id
      or v_run.candidate_revision_id is distinct from p_candidate_revision_id
    then
      raise exception using errcode = '23505', message = 'SEMANTIC_CANDIDATE_COMPILE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'candidate_id', v_run.candidate_id,
      'candidate_revision_id', v_run.candidate_revision_id,
      'created', false
    );
  end if;
  if not exists (
    select 1
    from semantic.semantic_candidate as candidate
    join semantic.semantic_candidate_revision as revision
      on revision.app_id = candidate.app_id and revision.tenant_id = candidate.tenant_id
      and revision.environment = candidate.environment and revision.semantic_domain = candidate.semantic_domain
      and revision.candidate_id = candidate.candidate_id
    join semantic.semantic_source_revision as source
      on source.app_id = revision.app_id and source.tenant_id = revision.tenant_id
      and source.environment = revision.environment and source.semantic_domain = revision.semantic_domain
      and source.revision_id = revision.source_revision_id
    where candidate.app_id = p_app_id and candidate.tenant_id = p_tenant_id
      and candidate.environment = p_environment and candidate.semantic_domain = p_semantic_domain
      and candidate.candidate_id = p_candidate_id
      and candidate.current_revision_id = p_candidate_revision_id
      and revision.revision_id = p_candidate_revision_id
      and candidate.proposer_principal = p_principal_id::text
      and candidate.candidate_status = 'DRAFT'
      and revision.revision_payload -> 'diff' ->> 'schema_version' = 'semantic-diff@1.0.0'
      and source.source_payload -> 'source' ->> 'source_kind' = 'AGENT'
      and source.source_payload -> 'source' -> 'content' ->> 'proposal_digest' = v_run.proposal_digest
  ) then
    raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_COMPILE_LINK_INVALID';
  end if;
  update semantic.semantic_candidate_compile_run as run
  set candidate_id = p_candidate_id, candidate_revision_id = p_candidate_revision_id
  where run.app_id = p_app_id and run.tenant_id = p_tenant_id
    and run.environment = p_environment and run.semantic_domain = p_semantic_domain
    and run.compile_run_id = p_compile_run_id;
  return pg_catalog.jsonb_build_object(
    'candidate_id', p_candidate_id,
    'candidate_revision_id', p_candidate_revision_id,
    'created', true
  );
end;
$function$;
