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
