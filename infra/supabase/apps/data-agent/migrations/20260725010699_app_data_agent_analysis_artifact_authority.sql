begin;

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010699_app_data_agent_analysis_artifact_authority',
  'sha256:1f5e42b0f86b8f470cece40564333f4b65ce0b474be5b62d7da941a2cd40feae'
);

do $analysis_l2_rpc$
declare
  source_definition text;
  analysis_definition text;
  source_case constant text :=
    'when ''QueryEvidence'' then ''EVIDENCE''';
  analysis_case constant text :=
    'when ''QueryEvidence'' then ''EVIDENCE''' || pg_catalog.chr(10) ||
    '    when ''DataProfile'' then ''EVIDENCE''' || pg_catalog.chr(10) ||
    '    when ''AnalysisPlan'' then ''PLANNING''' || pg_catalog.chr(10) ||
    '    when ''DerivedAnalysisEvidence'' then ''EVIDENCE''' || pg_catalog.chr(10) ||
    '    when ''AnalysisCompletionReceipt'' then ''COVERAGE''';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_l2_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict source_definition;
  if pg_catalog.strpos(source_definition, source_case) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'ANALYSIS_ARTIFACT_BASELINE_DEFINITION_INVALID';
  end if;
  analysis_definition := pg_catalog.replace(
    source_definition,
    'commit_current_l2_artifact',
    'commit_current_analysis_artifact'
  );
  analysis_definition := pg_catalog.replace(
    analysis_definition,
    source_case,
    analysis_case
  );
  if analysis_definition = source_definition
    or pg_catalog.strpos(analysis_definition, analysis_case) = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'ANALYSIS_ARTIFACT_RPC_REWRITE_FAILED';
  end if;
  execute analysis_definition;
end
$analysis_l2_rpc$;

alter function app_data_agent.commit_current_analysis_artifact(jsonb)
owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.commit_current_analysis_artifact(jsonb) from public;
grant execute on function app_data_agent.commit_current_analysis_artifact(jsonb)
to data_agent_backend;

create table app_data_agent.analysis_system_artifacts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  artifact_id uuid not null,
  artifact_type text not null check (
    artifact_type in ('SandboxProgram', 'SandboxExecutionReceipt', 'SandboxResult')
  ),
  revision integer not null check (revision = 1),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 256),
  attempt_id uuid not null,
  worker_fence bigint not null check (worker_fence >= 1),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload_json jsonb not null check (pg_catalog.jsonb_typeof(payload_json) = 'object'),
  content_bytes bytea,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, artifact_id, revision),
  unique (
    app_id, tenant_id, environment, run_id,
    artifact_id, artifact_type, revision, content_hash
  ),
  unique (
    app_id, tenant_id, environment, run_id, principal_id, idempotency_key
  ),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, attempt_id)
    references app_data_agent.run_attempts (app_id, tenant_id, environment, attempt_id)
    on delete restrict
);

create function app_data_agent.analysis_system_artifacts_immutable()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'ANALYSIS_SYSTEM_ARTIFACT_IMMUTABLE';
end
$function$;

create trigger analysis_system_artifacts_immutable
before update or delete on app_data_agent.analysis_system_artifacts
for each row execute function app_data_agent.analysis_system_artifacts_immutable();

create function app_data_agent.commit_analysis_system_artifact(
  envelope_json jsonb,
  content_bytes bytea
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  reference_json jsonb;
  target_run record;
  target_attempt record;
  target_outbox record;
  existing_artifact record;
  input_hash text;
  observed_content_hash text;
  created_count bigint;
  db_now timestamptz;
begin
  command_json := envelope_json -> 'command';
  scope_json := command_json -> 'scope';
  reference_json := command_json -> 'reference';
  if envelope_json ->> 'protocol_version' <> 'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)) <> 9
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(reference_json) <> 'object'
    or reference_json ->> 'artifact_type' not in (
      'SandboxProgram', 'SandboxExecutionReceipt', 'SandboxResult'
    )
    or (reference_json ->> 'revision')::integer <> 1
    or reference_json ->> 'app_id' is distinct from scope_json ->> 'app_id'
    or reference_json ->> 'tenant_id' is distinct from scope_json ->> 'tenant_id'
    or reference_json ->> 'environment' is distinct from scope_json ->> 'environment'
    or reference_json ->> 'run_id' is distinct from command_json ->> 'run_id'
    or pg_catalog.jsonb_typeof(command_json -> 'payload') <> 'object'
    or pg_catalog.octet_length(content_bytes) > 268435456
  then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'ANALYSIS_SYSTEM_ARTIFACT_CONTRACT_INVALID'
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESEARCH_ARTIFACT_AUTHORITY',
    case reference_json ->> 'artifact_type'
      when 'SandboxProgram' then 'PLANNING'
      else 'EVIDENCE'
    end,
    null,
    null,
    true
  );

  observed_content_hash := case
    when content_bytes is null then
      app_data_agent.runtime_canonical_sha256(command_json -> 'payload')
    else 'sha256:' || pg_catalog.encode(extensions.digest(content_bytes, 'sha256'), 'hex')
  end;
  if observed_content_hash <> reference_json ->> 'content_hash' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'ANALYSIS_SYSTEM_ARTIFACT_CONTENT_HASH_MISMATCH'
    );
  end if;

  select source.* into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;

  select source.* into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.attempt_id = (command_json ->> 'attempt_id')::uuid;

  select source.* into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_attempt.app_id
    and source.tenant_id = target_attempt.tenant_id
    and source.environment = target_attempt.environment
    and source.outbox_id = target_attempt.outbox_id
    and source.run_id = target_attempt.run_id
  for update of source nowait;

  select source.* into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_attempt.app_id
    and source.tenant_id = target_attempt.tenant_id
    and source.environment = target_attempt.environment
    and source.attempt_id = target_attempt.attempt_id
  for update of source nowait;

  db_now := pg_catalog.clock_timestamp();
  if target_run.run_id is null
    or target_attempt.attempt_id is null
    or target_outbox.outbox_id is null
    or target_attempt.status <> 'ACTIVE'
    or target_attempt.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_attempt.lease_expires_at <= db_now
    or target_outbox.active_attempt_id <> target_attempt.attempt_id
    or target_outbox.run_fence <> target_attempt.worker_fence
  then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH'
    );
  end if;

  input_hash := app_data_agent.u6_domain_sha256(
    'analysis-system-artifact-input@1.0.0',
    pg_catalog.jsonb_build_object(
      'command', command_json,
      'content_hash', observed_content_hash
    )
  );

  select source.* into existing_artifact
  from app_data_agent.analysis_system_artifacts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.principal_id = target_run.principal_id
    and source.idempotency_key = command_json ->> 'idempotency_key';
  if existing_artifact.artifact_id is not null then
    if existing_artifact.input_hash <> input_hash then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'error_code', 'ANALYSIS_SYSTEM_ARTIFACT_IDEMPOTENCY_CONFLICT'
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'created', false,
      'reference', reference_json
    );
  end if;

  insert into app_data_agent.analysis_system_artifacts (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type,
    revision, content_hash, principal_id, idempotency_key, attempt_id,
    worker_fence, input_hash, payload_json, content_bytes
  ) values (
    target_run.app_id,
    target_run.tenant_id,
    target_run.environment,
    target_run.run_id,
    (reference_json ->> 'artifact_id')::uuid,
    reference_json ->> 'artifact_type',
    1,
    reference_json ->> 'content_hash',
    target_run.principal_id,
    command_json ->> 'idempotency_key',
    target_attempt.attempt_id,
    target_attempt.worker_fence,
    input_hash,
    command_json -> 'payload',
    content_bytes
  ) on conflict do nothing;
  get diagnostics created_count = row_count;
  if created_count <> 1 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'ANALYSIS_SYSTEM_ARTIFACT_IDEMPOTENCY_CONFLICT'
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'created', true,
    'reference', reference_json
  );
end
$function$;

alter table app_data_agent.analysis_system_artifacts enable row level security;
alter table app_data_agent.analysis_system_artifacts force row level security;
revoke all on table app_data_agent.analysis_system_artifacts from public;
grant select, insert on table app_data_agent.analysis_system_artifacts to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_analysis_system_artifact(jsonb, bytea)
owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.commit_analysis_system_artifact(jsonb, bytea) from public;
grant execute on function app_data_agent.commit_analysis_system_artifact(jsonb, bytea)
to data_agent_backend;

create policy analysis_system_artifacts_rpc_select
on app_data_agent.analysis_system_artifacts
for select to data_agent_u6_rpc_owner
using (platform.backend_run_object_matches(app_id, tenant_id, environment, run_id, false));
create policy analysis_system_artifacts_rpc_insert
on app_data_agent.analysis_system_artifacts
for insert to data_agent_u6_rpc_owner
with check (platform.backend_run_object_matches(app_id, tenant_id, environment, run_id, true));

drop policy artifacts_u6_reserved_insert_deny on app_data_agent.artifacts;
drop policy artifacts_u6_reserved_update_deny on app_data_agent.artifacts;
drop policy artifacts_u6_reserved_delete_deny on app_data_agent.artifacts;

create policy artifacts_u6_reserved_insert_deny
on app_data_agent.artifacts as restrictive for insert to data_agent_backend
with check (artifact_type not in (
  'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'ObligationExecutionDecision',
  'QueryEvidence', 'DataProfile', 'AnalysisPlan', 'DerivedAnalysisEvidence',
  'AnalysisCompletionReceipt', 'AtomicClaim', 'EvidenceRelation', 'EvidenceCheckReceipt',
  'SupportDecision', 'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
  'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt', 'EvidenceGateReceipt',
  'ReportReadyCertificate', 'ReadinessRevocationReceipt'
));
create policy artifacts_u6_reserved_update_deny
on app_data_agent.artifacts as restrictive for update to data_agent_backend
using (artifact_type not in (
  'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'ObligationExecutionDecision',
  'QueryEvidence', 'DataProfile', 'AnalysisPlan', 'DerivedAnalysisEvidence',
  'AnalysisCompletionReceipt', 'AtomicClaim', 'EvidenceRelation', 'EvidenceCheckReceipt',
  'SupportDecision', 'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
  'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt', 'EvidenceGateReceipt',
  'ReportReadyCertificate', 'ReadinessRevocationReceipt'
)) with check (artifact_type not in (
  'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'ObligationExecutionDecision',
  'QueryEvidence', 'DataProfile', 'AnalysisPlan', 'DerivedAnalysisEvidence',
  'AnalysisCompletionReceipt', 'AtomicClaim', 'EvidenceRelation', 'EvidenceCheckReceipt',
  'SupportDecision', 'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
  'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt', 'EvidenceGateReceipt',
  'ReportReadyCertificate', 'ReadinessRevocationReceipt'
));
create policy artifacts_u6_reserved_delete_deny
on app_data_agent.artifacts as restrictive for delete to data_agent_backend
using (artifact_type not in (
  'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'ObligationExecutionDecision',
  'QueryEvidence', 'DataProfile', 'AnalysisPlan', 'DerivedAnalysisEvidence',
  'AnalysisCompletionReceipt', 'AtomicClaim', 'EvidenceRelation', 'EvidenceCheckReceipt',
  'SupportDecision', 'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
  'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt', 'EvidenceGateReceipt',
  'ReportReadyCertificate', 'ReadinessRevocationReceipt'
));

commit;
