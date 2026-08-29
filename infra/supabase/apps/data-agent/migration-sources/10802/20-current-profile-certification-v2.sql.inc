create function app_data_agent.resolve_current_provider_execution_certification_v2(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;
  current_epoch_row app_data_agent.falcon24_current_authority_epoch%rowtype;
  certification_stage_row app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  certification_artifact_row app_data_agent.artifacts%rowtype;
  reference jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
    or command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','model_profile_id','model_config_version',
      'certification_receipt_ref']::text[]) is distinct from true
    or command->>'schema_version'<>
      'current-provider-execution-certification-resolve@2.0.0'
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
  select * into current_epoch_row
    from app_data_agent.falcon24_current_authority_epoch current_source
    where current_source.app_id=authority.app_id
      and current_source.tenant_id=authority.tenant_id
      and current_source.environment=authority.environment;
  if current_epoch_row.authority_epoch is null
    or pg_catalog.substr(current_epoch_row.authority_epoch,2)::numeric<10
  then raise exception using errcode='55000',
    message='PROVIDER_CURRENT_CERTIFICATION_NOT_AVAILABLE'; end if;
  select * into certification_stage_row
    from app_data_agent.falcon24_llm_execution_certification_stage stage_source
    where stage_source.app_id=authority.app_id and stage_source.tenant_id=authority.tenant_id
      and stage_source.environment=authority.environment
      and stage_source.target_authority_epoch=current_epoch_row.authority_epoch
      and stage_source.activation_attempt_id=current_epoch_row.activation_attempt_id
      and stage_source.status='PROMOTED'
      and stage_source.model_profile_id=(command->>'model_profile_id')::uuid
      and stage_source.model_config_version=(command->>'model_config_version')::bigint;
  reference:=command->'certification_receipt_ref';
  if certification_stage_row.stage_id is null
    or reference->>'app_id'<>certification_stage_row.app_id::text
    or reference->>'tenant_id'<>certification_stage_row.tenant_id::text
    or reference->>'environment'<>certification_stage_row.environment
    or reference->>'run_id'<>certification_stage_row.certification_run_id::text
    or reference->>'artifact_id'<>certification_stage_row.certification_artifact_id::text
    or reference->>'revision'<>certification_stage_row.certification_revision::text
    or reference->>'content_hash'<>certification_stage_row.certification_content_hash
  then raise exception using errcode='55000',
    message='PROVIDER_CURRENT_CERTIFICATION_NOT_AVAILABLE'; end if;
  select * into certification_artifact_row
    from app_data_agent.artifacts artifact_source
    where artifact_source.app_id=certification_stage_row.app_id
      and artifact_source.tenant_id=certification_stage_row.tenant_id
      and artifact_source.environment=certification_stage_row.environment
      and artifact_source.run_id=certification_stage_row.certification_run_id
      and artifact_source.artifact_id=certification_stage_row.certification_artifact_id
      and artifact_source.artifact_type='ModelCertificationReceipt'
      and artifact_source.revision=certification_stage_row.certification_revision
      and artifact_source.content_hash=certification_stage_row.certification_content_hash
      and artifact_source.is_active;
  if certification_artifact_row.artifact_id is null
    or certification_artifact_row.document_json->>'schema_version'<>
      'model-execution-certification@1.0.0'
    or certification_artifact_row.document_json->>'verdict'<>'PASS'
    or certification_artifact_row.document_json->>'profile_id'<>
      certification_stage_row.model_profile_id::text
    or certification_artifact_row.document_json->>'model_config_version'<>
      certification_stage_row.model_config_version::text
    or certification_artifact_row.document_json->>'provider'<>certification_stage_row.provider
    or certification_artifact_row.document_json->>'model_id'<>certification_stage_row.model_id
    or certification_artifact_row.document_json->>'execution_profile_hash'<>
      certification_stage_row.execution_profile_hash
    or certification_artifact_row.document_json->'receipt_ref'<>reference
    or certification_artifact_row.content_hash<>
      app_data_agent.u2_canonical_sha256(
        certification_artifact_row.document_json#-'{receipt_ref,content_hash}')
    or certification_artifact_row.document_json->>'execution_profile_hash'<>
      app_data_agent.u2_canonical_sha256(
        certification_artifact_row.document_json->'execution_profile_snapshot')
    or certification_artifact_row.document_json#>>'{execution_profile_snapshot,scope,app_id}'<>
      authority.app_id::text
    or certification_artifact_row.document_json#>>'{execution_profile_snapshot,scope,tenant_id}'<>
      authority.tenant_id::text
    or certification_artifact_row.document_json#>>'{execution_profile_snapshot,scope,environment}'<>
      authority.environment
    or certification_artifact_row.document_json#>>'{connection,kind}'<>'SYSTEM_DEPLOYMENT'
    or certification_artifact_row.document_json#>>'{connection,deployment_id}'<>
      certification_stage_row.deployment_id::text
    or certification_artifact_row.document_json->'recovery_capabilities'<>
      '["AT_LEAST_ONCE_ONLY"]'::jsonb
    or certification_artifact_row.document_json->'connection'<>
      certification_artifact_row.document_json#>'{execution_profile_snapshot,connection}'
    or certification_artifact_row.document_json->'recovery_capabilities'<>
      certification_artifact_row.document_json#>'{execution_profile_snapshot,recovery_capabilities}'
  then raise exception using errcode='55000',
    message='PROVIDER_CURRENT_CERTIFICATION_INVALID'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','current-provider-execution-certification@2.0.0',
    'claims',certification_artifact_row.document_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',
    message='PROVIDER_CURRENT_CERTIFICATION_RESOLVE_INVALID';
end
$function$;
