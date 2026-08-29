create function app_data_agent.stage_falcon24_llm_execution_certification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  existing app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  proof jsonb;certification jsonb;reference jsonb;snapshot jsonb;worker_build jsonb;
  catalog app_data_agent.model_catalog_entries%rowtype;
  revision app_data_agent.model_config_versions%rowtype;
  deployment platform.deployment_mappings%rowtype;
  active_fence bigint;expected_resource_hash text;expected_deployment_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','target_authority_epoch','staging_id','stage_id','idempotency_key',
      'proof_document','certification_claims','worker_fence','command_hash']::text[])
      is distinct from true
    or command->>'schema_version'<>'falcon24-llm-execution-stage-command@1.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'target_authority_epoch')
      is distinct from true
    or pg_catalog.substr(command->>'target_authority_epoch',2)::numeric<7
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'stage_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or pg_catalog.jsonb_typeof(command->'worker_fence') is distinct from 'number'
    or command->>'worker_fence'!~'^(0|[1-9][0-9]*)$'
    or (command->>'worker_fence')::numeric>9007199254740991
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_STAGE_COMMAND_INVALID'; end if;
  proof:=command->'proof_document';certification:=command->'certification_claims';
  reference:=certification->'receipt_ref';snapshot:=certification->'execution_profile_snapshot';
  worker_build:=proof->'worker_build';
  if pg_catalog.jsonb_typeof(proof) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(proof,array[
      'schema_version','scope','target_authority_epoch','staging_id','stage_id','model_profile_id',
      'model_config_version','model_resource_hash','provider','model_id','certification_receipt_ref',
      'execution_profile_hash','deployment_id','deployment_hash','recovery_capabilities',
      'worker_build','proof_hash']::text[]) is distinct from true
    or proof->>'schema_version'<>'falcon24-llm-execution-authority-proof@1.0.0'
    or proof->>'target_authority_epoch'<>command->>'target_authority_epoch'
    or proof->>'staging_id'<>command->>'staging_id' or proof->>'stage_id'<>command->>'stage_id'
    or proof->>'provider'<>'deepseek' or proof->>'model_id'<>'deepseek-v4-flash'
    or proof->'recovery_capabilities'<>'["AT_LEAST_ONCE_ONLY"]'::jsonb
    or proof->>'proof_hash' is distinct from app_data_agent.u2_canonical_sha256(
      pg_catalog.jsonb_build_object('hash_domain',
        'falcon24-llm-execution-authority-proof@1.0.0','proof',proof-'proof_hash'))
    or not app_data_agent.provider_json_object_has_exact_keys(proof->'scope',array[
      'app_id','tenant_id','environment','semantic_domain']::text[])
    or proof#>>'{scope,semantic_domain}'<>'falcon24'
    or not app_data_agent.provider_json_object_has_exact_keys(worker_build,array[
      'build_id','generation_id']::text[])
    or worker_build->>'build_id'!~'^sha256:[0-9a-f]{64}$'
    or worker_build->>'generation_id'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_PROOF_INVALID'; end if;
  if pg_catalog.jsonb_typeof(certification) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(certification,array[
      'schema_version','receipt_ref','profile_id','model_config_version','provider','model_id',
      'profile_version','adapter_version','execution_profile_hash','execution_profile_snapshot',
      'recovery_capabilities','connection','certification_basis','verdict']::text[])
      is distinct from true
    or certification->>'schema_version'<>'model-execution-certification@1.0.0'
    or certification->>'provider'<>'deepseek' or certification->>'model_id'<>'deepseek-v4-flash'
    or certification->>'verdict'<>'PASS'
    or certification->'recovery_capabilities'<>'["AT_LEAST_ONCE_ONLY"]'::jsonb
    or certification#>>'{certification_basis,kind}'<>'CREDENTIAL_SMOKE'
    or certification#>>'{certification_basis,probe_hash}'!~'^sha256:[0-9a-f]{64}$'
    or certification->>'execution_profile_hash' is distinct from
      app_data_agent.u2_canonical_sha256(certification->'execution_profile_snapshot')
    or reference->>'content_hash' is distinct from
      app_data_agent.u2_canonical_sha256(certification#-'{receipt_ref,content_hash}')
    or certification->'connection' is distinct from snapshot->'connection'
    or certification->'recovery_capabilities' is distinct from snapshot->'recovery_capabilities'
    or certification->>'profile_id' is distinct from snapshot->>'profile_id'
    or certification->>'model_config_version' is distinct from snapshot->>'model_config_version'
    or certification->>'provider' is distinct from snapshot->>'provider'
    or certification->>'model_id' is distinct from snapshot->>'model_id'
    or certification->>'profile_version' is distinct from snapshot->>'profile_version'
    or certification->>'adapter_version' is distinct from snapshot->>'adapter_version'
    or snapshot#>>'{context_window,verification_status}'<>'VERIFIED'
    or certification#>>'{connection,kind}'<>'SYSTEM_DEPLOYMENT'
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_CERTIFICATION_INVALID'; end if;
  if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
      'content_hash']::text[])
    or reference->>'artifact_type'<>'ModelCertificationReceipt' or reference->>'revision'<>'1'
    or app_data_agent.canonical_uuid_json_string_is_valid(reference->'artifact_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(reference->'run_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(certification->'profile_id') is distinct from true
    or certification->>'model_config_version'!~'^[1-9][0-9]*$'
    or (certification->>'model_config_version')::numeric>9007199254740991
    or not app_data_agent.provider_json_object_has_exact_keys(certification->'connection',array[
      'kind','deployment_id','deployment_revision','deployment_hash']::text[])
    or certification#>>'{connection,deployment_revision}'<>'1'
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_CERTIFICATION_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  if proof#>>'{scope,app_id}' is distinct from authority.app_id::text
    or proof#>>'{scope,tenant_id}' is distinct from authority.tenant_id::text
    or proof#>>'{scope,environment}' is distinct from authority.environment
    or reference->>'app_id' is distinct from authority.app_id::text
    or reference->>'tenant_id' is distinct from authority.tenant_id::text
    or reference->>'environment' is distinct from authority.environment
    or snapshot#>>'{scope,app_id}' is distinct from authority.app_id::text
    or snapshot#>>'{scope,tenant_id}' is distinct from authority.tenant_id::text
    or snapshot#>>'{scope,environment}' is distinct from authority.environment
  then raise exception using errcode='42501',
    message='FALCON24_LLM_EXECUTION_STAGE_SCOPE_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-llm-execution-stage:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  select * into existing from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and (row.stage_id=(command->>'stage_id')::uuid
        or row.idempotency_key=command->>'idempotency_key') for update;
  if found then
    if existing.staging_command_hash=command->>'command_hash'
      and existing.proof_hash=proof->>'proof_hash'
    then return existing.proof_document; end if;
    raise exception using errcode='23505',message='FALCON24_LLM_EXECUTION_STAGE_CONFLICT';
  end if;
  if pg_catalog.substr(command->>'target_authority_epoch',2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
  then raise exception using errcode='55000',
    message='FALCON24_LLM_EXECUTION_STAGE_NOT_SUCCESSOR'; end if;

  select * into catalog from app_data_agent.model_catalog_entries row
    where row.app_id=authority.app_id and row.environment=authority.environment
      and row.model_profile_id=(certification->>'profile_id')::uuid
      and row.config_version=(certification->>'model_config_version')::bigint
      and row.provider='deepseek' and row.model_id='deepseek-v4-flash'
      and row.status='ACTIVE' and row.is_system_default for share;
  select * into revision from app_data_agent.model_config_versions row
    where row.app_id=catalog.app_id and row.environment=catalog.environment
      and row.model_profile_id=catalog.model_profile_id
      and row.config_version=catalog.config_version for share;
  select * into deployment from platform.deployment_mappings row
    where row.deployment_id=authority.deployment_id and row.app_id=authority.app_id
      and row.environment=authority.environment and row.is_active for share;
  expected_resource_hash:=platform.canonical_sha256(revision.snapshot);
  expected_deployment_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'deployment_id',deployment.deployment_id,'app_id',deployment.app_id,
    'environment',deployment.environment,'deployment_key_hash',deployment.deployment_key_hash));
  if catalog.model_profile_id is null or revision.model_profile_id is null or deployment.deployment_id is null
    or proof->>'model_profile_id'<>catalog.model_profile_id::text
    or proof->>'model_config_version'<>catalog.config_version::text
    or proof->>'model_resource_hash' is distinct from expected_resource_hash
    or proof->>'execution_profile_hash' is distinct from certification->>'execution_profile_hash'
    or proof->>'deployment_id'<>deployment.deployment_id::text
    or proof->>'deployment_hash' is distinct from expected_deployment_hash
    or certification#>>'{connection,deployment_id}'<>deployment.deployment_id::text
    or certification#>>'{connection,deployment_hash}' is distinct from expected_deployment_hash
    or proof->'certification_receipt_ref' is distinct from reference
  then raise exception using errcode='55000',
    message='FALCON24_LLM_EXECUTION_CATALOG_MISMATCH'; end if;

  select app_data_agent.lock_owned_run_fence((reference->>'run_id')::uuid)
    into strict active_fence;
  if active_fence is distinct from (command->>'worker_fence')::bigint
  then raise exception using errcode='55000',message='WORKER_FENCE_STALE'; end if;
  insert into app_data_agent.artifacts(
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
    document_json,worker_fence,is_active,parent_revision,parent_content_hash)
  values(authority.app_id,authority.tenant_id,authority.environment,
    (reference->>'run_id')::uuid,(reference->>'artifact_id')::uuid,
    'ModelCertificationReceipt',1,reference->>'content_hash',certification,active_fence,
    false,null,null);
  insert into app_data_agent.falcon24_llm_execution_certification_stage(
    app_id,tenant_id,environment,principal_id,target_authority_epoch,staging_id,stage_id,
    idempotency_key,staging_command_hash,model_profile_id,model_config_version,
    model_resource_hash,provider,model_id,certification_run_id,certification_artifact_id,
    certification_revision,certification_content_hash,execution_profile_hash,deployment_id,
    deployment_hash,recovery_capabilities,worker_build_id,worker_generation_id,
    proof_hash,proof_document,status)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    command->>'target_authority_epoch',(command->>'staging_id')::uuid,
    (command->>'stage_id')::uuid,command->>'idempotency_key',command->>'command_hash',
    (proof->>'model_profile_id')::uuid,(proof->>'model_config_version')::bigint,
    proof->>'model_resource_hash','deepseek','deepseek-v4-flash',
    (reference->>'run_id')::uuid,(reference->>'artifact_id')::uuid,1,
    reference->>'content_hash',proof->>'execution_profile_hash',
    (proof->>'deployment_id')::uuid,proof->>'deployment_hash',proof->'recovery_capabilities',
    worker_build->>'build_id',worker_build->>'generation_id',proof->>'proof_hash',proof,'STAGED');
  return proof;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_LLM_EXECUTION_STAGE_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_llm_execution_certification_stage(requested_stage_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  certification app_data_agent.artifacts%rowtype;
begin
  if requested_stage_id is null then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_STAGE_ID_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.stage_id=requested_stage_id;
  if not found or stage.principal_id<>authority.principal_id
  then raise exception using errcode='02000',message='FALCON24_LLM_EXECUTION_STAGE_NOT_FOUND'; end if;
  select * into certification from app_data_agent.artifacts row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.run_id=stage.certification_run_id
      and row.artifact_id=stage.certification_artifact_id
      and row.revision=stage.certification_revision
      and row.content_hash=stage.certification_content_hash;
  if certification.artifact_id is null
  then raise exception using errcode='55000',message='FALCON24_LLM_EXECUTION_STAGE_CORRUPT'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-llm-execution-stage@1.0.0',
    'status',stage.status,'proof_document',stage.proof_document,
    'certification_claims',certification.document_json,
    'certification_is_active',certification.is_active,
    'staging_command_hash',stage.staging_command_hash,
    'activation_attempt_id',stage.activation_attempt_id,
    'rejection_reason_code',stage.rejection_reason_code,
    'rejection_command_hash',stage.rejection_command_hash);
end
$function$;

create function app_data_agent.reject_falcon24_llm_execution_certification_stage(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','stage_id','proof_hash','reason_code','command_hash']::text[])
      is distinct from true
    or command->>'schema_version'<>'falcon24-llm-execution-stage-reject@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'stage_id') is distinct from true
    or command->>'proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'reason_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',
    message='FALCON24_LLM_EXECUTION_STAGE_REJECT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.stage_id=(command->>'stage_id')::uuid for update;
  if stage.stage_id is null or stage.proof_hash<>command->>'proof_hash'
  then raise exception using errcode='02000',
    message='FALCON24_LLM_EXECUTION_STAGE_NOT_FOUND'; end if;
  if stage.status='REJECTED'
  then return app_data_agent.load_falcon24_llm_execution_certification_stage(stage.stage_id); end if;
  if stage.status<>'STAGED'
    or pg_catalog.substr(stage.target_authority_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
    or exists(select 1 from app_data_agent.falcon24_authority_baselines baseline
      join app_data_agent.falcon24_authority_activation_attempts attempt
        on attempt.app_id=baseline.app_id and attempt.tenant_id=baseline.tenant_id
       and attempt.environment=baseline.environment and attempt.baseline_id=baseline.baseline_id
       and attempt.expected_baseline_hash=baseline.baseline_hash
      where baseline.app_id=stage.app_id and baseline.tenant_id=stage.tenant_id
        and baseline.environment=stage.environment and baseline.staging_id=stage.staging_id
        and attempt.status='ACTIVATED')
  then raise exception using errcode='55000',
    message='FALCON24_LLM_EXECUTION_STAGE_REJECT_FORBIDDEN'; end if;
  update app_data_agent.falcon24_llm_execution_certification_stage set
    status='REJECTED',rejection_reason_code=command->>'reason_code',
    rejection_command_hash=command->>'command_hash',promoted_at=pg_catalog.clock_timestamp()
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and stage_id=stage.stage_id and status='STAGED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_LLM_EXECUTION_STAGE_REJECT_RACE'; end if;
  return app_data_agent.load_falcon24_llm_execution_certification_stage(stage.stage_id);
end
$function$;

create function app_data_agent.load_falcon24_e7_recovery_context(requested_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  attempt app_data_agent.falcon24_diagnostic_attempts%rowtype;
  run_row app_data_agent.runs%rowtype;
begin
  if requested_attempt_id is null then raise exception using errcode='22023',
    message='FALCON24_E7_RECOVERY_CONTEXT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  select * into attempt from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=requested_attempt_id;
  select * into run_row from app_data_agent.runs row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.run_id=attempt.run_id
      and row.principal_id=attempt.principal_id;
  if attempt.attempt_id is null or attempt.status<>'ACTIVE'
    or attempt.authority_epoch<>current_epoch.authority_epoch
    or attempt.authority_baseline_id<>current_epoch.baseline_id
    or attempt.authority_baseline_hash<>current_epoch.baseline_hash
    or attempt.authority_activation_attempt_id<>current_epoch.activation_attempt_id
    or run_row.status<>'FAILED'
    or not exists(select 1 from app_data_agent.run_events event
      where event.app_id=attempt.app_id and event.tenant_id=attempt.tenant_id
        and event.environment=attempt.environment and event.run_id=attempt.run_id
        and event.event_type='run.failed'
        and event.payload_json->>'error_code'='PROVIDER_PROFILE_NOT_AVAILABLE'
        and event.payload_json->>'retryable'='false')
  then raise exception using errcode='55000',
    message='FALCON24_E7_RECOVERY_CONTEXT_NOT_ELIGIBLE'; end if;
  return pg_catalog.jsonb_build_object(
    'attempt_id',attempt.attempt_id,'run_id',attempt.run_id,'manifest_hash',attempt.manifest_hash,
    'failure_class','FROZEN_CLOSURE_CHANGE_REQUIRED',
    'failure_code','PROVIDER_PROFILE_NOT_AVAILABLE');
end
$function$;
