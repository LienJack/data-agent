alter function app_data_agent.activate_falcon24_authority(jsonb)
  rename to activate_falcon24_authority_pre_e8;

create function app_data_agent.activate_falcon24_authority(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;scope_json jsonb;expected_authority jsonb;failure_ref jsonb;stage_ref jsonb;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  failure_receipt app_data_agent.falcon24_epoch_closure_failure_receipts%rowtype;
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
      'falcon24-activation-request@4.0.0')
  then return app_data_agent.activate_falcon24_authority_pre_e8(command); end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','scope','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'expected_current_authority','expected_semantic_release','expected_versions',
      'retained_semantic_proof_hash','predecessor_closure_failure_ref',
      'llm_execution_stage_ref','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-activation-request@5.0.0'
    or command->>'authority_epoch'<>'E8'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'retained_semantic_proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_CLOSURE_RECOVERY_ACTIVATION_INVALID'; end if;
  scope_json:=command->'scope';expected_authority:=command->'expected_current_authority';
  failure_ref:=command->'predecessor_closure_failure_ref';
  stage_ref:=command->'llm_execution_stage_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
    or expected_authority->>'schema_version'<>'falcon24-authority-binding@2.0.0'
    or expected_authority->>'authority_epoch'<>'E7'
    or not app_data_agent.provider_json_object_has_exact_keys(failure_ref,array[
      'receipt_id','receipt_hash','failure_code']::text[])
    or failure_ref->>'failure_code'<>'PROVIDER_PROFILE_BINDING_NOT_SELECTED'
    or failure_ref->>'receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or not app_data_agent.provider_json_object_has_exact_keys(stage_ref,array[
      'stage_id','proof_hash']::text[])
    or stage_ref->>'proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(failure_ref->'receipt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
  then raise exception using errcode='22023',
    message='FALCON24_CLOSURE_RECOVERY_ACTIVATION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',
    message='FALCON24_CLOSURE_RECOVERY_ACTIVATION_SCOPE_FORBIDDEN'; end if;

  perform semantic.lock_semantic_authority_fence(
    authority.app_id,authority.tenant_id,authority.environment,scope_json->>'semantic_domain');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
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
  select * into failure_receipt from app_data_agent.falcon24_epoch_closure_failure_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.receipt_id=(failure_ref->>'receipt_id')::uuid for share;
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
    message='FALCON24_CLOSURE_RECOVERY_PREDECESSOR_MISMATCH'; end if;
  if failure_receipt.receipt_id is null
    or failure_receipt.receipt_hash<>failure_ref->>'receipt_hash'
    or failure_receipt.failure_code<>failure_ref->>'failure_code'
    or failure_receipt.authority_epoch<>expected_authority->>'authority_epoch'
    or failure_receipt.baseline_id<>(expected_authority->>'baseline_id')::uuid
    or failure_receipt.baseline_hash<>expected_authority->>'baseline_hash'
    or failure_receipt.activation_attempt_id<>
      (expected_authority->>'activation_attempt_id')::uuid
  then raise exception using errcode='55000',
    message='FALCON24_CLOSURE_RECOVERY_FAILURE_RECEIPT_MISMATCH'; end if;
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
    message='FALCON24_CLOSURE_RECOVERY_LLM_STAGE_MISMATCH'; end if;
  if catalog.model_profile_id is null or catalog.status<>'ACTIVE' or not catalog.is_system_default
    or model_revision.model_profile_id is null
    or platform.canonical_sha256(model_revision.snapshot)<>stage.model_resource_hash
    or deployment.deployment_id is null or not deployment.is_active
    or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'deployment_id',deployment.deployment_id,'app_id',deployment.app_id,
      'environment',deployment.environment,'deployment_key_hash',deployment.deployment_key_hash))
      <>stage.deployment_hash
  then raise exception using errcode='55000',
    message='FALCON24_CLOSURE_RECOVERY_LLM_CATALOG_DRIFT'; end if;
  if not is_replay then
    now_at:=pg_catalog.clock_timestamp();
    perform pg_catalog.set_config('app.falcon24_e7_activation_stage_id',stage.stage_id::text,true);
    perform pg_catalog.set_config('app.falcon24_e7_activation_attempt_id',command->>'attempt_id',true);
    update app_data_agent.falcon24_llm_execution_certification_stage set
      status='PROMOTED',activation_attempt_id=(command->>'attempt_id')::uuid,promoted_at=now_at
      where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
        and stage_id=stage.stage_id and status='STAGED';
    if not found then raise exception using errcode='40001',
      message='FALCON24_CLOSURE_RECOVERY_LLM_STAGE_PROMOTION_RACE'; end if;
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
      message='FALCON24_CLOSURE_RECOVERY_CERTIFICATION_PROMOTION_RACE'; end if;
  end if;
  v3_command:=(command-array[
    'predecessor_closure_failure_ref','llm_execution_stage_ref','command_hash'])
    ||pg_catalog.jsonb_build_object('schema_version','falcon24-activation-request@3.0.0');
  v3_command:=v3_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(v3_command));
  authority_document:=app_data_agent.activate_falcon24_authority_pre_e7(v3_command);
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-retained-activation-result@5.0.0',
    'activation_command_hash',command->>'command_hash','authority',authority_document,
    'predecessor_closure_failure_receipt',pg_catalog.jsonb_build_object(
      'receipt_id',failure_receipt.receipt_id,'receipt_hash',failure_receipt.receipt_hash,
      'failure_code',failure_receipt.failure_code),
    'llm_execution_certification',pg_catalog.jsonb_build_object(
      'stage_id',stage.stage_id,'proof_hash',stage.proof_hash,
      'certification_receipt_ref',stage.proof_document->'certification_receipt_ref',
      'execution_profile_hash',stage.execution_profile_hash));
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',
    message='FALCON24_CLOSURE_RECOVERY_ACTIVATION_INVALID';
end
$function$;
