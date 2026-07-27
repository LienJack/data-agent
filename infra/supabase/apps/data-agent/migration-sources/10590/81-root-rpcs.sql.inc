create function app_data_agent.commit_current_l2_artifact(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  candidate_json jsonb;
  candidate_envelope jsonb;
  candidate_payload jsonb;
  artifact_domain text;
  input_hash text;
  computed_content_hash text;
  db_now timestamptz;
  committed_at text;
  committed_document jsonb;
  target_run record;
  target_attempt record;
  target_outbox record;
  active_artifact record;
  existing_operation record;
  expected_parent jsonb;
  observed_parent jsonb;
  claim_identity text;
  evidence_identity text;
  pair_hash text;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 10
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  candidate_json := command_json -> 'candidate';
  candidate_envelope := candidate_json -> 'envelope';
  candidate_payload := candidate_json -> 'payload';
  if pg_catalog.jsonb_typeof(candidate_json) <> 'object'
    or pg_catalog.jsonb_typeof(candidate_envelope) <> 'object'
    or pg_catalog.jsonb_typeof(candidate_payload) <> 'object'
    or candidate_envelope ->> 'artifact_type' is distinct from candidate_payload ->> 'artifact_type'
    or candidate_envelope ->> 'status' <> 'CANDIDATE'
    or candidate_envelope ->> 'app_id' is distinct from scope_json ->> 'app_id'
    or candidate_envelope ->> 'tenant_id' is distinct from scope_json ->> 'tenant_id'
    or candidate_envelope ->> 'environment' is distinct from scope_json ->> 'environment'
    or candidate_envelope ->> 'run_id' is distinct from command_json ->> 'run_id'
    or candidate_envelope ->> 'attempt_id' is distinct from command_json ->> 'attempt_id'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  artifact_domain := case candidate_payload ->> 'artifact_type'
    when 'ResearchBrief' then 'BRIEF_SEMANTIC'
    when 'HypothesisSet' then 'PLANNING'
    when 'EvidencePlan' then 'PLANNING'
    when 'ObligationExecutionDecision' then 'OBLIGATION_EXECUTION'
    when 'QueryEvidence' then 'EVIDENCE'
    when 'AtomicClaim' then 'CLAIM_STRUCTURE'
    when 'EvidenceRelation' then 'RELATION'
    when 'EvidenceCheckReceipt' then 'PROOF'
    when 'SupportDecision' then 'PROOF'
    when 'HypothesisAssessment' then 'PROOF'
    when 'CoverageState' then 'COVERAGE'
    when 'ResearchStopDecision' then 'RESEARCH_STOP'
    when 'ReportManifest' then 'PROJECTION'
    when 'AnalysisReport' then 'PROJECTION'
    when 'ReportProjectionReceipt' then 'PROJECTION'
    when 'EvidenceGateReceipt' then 'EVIDENCE_GATE'
    when 'ReportReadyCertificate' then 'READINESS'
    else null
  end;
  if artifact_domain is null
    or candidate_payload ->> 'artifact_type' = 'ReadinessRevocationReceipt'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'L2_WIRE_VERSION_WRITE_UNSUPPORTED',
        'retryable', false
      )
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESEARCH_ARTIFACT_AUTHORITY',
    artifact_domain,
    null,
    null,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-artifact-commit-input@1.0.0',
    command_json
  );
  computed_content_hash := app_data_agent.runtime_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'envelope',
      candidate_envelope - 'content_hash' - 'created_at' - 'status',
      'payload',
      candidate_payload
    )
  );
  if computed_content_hash <> candidate_envelope ->> 'content_hash' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READY_CERTIFICATE_TAMPERED',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  if target_run.run_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.attempt_id = (command_json ->> 'attempt_id')::uuid;
  if target_attempt.attempt_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_attempt.app_id
    and source.tenant_id = target_attempt.tenant_id
    and source.environment = target_attempt.environment
    and source.outbox_id = target_attempt.outbox_id
    and source.run_id = target_attempt.run_id
  for update of source nowait;

  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_attempt.app_id
    and source.tenant_id = target_attempt.tenant_id
    and source.environment = target_attempt.environment
    and source.attempt_id = target_attempt.attempt_id
  for update of source nowait;

  db_now := pg_catalog.clock_timestamp();
  if target_outbox.outbox_id is null
    or target_attempt.status <> 'ACTIVE'
    or target_attempt.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_attempt.lease_expires_at <= db_now
    or target_outbox.active_attempt_id <> target_attempt.attempt_id
    or target_outbox.run_fence <> target_attempt.worker_fence
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into existing_operation
  from app_data_agent.research_artifact_commit_operations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and (
      source.commit_id = (command_json ->> 'commit_id')::uuid
      or (
        source.run_id = target_run.run_id
        and source.principal_id = target_run.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if existing_operation.commit_id is not null then
    if existing_operation.input_hash <> input_hash
      or existing_operation.commit_id <> (command_json ->> 'commit_id')::uuid
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'reference', pg_catalog.jsonb_build_object(
          'app_id', existing_operation.app_id,
          'tenant_id', existing_operation.tenant_id,
          'environment', existing_operation.environment,
          'run_id', existing_operation.run_id,
          'artifact_id', existing_operation.artifact_id,
          'artifact_type', existing_operation.artifact_type,
          'revision', existing_operation.revision,
          'content_hash', existing_operation.content_hash
        ),
        'created', false
      )
    );
  end if;

  select source.*
  into active_artifact
  from app_data_agent.artifacts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.artifact_id = (candidate_envelope ->> 'artifact_id')::uuid
    and source.is_active
  for update of source nowait;

  expected_parent := command_json -> 'expected_parent_ref';
  observed_parent := case
    when active_artifact.artifact_id is null then null
    else pg_catalog.jsonb_build_object(
      'app_id', active_artifact.app_id,
      'tenant_id', active_artifact.tenant_id,
      'environment', active_artifact.environment,
      'run_id', active_artifact.run_id,
      'artifact_id', active_artifact.artifact_id,
      'artifact_type', active_artifact.artifact_type,
      'revision', active_artifact.revision,
      'content_hash', active_artifact.content_hash
    )
  end;
  if observed_parent is distinct from expected_parent
    or (
      active_artifact.artifact_id is null
      and (candidate_envelope ->> 'revision')::integer <> 1
    )
    or (
      active_artifact.artifact_id is not null
      and (candidate_envelope ->> 'revision')::integer <> active_artifact.revision + 1
    )
    or candidate_envelope -> 'parent_ref' is distinct from expected_parent
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT',
        'retryable', false
      )
    );
  end if;

  if candidate_payload ->> 'artifact_type' = 'EvidenceRelation' then
    claim_identity := app_data_agent.runtime_canonical_json(candidate_payload -> 'claim_ref');
    evidence_identity := app_data_agent.runtime_canonical_json(candidate_payload -> 'evidence_ref');
    pair_hash := app_data_agent.u6_domain_sha256(
      'research-evidence-relation-pair@1.0.0',
      pg_catalog.jsonb_build_array(
        candidate_payload -> 'claim_ref',
        candidate_payload -> 'evidence_ref'
      )
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(pair_hash, 0)
    );
    if exists (
      select 1
      from app_data_agent.research_current_evidence_relation_keys as relation_key
      where relation_key.app_id = target_run.app_id
        and relation_key.tenant_id = target_run.tenant_id
        and relation_key.environment = target_run.environment
        and relation_key.run_id = target_run.run_id
        and relation_key.claim_ref_identity = claim_identity
        and relation_key.evidence_ref_identity = evidence_identity
        and relation_key.artifact_id <> (candidate_envelope ->> 'artifact_id')::uuid
    ) then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'EVIDENCE_RELATION_IDENTITY_CONFLICT',
          'retryable', false
        )
      );
    end if;
  end if;

  committed_at := pg_catalog.to_char(
    db_now at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  committed_document := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      candidate_json,
      '{envelope,status}',
      '"COMMITTED"'::jsonb,
      false
    ),
    '{envelope,created_at}',
    pg_catalog.to_jsonb(committed_at),
    false
  );

  if active_artifact.artifact_id is not null then
    update app_data_agent.artifacts
    set is_active = false
    where app_id = active_artifact.app_id
      and tenant_id = active_artifact.tenant_id
      and environment = active_artifact.environment
      and run_id = active_artifact.run_id
      and artifact_id = active_artifact.artifact_id
      and revision = active_artifact.revision;
  end if;

  insert into app_data_agent.artifacts (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type,
    revision, content_hash, document_json, worker_fence, is_active,
    parent_revision, parent_content_hash, created_at
  )
  values (
    target_run.app_id,
    target_run.tenant_id,
    target_run.environment,
    target_run.run_id,
    (candidate_envelope ->> 'artifact_id')::uuid,
    candidate_envelope ->> 'artifact_type',
    (candidate_envelope ->> 'revision')::integer,
    candidate_envelope ->> 'content_hash',
    committed_document,
    (command_json ->> 'worker_fence')::bigint,
    true,
    nullif(expected_parent ->> 'revision', '')::integer,
    nullif(expected_parent ->> 'content_hash', ''),
    db_now
  );

  if candidate_payload ->> 'artifact_type' = 'EvidenceRelation' then
    insert into app_data_agent.research_current_evidence_relation_keys (
      app_id, tenant_id, environment, run_id, claim_ref_identity,
      evidence_ref_identity, pair_identity_hash, artifact_id, artifact_type,
      revision, content_hash
    )
    values (
      target_run.app_id, target_run.tenant_id, target_run.environment,
      target_run.run_id, claim_identity, evidence_identity, pair_hash,
      (candidate_envelope ->> 'artifact_id')::uuid, 'EvidenceRelation',
      (candidate_envelope ->> 'revision')::integer,
      candidate_envelope ->> 'content_hash'
    )
    on conflict (
      app_id, tenant_id, environment, run_id,
      claim_ref_identity, evidence_ref_identity
    )
    do update set
      revision = excluded.revision,
      content_hash = excluded.content_hash,
      updated_at = db_now;
  end if;

  insert into app_data_agent.research_artifact_commit_operations (
    app_id, tenant_id, environment, run_id, commit_id, principal_id,
    idempotency_key, input_hash, artifact_authority_domain, artifact_id,
    artifact_type, revision, content_hash, parent_ref, candidate_json
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    target_run.run_id, (command_json ->> 'commit_id')::uuid,
    target_run.principal_id, command_json ->> 'idempotency_key', input_hash,
    artifact_domain, (candidate_envelope ->> 'artifact_id')::uuid,
    candidate_envelope ->> 'artifact_type',
    (candidate_envelope ->> 'revision')::integer,
    candidate_envelope ->> 'content_hash', expected_parent, candidate_json
  );

  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'reference', pg_catalog.jsonb_build_object(
        'app_id', target_run.app_id,
        'tenant_id', target_run.tenant_id,
        'environment', target_run.environment,
        'run_id', target_run.run_id,
        'artifact_id', candidate_envelope ->> 'artifact_id',
        'artifact_type', candidate_envelope ->> 'artifact_type',
        'revision', (candidate_envelope ->> 'revision')::integer,
        'content_hash', candidate_envelope ->> 'content_hash'
      ),
      'created', true
    )
  );
end
$function$;

create function app_data_agent.consume_current_ready(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  certificate_ref jsonb;
  certificate_document jsonb;
  certificate_payload jsonb;
  report_ref jsonb;
  report_document jsonb;
  requested_purpose text;
  expected_authority text;
  require_write boolean;
  input_hash text;
  current_row record;
  terminal_row record;
  grant_row record;
  consumption_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  aggregate_frontier_hash text;
  body_bytes bytea;
  body_base64url text;
  response_digest text;
  response_wire jsonb;
  response_binding jsonb;
  response_wire_hash text;
  db_now timestamptz;
  expires_at timestamptz;
  requested_terminal_id uuid;
  requested_grant_id uuid;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'consumption_id', 'purpose', 'certificate_ref'
      ]
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  requested_purpose := command_json ->> 'purpose';
  if (
    requested_purpose = 'DOMAIN_TERMINAL'
    and command_json ? 'terminal_id'
    and not command_json ? 'grant_id'
  ) then
    expected_authority := 'CURRENT_READINESS_AUTHORITY';
    require_write := true;
    requested_terminal_id := (command_json ->> 'terminal_id')::uuid;
  elsif (
    requested_purpose = 'REPORT_READ'
    and command_json ? 'grant_id'
    and not command_json ? 'terminal_id'
  ) then
    expected_authority := 'REPORT_READ_AUTHORITY';
    require_write := false;
    requested_grant_id := (command_json ->> 'grant_id')::uuid;
  else
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;

  scope_json := command_json -> 'scope';
  certificate_ref := command_json -> 'certificate_ref';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, expected_authority, null, null, null, require_write
  );
  -- Coverage derivation, candidate-enumeration, budget-ledger and input-event
  -- watermark receipts are not yet persisted as DB-owned exact inputs.
  -- Without those inputs PostgreSQL cannot replay the frozen Research Kernel,
  -- so neither READY consumption nor ReportRead Grant issue may succeed.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_DATABASE_AUTHORITY_REQUIRED', 'retryable', false
    )
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-readiness-consumption@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and (
      requested_purpose = 'REPORT_READ'
      or run.principal_id = (command_json ->> 'principal_id')::uuid
    )
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select artifact.document_json
  into certificate_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (scope_json ->> 'app_id')::uuid
    and artifact.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and artifact.environment = scope_json ->> 'environment'
    and artifact.run_id = (command_json ->> 'run_id')::uuid
    and artifact.artifact_id = (certificate_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'ReportReadyCertificate'
    and artifact.revision = (certificate_ref ->> 'revision')::integer
    and artifact.content_hash = certificate_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  certificate_payload := certificate_document -> 'payload';
  if certificate_document is null
    or certificate_payload ->> 'protocol_version'
      is distinct from 'report-ready@3.0.0'
    or certificate_document #>> '{envelope,status}'
      is distinct from 'COMMITTED'
    or app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope',
          (certificate_document -> 'envelope')
            - 'content_hash' - 'created_at' - 'status',
        'payload', certificate_payload
      )
    ) <> certificate_ref ->> 'content_hash'
    or certificate_payload ->> 'certificate_semantic_hash'
      <> app_data_agent.runtime_canonical_sha256(
        certificate_payload - 'certificate_semantic_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READY_CERTIFICATE_TAMPERED', 'retryable', false
      )
    );
  end if;
  report_ref := certificate_payload -> 'analysis_report_ref';
  select artifact.document_json
  into report_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (scope_json ->> 'app_id')::uuid
    and artifact.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and artifact.environment = scope_json ->> 'environment'
    and artifact.run_id = (command_json ->> 'run_id')::uuid
    and artifact.artifact_id = (report_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'AnalysisReport'
    and artifact.revision = (report_ref ->> 'revision')::integer
    and artifact.content_hash = report_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  if report_document is null
    or report_document #>> '{payload,protocol_version}'
      is distinct from 'analysis-report@2.0.0'
    or report_document #>> '{envelope,status}' is distinct from 'COMMITTED'
    or app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope',
          (report_document -> 'envelope')
            - 'content_hash' - 'created_at' - 'status',
        'payload', report_document -> 'payload'
      )
    ) <> report_ref ->> 'content_hash'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  if current_row.run_id is null
    or current_row.certificate_ref is distinct from certificate_ref
    or current_row.report_ref is distinct from report_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = current_row.app_id
    and frontier.tenant_id = current_row.tenant_id
    and frontier.environment = current_row.environment
    and frontier.run_id = current_row.run_id
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.* into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'SEMANTIC';
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'SCHEMA';
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'DATA';
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'POLICY';
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'IDENTITY';
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  aggregate_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );
  if current_row.state = 'CURRENT'
    and (
      current_row.frontier_hash <> aggregate_frontier_hash
      or current_row.certificate_semantic_hash
        <> certificate_payload ->> 'certificate_semantic_hash'
      or current_row.semantic_frontier_version <> semantic_frontier.frontier_version
      or current_row.semantic_frontier_hash <> semantic_frontier.frontier_value_hash
      or current_row.schema_frontier_version <> schema_frontier.frontier_version
      or current_row.schema_frontier_hash <> schema_frontier.frontier_value_hash
      or current_row.data_frontier_version <> data_frontier.frontier_version
      or current_row.data_frontier_hash <> data_frontier.frontier_value_hash
      or current_row.policy_frontier_version <> policy_frontier.frontier_version
      or current_row.policy_frontier_hash <> policy_frontier.frontier_value_hash
      or current_row.identity_frontier_version <> identity_frontier.frontier_version
      or current_row.identity_frontier_hash <> identity_frontier.frontier_value_hash
      or current_row.authority_epoch <> identity_frontier.authority_epoch
      or certificate_payload #> '{version_frontier,semantic_release_ref}'
        is distinct from semantic_frontier.frontier_value_json -> 'reference'
      or certificate_payload #> '{version_frontier,schema_snapshot_ref}'
        is distinct from schema_frontier.frontier_value_json -> 'reference'
      or certificate_payload #> '{version_frontier,data_snapshot}'
        is distinct from data_frontier.frontier_value_json -> 'data_snapshot'
      or certificate_payload #> '{version_frontier,policy_receipt_ref}'
        is distinct from policy_frontier.frontier_value_json -> 'reference'
      or certificate_payload #> '{version_frontier,identity_binding}'
        is distinct from identity_frontier.frontier_value_json -> 'identity_binding'
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_STALE', 'retryable', false
      )
    );
  end if;

  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
  for update of source nowait;
  if requested_purpose = 'REPORT_READ' then
    select source.*
    into grant_row
    from app_data_agent.report_read_grants as source
    where source.app_id = current_row.app_id
      and source.tenant_id = current_row.tenant_id
      and source.environment = current_row.environment
      and source.grant_id = requested_grant_id
    for update of source nowait;
  end if;
  select source.*
  into consumption_row
  from app_data_agent.research_readiness_consumptions as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and (
      source.consumption_id = (command_json ->> 'consumption_id')::uuid
      or (
        source.run_id = current_row.run_id
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.purpose = requested_purpose
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if consumption_row.consumption_id is not null then
    if consumption_row.consumption_id
        <> (command_json ->> 'consumption_id')::uuid
      or consumption_row.input_hash <> input_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    if consumption_row.outcome = 'STALE_COMMITTED'
      and current_row.state = 'REVOKED'
      and terminal_row.terminal = 'STALE'
      and terminal_row.revocation_receipt_ref
        is not distinct from current_row.revocation_receipt_ref
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
        'value', pg_catalog.jsonb_build_object(
          'purpose', 'DOMAIN_TERMINAL',
          'outcome', 'STALE_COMMITTED',
          'consumption_id', consumption_row.consumption_id,
          'current_state', 'REVOKED',
          'terminal', pg_catalog.jsonb_build_object(
            'terminal_id', terminal_row.terminal_id,
            'terminal', 'STALE',
            'reason_code', 'RUN_STALE',
            'domain_reason_codes', terminal_row.domain_reason_codes,
            'authority_kind', 'REVOCATION_CONSUMPTION',
            'certificate_ref', null,
            'revocation_receipt_ref', terminal_row.revocation_receipt_ref,
            'stop_decision_ref', null,
            'committed_at', terminal_row.committed_at
          )
        )
      );
    elsif consumption_row.outcome = 'READY_COMMITTED'
      and current_row.state = 'CURRENT'
      and terminal_row.terminal = 'READY'
      and terminal_row.certificate_ref is not distinct from certificate_ref
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
        'value', pg_catalog.jsonb_build_object(
          'purpose', 'DOMAIN_TERMINAL',
          'outcome', 'READY_COMMITTED',
          'consumption_id', consumption_row.consumption_id,
          'current_state', 'CURRENT',
          'terminal', pg_catalog.jsonb_build_object(
            'terminal_id', terminal_row.terminal_id,
            'terminal', 'READY',
            'reason_code', 'RUN_READY',
            'domain_reason_codes', terminal_row.domain_reason_codes,
            'authority_kind', 'CURRENT_READINESS',
            'certificate_ref', terminal_row.certificate_ref,
            'revocation_receipt_ref', null,
            'stop_decision_ref', null,
            'committed_at', terminal_row.committed_at
          )
        )
      );
    elsif consumption_row.outcome = 'GRANT_ISSUED'
      and current_row.state = 'CURRENT'
      and grant_row.grant_id = consumption_row.grant_id
      and grant_row.state in ('ISSUED', 'CONSUMED', 'RESPONDED')
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
        'value', pg_catalog.jsonb_build_object(
          'purpose', 'REPORT_READ',
          'outcome', 'GRANT_ISSUED',
          'consumption_id', consumption_row.consumption_id,
          'current_state', 'CURRENT',
          'grant_id', grant_row.grant_id,
          'state', 'ISSUED',
          'response', grant_row.response_wire - 'body_base64url'
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case when current_row.state = 'REVOKED'
          then 'CURRENT_READINESS_REVOKED'
          else 'AUTHORITY_EVIDENCE_NOT_CURRENT' end,
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if current_row.state = 'REVOKED' then
    if requested_purpose = 'REPORT_READ' then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'CURRENT_READINESS_REVOKED', 'retryable', false
        )
      );
    end if;
    if terminal_row.run_id is not null
      or current_row.revocation_receipt_ref is null
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'CURRENT_READINESS_REVOKED', 'retryable', false
        )
      );
    end if;
    insert into app_data_agent.research_domain_terminals (
      app_id, tenant_id, environment, run_id, terminal_id, terminal,
      authority_kind, reason_code, domain_reason_codes, certificate_ref,
      revocation_receipt_ref, stop_decision_ref, coverage_ref, input_hash,
      committed_at
    )
    values (
      current_row.app_id, current_row.tenant_id, current_row.environment,
      current_row.run_id, requested_terminal_id, 'STALE',
      'REVOCATION_CONSUMPTION', 'RUN_STALE',
      '["READINESS_REVOKED_DURING_CONSUMPTION"]'::jsonb,
      null, current_row.revocation_receipt_ref, null, null, input_hash, db_now
    );
    insert into app_data_agent.research_readiness_consumptions (
      app_id, tenant_id, environment, consumption_id, run_id, principal_id,
      purpose, idempotency_key, input_hash, certificate_ref, report_ref,
      readiness_version, revocation_seq, frontier_hash, authority_epoch,
      outcome, terminal_id, grant_id, committed_at
    )
    values (
      current_row.app_id, current_row.tenant_id, current_row.environment,
      (command_json ->> 'consumption_id')::uuid, current_row.run_id,
      (command_json ->> 'principal_id')::uuid, 'DOMAIN_TERMINAL',
      command_json ->> 'idempotency_key', input_hash, certificate_ref,
      current_row.report_ref, current_row.readiness_version,
      current_row.revocation_seq, current_row.frontier_hash,
      current_row.authority_epoch, 'STALE_COMMITTED',
      requested_terminal_id, null, db_now
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'purpose', 'DOMAIN_TERMINAL',
        'outcome', 'STALE_COMMITTED',
        'consumption_id', command_json ->> 'consumption_id',
        'current_state', 'REVOKED',
        'terminal', pg_catalog.jsonb_build_object(
          'terminal_id', requested_terminal_id,
          'terminal', 'STALE',
          'reason_code', 'RUN_STALE',
          'domain_reason_codes',
            '["READINESS_REVOKED_DURING_CONSUMPTION"]'::jsonb,
          'authority_kind', 'REVOCATION_CONSUMPTION',
          'certificate_ref', null,
          'revocation_receipt_ref', current_row.revocation_receipt_ref,
          'stop_decision_ref', null,
          'committed_at', db_now
        )
      )
    );
  end if;

  if requested_purpose = 'DOMAIN_TERMINAL' then
    if terminal_row.run_id is not null then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'CURRENT_READY_CONSUMPTION_REQUIRED', 'retryable', false
        )
      );
    end if;
    insert into app_data_agent.research_domain_terminals (
      app_id, tenant_id, environment, run_id, terminal_id, terminal,
      authority_kind, reason_code, domain_reason_codes, certificate_ref,
      revocation_receipt_ref, stop_decision_ref, coverage_ref, input_hash,
      committed_at
    )
    values (
      current_row.app_id, current_row.tenant_id, current_row.environment,
      current_row.run_id, requested_terminal_id, 'READY',
      'CURRENT_READINESS', 'RUN_READY', '[]'::jsonb, certificate_ref,
      null, null, null, input_hash, db_now
    );
    insert into app_data_agent.research_readiness_consumptions (
      app_id, tenant_id, environment, consumption_id, run_id, principal_id,
      purpose, idempotency_key, input_hash, certificate_ref, report_ref,
      readiness_version, revocation_seq, frontier_hash, authority_epoch,
      outcome, terminal_id, grant_id, committed_at
    )
    values (
      current_row.app_id, current_row.tenant_id, current_row.environment,
      (command_json ->> 'consumption_id')::uuid, current_row.run_id,
      (command_json ->> 'principal_id')::uuid, 'DOMAIN_TERMINAL',
      command_json ->> 'idempotency_key', input_hash, certificate_ref,
      current_row.report_ref, current_row.readiness_version,
      current_row.revocation_seq, current_row.frontier_hash,
      current_row.authority_epoch, 'READY_COMMITTED',
      requested_terminal_id, null, db_now
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'purpose', 'DOMAIN_TERMINAL',
        'outcome', 'READY_COMMITTED',
        'consumption_id', command_json ->> 'consumption_id',
        'current_state', 'CURRENT',
        'terminal', pg_catalog.jsonb_build_object(
          'terminal_id', requested_terminal_id,
          'terminal', 'READY',
          'reason_code', 'RUN_READY',
          'domain_reason_codes', '[]'::jsonb,
          'authority_kind', 'CURRENT_READINESS',
          'certificate_ref', certificate_ref,
          'revocation_receipt_ref', null,
          'stop_decision_ref', null,
          'committed_at', db_now
        )
      )
    );
  end if;

  if terminal_row.terminal is distinct from 'READY'
    or terminal_row.authority_kind is distinct from 'CURRENT_READINESS'
    or terminal_row.certificate_ref is distinct from certificate_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_READY_TERMINAL_REQUIRED', 'retryable', false
      )
    );
  end if;
  if grant_row.grant_id is not null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
      )
    );
  end if;

  body_bytes := pg_catalog.convert_to(
    app_data_agent.runtime_canonical_json(report_document -> 'payload'),
    'UTF8'
  );
  if pg_catalog.octet_length(body_bytes) > 1048576 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  body_base64url := pg_catalog.rtrim(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.translate(
          pg_catalog.encode(body_bytes, 'base64'),
          '+/',
          '-_'
        ),
        pg_catalog.chr(10),
        ''
      ),
      pg_catalog.chr(13),
      ''
    ),
    '='
  );
  response_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('canonical-response@1.0.0', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('application/json; charset=utf-8', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('inline', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || body_bytes,
      'sha256'
    ),
    'hex'
  );
  response_wire := pg_catalog.jsonb_build_object(
    'protocol_version', 'canonical-response@1.0.0',
    'media_type', 'application/json; charset=utf-8',
    'content_disposition', 'inline',
    'byte_length', pg_catalog.octet_length(body_bytes),
    'response_digest', response_digest,
    'body_base64url', body_base64url
  );
  response_binding := response_wire - 'body_base64url';
  response_wire_hash := app_data_agent.runtime_canonical_sha256(response_wire);
  expires_at := db_now + pg_catalog.make_interval(secs => 60);
  insert into app_data_agent.report_read_grants (
    app_id, tenant_id, environment, grant_id, run_id, principal_id,
    idempotency_key, issue_input_hash, certificate_ref, report_ref,
    response_wire, response_wire_hash, issue_readiness_version,
    issue_revocation_seq, issue_frontier_hash, authority_epoch, state,
    expires_at, issued_at
  )
  values (
    current_row.app_id, current_row.tenant_id, current_row.environment,
    requested_grant_id, current_row.run_id,
    (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash, certificate_ref,
    current_row.report_ref, response_wire, response_wire_hash,
    current_row.readiness_version, current_row.revocation_seq,
    current_row.frontier_hash, current_row.authority_epoch, 'ISSUED',
    expires_at, db_now
  );
  insert into app_data_agent.research_readiness_consumptions (
    app_id, tenant_id, environment, consumption_id, run_id, principal_id,
    purpose, idempotency_key, input_hash, certificate_ref, report_ref,
    readiness_version, revocation_seq, frontier_hash, authority_epoch,
    outcome, terminal_id, grant_id, committed_at
  )
  values (
    current_row.app_id, current_row.tenant_id, current_row.environment,
    (command_json ->> 'consumption_id')::uuid, current_row.run_id,
    (command_json ->> 'principal_id')::uuid, 'REPORT_READ',
    command_json ->> 'idempotency_key', input_hash, certificate_ref,
    current_row.report_ref, current_row.readiness_version,
    current_row.revocation_seq, current_row.frontier_hash,
    current_row.authority_epoch, 'GRANT_ISSUED', null,
    requested_grant_id, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'purpose', 'REPORT_READ',
      'outcome', 'GRANT_ISSUED',
      'consumption_id', command_json ->> 'consumption_id',
      'current_state', 'CURRENT',
      'grant_id', requested_grant_id,
      'state', 'ISSUED',
      'response', response_binding
    )
  );
end
$function$;

create function app_data_agent.revoke_current_readiness(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  certificate_ref jsonb;
  certificate_document jsonb;
  current_row record;
  terminal_row record;
  operation_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  input_hash text;
  observed_frontier jsonb;
  observed_frontier_hash text;
  observed_frontier_event_seq bigint;
  receipt_artifact_id uuid;
  receipt_payload jsonb;
  receipt_input_refs jsonb;
  receipt_envelope_material jsonb;
  receipt_envelope jsonb;
  receipt_document jsonb;
  receipt_content_hash text;
  receipt_commit jsonb;
  committed_receipt_ref jsonb;
  next_revocation_seq bigint;
  committed_at timestamptz;
  committed_at_text text;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'operation_id', 'certificate_ref',
        'observed_frontier_hash', 'reason'
      ]
    )
    or command_json ->> 'reason' is null
    or command_json ->> 'reason'
      not in ('EVIDENCE_REVOKED', 'CERTIFICATE_TAMPERED')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  certificate_ref := command_json -> 'certificate_ref';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'SERVICE_REVOCATION_AUTHORITY', null, null, null, true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-readiness-revocation-operation@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  receipt_artifact_id := app_data_agent.u6_uuid_v5(
    (command_json ->> 'operation_id')::uuid,
    pg_catalog.convert_to('readiness-revocation-receipt@1.0.0', 'UTF8')
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      app_data_agent.runtime_canonical_json(
        pg_catalog.jsonb_build_array(
          scope_json,
          command_json ->> 'run_id',
          receipt_artifact_id,
          'ReadinessRevocationReceipt'
        )
      ),
      0
    )
  );
  select artifact.document_json
  into certificate_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (scope_json ->> 'app_id')::uuid
    and artifact.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and artifact.environment = scope_json ->> 'environment'
    and artifact.run_id = (command_json ->> 'run_id')::uuid
    and artifact.artifact_id = (certificate_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'ReportReadyCertificate'
    and artifact.revision = (certificate_ref ->> 'revision')::integer
    and artifact.content_hash = certificate_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  if certificate_document is null
    or certificate_document #>> '{payload,protocol_version}'
      is distinct from 'report-ready@3.0.0'
    or certificate_document #>> '{envelope,status}'
      is distinct from 'COMMITTED'
    or app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope',
          (certificate_document -> 'envelope')
            - 'content_hash' - 'created_at' - 'status',
        'payload', certificate_document -> 'payload'
      )
    ) <> certificate_ref ->> 'content_hash'
    or certificate_document #>> '{payload,certificate_semantic_hash}'
      <> app_data_agent.runtime_canonical_sha256(
        (certificate_document -> 'payload') - 'certificate_semantic_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  if current_row.run_id is null
    or current_row.certificate_ref is distinct from certificate_ref
    or current_row.certificate_semantic_hash
      <> certificate_document #>> '{payload,certificate_semantic_hash}'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = current_row.app_id
    and frontier.tenant_id = current_row.tenant_id
    and frontier.environment = current_row.environment
    and frontier.run_id = current_row.run_id
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.* into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'SEMANTIC';
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'SCHEMA';
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'DATA';
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'POLICY';
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'IDENTITY';
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  observed_frontier := pg_catalog.jsonb_build_object(
    'semantic_release_ref',
      semantic_frontier.frontier_value_json -> 'reference',
    'schema_snapshot_ref',
      schema_frontier.frontier_value_json -> 'reference',
    'data_snapshot',
      data_frontier.frontier_value_json -> 'data_snapshot',
    'policy_receipt_ref',
      policy_frontier.frontier_value_json -> 'reference',
    'identity_binding',
      identity_frontier.frontier_value_json -> 'identity_binding'
  );
  observed_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );
  if observed_frontier_hash <> command_json ->> 'observed_frontier_hash' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_STALE', 'retryable', false
      )
    );
  end if;
  observed_frontier_event_seq := pg_catalog.greatest(
    semantic_frontier.event_seq,
    schema_frontier.event_seq,
    data_frontier.event_seq,
    policy_frontier.event_seq,
    identity_frontier.event_seq
  );

  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
  for update of source nowait;
  perform 1
  from app_data_agent.report_read_grants as grant_source
  where grant_source.app_id = current_row.app_id
    and grant_source.tenant_id = current_row.tenant_id
    and grant_source.environment = current_row.environment
    and grant_source.run_id = current_row.run_id
  order by grant_source.grant_id
  for update of grant_source nowait;
  select source.*
  into operation_row
  from app_data_agent.research_revocation_operations as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and (
      source.operation_id = (command_json ->> 'operation_id')::uuid
      or (
        source.run_id = current_row.run_id
        and source.owner_principal_id =
          (command_json ->> 'principal_id')::uuid
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if operation_row.operation_id is not null then
    if operation_row.operation_id <> (command_json ->> 'operation_id')::uuid
      or operation_row.input_hash <> input_hash
      or operation_row.trigger_kind <> 'SERVICE_REQUEST'
      or operation_row.state <> 'COMMITTED'
      or operation_row.certificate_ref is distinct from certificate_ref
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'operation_id', operation_row.operation_id,
        'state', 'REVOKED',
        'revocation_seq', current_row.revocation_seq,
        'receipt_ref', operation_row.receipt_ref
      )
    );
  end if;
  if current_row.state = 'REVOKED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'CURRENT_READINESS_REVOKED', 'retryable', false
      )
    );
  end if;

  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.research_revocation_operations (
    app_id, tenant_id, environment, operation_id, run_id,
    owner_principal_id, idempotency_key, input_hash, trigger_kind,
    source_operation_id, reason, certificate_ref, observed_frontier_hash,
    authority_epoch, state
  )
  values (
    current_row.app_id, current_row.tenant_id, current_row.environment,
    (command_json ->> 'operation_id')::uuid, current_row.run_id,
    (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash, 'SERVICE_REQUEST',
    (command_json ->> 'operation_id')::uuid, command_json ->> 'reason',
    certificate_ref, observed_frontier_hash,
    identity_frontier.authority_epoch, 'REQUESTED'
  );

  receipt_payload := pg_catalog.jsonb_build_object(
    'artifact_type', 'ReadinessRevocationReceipt',
    'protocol_version', 'readiness-revocation@1.0.0',
    'certificate_ref', certificate_ref,
    'observed_frontier', observed_frontier,
    'reason', command_json ->> 'reason',
    'trigger', 'SERVICE_REQUEST',
    'source_operation_id', command_json ->> 'operation_id',
    'observed_frontier_event_seq', observed_frontier_event_seq
  );
  receipt_payload := receipt_payload || pg_catalog.jsonb_build_object(
    'revocation_semantic_hash',
    app_data_agent.runtime_canonical_sha256(receipt_payload)
  );
  select pg_catalog.jsonb_agg(reference_value order by reference_identity)
  into receipt_input_refs
  from (
    select candidate.reference_value,
      app_data_agent.runtime_canonical_json(
        pg_catalog.jsonb_build_array(
          candidate.reference_value ->> 'app_id',
          candidate.reference_value ->> 'tenant_id',
          candidate.reference_value ->> 'environment',
          candidate.reference_value ->> 'run_id',
          candidate.reference_value ->> 'artifact_id',
          candidate.reference_value ->> 'artifact_type',
          candidate.reference_value -> 'revision',
          candidate.reference_value ->> 'content_hash'
        )
      ) as reference_identity
    from (
      values
        (certificate_ref),
        (observed_frontier -> 'semantic_release_ref'),
        (observed_frontier -> 'schema_snapshot_ref'),
        (observed_frontier -> 'policy_receipt_ref')
    ) as candidate(reference_value)
  ) as ordered_references;
  committed_at_text := pg_catalog.to_char(
    committed_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  receipt_envelope_material := pg_catalog.jsonb_build_object(
    'artifact_id', receipt_artifact_id,
    'artifact_type', 'ReadinessRevocationReceipt',
    'app_id', current_row.app_id,
    'tenant_id', current_row.tenant_id,
    'environment', current_row.environment,
    'run_id', current_row.run_id,
    'revision', 1,
    'parent_ref', null,
    'attempt_id', command_json ->> 'operation_id',
    'producer', pg_catalog.jsonb_build_object(
      'kind', 'deterministic',
      'id', 'u6-readiness-revocation-writer'
    ),
    'input_refs', receipt_input_refs,
    'schema_version', '1.0.0',
    'semantic_version', '1.0.0',
    'policy_version', '1.0.0',
    'model_profile_version', '1.0.0'
  );
  receipt_content_hash := app_data_agent.runtime_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'envelope', receipt_envelope_material,
      'payload', receipt_payload
    )
  );
  receipt_envelope := receipt_envelope_material
    || pg_catalog.jsonb_build_object(
      'content_hash', receipt_content_hash,
      'status', 'COMMITTED',
      'created_at', committed_at_text
    );
  receipt_document := pg_catalog.jsonb_build_object(
    'envelope', receipt_envelope,
    'payload', receipt_payload
  );
  receipt_commit := app_data_agent.commit_research_revocation_receipt(
    pg_catalog.jsonb_build_object(
      'document', receipt_document,
      'document_checksum',
        app_data_agent.runtime_canonical_sha256(receipt_document)
    )
  );
  committed_receipt_ref := receipt_commit -> 'reference';
  if committed_receipt_ref is null then
    raise exception using
      errcode = '23514',
      message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
  end if;

  next_revocation_seq := current_row.revocation_seq + 1;
  update app_data_agent.current_report_readiness
  set state = 'REVOKED',
      revocation_seq = next_revocation_seq,
      revocation_receipt_ref = committed_receipt_ref,
      revoked_at = committed_at,
      updated_at = committed_at
  where app_id = current_row.app_id
    and tenant_id = current_row.tenant_id
    and environment = current_row.environment
    and run_id = current_row.run_id
    and state = 'CURRENT';
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
  end if;
  update app_data_agent.report_read_grants as target
  set state = 'REVOKED',
      terminal_from_status = target.state,
      revoked_at = committed_at
  where target.app_id = current_row.app_id
    and target.tenant_id = current_row.tenant_id
    and target.environment = current_row.environment
    and target.run_id = current_row.run_id
    and target.state in ('ISSUED', 'CONSUMED');
  update app_data_agent.research_revocation_operations
  set state = 'COMMITTED',
      receipt_ref = committed_receipt_ref,
      completed_at = committed_at
  where app_id = current_row.app_id
    and tenant_id = current_row.tenant_id
    and environment = current_row.environment
    and operation_id = (command_json ->> 'operation_id')::uuid
    and state = 'REQUESTED';
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'operation_id', command_json ->> 'operation_id',
      'state', 'REVOKED',
      'revocation_seq', next_revocation_seq,
      'receipt_ref', committed_receipt_ref
    )
  );
end
$function$;

create function app_data_agent.consume_report_read_grant(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  input_hash text;
  grant_locator record;
  grant_row record;
  current_row record;
  terminal_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  aggregate_frontier_hash text;
  locked_artifact_count bigint;
  decoded_body bytea;
  expected_response_digest text;
  db_now timestamptz;
  transition_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 6
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'grant_id'
      ]
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'REPORT_READ_AUTHORITY', null, null, null, false
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'report-read-grant-consumption@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  -- Locator only; the row is re-locked at its frozen rank below.
  select source.*
  into grant_locator
  from app_data_agent.report_read_grants as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.grant_id = (command_json ->> 'grant_id')::uuid
    and source.run_id = (command_json ->> 'run_id')::uuid;
  if grant_locator.grant_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  perform 1
  from app_data_agent.artifacts as artifact
  where artifact.app_id = grant_locator.app_id
    and artifact.tenant_id = grant_locator.tenant_id
    and artifact.environment = grant_locator.environment
    and artifact.run_id = grant_locator.run_id
    and (
      (
        artifact.artifact_id =
          (grant_locator.certificate_ref ->> 'artifact_id')::uuid
        and artifact.artifact_type = 'ReportReadyCertificate'
        and artifact.revision =
          (grant_locator.certificate_ref ->> 'revision')::integer
        and artifact.content_hash =
          grant_locator.certificate_ref ->> 'content_hash'
      )
      or (
        artifact.artifact_id = (grant_locator.report_ref ->> 'artifact_id')::uuid
        and artifact.artifact_type = 'AnalysisReport'
        and artifact.revision = (grant_locator.report_ref ->> 'revision')::integer
        and artifact.content_hash = grant_locator.report_ref ->> 'content_hash'
      )
    )
    and artifact.is_active
  order by app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      artifact.app_id, artifact.tenant_id, artifact.environment,
      artifact.run_id, artifact.artifact_id, artifact.artifact_type,
      artifact.revision, artifact.content_hash
    )
  )
  for update of artifact nowait;
  get diagnostics locked_artifact_count = row_count;
  if locked_artifact_count <> 2 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
  for update of source nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = grant_locator.app_id
    and frontier.tenant_id = grant_locator.tenant_id
    and frontier.environment = grant_locator.environment
    and frontier.run_id = grant_locator.run_id
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.* into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'SEMANTIC';
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'SCHEMA';
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'DATA';
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'POLICY';
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'IDENTITY';
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  aggregate_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );
  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
  for update of source nowait;
  select source.*
  into grant_row
  from app_data_agent.report_read_grants as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.grant_id = grant_locator.grant_id
  for update of source nowait;
  if grant_row.grant_id is null
    or grant_row.principal_id <> (command_json ->> 'principal_id')::uuid
    or current_row.run_id is null
    or current_row.state <> 'CURRENT'
    or current_row.certificate_ref is distinct from grant_row.certificate_ref
    or current_row.report_ref is distinct from grant_row.report_ref
    or current_row.readiness_version <> grant_row.issue_readiness_version
    or current_row.revocation_seq <> grant_row.issue_revocation_seq
    or current_row.frontier_hash <> aggregate_frontier_hash
    or current_row.frontier_hash <> grant_row.issue_frontier_hash
    or current_row.authority_epoch <> grant_row.authority_epoch
    or current_row.authority_epoch <> identity_frontier.authority_epoch
    or terminal_row.terminal is distinct from 'READY'
    or terminal_row.certificate_ref is distinct from grant_row.certificate_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case
          when current_row.state = 'REVOKED' or grant_row.state = 'REVOKED'
            then 'REPORT_READ_GRANT_REVOKED'
          else 'AUTHORITY_EVIDENCE_NOT_CURRENT'
        end,
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if db_now >= grant_row.expires_at or grant_row.state = 'EXPIRED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_EXPIRED', 'retryable', false
      )
    );
  end if;
  decoded_body := app_data_agent.u6_strict_base64url_decode(
    grant_row.response_wire ->> 'body_base64url'
  );
  expected_response_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('canonical-response@1.0.0', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('application/json; charset=utf-8', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('inline', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || decoded_body,
      'sha256'
    ),
    'hex'
  );
  if grant_row.response_wire_hash
      <> app_data_agent.runtime_canonical_sha256(grant_row.response_wire)
    or grant_row.response_wire ->> 'protocol_version'
      is distinct from 'canonical-response@1.0.0'
    or grant_row.response_wire ->> 'media_type'
      is distinct from 'application/json; charset=utf-8'
    or grant_row.response_wire ->> 'content_disposition'
      is distinct from 'inline'
    or (grant_row.response_wire ->> 'byte_length')::bigint
      <> pg_catalog.octet_length(decoded_body)
    or grant_row.response_wire ->> 'response_digest'
      <> expected_response_digest
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_RESPONSE_DIGEST_MISMATCH', 'retryable', false
      )
    );
  end if;

  if grant_row.state in ('CONSUMED', 'RESPONDED')
    and grant_row.consume_idempotency_key =
      command_json ->> 'idempotency_key'
    and grant_row.consume_input_hash = input_hash
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'grant_id', grant_row.grant_id,
        'state', 'CONSUMED',
        'report_ref', grant_row.report_ref,
        'response', grant_row.response_wire - 'body_base64url',
        'consumed_at', grant_row.consumed_at
      )
    );
  end if;
  if grant_row.state <> 'ISSUED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case when grant_row.state = 'REVOKED'
          then 'REPORT_READ_GRANT_REVOKED'
          else 'REPORT_READ_GRANT_NOT_CONSUMABLE' end,
        'retryable', false
      )
    );
  end if;
  transition_at := db_now;
  update app_data_agent.report_read_grants
  set state = 'CONSUMED',
      consume_idempotency_key = command_json ->> 'idempotency_key',
      consume_input_hash = input_hash,
      consumed_at = transition_at
  where app_id = grant_row.app_id
    and tenant_id = grant_row.tenant_id
    and environment = grant_row.environment
    and grant_id = grant_row.grant_id
    and state = 'ISSUED';
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'grant_id', grant_row.grant_id,
      'state', 'CONSUMED',
      'report_ref', grant_row.report_ref,
      'response', grant_row.response_wire - 'body_base64url',
      'consumed_at', transition_at
    )
  );
end
$function$;

create function app_data_agent.expire_report_read_grant(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  input_hash text;
  current_row record;
  terminal_row record;
  grant_row record;
  operation_row record;
  db_now timestamptz;
  source_state text;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'operation_id', 'grant_id',
        'expected_state', 'reason_code'
      ]
    )
    or command_json ->> 'expected_state' is null
    or command_json ->> 'expected_state' not in ('ISSUED', 'CONSUMED')
    or command_json ->> 'reason_code'
      is distinct from 'REPORT_READ_GRANT_TTL_EXPIRED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'REPORT_READ_EXPIRY_AUTHORITY', null, null, null, true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'report-read-grant-expiration@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;
  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = (scope_json ->> 'app_id')::uuid
    and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and frontier.environment = scope_json ->> 'environment'
    and frontier.run_id = (command_json ->> 'run_id')::uuid
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  select source.*
  into grant_row
  from app_data_agent.report_read_grants as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.grant_id = (command_json ->> 'grant_id')::uuid
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  select source.*
  into operation_row
  from app_data_agent.report_read_grant_expiration_operations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.operation_id = (command_json ->> 'operation_id')::uuid
      or (
        source.grant_id = (command_json ->> 'grant_id')::uuid
        and source.principal_id =
          (command_json ->> 'principal_id')::uuid
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if operation_row.operation_id is not null then
    if operation_row.operation_id <> (command_json ->> 'operation_id')::uuid
      or operation_row.input_hash <> input_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'operation_id', operation_row.operation_id,
        'grant_id', operation_row.grant_id,
        'state', 'EXPIRED',
        'terminal_from_status', operation_row.source_state,
        'expired_at', operation_row.committed_at
      )
    );
  end if;
  if grant_row.grant_id is null
    or grant_row.state = 'REVOKED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case when grant_row.state = 'REVOKED'
          then 'REPORT_READ_GRANT_REVOKED'
          else 'REPORT_READ_GRANT_NOT_CONSUMABLE' end,
        'retryable', false
      )
    );
  end if;
  source_state := grant_row.state;
  if source_state <> command_json ->> 'expected_state' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  if db_now < grant_row.expires_at then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;

  update app_data_agent.report_read_grants
  set state = 'EXPIRED',
      terminal_from_status = source_state,
      expired_at = db_now
  where app_id = grant_row.app_id
    and tenant_id = grant_row.tenant_id
    and environment = grant_row.environment
    and grant_id = grant_row.grant_id
    and state = source_state;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  insert into app_data_agent.report_read_grant_expiration_operations (
    app_id, tenant_id, environment, operation_id, grant_id, principal_id,
    idempotency_key, input_hash, expected_state, source_state, committed_at
  )
  values (
    grant_row.app_id, grant_row.tenant_id, grant_row.environment,
    (command_json ->> 'operation_id')::uuid, grant_row.grant_id,
    (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash,
    command_json ->> 'expected_state', source_state, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'operation_id', command_json ->> 'operation_id',
      'grant_id', grant_row.grant_id,
      'state', 'EXPIRED',
      'terminal_from_status', source_state,
      'expired_at', db_now
    )
  );
end
$function$;

create function app_data_agent.commit_report_read_response(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  input_hash text;
  grant_locator record;
  grant_row record;
  current_row record;
  terminal_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  aggregate_frontier_hash text;
  locked_artifact_count bigint;
  report_document jsonb;
  body_bytes bytea;
  body_base64url text;
  response_digest text;
  expected_response_wire jsonb;
  expected_response_wire_hash text;
  db_now timestamptz;
  response_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 6
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'grant_id'
      ]
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'REPORT_READ_AUTHORITY', null, null, null, false
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'report-read-response-commit@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;
  select source.*
  into grant_locator
  from app_data_agent.report_read_grants as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.grant_id = (command_json ->> 'grant_id')::uuid
    and source.run_id = (command_json ->> 'run_id')::uuid;
  if grant_locator.grant_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  perform 1
  from app_data_agent.artifacts as artifact
  where artifact.app_id = grant_locator.app_id
    and artifact.tenant_id = grant_locator.tenant_id
    and artifact.environment = grant_locator.environment
    and artifact.run_id = grant_locator.run_id
    and (
      (
        artifact.artifact_id =
          (grant_locator.certificate_ref ->> 'artifact_id')::uuid
        and artifact.artifact_type = 'ReportReadyCertificate'
        and artifact.revision =
          (grant_locator.certificate_ref ->> 'revision')::integer
        and artifact.content_hash =
          grant_locator.certificate_ref ->> 'content_hash'
      )
      or (
        artifact.artifact_id = (grant_locator.report_ref ->> 'artifact_id')::uuid
        and artifact.artifact_type = 'AnalysisReport'
        and artifact.revision = (grant_locator.report_ref ->> 'revision')::integer
        and artifact.content_hash = grant_locator.report_ref ->> 'content_hash'
      )
    )
    and artifact.is_active
  order by app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      artifact.app_id, artifact.tenant_id, artifact.environment,
      artifact.run_id, artifact.artifact_id, artifact.artifact_type,
      artifact.revision, artifact.content_hash
    )
  )
  for update of artifact nowait;
  get diagnostics locked_artifact_count = row_count;
  if locked_artifact_count <> 2 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;
  select artifact.document_json
  into report_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = grant_locator.app_id
    and artifact.tenant_id = grant_locator.tenant_id
    and artifact.environment = grant_locator.environment
    and artifact.run_id = grant_locator.run_id
    and artifact.artifact_id = (grant_locator.report_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'AnalysisReport'
    and artifact.revision = (grant_locator.report_ref ->> 'revision')::integer
    and artifact.content_hash = grant_locator.report_ref ->> 'content_hash'
    and artifact.is_active;
  if report_document is null
    or report_document #>> '{payload,protocol_version}'
      is distinct from 'analysis-report@2.0.0'
    or report_document #>> '{envelope,status}' is distinct from 'COMMITTED'
    or app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope',
          (report_document -> 'envelope')
            - 'content_hash' - 'created_at' - 'status',
        'payload', report_document -> 'payload'
      )
    ) <> grant_locator.report_ref ->> 'content_hash'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
  for update of source nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = grant_locator.app_id
    and frontier.tenant_id = grant_locator.tenant_id
    and frontier.environment = grant_locator.environment
    and frontier.run_id = grant_locator.run_id
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.* into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'SEMANTIC';
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'SCHEMA';
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'DATA';
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'POLICY';
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'IDENTITY';
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  aggregate_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );
  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
  for update of source nowait;
  select source.*
  into grant_row
  from app_data_agent.report_read_grants as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.grant_id = grant_locator.grant_id
  for update of source nowait;
  if grant_row.grant_id is null
    or grant_row.principal_id <> (command_json ->> 'principal_id')::uuid
    or current_row.run_id is null
    or current_row.state <> 'CURRENT'
    or current_row.certificate_ref is distinct from grant_row.certificate_ref
    or current_row.report_ref is distinct from grant_row.report_ref
    or current_row.readiness_version <> grant_row.issue_readiness_version
    or current_row.revocation_seq <> grant_row.issue_revocation_seq
    or current_row.frontier_hash <> aggregate_frontier_hash
    or current_row.frontier_hash <> grant_row.issue_frontier_hash
    or current_row.authority_epoch <> grant_row.authority_epoch
    or current_row.authority_epoch <> identity_frontier.authority_epoch
    or terminal_row.terminal is distinct from 'READY'
    or terminal_row.certificate_ref is distinct from grant_row.certificate_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case
          when current_row.state = 'REVOKED' or grant_row.state = 'REVOKED'
            then 'REPORT_READ_GRANT_REVOKED'
          else 'AUTHORITY_EVIDENCE_NOT_CURRENT'
        end,
        'retryable', false
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  if db_now >= grant_row.expires_at or grant_row.state = 'EXPIRED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_EXPIRED', 'retryable', false
      )
    );
  end if;

  body_bytes := pg_catalog.convert_to(
    app_data_agent.runtime_canonical_json(report_document -> 'payload'),
    'UTF8'
  );
  if pg_catalog.octet_length(body_bytes) > 1048576 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_RESPONSE_DIGEST_MISMATCH', 'retryable', false
      )
    );
  end if;
  body_base64url := pg_catalog.rtrim(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.translate(
          pg_catalog.encode(body_bytes, 'base64'),
          '+/',
          '-_'
        ),
        pg_catalog.chr(10),
        ''
      ),
      pg_catalog.chr(13),
      ''
    ),
    '='
  );
  response_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('canonical-response@1.0.0', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('application/json; charset=utf-8', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('inline', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || body_bytes,
      'sha256'
    ),
    'hex'
  );
  expected_response_wire := pg_catalog.jsonb_build_object(
    'protocol_version', 'canonical-response@1.0.0',
    'media_type', 'application/json; charset=utf-8',
    'content_disposition', 'inline',
    'byte_length', pg_catalog.octet_length(body_bytes),
    'response_digest', response_digest,
    'body_base64url', body_base64url
  );
  expected_response_wire_hash :=
    app_data_agent.runtime_canonical_sha256(expected_response_wire);
  if grant_row.response_wire is distinct from expected_response_wire
    or grant_row.response_wire_hash <> expected_response_wire_hash
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_RESPONSE_DIGEST_MISMATCH', 'retryable', false
      )
    );
  end if;

  if grant_row.state = 'RESPONDED'
    and grant_row.response_idempotency_key =
      command_json ->> 'idempotency_key'
    and grant_row.response_input_hash = input_hash
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'grant_id', grant_row.grant_id,
        'state', 'RESPONDED',
        'response', expected_response_wire,
        'responded_at', grant_row.responded_at
      )
    );
  end if;
  if grant_row.state <> 'CONSUMED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case when grant_row.state = 'REVOKED'
          then 'REPORT_READ_GRANT_REVOKED'
          else 'REPORT_READ_GRANT_NOT_CONSUMABLE' end,
        'retryable', false
      )
    );
  end if;
  response_at := db_now;
  update app_data_agent.report_read_grants
  set state = 'RESPONDED',
      response_idempotency_key = command_json ->> 'idempotency_key',
      response_input_hash = input_hash,
      responded_at = response_at
  where app_id = grant_row.app_id
    and tenant_id = grant_row.tenant_id
    and environment = grant_row.environment
    and grant_id = grant_row.grant_id
    and state = 'CONSUMED';
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'grant_id', grant_row.grant_id,
      'state', 'RESPONDED',
      'response', expected_response_wire,
      'responded_at', response_at
    )
  );
end
$function$;

create function app_data_agent.commit_current_release_go(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 16
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'decision_id', 'decision', 'certificate_ref',
        'release_manifest_ref', 'scorecard_refs',
        'benchmark_receipt_refs', 'sandbox_receipt_refs',
        'model_certification_receipt_refs', 'signed_outcome_refs',
        'release_policy_version', 'candidate_input_hash'
      ]
    )
    or command_json ->> 'decision' is distinct from 'GO'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'RELEASE_GO_AUTHORITY', null, null, null, true
  );

  -- U6 freezes the GO wire and lock surface, but the authoritative U7-U9
  -- release-evidence and signed-outcome verifier does not exist in this
  -- migration. Failing closed here is the only honest state: no row is ever
  -- inserted into research_release_decision_commits until that verifier is
  -- delivered and independently certified.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'CURRENT_RELEASE_COMMIT_REQUIRED', 'retryable', false
    )
  );
end
$function$;

create function app_data_agent.commit_research_stop_terminal(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  stop_ref jsonb;
  coverage_ref jsonb;
  stop_document jsonb;
  stop_payload jsonb;
  coverage_document jsonb;
  requested_terminal text;
  requested_reason text;
  input_hash text;
  existing_commit record;
  existing_terminal record;
  committed_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  stop_ref := command_json -> 'stop_decision_ref';
  coverage_ref := command_json -> 'coverage_ref';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'RESEARCH_STOP_AUTHORITY', null, null, null, true
  );
  -- The Stop payload contains derived assessments but not the DB-owned
  -- CandidateEnumerationReceipt and BudgetLedgerReceipt needed to replay the
  -- mutually exclusive decision tree. Never turn self-reported JSON into an
  -- immutable public terminal.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_STOP_INPUT_INCONSISTENT', 'retryable', false
    )
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-stop-terminal-commit@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and run.principal_id = (command_json ->> 'principal_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select source.*
  into existing_commit
  from app_data_agent.research_stop_terminal_commits as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.commit_id = (command_json ->> 'commit_id')::uuid
      or (
        source.run_id = (command_json ->> 'run_id')::uuid
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if existing_commit.commit_id is not null then
    if existing_commit.input_hash <> input_hash
      or existing_commit.commit_id <> (command_json ->> 'commit_id')::uuid
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    select source.*
    into existing_terminal
    from app_data_agent.research_domain_terminals as source
    where source.app_id = existing_commit.app_id
      and source.tenant_id = existing_commit.tenant_id
      and source.environment = existing_commit.environment
      and source.run_id = existing_commit.run_id;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'commit_id', existing_commit.commit_id,
        'terminal_id', existing_terminal.terminal_id,
        'terminal', existing_terminal.terminal,
        'reason_code', existing_terminal.reason_code,
        'domain_reason_codes', existing_terminal.domain_reason_codes,
        'authority_kind', 'RESEARCH_STOP',
        'certificate_ref', null,
        'revocation_receipt_ref', null,
        'stop_decision_ref', existing_terminal.stop_decision_ref,
        'committed_at', existing_terminal.committed_at
      )
    );
  end if;

  perform 1
  from app_data_agent.current_report_readiness as current
  where current.app_id = (scope_json ->> 'app_id')::uuid
    and current.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and current.environment = scope_json ->> 'environment'
    and current.run_id = (command_json ->> 'run_id')::uuid
  for update of current nowait;
  if found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_STOP_INPUT_INCONSISTENT', 'retryable', false
      )
    );
  end if;
  perform 1
  from app_data_agent.research_domain_terminals as terminal
  where terminal.app_id = (scope_json ->> 'app_id')::uuid
    and terminal.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and terminal.environment = scope_json ->> 'environment'
    and terminal.run_id = (command_json ->> 'run_id')::uuid
  for update of terminal nowait;
  if found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED', 'retryable', false
      )
    );
  end if;

  select artifact.document_json
  into stop_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (stop_ref ->> 'app_id')::uuid
    and artifact.tenant_id = (stop_ref ->> 'tenant_id')::uuid
    and artifact.environment = stop_ref ->> 'environment'
    and artifact.run_id = (stop_ref ->> 'run_id')::uuid
    and artifact.artifact_id = (stop_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'ResearchStopDecision'
    and artifact.revision = (stop_ref ->> 'revision')::integer
    and artifact.content_hash = stop_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  select artifact.document_json
  into coverage_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (coverage_ref ->> 'app_id')::uuid
    and artifact.tenant_id = (coverage_ref ->> 'tenant_id')::uuid
    and artifact.environment = coverage_ref ->> 'environment'
    and artifact.run_id = (coverage_ref ->> 'run_id')::uuid
    and artifact.artifact_id = (coverage_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'CoverageState'
    and artifact.revision = (coverage_ref ->> 'revision')::integer
    and artifact.content_hash = coverage_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  if stop_document is null
    or coverage_document is null
    or stop_document #> '{payload,coverage_ref}' is distinct from coverage_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;
  stop_payload := stop_document -> 'payload';
  select mapped.terminal, mapped.reason_code
  into requested_terminal, requested_reason
  from (
    values
      ('STOP_PARTIAL', 'PARTIAL', 'EVIDENCE_PARTIAL'),
      (
        'STOP_NEEDS_MORE_RESEARCH',
        'NEEDS_MORE_RESEARCH',
        'EVIDENCE_COVERAGE_INSUFFICIENT'
      ),
      ('STOP_INCONCLUSIVE', 'INCONCLUSIVE', 'ANALYSIS_INCONCLUSIVE')
  ) as mapped(decision, terminal, reason_code)
  where mapped.decision = stop_payload ->> 'decision';
  if requested_terminal is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_STOP_INPUT_INCONSISTENT', 'retryable', false
      )
    );
  end if;
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.research_domain_terminals (
    app_id, tenant_id, environment, run_id, terminal_id, terminal,
    authority_kind, reason_code, domain_reason_codes, certificate_ref,
    revocation_receipt_ref, stop_decision_ref, coverage_ref, input_hash,
    committed_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'run_id')::uuid,
    (command_json ->> 'terminal_id')::uuid, requested_terminal,
    'RESEARCH_STOP', requested_reason, stop_payload -> 'reason_codes',
    null, null, stop_ref, coverage_ref, input_hash, committed_at
  );
  insert into app_data_agent.research_stop_terminal_commits (
    app_id, tenant_id, environment, commit_id, run_id, principal_id,
    idempotency_key, input_hash, stop_decision_ref, coverage_ref, terminal_id
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'commit_id')::uuid,
    (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash, stop_ref, coverage_ref,
    (command_json ->> 'terminal_id')::uuid
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'commit_id', command_json ->> 'commit_id',
      'terminal_id', command_json ->> 'terminal_id',
      'terminal', requested_terminal,
      'reason_code', requested_reason,
      'domain_reason_codes', stop_payload -> 'reason_codes',
      'authority_kind', 'RESEARCH_STOP',
      'certificate_ref', null,
      'revocation_receipt_ref', null,
      'stop_decision_ref', stop_ref,
      'committed_at', committed_at
    )
  );
end
$function$;

create function app_data_agent.publish_current_report_readiness(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  certificate_ref jsonb;
  certificate_document jsonb;
  certificate_payload jsonb;
  report_ref jsonb;
  current_row record;
  publication_row record;
  terminal_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  aggregate_frontier_hash text;
  input_hash text;
  next_readiness_version bigint;
  preserved_revocation_seq bigint;
  committed_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 8
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  certificate_ref := command_json -> 'certificate_ref';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'CURRENT_READINESS_AUTHORITY', null, null, null, true
  );
  -- Current Coverage does not yet bind the DB-owned derivation receipts and
  -- the Certificate input-event watermark has no PostgreSQL authority source.
  -- Publishing CURRENT from a shallow self-hash would make forged READY
  -- reachable, therefore publication remains explicitly fail closed.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_DATABASE_AUTHORITY_REQUIRED', 'retryable', false
    )
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-readiness-publication@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and run.principal_id = (command_json ->> 'principal_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  if terminal_row.run_id is not null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_STOP_INPUT_INCONSISTENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;

  select source.*
  into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'SEMANTIC'
  for update of source nowait;
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'SCHEMA'
  for update of source nowait;
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'DATA'
  for update of source nowait;
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'POLICY'
  for update of source nowait;
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'IDENTITY'
  for update of source nowait;
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;

  select artifact.document_json
  into certificate_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (certificate_ref ->> 'app_id')::uuid
    and artifact.tenant_id = (certificate_ref ->> 'tenant_id')::uuid
    and artifact.environment = certificate_ref ->> 'environment'
    and artifact.run_id = (certificate_ref ->> 'run_id')::uuid
    and artifact.artifact_id = (certificate_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'ReportReadyCertificate'
    and artifact.revision = (certificate_ref ->> 'revision')::integer
    and artifact.content_hash = certificate_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  certificate_payload := certificate_document -> 'payload';
  if certificate_document is null
    or certificate_payload ->> 'protocol_version'
      is distinct from 'report-ready@3.0.0'
    or certificate_payload -> 'version_frontier' -> 'semantic_release_ref'
      is distinct from semantic_frontier.frontier_value_json -> 'reference'
    or certificate_payload -> 'version_frontier' -> 'schema_snapshot_ref'
      is distinct from schema_frontier.frontier_value_json -> 'reference'
    or certificate_payload -> 'version_frontier' -> 'data_snapshot'
      is distinct from data_frontier.frontier_value_json -> 'data_snapshot'
    or certificate_payload -> 'version_frontier' -> 'policy_receipt_ref'
      is distinct from policy_frontier.frontier_value_json -> 'reference'
    or certificate_payload -> 'version_frontier' -> 'identity_binding'
      is distinct from identity_frontier.frontier_value_json -> 'identity_binding'
    or certificate_payload ->> 'certificate_semantic_hash'
      <> app_data_agent.runtime_canonical_sha256(
        certificate_payload - 'certificate_semantic_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READY_CERTIFICATE_TAMPERED', 'retryable', false
      )
    );
  end if;
  report_ref := certificate_payload -> 'analysis_report_ref';
  aggregate_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );

  select source.*
  into publication_row
  from app_data_agent.research_readiness_publications as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.publication_id = (command_json ->> 'publication_id')::uuid
      or (
        source.run_id = (command_json ->> 'run_id')::uuid
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if publication_row.publication_id is not null then
    if publication_row.input_hash <> input_hash
      or current_row.state <> 'CURRENT'
      or current_row.certificate_ref is distinct from certificate_ref
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code',
          case when current_row.state = 'REVOKED'
            then 'CURRENT_READINESS_REVOKED'
            else 'READINESS_IDEMPOTENCY_CONFLICT' end,
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'state', 'CURRENT',
        'certificate_ref', current_row.certificate_ref,
        'report_ref', current_row.report_ref,
        'readiness_version', current_row.readiness_version,
        'revocation_seq', current_row.revocation_seq,
        'frontier_hash', current_row.frontier_hash
      )
    );
  end if;
  if exists (
    select 1
    from app_data_agent.research_revocation_operations as operation
    where operation.app_id = (scope_json ->> 'app_id')::uuid
      and operation.tenant_id = (scope_json ->> 'tenant_id')::uuid
      and operation.environment = scope_json ->> 'environment'
      and operation.certificate_ref = certificate_ref
      and operation.state = 'COMMITTED'
  ) then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'CURRENT_READINESS_REVOKED', 'retryable', false
      )
    );
  end if;
  if current_row.run_id is null then
    if command_json -> 'expected_readiness_version' <> 'null'::jsonb then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_CAS_CONFLICT', 'retryable', true
        )
      );
    end if;
    next_readiness_version := 0;
    preserved_revocation_seq := 0;
  else
    if (command_json ->> 'expected_readiness_version')::bigint
      is distinct from current_row.readiness_version
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_CAS_CONFLICT', 'retryable', true
        )
      );
    end if;
    next_readiness_version := current_row.readiness_version + 1;
    preserved_revocation_seq := current_row.revocation_seq;
  end if;
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.current_report_readiness (
    app_id, tenant_id, environment, run_id, state, certificate_ref,
    certificate_identity, certificate_semantic_hash, report_ref, report_identity,
    semantic_frontier_version, semantic_frontier_hash,
    schema_frontier_version, schema_frontier_hash,
    data_frontier_version, data_frontier_hash,
    policy_frontier_version, policy_frontier_hash,
    identity_frontier_version, identity_frontier_hash,
    frontier_hash, authority_epoch, readiness_version, revocation_seq,
    revocation_receipt_ref, published_at, revoked_at, updated_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'run_id')::uuid,
    'CURRENT', certificate_ref, app_data_agent.runtime_canonical_json(certificate_ref),
    certificate_payload ->> 'certificate_semantic_hash',
    report_ref, app_data_agent.runtime_canonical_json(report_ref),
    semantic_frontier.frontier_version, semantic_frontier.frontier_value_hash,
    schema_frontier.frontier_version, schema_frontier.frontier_value_hash,
    data_frontier.frontier_version, data_frontier.frontier_value_hash,
    policy_frontier.frontier_version, policy_frontier.frontier_value_hash,
    identity_frontier.frontier_version, identity_frontier.frontier_value_hash,
    aggregate_frontier_hash, identity_frontier.authority_epoch,
    next_readiness_version, preserved_revocation_seq, null,
    committed_at, null, committed_at
  )
  on conflict (app_id, tenant_id, environment, run_id)
  do update set
    state = 'CURRENT',
    certificate_ref = excluded.certificate_ref,
    certificate_identity = excluded.certificate_identity,
    certificate_semantic_hash = excluded.certificate_semantic_hash,
    report_ref = excluded.report_ref,
    report_identity = excluded.report_identity,
    semantic_frontier_version = excluded.semantic_frontier_version,
    semantic_frontier_hash = excluded.semantic_frontier_hash,
    schema_frontier_version = excluded.schema_frontier_version,
    schema_frontier_hash = excluded.schema_frontier_hash,
    data_frontier_version = excluded.data_frontier_version,
    data_frontier_hash = excluded.data_frontier_hash,
    policy_frontier_version = excluded.policy_frontier_version,
    policy_frontier_hash = excluded.policy_frontier_hash,
    identity_frontier_version = excluded.identity_frontier_version,
    identity_frontier_hash = excluded.identity_frontier_hash,
    frontier_hash = excluded.frontier_hash,
    authority_epoch = excluded.authority_epoch,
    readiness_version = excluded.readiness_version,
    revocation_receipt_ref = null,
    published_at = excluded.published_at,
    revoked_at = null,
    updated_at = excluded.updated_at;
  insert into app_data_agent.research_readiness_publications (
    app_id, tenant_id, environment, publication_id, run_id, principal_id,
    idempotency_key, input_hash, certificate_ref, report_ref,
    expected_readiness_version, committed_readiness_version, frontier_hash,
    committed_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'publication_id')::uuid,
    (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash, certificate_ref, report_ref,
    nullif(command_json ->> 'expected_readiness_version', '')::bigint,
    next_readiness_version, aggregate_frontier_hash, committed_at
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'state', 'CURRENT',
      'certificate_ref', certificate_ref,
      'report_ref', report_ref,
      'readiness_version', next_readiness_version,
      'revocation_seq', preserved_revocation_seq,
      'frontier_hash', aggregate_frontier_hash
    )
  );
end
$function$;

create function app_data_agent.initialize_research_version_frontier(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  value_json jsonb;
  scope_json jsonb;
  requested_frontier_kind text;
  expected_authority text;
  frontier_hash text;
  input_hash text;
  operation_row record;
  event_seq bigint;
  committed_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or command_json -> 'expected_frontier_version' <> 'null'::jsonb
    or command_json -> 'expected_frontier_hash' <> 'null'::jsonb
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  value_json := command_json -> 'value';
  scope_json := command_json -> 'scope';
  requested_frontier_kind := value_json ->> 'frontier_kind';
  expected_authority := case requested_frontier_kind
    when 'SEMANTIC' then 'SEMANTIC_FRONTIER_AUTHORITY'
    when 'SCHEMA' then 'SCHEMA_FRONTIER_AUTHORITY'
    when 'DATA' then 'DATA_SNAPSHOT_FRONTIER_AUTHORITY'
    when 'POLICY' then 'POLICY_FRONTIER_AUTHORITY'
    when 'IDENTITY' then 'IDENTITY_FRONTIER_AUTHORITY'
    else null
  end;
  if expected_authority is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  if requested_frontier_kind = 'DATA'
    and value_json #>> '{data_snapshot,binding_hash}'
      <> app_data_agent.u6_domain_sha256(
        'data-snapshot-binding@1.0.0',
        (value_json -> 'data_snapshot') - 'binding_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, expected_authority, null, requested_frontier_kind, null, true
  );
  frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-value@1.0.0',
    value_json
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-operation@1.0.0',
    command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and run.principal_id = (command_json ->> 'principal_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select source.*
  into operation_row
  from app_data_agent.research_frontier_operations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.operation_id = (command_json ->> 'operation_id')::uuid
      or (
        source.run_id = (command_json ->> 'run_id')::uuid
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.frontier_kind = requested_frontier_kind
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if operation_row.operation_id is not null then
    if operation_row.input_hash <> input_hash or operation_row.outcome <> 'COMMITTED' then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'operation_id', operation_row.operation_id,
        'frontier_kind', operation_row.frontier_kind,
        'frontier_version', operation_row.committed_frontier_version,
        'frontier_value_hash', operation_row.committed_frontier_hash,
        'event_seq', operation_row.event_seq,
        'cascaded_revocation_operation_id',
          operation_row.cascaded_revocation_operation_id,
        'committed_at', operation_row.completed_at
      )
    );
  end if;

  perform 1
  from app_data_agent.current_report_readiness as current
  where current.app_id = (scope_json ->> 'app_id')::uuid
    and current.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and current.environment = scope_json ->> 'environment'
    and current.run_id = (command_json ->> 'run_id')::uuid
  for update of current nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = (scope_json ->> 'app_id')::uuid
    and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and frontier.environment = scope_json ->> 'environment'
    and frontier.run_id = (command_json ->> 'run_id')::uuid
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;

  if exists (
    select 1
    from app_data_agent.research_version_frontiers as frontier
    where frontier.app_id = (scope_json ->> 'app_id')::uuid
      and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
      and frontier.environment = scope_json ->> 'environment'
      and frontier.run_id = (command_json ->> 'run_id')::uuid
      and frontier.frontier_kind = requested_frontier_kind
  ) then
    insert into app_data_agent.research_frontier_operations (
      app_id, tenant_id, environment, operation_id, run_id, principal_id,
      frontier_kind, idempotency_key, input_hash, expected_frontier_version,
      expected_frontier_hash, requested_frontier_hash, outcome, error_code
    )
    values (
      (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
      scope_json ->> 'environment', (command_json ->> 'operation_id')::uuid,
      (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
      requested_frontier_kind, command_json ->> 'idempotency_key', input_hash, null, null,
      frontier_hash, 'REJECTED', 'RESEARCH_FRONTIER_CAS_CONFLICT'
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_FRONTIER_CAS_CONFLICT', 'retryable', true
      )
    );
  end if;

  select pg_catalog.coalesce(pg_catalog.max(frontier.event_seq), 0) + 1
  into event_seq
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = (scope_json ->> 'app_id')::uuid
    and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and frontier.environment = scope_json ->> 'environment'
    and frontier.run_id = (command_json ->> 'run_id')::uuid;
  committed_at := pg_catalog.clock_timestamp();

  insert into app_data_agent.research_version_frontiers (
    app_id, tenant_id, environment, run_id, frontier_kind,
    frontier_value_json, frontier_value_hash, frontier_version,
    authority_epoch, event_seq, updated_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'run_id')::uuid,
    requested_frontier_kind, value_json, frontier_hash, 0,
    case
      when requested_frontier_kind = 'IDENTITY'
        then (value_json #>> '{identity_binding,authority_epoch}')::bigint
      else 0
    end,
    event_seq, committed_at
  );

  insert into app_data_agent.research_frontier_operations (
    app_id, tenant_id, environment, operation_id, run_id, principal_id,
    frontier_kind, idempotency_key, input_hash, expected_frontier_version,
    expected_frontier_hash, requested_frontier_hash, outcome,
    committed_frontier_version, committed_frontier_hash, event_seq,
    cascaded_revocation_operation_id, error_code, completed_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'operation_id')::uuid,
    (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
    requested_frontier_kind, command_json ->> 'idempotency_key', input_hash, null, null,
    frontier_hash, 'COMMITTED', 0, frontier_hash, event_seq, null, null, committed_at
  );
  insert into app_data_agent.research_frontier_events (
    app_id, tenant_id, environment, run_id, event_seq, operation_id,
    frontier_kind, event_kind, owner_principal_id, old_frontier_version,
    old_frontier_hash, new_frontier_version, new_frontier_hash, committed_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'run_id')::uuid,
    event_seq, (command_json ->> 'operation_id')::uuid, requested_frontier_kind,
    'INITIALIZED', (command_json ->> 'principal_id')::uuid, null, null,
    0, frontier_hash, committed_at
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'operation_id', command_json ->> 'operation_id',
      'frontier_kind', requested_frontier_kind,
      'frontier_version', 0,
      'frontier_value_hash', frontier_hash,
      'event_seq', event_seq,
      'cascaded_revocation_operation_id', null,
      'committed_at', committed_at
    )
  );
end
$function$;

create function app_data_agent.advance_research_version_frontier(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  value_json jsonb;
  scope_json jsonb;
  requested_frontier_kind text;
  expected_authority text;
  frontier_hash text;
  input_hash text;
  target_frontier record;
  current_readiness record;
  locked_certificate record;
  operation_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  next_event_seq bigint;
  next_version bigint;
  cascade_operation_id uuid;
  cascade_reason text;
  observed_frontier jsonb;
  observed_frontier_hash text;
  observed_frontier_event_seq bigint;
  revocation_input_hash text;
  next_revocation_seq bigint;
  receipt_artifact_id uuid;
  receipt_payload jsonb;
  receipt_envelope_material jsonb;
  receipt_envelope jsonb;
  receipt_document jsonb;
  receipt_content_hash text;
  committed_receipt_ref jsonb;
  receipt_commit jsonb;
  receipt_input_refs jsonb;
  committed_at_text text;
  committed_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or pg_catalog.jsonb_typeof(command_json -> 'expected_frontier_version') <> 'number'
    or pg_catalog.jsonb_typeof(command_json -> 'expected_frontier_hash') <> 'string'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  value_json := command_json -> 'value';
  scope_json := command_json -> 'scope';
  requested_frontier_kind := value_json ->> 'frontier_kind';
  expected_authority := case requested_frontier_kind
    when 'SEMANTIC' then 'SEMANTIC_FRONTIER_AUTHORITY'
    when 'SCHEMA' then 'SCHEMA_FRONTIER_AUTHORITY'
    when 'DATA' then 'DATA_SNAPSHOT_FRONTIER_AUTHORITY'
    when 'POLICY' then 'POLICY_FRONTIER_AUTHORITY'
    when 'IDENTITY' then 'IDENTITY_FRONTIER_AUTHORITY'
    else null
  end;
  if expected_authority is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, expected_authority, null, requested_frontier_kind, null, true
  );
  frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-value@1.0.0', value_json
  );
  if requested_frontier_kind = 'DATA'
    and value_json #>> '{data_snapshot,binding_hash}'
      <> app_data_agent.u6_domain_sha256(
        'data-snapshot-binding@1.0.0',
        (value_json -> 'data_snapshot') - 'binding_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  input_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-operation@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and run.principal_id = (command_json ->> 'principal_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select source.*
  into operation_row
  from app_data_agent.research_frontier_operations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.operation_id = (command_json ->> 'operation_id')::uuid
      or (
        source.run_id = (command_json ->> 'run_id')::uuid
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.frontier_kind = requested_frontier_kind
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if operation_row.operation_id is not null then
    if operation_row.input_hash <> input_hash or operation_row.outcome <> 'COMMITTED' then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'operation_id', operation_row.operation_id,
        'frontier_kind', operation_row.frontier_kind,
        'frontier_version', operation_row.committed_frontier_version,
        'frontier_value_hash', operation_row.committed_frontier_hash,
        'event_seq', operation_row.event_seq,
        'cascaded_revocation_operation_id',
          operation_row.cascaded_revocation_operation_id,
        'committed_at', operation_row.completed_at
      )
    );
  end if;

  -- The unlocked read is only a locator under the already-held Run lock. It
  -- allows the exact Certificate/Receipt artifact key to be locked before the
  -- Current row, preserving the frozen Root rank.
  select source.*
  into current_readiness
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid;
  if current_readiness.run_id is not null
    and current_readiness.state = 'CURRENT'
  then
    receipt_artifact_id := app_data_agent.u6_uuid_v5(
      (command_json ->> 'operation_id')::uuid,
      pg_catalog.convert_to('readiness-revocation-receipt@1.0.0', 'UTF8')
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        app_data_agent.runtime_canonical_json(
          pg_catalog.jsonb_build_array(
            scope_json,
            command_json ->> 'run_id',
            receipt_artifact_id,
            'ReadinessRevocationReceipt'
          )
        ),
        0
      )
    );
    select artifact.*
    into locked_certificate
    from app_data_agent.artifacts as artifact
    where artifact.app_id = current_readiness.app_id
      and artifact.tenant_id = current_readiness.tenant_id
      and artifact.environment = current_readiness.environment
      and artifact.run_id = current_readiness.run_id
      and artifact.artifact_id =
        (current_readiness.certificate_ref ->> 'artifact_id')::uuid
      and artifact.artifact_type = 'ReportReadyCertificate'
      and artifact.revision =
        (current_readiness.certificate_ref ->> 'revision')::integer
      and artifact.content_hash =
        current_readiness.certificate_ref ->> 'content_hash'
      and artifact.is_active
    for update of artifact nowait;
    if locked_certificate.artifact_id is null
      or locked_certificate.document_json #>> '{payload,protocol_version}'
        is distinct from 'report-ready@3.0.0'
      or locked_certificate.document_json #>> '{envelope,status}'
        is distinct from 'COMMITTED'
      or app_data_agent.runtime_canonical_sha256(
        pg_catalog.jsonb_build_object(
          'envelope',
            (locked_certificate.document_json -> 'envelope')
              - 'content_hash' - 'created_at' - 'status',
          'payload', locked_certificate.document_json -> 'payload'
        )
      ) <> current_readiness.certificate_ref ->> 'content_hash'
      or locked_certificate.document_json
          #>> '{payload,certificate_semantic_hash}'
        <> app_data_agent.runtime_canonical_sha256(
          (locked_certificate.document_json -> 'payload')
            - 'certificate_semantic_hash'
        )
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
        )
      );
    end if;
  end if;

  select source.*
  into current_readiness
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = (scope_json ->> 'app_id')::uuid
    and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and frontier.environment = scope_json ->> 'environment'
    and frontier.run_id = (command_json ->> 'run_id')::uuid
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;

  select source.*
  into target_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = requested_frontier_kind;
  if target_frontier.frontier_kind is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  if target_frontier.frontier_version <> (command_json ->> 'expected_frontier_version')::bigint
    or target_frontier.frontier_value_hash <> command_json ->> 'expected_frontier_hash'
  then
    insert into app_data_agent.research_frontier_operations (
      app_id, tenant_id, environment, operation_id, run_id, principal_id,
      frontier_kind, idempotency_key, input_hash, expected_frontier_version,
      expected_frontier_hash, requested_frontier_hash, outcome, error_code
    )
    values (
      (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
      scope_json ->> 'environment', (command_json ->> 'operation_id')::uuid,
      (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
      requested_frontier_kind, command_json ->> 'idempotency_key', input_hash,
      (command_json ->> 'expected_frontier_version')::bigint,
      command_json ->> 'expected_frontier_hash', frontier_hash,
      'REJECTED', 'RESEARCH_FRONTIER_CAS_CONFLICT'
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_FRONTIER_CAS_CONFLICT', 'retryable', true
      )
    );
  end if;
  next_version := target_frontier.frontier_version + 1;
  select pg_catalog.max(frontier.event_seq) + 1
  into next_event_seq
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = target_frontier.app_id
    and frontier.tenant_id = target_frontier.tenant_id
    and frontier.environment = target_frontier.environment
    and frontier.run_id = target_frontier.run_id;
  committed_at := pg_catalog.clock_timestamp();

  update app_data_agent.research_version_frontiers
  set frontier_value_json = value_json,
      frontier_value_hash = frontier_hash,
      frontier_version = next_version,
      authority_epoch = case
        when requested_frontier_kind = 'IDENTITY'
          then (value_json #>> '{identity_binding,authority_epoch}')::bigint
        else 0
      end,
      event_seq = next_event_seq,
      updated_at = committed_at
  where app_id = target_frontier.app_id
    and tenant_id = target_frontier.tenant_id
    and environment = target_frontier.environment
    and run_id = target_frontier.run_id
    and research_version_frontiers.frontier_kind = target_frontier.frontier_kind;

  cascade_operation_id := case
    when current_readiness.run_id is not null
      and current_readiness.state = 'CURRENT'
      then (command_json ->> 'operation_id')::uuid
    else null
  end;

  insert into app_data_agent.research_frontier_operations (
    app_id, tenant_id, environment, operation_id, run_id, principal_id,
    frontier_kind, idempotency_key, input_hash, expected_frontier_version,
    expected_frontier_hash, requested_frontier_hash, outcome,
    committed_frontier_version, committed_frontier_hash, event_seq,
    cascaded_revocation_operation_id, error_code, completed_at
  )
  values (
    target_frontier.app_id, target_frontier.tenant_id, target_frontier.environment,
    (command_json ->> 'operation_id')::uuid, target_frontier.run_id,
    (command_json ->> 'principal_id')::uuid, requested_frontier_kind,
    command_json ->> 'idempotency_key', input_hash,
    target_frontier.frontier_version, target_frontier.frontier_value_hash,
    frontier_hash, 'COMMITTED', next_version, frontier_hash, next_event_seq,
    cascade_operation_id, null, committed_at
  );

  if cascade_operation_id is not null then
    select source.* into semantic_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'SEMANTIC';
    select source.* into schema_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'SCHEMA';
    select source.* into data_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'DATA';
    select source.* into policy_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'POLICY';
    select source.* into identity_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'IDENTITY';

    if semantic_frontier.frontier_kind is null
      or schema_frontier.frontier_kind is null
      or data_frontier.frontier_kind is null
      or policy_frontier.frontier_kind is null
      or identity_frontier.frontier_kind is null
    then
      raise exception using
        errcode = '23514',
        message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
    end if;

    observed_frontier := pg_catalog.jsonb_build_object(
      'semantic_release_ref',
        semantic_frontier.frontier_value_json -> 'reference',
      'schema_snapshot_ref',
        schema_frontier.frontier_value_json -> 'reference',
      'data_snapshot',
        data_frontier.frontier_value_json -> 'data_snapshot',
      'policy_receipt_ref',
        policy_frontier.frontier_value_json -> 'reference',
      'identity_binding',
        identity_frontier.frontier_value_json -> 'identity_binding'
    );
    observed_frontier_hash := app_data_agent.u6_domain_sha256(
      'research-frontier-vector@1.0.0',
      pg_catalog.jsonb_build_object(
        'SEMANTIC', semantic_frontier.frontier_value_json,
        'SCHEMA', schema_frontier.frontier_value_json,
        'DATA', data_frontier.frontier_value_json,
        'POLICY', policy_frontier.frontier_value_json,
        'IDENTITY', identity_frontier.frontier_value_json
      )
    );
    observed_frontier_event_seq := pg_catalog.greatest(
      semantic_frontier.event_seq,
      schema_frontier.event_seq,
      data_frontier.event_seq,
      policy_frontier.event_seq,
      identity_frontier.event_seq
    );
    cascade_reason := case requested_frontier_kind
      when 'SEMANTIC' then 'SEMANTIC_REVISION_CHANGED'
      when 'SCHEMA' then 'SCHEMA_REVISION_CHANGED'
      when 'DATA' then 'DATA_SNAPSHOT_STALE'
      when 'POLICY' then 'POLICY_CHANGED'
      when 'IDENTITY' then 'IDENTITY_AUTHORITY_CHANGED'
    end;
    revocation_input_hash := app_data_agent.u6_domain_sha256(
      'research-readiness-revocation-operation@1.0.0',
      pg_catalog.jsonb_build_object(
        'trigger', 'FRONTIER_ADVANCE',
        'source_operation_id', cascade_operation_id,
        'reason', cascade_reason,
        'certificate_ref', current_readiness.certificate_ref,
        'observed_frontier_hash', observed_frontier_hash
      )
    );

    insert into app_data_agent.research_revocation_operations (
      app_id, tenant_id, environment, operation_id, run_id,
      owner_principal_id, idempotency_key, input_hash, trigger_kind,
      source_operation_id, reason, certificate_ref,
      observed_frontier_hash, authority_epoch, state
    )
    values (
      target_frontier.app_id, target_frontier.tenant_id,
      target_frontier.environment, cascade_operation_id,
      target_frontier.run_id, (command_json ->> 'principal_id')::uuid,
      'frontier:' || (command_json ->> 'operation_id'),
      revocation_input_hash, 'FRONTIER_ADVANCE', cascade_operation_id,
      cascade_reason, current_readiness.certificate_ref,
      observed_frontier_hash, identity_frontier.authority_epoch, 'REQUESTED'
    );

    receipt_payload := pg_catalog.jsonb_build_object(
      'artifact_type', 'ReadinessRevocationReceipt',
      'protocol_version', 'readiness-revocation@1.0.0',
      'certificate_ref', current_readiness.certificate_ref,
      'observed_frontier', observed_frontier,
      'reason', cascade_reason,
      'trigger', 'FRONTIER_ADVANCE',
      'source_operation_id', cascade_operation_id,
      'observed_frontier_event_seq', observed_frontier_event_seq
    );
    receipt_payload := receipt_payload || pg_catalog.jsonb_build_object(
      'revocation_semantic_hash',
      app_data_agent.runtime_canonical_sha256(receipt_payload)
    );
    select pg_catalog.jsonb_agg(reference_value order by reference_identity)
    into receipt_input_refs
    from (
      select candidate.reference_value,
        app_data_agent.runtime_canonical_json(
          pg_catalog.jsonb_build_array(
            candidate.reference_value ->> 'app_id',
            candidate.reference_value ->> 'tenant_id',
            candidate.reference_value ->> 'environment',
            candidate.reference_value ->> 'run_id',
            candidate.reference_value ->> 'artifact_id',
            candidate.reference_value ->> 'artifact_type',
            candidate.reference_value -> 'revision',
            candidate.reference_value ->> 'content_hash'
          )
        ) as reference_identity
      from (
        values
          (current_readiness.certificate_ref),
          (observed_frontier -> 'semantic_release_ref'),
          (observed_frontier -> 'schema_snapshot_ref'),
          (observed_frontier -> 'policy_receipt_ref')
      ) as candidate(reference_value)
    ) as ordered_references;
    committed_at_text := pg_catalog.to_char(
      committed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    receipt_envelope_material := pg_catalog.jsonb_build_object(
      'artifact_id', receipt_artifact_id,
      'artifact_type', 'ReadinessRevocationReceipt',
      'app_id', target_frontier.app_id,
      'tenant_id', target_frontier.tenant_id,
      'environment', target_frontier.environment,
      'run_id', target_frontier.run_id,
      'revision', 1,
      'parent_ref', null,
      'attempt_id', cascade_operation_id,
      'producer', pg_catalog.jsonb_build_object(
        'kind', 'deterministic',
        'id', 'u6-readiness-revocation-writer'
      ),
      'input_refs', receipt_input_refs,
      'schema_version', '1.0.0',
      'semantic_version', '1.0.0',
      'policy_version', '1.0.0',
      'model_profile_version', '1.0.0'
    );
    receipt_content_hash := app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope', receipt_envelope_material,
        'payload', receipt_payload
      )
    );
    receipt_envelope := receipt_envelope_material
      || pg_catalog.jsonb_build_object(
        'content_hash', receipt_content_hash,
        'status', 'COMMITTED',
        'created_at', committed_at_text
      );
    receipt_document := pg_catalog.jsonb_build_object(
      'envelope', receipt_envelope,
      'payload', receipt_payload
    );
    receipt_commit := app_data_agent.commit_research_revocation_receipt(
      pg_catalog.jsonb_build_object(
        'document', receipt_document,
        'document_checksum',
          app_data_agent.runtime_canonical_sha256(receipt_document)
      )
    );
    committed_receipt_ref := receipt_commit -> 'reference';
    if committed_receipt_ref is null then
      raise exception using
        errcode = '23514',
        message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
    end if;

    next_revocation_seq := current_readiness.revocation_seq + 1;
    update app_data_agent.current_report_readiness
    set state = 'REVOKED',
        revocation_seq = next_revocation_seq,
        revocation_receipt_ref = committed_receipt_ref,
        revoked_at = committed_at,
        updated_at = committed_at
    where app_id = current_readiness.app_id
      and tenant_id = current_readiness.tenant_id
      and environment = current_readiness.environment
      and run_id = current_readiness.run_id
      and state = 'CURRENT';
    if not found then
      raise exception using
        errcode = '40001',
        message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
    end if;

    update app_data_agent.report_read_grants as target
    set state = 'REVOKED',
        terminal_from_status = target.state,
        revoked_at = committed_at
    where target.app_id = current_readiness.app_id
      and target.tenant_id = current_readiness.tenant_id
      and target.environment = current_readiness.environment
      and target.run_id = current_readiness.run_id
      and target.state in ('ISSUED', 'CONSUMED');

    update app_data_agent.research_revocation_operations
    set state = 'COMMITTED',
        receipt_ref = committed_receipt_ref,
        completed_at = committed_at
    where app_id = target_frontier.app_id
      and tenant_id = target_frontier.tenant_id
      and environment = target_frontier.environment
      and operation_id = cascade_operation_id
      and state = 'REQUESTED';
    if not found then
      raise exception using
        errcode = '40001',
        message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
    end if;
  end if;

  insert into app_data_agent.research_frontier_events (
    app_id, tenant_id, environment, run_id, event_seq, operation_id,
    frontier_kind, event_kind, owner_principal_id, old_frontier_version,
    old_frontier_hash, new_frontier_version, new_frontier_hash, committed_at
  )
  values (
    target_frontier.app_id, target_frontier.tenant_id, target_frontier.environment,
    target_frontier.run_id, next_event_seq, (command_json ->> 'operation_id')::uuid,
    requested_frontier_kind, 'ADVANCED', (command_json ->> 'principal_id')::uuid,
    target_frontier.frontier_version, target_frontier.frontier_value_hash,
    next_version, frontier_hash, committed_at
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'operation_id', command_json ->> 'operation_id',
      'frontier_kind', requested_frontier_kind,
      'frontier_version', next_version,
      'frontier_value_hash', frontier_hash,
      'event_seq', next_event_seq,
      'cascaded_revocation_operation_id', cascade_operation_id,
      'committed_at', committed_at
    )
  );
end
$function$;
