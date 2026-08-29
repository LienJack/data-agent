alter function app_data_agent.activate_falcon24_authority(jsonb)
  rename to activate_falcon24_authority_pre_e10;

create function app_data_agent.activate_falcon24_authority(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;scope_json jsonb;expected_authority jsonb;failure_ref jsonb;
  stage_ref jsonb;
  current_epoch_row app_data_agent.falcon24_current_authority_epoch%rowtype;
  pointer_row semantic.semantic_active_pointer%rowtype;
  runtime_row semantic.semantic_runtime_activation%rowtype;
  defaults_pointer_row app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision_row app_data_agent.workspace_run_default_revisions%rowtype;
  failure_row app_data_agent.falcon24_finalization_failure_receipts%rowtype;
  candidate_stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  certification_artifact app_data_agent.artifacts%rowtype;
  catalog_row app_data_agent.model_catalog_entries%rowtype;
  model_revision_row app_data_agent.model_config_versions%rowtype;
  deployment_row platform.deployment_mappings%rowtype;
  target_baseline_row app_data_agent.falcon24_authority_baselines%rowtype;
  llm_receipt_row app_data_agent.falcon24_authority_staging_receipts%rowtype;
  v3_command jsonb;authority_document jsonb;is_replay boolean:=false;now_at timestamptz;
begin
  if command->>'schema_version' in(
      'falcon24-activation-request@2.0.0','falcon24-activation-request@3.0.0',
      'falcon24-activation-request@4.0.0','falcon24-activation-request@5.0.0',
      'falcon24-activation-request@6.0.0')
  then return app_data_agent.activate_falcon24_authority_pre_e10(command); end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','scope','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'expected_current_authority','expected_semantic_release','expected_versions',
      'retained_semantic_proof_hash','predecessor_finalization_failure_receipt',
      'llm_execution_stage_ref','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-activation-request@7.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric<10
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'retained_semantic_proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_FINALIZATION_FAILURE_RECOVERY_ACTIVATION_INVALID'; end if;
  scope_json:=command->'scope';expected_authority:=command->'expected_current_authority';
  failure_ref:=command->'predecessor_finalization_failure_receipt';
  stage_ref:=command->'llm_execution_stage_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
    or expected_authority->>'schema_version'<>'falcon24-authority-binding@2.0.0'
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric<>
      pg_catalog.substr(expected_authority->>'authority_epoch',2)::numeric+1
    or not app_data_agent.provider_json_object_has_exact_keys(failure_ref,array[
      'receipt_id','receipt_hash','failure_code']::text[])
    or failure_ref->>'failure_code'<>
      'CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS'
    or failure_ref->>'receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or not app_data_agent.provider_json_object_has_exact_keys(
      stage_ref,array['stage_id','proof_hash']::text[])
    or stage_ref->>'proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      failure_ref->'receipt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
  then raise exception using errcode='22023',
    message='FALCON24_FINALIZATION_FAILURE_RECOVERY_ACTIVATION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',
    message='FALCON24_FINALIZATION_FAILURE_RECOVERY_SCOPE_FORBIDDEN'; end if;

  perform semantic.lock_semantic_authority_fence(
    authority.app_id,authority.tenant_id,authority.environment,scope_json->>'semantic_domain');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch_row
    from app_data_agent.falcon24_current_authority_epoch current_source
    where current_source.app_id=authority.app_id
      and current_source.tenant_id=authority.tenant_id
      and current_source.environment=authority.environment for update;
  select * into pointer_row from semantic.semantic_active_pointer pointer_source
    where pointer_source.app_id=authority.app_id
      and pointer_source.tenant_id=authority.tenant_id
      and pointer_source.environment=authority.environment
      and pointer_source.semantic_domain=scope_json->>'semantic_domain' for update;
  select * into runtime_row from semantic.semantic_runtime_activation runtime_source
    where runtime_source.app_id=authority.app_id
      and runtime_source.tenant_id=authority.tenant_id
      and runtime_source.environment=authority.environment
      and runtime_source.semantic_domain=scope_json->>'semantic_domain' for update;
  select * into defaults_pointer_row
    from app_data_agent.workspace_run_defaults defaults_source
    where defaults_source.app_id=authority.app_id
      and defaults_source.tenant_id=authority.tenant_id
      and defaults_source.environment=authority.environment for update;
  select * into defaults_revision_row
    from app_data_agent.workspace_run_default_revisions revision_source
    where revision_source.app_id=defaults_pointer_row.app_id
      and revision_source.tenant_id=defaults_pointer_row.tenant_id
      and revision_source.environment=defaults_pointer_row.environment
      and revision_source.defaults_id=defaults_pointer_row.defaults_id
      and revision_source.defaults_revision=defaults_pointer_row.defaults_revision
      and revision_source.revision_id=defaults_pointer_row.revision_id
      and revision_source.defaults_hash=defaults_pointer_row.defaults_hash for update;
  select * into failure_row
    from app_data_agent.falcon24_finalization_failure_receipts failure_source
    where failure_source.app_id=authority.app_id
      and failure_source.tenant_id=authority.tenant_id
      and failure_source.environment=authority.environment
      and failure_source.principal_id=authority.principal_id
      and failure_source.receipt_id=(failure_ref->>'receipt_id')::uuid for share;
  select * into candidate_stage
    from app_data_agent.falcon24_llm_execution_certification_stage stage_source
    where stage_source.app_id=authority.app_id and stage_source.tenant_id=authority.tenant_id
      and stage_source.environment=authority.environment
      and stage_source.principal_id=authority.principal_id
      and stage_source.stage_id=(stage_ref->>'stage_id')::uuid for update;
  select * into certification_artifact from app_data_agent.artifacts artifact_source
    where artifact_source.app_id=candidate_stage.app_id
      and artifact_source.tenant_id=candidate_stage.tenant_id
      and artifact_source.environment=candidate_stage.environment
      and artifact_source.run_id=candidate_stage.certification_run_id
      and artifact_source.artifact_id=candidate_stage.certification_artifact_id
      and artifact_source.revision=candidate_stage.certification_revision
      and artifact_source.content_hash=candidate_stage.certification_content_hash for update;
  select * into catalog_row from app_data_agent.model_catalog_entries catalog_source
    where catalog_source.app_id=candidate_stage.app_id
      and catalog_source.environment=candidate_stage.environment
      and catalog_source.model_profile_id=candidate_stage.model_profile_id
      and catalog_source.config_version=candidate_stage.model_config_version
      and catalog_source.provider=candidate_stage.provider
      and catalog_source.model_id=candidate_stage.model_id for share;
  select * into model_revision_row
    from app_data_agent.model_config_versions model_revision_source
    where model_revision_source.app_id=candidate_stage.app_id
      and model_revision_source.environment=candidate_stage.environment
      and model_revision_source.model_profile_id=candidate_stage.model_profile_id
      and model_revision_source.config_version=candidate_stage.model_config_version for share;
  select * into deployment_row from platform.deployment_mappings deployment_source
    where deployment_source.deployment_id=candidate_stage.deployment_id
      and deployment_source.app_id=candidate_stage.app_id
      and deployment_source.environment=candidate_stage.environment for share;
  select * into target_baseline_row
    from app_data_agent.falcon24_authority_baselines baseline_source
    where baseline_source.app_id=authority.app_id
      and baseline_source.tenant_id=authority.tenant_id
      and baseline_source.environment=authority.environment
      and baseline_source.baseline_id=(command->>'baseline_id')::uuid
      and baseline_source.authority_epoch=command->>'authority_epoch' for update;
  select * into llm_receipt_row
    from app_data_agent.falcon24_authority_staging_receipts receipt_source
    where receipt_source.app_id=target_baseline_row.app_id
      and receipt_source.tenant_id=target_baseline_row.tenant_id
      and receipt_source.environment=target_baseline_row.environment
      and receipt_source.staging_id=target_baseline_row.staging_id
      and receipt_source.authority_epoch=target_baseline_row.authority_epoch
      and receipt_source.component='LLM_CONFIGURATION' for share;

  is_replay:=current_epoch_row.authority_epoch=command->>'authority_epoch'
    and current_epoch_row.baseline_id=(command->>'baseline_id')::uuid
    and current_epoch_row.baseline_hash=command->>'expected_baseline_hash'
    and current_epoch_row.activation_attempt_id=(command->>'attempt_id')::uuid;
  if not is_replay and (
      current_epoch_row.authority_epoch is distinct from expected_authority->>'authority_epoch'
      or current_epoch_row.baseline_id is distinct from
        (expected_authority->>'baseline_id')::uuid
      or current_epoch_row.baseline_hash is distinct from expected_authority->>'baseline_hash'
      or current_epoch_row.activation_attempt_id is distinct from
        (expected_authority->>'activation_attempt_id')::uuid)
  then raise exception using errcode='40001',
    message='FALCON24_FINALIZATION_FAILURE_RECOVERY_PREDECESSOR_MISMATCH'; end if;
  if failure_row.receipt_id is null
    or failure_row.receipt_hash<>failure_ref->>'receipt_hash'
    or failure_row.failure_code<>failure_ref->>'failure_code'
    or failure_row.failure_class<>'FROZEN_CLOSURE_CHANGE_REQUIRED'
    or failure_row.observed_sqlstate<>'42702'
    or failure_row.authority_epoch<>expected_authority->>'authority_epoch'
    or failure_row.baseline_id<>(expected_authority->>'baseline_id')::uuid
    or failure_row.baseline_hash<>expected_authority->>'baseline_hash'
    or failure_row.activation_attempt_id<>
      (expected_authority->>'activation_attempt_id')::uuid
    or failure_row.receipt_document->>'receipt_hash'<>failure_row.receipt_hash
  then raise exception using errcode='55000',
    message='FALCON24_FINALIZATION_FAILURE_RECOVERY_RECEIPT_MISMATCH'; end if;
  if candidate_stage.stage_id is null
    or candidate_stage.target_authority_epoch<>command->>'authority_epoch'
    or target_baseline_row.baseline_id is null
    or candidate_stage.staging_id<>target_baseline_row.staging_id
    or candidate_stage.proof_hash<>stage_ref->>'proof_hash'
    or candidate_stage.proof_document->>'proof_hash'<>candidate_stage.proof_hash
    or llm_receipt_row.evidence_hash<>candidate_stage.proof_hash
    or llm_receipt_row.subject_hash<>candidate_stage.model_resource_hash
    or (not is_replay and
      (candidate_stage.status<>'STAGED' or certification_artifact.is_active))
    or (is_replay and
      (candidate_stage.status<>'PROMOTED' or not certification_artifact.is_active
        or candidate_stage.activation_attempt_id<>(command->>'attempt_id')::uuid))
  then raise exception using errcode='55000',
    message='FALCON24_FINALIZATION_FAILURE_RECOVERY_LLM_STAGE_MISMATCH'; end if;
  if catalog_row.model_profile_id is null or catalog_row.status<>'ACTIVE'
    or not catalog_row.is_system_default or model_revision_row.model_profile_id is null
    or platform.canonical_sha256(model_revision_row.snapshot)<>candidate_stage.model_resource_hash
    or deployment_row.deployment_id is null or not deployment_row.is_active
    or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'deployment_id',deployment_row.deployment_id,'app_id',deployment_row.app_id,
      'environment',deployment_row.environment,
      'deployment_key_hash',deployment_row.deployment_key_hash))
      <>candidate_stage.deployment_hash
  then raise exception using errcode='55000',
    message='FALCON24_FINALIZATION_FAILURE_RECOVERY_LLM_CATALOG_DRIFT'; end if;
  if not is_replay then
    now_at:=pg_catalog.clock_timestamp();
    perform pg_catalog.set_config(
      'app.falcon24_e7_activation_stage_id',candidate_stage.stage_id::text,true);
    perform pg_catalog.set_config(
      'app.falcon24_e7_activation_attempt_id',command->>'attempt_id',true);
    update app_data_agent.falcon24_llm_execution_certification_stage update_stage set
      status='PROMOTED',activation_attempt_id=(command->>'attempt_id')::uuid,promoted_at=now_at
      where update_stage.app_id=candidate_stage.app_id
        and update_stage.tenant_id=candidate_stage.tenant_id
        and update_stage.environment=candidate_stage.environment
        and update_stage.stage_id=candidate_stage.stage_id and update_stage.status='STAGED';
    if not found then raise exception using errcode='40001',
      message='FALCON24_FINALIZATION_FAILURE_RECOVERY_STAGE_PROMOTION_RACE'; end if;
    update app_data_agent.artifacts artifact_update set is_active=true
      where artifact_update.app_id=certification_artifact.app_id
        and artifact_update.tenant_id=certification_artifact.tenant_id
        and artifact_update.environment=certification_artifact.environment
        and artifact_update.run_id=certification_artifact.run_id
        and artifact_update.artifact_id=certification_artifact.artifact_id
        and artifact_update.revision=certification_artifact.revision
        and artifact_update.content_hash=certification_artifact.content_hash
        and not artifact_update.is_active;
    if not found then raise exception using errcode='40001',
      message='FALCON24_FINALIZATION_FAILURE_RECOVERY_CERTIFICATION_PROMOTION_RACE'; end if;
  end if;
  v3_command:=(command-array[
    'predecessor_finalization_failure_receipt','llm_execution_stage_ref','command_hash'])
    ||pg_catalog.jsonb_build_object('schema_version','falcon24-activation-request@3.0.0');
  v3_command:=v3_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(v3_command));
  authority_document:=app_data_agent.activate_falcon24_authority_pre_e10(v3_command);
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-retained-activation-result@7.0.0',
    'activation_command_hash',command->>'command_hash','authority',authority_document,
    'predecessor_finalization_failure_receipt',failure_ref,
    'llm_execution_certification',pg_catalog.jsonb_build_object(
      'stage_id',candidate_stage.stage_id,'proof_hash',candidate_stage.proof_hash,
      'certification_receipt_ref',candidate_stage.proof_document->'certification_receipt_ref',
      'execution_profile_hash',candidate_stage.execution_profile_hash));
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',
    message='FALCON24_FINALIZATION_FAILURE_RECOVERY_ACTIVATION_INVALID';
end
$function$;
