-- falcon24_e9_current_profile_authority_migration_checksum: sha256:3e02122c78486eb2743b1b23c4387a7b363172335a27af5663d829085d2d7099
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010800_app_data_agent_falcon24_e8_provider_binding')
    or pg_catalog.to_regprocedure('app_data_agent.activate_falcon24_authority(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.resolve_current_provider_execution_certification(jsonb)') is not null
    or pg_catalog.to_regclass('app_data_agent.falcon24_llm_execution_certification_stage') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_diagnostic_receipts') is null
  then raise exception using errcode='P0001',
    message='FALCON24_E9_CURRENT_PROFILE_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10801_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text;schema_name text;table_name text;before_count bigint;before_digest text;
begin
  foreach relation_name in array array[
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection','semantic.semantic_runtime_restriction_projection',
    'semantic.semantic_graph_projection','semantic.semantic_source_release_graph_projection',
    'semantic.semantic_active_pointer','semantic.semantic_runtime_activation',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions',
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_diagnostic_attempts','app_data_agent.falcon24_diagnostic_receipts',
    'app_data_agent.falcon24_epoch_closure_failure_receipts',
    'app_data_agent.falcon24_qualifications','app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.runs','app_data_agent.run_events','app_data_agent.run_attempts',
    'app_data_agent.artifacts','app_data_agent.falcon24_llm_execution_certification_stage'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10801_history_snapshot values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create function app_data_agent.resolve_current_provider_execution_certification(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  artifact app_data_agent.artifacts%rowtype;reference jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
    or command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','model_profile_id','model_config_version',
      'certification_receipt_ref']::text[]) is distinct from true
    or command->>'schema_version'<>
      'current-provider-execution-certification-resolve@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'model_profile_id')
      is distinct from true
    or command->>'model_config_version'!~'^[1-9][0-9]*$'
    or not app_data_agent.provider_json_object_has_exact_keys(
      command->'certification_receipt_ref',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
        'content_hash']::text[])
    or command#>>'{certification_receipt_ref,artifact_type}'<>'ModelCertificationReceipt'
    or command#>>'{certification_receipt_ref,revision}'<>'1'
    or command#>>'{certification_receipt_ref,content_hash}'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='PROVIDER_CURRENT_CERTIFICATION_RESOLVE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  if current_epoch.authority_epoch is null
    or pg_catalog.substr(current_epoch.authority_epoch,2)::numeric<9
  then raise exception using errcode='55000',
    message='PROVIDER_CURRENT_CERTIFICATION_NOT_AVAILABLE'; end if;
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage stage
    where stage.app_id=authority.app_id and stage.tenant_id=authority.tenant_id
      and stage.environment=authority.environment
      and stage.target_authority_epoch=current_epoch.authority_epoch
      and stage.activation_attempt_id=current_epoch.activation_attempt_id
      and stage.status='PROMOTED'
      and stage.model_profile_id=(command->>'model_profile_id')::uuid
      and stage.model_config_version=(command->>'model_config_version')::bigint;
  reference:=command->'certification_receipt_ref';
  if stage.stage_id is null
    or reference->>'app_id'<>stage.app_id::text
    or reference->>'tenant_id'<>stage.tenant_id::text
    or reference->>'environment'<>stage.environment
    or reference->>'run_id'<>stage.certification_run_id::text
    or reference->>'artifact_id'<>stage.certification_artifact_id::text
    or reference->>'revision'<>stage.certification_revision::text
    or reference->>'content_hash'<>stage.certification_content_hash
  then raise exception using errcode='55000',
    message='PROVIDER_CURRENT_CERTIFICATION_NOT_AVAILABLE'; end if;
  select * into artifact from app_data_agent.artifacts artifact
    where artifact.app_id=stage.app_id and artifact.tenant_id=stage.tenant_id
      and artifact.environment=stage.environment and artifact.run_id=stage.certification_run_id
      and artifact.artifact_id=stage.certification_artifact_id
      and artifact.artifact_type='ModelCertificationReceipt'
      and artifact.revision=stage.certification_revision
      and artifact.content_hash=stage.certification_content_hash and artifact.is_active;
  if artifact.artifact_id is null
    or artifact.document_json->>'schema_version'<>'model-execution-certification@1.0.0'
    or artifact.document_json->>'verdict'<>'PASS'
    or artifact.document_json->>'profile_id'<>stage.model_profile_id::text
    or artifact.document_json->>'model_config_version'<>stage.model_config_version::text
    or artifact.document_json->>'provider'<>stage.provider
    or artifact.document_json->>'model_id'<>stage.model_id
    or artifact.document_json->>'execution_profile_hash'<>stage.execution_profile_hash
    or artifact.document_json->'receipt_ref'<>reference
    or artifact.content_hash<>
      app_data_agent.u2_canonical_sha256(artifact.document_json#-'{receipt_ref,content_hash}')
    or artifact.document_json->>'execution_profile_hash'<>
      app_data_agent.u2_canonical_sha256(artifact.document_json->'execution_profile_snapshot')
    or artifact.document_json#>>'{execution_profile_snapshot,scope,app_id}'<>authority.app_id::text
    or artifact.document_json#>>'{execution_profile_snapshot,scope,tenant_id}'<>
      authority.tenant_id::text
    or artifact.document_json#>>'{execution_profile_snapshot,scope,environment}'<>
      authority.environment
    or artifact.document_json#>>'{connection,kind}'<>'SYSTEM_DEPLOYMENT'
    or artifact.document_json#>>'{connection,deployment_id}'<>stage.deployment_id::text
    or artifact.document_json->'recovery_capabilities'<>'["AT_LEAST_ONCE_ONLY"]'::jsonb
    or artifact.document_json->'connection'<>
      artifact.document_json#>'{execution_profile_snapshot,connection}'
    or artifact.document_json->'recovery_capabilities'<>
      artifact.document_json#>'{execution_profile_snapshot,recovery_capabilities}'
  then raise exception using errcode='55000',
    message='PROVIDER_CURRENT_CERTIFICATION_INVALID'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','current-provider-execution-certification@1.0.0',
    'claims',artifact.document_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',
    message='PROVIDER_CURRENT_CERTIFICATION_RESOLVE_INVALID';
end
$function$;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  rename to activate_falcon24_authority_pre_e9;

create function app_data_agent.activate_falcon24_authority(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;scope_json jsonb;expected_authority jsonb;failure jsonb;stage_ref jsonb;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  diagnostic app_data_agent.falcon24_diagnostic_attempts%rowtype;
  diagnostic_receipt app_data_agent.falcon24_diagnostic_receipts%rowtype;
  failed_run app_data_agent.runs%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  certification app_data_agent.artifacts%rowtype;
  catalog app_data_agent.model_catalog_entries%rowtype;
  model_revision app_data_agent.model_config_versions%rowtype;
  deployment platform.deployment_mappings%rowtype;
  target_baseline app_data_agent.falcon24_authority_baselines%rowtype;
  llm_receipt app_data_agent.falcon24_authority_staging_receipts%rowtype;
  v3_command jsonb;authority_document jsonb;is_replay boolean:=false;now_at timestamptz;
begin
  if command->>'schema_version' in(
      'falcon24-activation-request@2.0.0','falcon24-activation-request@3.0.0',
      'falcon24-activation-request@4.0.0','falcon24-activation-request@5.0.0')
  then return app_data_agent.activate_falcon24_authority_pre_e9(command); end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','scope','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'expected_current_authority','expected_semantic_release','expected_versions',
      'retained_semantic_proof_hash','predecessor_diagnostic_receipt',
      'llm_execution_stage_ref','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-activation-request@6.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric<9
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'retained_semantic_proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_ACTIVATION_INVALID'; end if;
  scope_json:=command->'scope';expected_authority:=command->'expected_current_authority';
  failure:=command->'predecessor_diagnostic_receipt';stage_ref:=command->'llm_execution_stage_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
    or expected_authority->>'schema_version'<>'falcon24-authority-binding@2.0.0'
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric<>
      pg_catalog.substr(expected_authority->>'authority_epoch',2)::numeric+1
    or not app_data_agent.provider_json_object_has_exact_keys(failure,array[
      'attempt_id','run_id','manifest_hash','receipt_hash','failure_class','failure_code']::text[])
    or failure->>'failure_class'<>'FROZEN_CLOSURE_CHANGE_REQUIRED'
    or failure->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
    or failure->>'manifest_hash'!~'^sha256:[0-9a-f]{64}$'
    or failure->>'receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or not app_data_agent.provider_json_object_has_exact_keys(stage_ref,array[
      'stage_id','proof_hash']::text[])
    or stage_ref->>'proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(failure->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(failure->'run_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
  then raise exception using errcode='22023',
    message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_ACTIVATION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',
    message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_SCOPE_FORBIDDEN'; end if;

  perform semantic.lock_semantic_authority_fence(
    authority.app_id,authority.tenant_id,authority.environment,scope_json->>'semantic_domain');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-diagnostic:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
    for update;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
    for update;
  select * into defaults_pointer from app_data_agent.workspace_run_defaults row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  select * into defaults_revision from app_data_agent.workspace_run_default_revisions row
    where row.app_id=defaults_pointer.app_id and row.tenant_id=defaults_pointer.tenant_id
      and row.environment=defaults_pointer.environment and row.defaults_id=defaults_pointer.defaults_id
      and row.defaults_revision=defaults_pointer.defaults_revision
      and row.revision_id=defaults_pointer.revision_id and row.defaults_hash=defaults_pointer.defaults_hash
    for update;
  select * into diagnostic from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(failure->>'attempt_id')::uuid for share;
  select * into diagnostic_receipt from app_data_agent.falcon24_diagnostic_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.attempt_id=(failure->>'attempt_id')::uuid
      and row.run_id=(failure->>'run_id')::uuid;
  select * into failed_run from app_data_agent.runs row
    where row.app_id=diagnostic.app_id and row.tenant_id=diagnostic.tenant_id
      and row.environment=diagnostic.environment and row.run_id=diagnostic.run_id
      and row.principal_id=diagnostic.principal_id;
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.stage_id=(stage_ref->>'stage_id')::uuid for update;
  select * into certification from app_data_agent.artifacts row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.run_id=stage.certification_run_id
      and row.artifact_id=stage.certification_artifact_id
      and row.revision=stage.certification_revision
      and row.content_hash=stage.certification_content_hash for update;
  select * into catalog from app_data_agent.model_catalog_entries row
    where row.app_id=stage.app_id and row.environment=stage.environment
      and row.model_profile_id=stage.model_profile_id
      and row.config_version=stage.model_config_version
      and row.provider=stage.provider and row.model_id=stage.model_id for share;
  select * into model_revision from app_data_agent.model_config_versions row
    where row.app_id=stage.app_id and row.environment=stage.environment
      and row.model_profile_id=stage.model_profile_id
      and row.config_version=stage.model_config_version for share;
  select * into deployment from platform.deployment_mappings row
    where row.deployment_id=stage.deployment_id and row.app_id=stage.app_id
      and row.environment=stage.environment for share;
  select * into target_baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.baseline_id=(command->>'baseline_id')::uuid
      and row.authority_epoch=command->>'authority_epoch' for update;
  select * into llm_receipt from app_data_agent.falcon24_authority_staging_receipts row
    where row.app_id=target_baseline.app_id and row.tenant_id=target_baseline.tenant_id
      and row.environment=target_baseline.environment
      and row.staging_id=target_baseline.staging_id
      and row.authority_epoch=target_baseline.authority_epoch
      and row.component='LLM_CONFIGURATION' for share;

  is_replay:=current_epoch.authority_epoch=command->>'authority_epoch'
    and current_epoch.baseline_id=(command->>'baseline_id')::uuid
    and current_epoch.baseline_hash=command->>'expected_baseline_hash'
    and current_epoch.activation_attempt_id=(command->>'attempt_id')::uuid;
  if not is_replay and (
      current_epoch.authority_epoch is distinct from expected_authority->>'authority_epoch'
      or current_epoch.baseline_id is distinct from (expected_authority->>'baseline_id')::uuid
      or current_epoch.baseline_hash is distinct from expected_authority->>'baseline_hash'
      or current_epoch.activation_attempt_id is distinct from
        (expected_authority->>'activation_attempt_id')::uuid)
  then raise exception using errcode='40001',
    message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_PREDECESSOR_MISMATCH'; end if;
  if diagnostic.attempt_id is null or diagnostic.run_id<>(failure->>'run_id')::uuid
    or diagnostic.manifest_hash<>failure->>'manifest_hash'
    or diagnostic.status<>'FAILED'
    or diagnostic.failure_class<>failure->>'failure_class'
    or diagnostic.failure_code<>failure->>'failure_code'
    or diagnostic.terminal_receipt_hash<>failure->>'receipt_hash'
    or diagnostic.authority_epoch<>expected_authority->>'authority_epoch'
    or diagnostic.authority_baseline_id<>(expected_authority->>'baseline_id')::uuid
    or diagnostic.authority_baseline_hash<>expected_authority->>'baseline_hash'
    or diagnostic.authority_activation_attempt_id<>
      (expected_authority->>'activation_attempt_id')::uuid
    or failed_run.run_id is null or failed_run.status<>'FAILED'
    or diagnostic_receipt.attempt_id is null or diagnostic_receipt.outcome<>'FAIL'
    or diagnostic_receipt.receipt_hash<>failure->>'receipt_hash'
    or diagnostic_receipt.receipt_document->>'attempt_manifest_hash'<>failure->>'manifest_hash'
    or diagnostic_receipt.receipt_document->>'failure_class'<>failure->>'failure_class'
    or diagnostic_receipt.receipt_document->>'failure_code'<>failure->>'failure_code'
    or diagnostic_receipt.receipt_document#>>'{authority,authority_epoch}'<>
      expected_authority->>'authority_epoch'
    or not exists(select 1 from app_data_agent.run_events event
      where event.app_id=diagnostic.app_id and event.tenant_id=diagnostic.tenant_id
        and event.environment=diagnostic.environment and event.run_id=diagnostic.run_id
        and event.event_type='run.failed' and event.payload_json->>'retryable'='false')
  then raise exception using errcode='55000',
    message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_RECEIPT_MISMATCH'; end if;
  if stage.stage_id is null or stage.target_authority_epoch<>command->>'authority_epoch'
    or target_baseline.baseline_id is null or stage.staging_id<>target_baseline.staging_id
    or stage.proof_hash<>stage_ref->>'proof_hash'
    or stage.proof_document->>'proof_hash'<>stage.proof_hash
    or llm_receipt.evidence_hash<>stage.proof_hash
    or llm_receipt.subject_hash<>stage.model_resource_hash
    or (not is_replay and (stage.status<>'STAGED' or certification.is_active))
    or (is_replay and (stage.status<>'PROMOTED' or not certification.is_active
      or stage.activation_attempt_id<>(command->>'attempt_id')::uuid))
  then raise exception using errcode='55000',
    message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_LLM_STAGE_MISMATCH'; end if;
  if catalog.model_profile_id is null or catalog.status<>'ACTIVE' or not catalog.is_system_default
    or model_revision.model_profile_id is null
    or platform.canonical_sha256(model_revision.snapshot)<>stage.model_resource_hash
    or deployment.deployment_id is null or not deployment.is_active
    or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'deployment_id',deployment.deployment_id,'app_id',deployment.app_id,
      'environment',deployment.environment,'deployment_key_hash',deployment.deployment_key_hash))
      <>stage.deployment_hash
  then raise exception using errcode='55000',
    message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_LLM_CATALOG_DRIFT'; end if;
  if not is_replay then
    now_at:=pg_catalog.clock_timestamp();
    perform pg_catalog.set_config('app.falcon24_e7_activation_stage_id',stage.stage_id::text,true);
    perform pg_catalog.set_config(
      'app.falcon24_e7_activation_attempt_id',command->>'attempt_id',true);
    update app_data_agent.falcon24_llm_execution_certification_stage set
      status='PROMOTED',activation_attempt_id=(command->>'attempt_id')::uuid,promoted_at=now_at
      where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
        and stage_id=stage.stage_id and status='STAGED';
    if not found then raise exception using errcode='40001',
      message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_STAGE_PROMOTION_RACE'; end if;
    update app_data_agent.artifacts artifact_row set is_active=true
      where artifact_row.app_id=certification.app_id
        and artifact_row.tenant_id=certification.tenant_id
        and artifact_row.environment=certification.environment
        and artifact_row.run_id=certification.run_id
        and artifact_row.artifact_id=certification.artifact_id
        and artifact_row.revision=certification.revision
        and artifact_row.content_hash=certification.content_hash
        and not artifact_row.is_active;
    if not found then raise exception using errcode='40001',
      message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_CERTIFICATION_PROMOTION_RACE'; end if;
  end if;
  v3_command:=(command-array[
    'predecessor_diagnostic_receipt','llm_execution_stage_ref','command_hash'])
    ||pg_catalog.jsonb_build_object('schema_version','falcon24-activation-request@3.0.0');
  v3_command:=v3_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(v3_command));
  authority_document:=app_data_agent.activate_falcon24_authority_pre_e9(v3_command);
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-retained-activation-result@6.0.0',
    'activation_command_hash',command->>'command_hash','authority',authority_document,
    'predecessor_diagnostic_receipt',failure,
    'llm_execution_certification',pg_catalog.jsonb_build_object(
      'stage_id',stage.stage_id,'proof_hash',stage.proof_hash,
      'certification_receipt_ref',stage.proof_document->'certification_receipt_ref',
      'execution_profile_hash',stage.execution_profile_hash));
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',
    message='FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_ACTIVATION_INVALID';
end
$function$;
alter function app_data_agent.activate_falcon24_authority_pre_e9(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_current_provider_execution_certification(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;

revoke all on function
  app_data_agent.activate_falcon24_authority_pre_e9(jsonb),
  app_data_agent.resolve_current_provider_execution_certification(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.activate_falcon24_authority(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.resolve_current_provider_execution_certification(jsonb)
  to data_agent_backend;
do $postconditions$
declare relation_name text;schema_name text;table_name text;after_count bigint;after_digest text;
  before_row record;definition text;
begin
  foreach definition in array array[
    'app_data_agent.activate_falcon24_authority(jsonb)',
    'app_data_agent.resolve_current_provider_execution_certification(jsonb)']::text[] loop
    if pg_catalog.to_regprocedure(definition) is null
      or pg_catalog.has_function_privilege('public',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',definition,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',definition,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E9_CURRENT_PROFILE_SECURITY_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'falcon24-activation-request@6.0.0')=0
    or pg_catalog.strpos(definition,'activate_falcon24_authority_pre_e9(v3_command)')=0
    or pg_catalog.strpos(definition,'predecessor_diagnostic_receipt')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E9_ACTIVATION_POSTCONDITION_FAILED'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.resolve_current_provider_execution_certification(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,
      'stage.target_authority_epoch=current_epoch.authority_epoch')=0
    or pg_catalog.strpos(definition,
      'stage.activation_attempt_id=current_epoch.activation_attempt_id')=0
    or pg_catalog.strpos(definition,'stage.status=''PROMOTED''')=0
    or pg_catalog.strpos(definition,'artifact.is_active')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E9_CURRENT_PROFILE_RESOLVER_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10801_history_snapshot order by relation_name loop
    relation_name:=before_row.relation_name;
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if after_count<>before_row.row_count or after_digest<>before_row.row_digest
    then raise exception using errcode='P0001',
      message='FALCON24_E9_CURRENT_PROFILE_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010801_app_data_agent_falcon24_e9_current_profile_authority',
  'sha256:3e02122c78486eb2743b1b23c4387a7b363172335a27af5663d829085d2d7099');

commit;
