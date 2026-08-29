create function app_data_agent.load_falcon24_epoch_closure_failure(requested_receipt_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;receipt app_data_agent.falcon24_epoch_closure_failure_receipts%rowtype;
begin
  if requested_receipt_id is null then raise exception using errcode='22023',
    message='FALCON24_EPOCH_CLOSURE_FAILURE_ID_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into receipt from app_data_agent.falcon24_epoch_closure_failure_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.receipt_id=requested_receipt_id;
  if receipt.receipt_id is null then raise exception using errcode='02000',
    message='FALCON24_EPOCH_CLOSURE_FAILURE_NOT_FOUND'; end if;
  return receipt.receipt_document;
end
$function$;

create function app_data_agent.record_falcon24_epoch_closure_failure(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;expected_authority jsonb;stage_ref jsonb;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  existing app_data_agent.falcon24_epoch_closure_failure_receipts%rowtype;
  original_document jsonb;observed_document jsonb;original_profile jsonb;observed_profile jsonb;
  evidence jsonb;evidence_hash text;material jsonb;receipt_hash text;document jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt_id','idempotency_key','expected_authority','stage_ref','command_hash'
    ]::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-epoch-closure-failure-record@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'receipt_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_EPOCH_CLOSURE_FAILURE_COMMAND_INVALID'; end if;
  expected_authority:=command->'expected_authority';stage_ref:=command->'stage_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
    or expected_authority->>'schema_version'<>'falcon24-authority-binding@2.0.0'
    or expected_authority->>'authority_epoch'<>'E7'
    or expected_authority->>'baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or not app_data_agent.provider_json_object_has_exact_keys(stage_ref,array['stage_id','proof_hash']::text[])
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
    or stage_ref->>'proof_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',
    message='FALCON24_EPOCH_CLOSURE_FAILURE_COMMAND_INVALID'; end if;
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
      and row.stage_id=(stage_ref->>'stage_id')::uuid for share;
  if current_epoch.authority_epoch is distinct from expected_authority->>'authority_epoch'
    or current_epoch.baseline_id is distinct from (expected_authority->>'baseline_id')::uuid
    or current_epoch.baseline_hash is distinct from expected_authority->>'baseline_hash'
    or current_epoch.activation_attempt_id is distinct from
      (expected_authority->>'activation_attempt_id')::uuid
    or stage.stage_id is null or stage.target_authority_epoch<>current_epoch.authority_epoch
    or stage.status<>'PROMOTED' or stage.activation_attempt_id<>current_epoch.activation_attempt_id
    or stage.proof_hash<>stage_ref->>'proof_hash'
  then raise exception using errcode='55000',
    message='FALCON24_EPOCH_CLOSURE_FAILURE_NOT_PROVEN'; end if;
  original_document:=app_data_agent.list_provider_execution_profiles_pre_e7();
  observed_document:=app_data_agent.list_provider_execution_profiles();
  select item into original_profile from pg_catalog.jsonb_array_elements(original_document->'profiles') item
    where item->>'model_profile_id'=stage.model_profile_id::text;
  select item into observed_profile from pg_catalog.jsonb_array_elements(observed_document->'profiles') item
    where item->>'model_profile_id'=stage.model_profile_id::text;
  if original_profile is null or observed_profile is null
    or original_profile->>'model_config_version'<>stage.model_config_version::text
    or original_profile->>'execution_profile_hash'<>stage.execution_profile_hash
    or original_profile#>>'{certification_receipt_ref,run_id}'<>stage.certification_run_id::text
    or original_profile#>>'{certification_receipt_ref,artifact_id}'<>stage.certification_artifact_id::text
    or original_profile#>>'{certification_receipt_ref,revision}'<>stage.certification_revision::text
    or original_profile#>>'{certification_receipt_ref,content_hash}'<>stage.certification_content_hash
    or original_profile->>'readiness'<>'AVAILABLE' or original_profile->>'selectable'<>'true'
    or observed_profile->>'readiness'<>'STALE' or observed_profile->>'selectable'<>'false'
  then raise exception using errcode='55000',
    message='FALCON24_EPOCH_CLOSURE_FAILURE_NOT_PROVEN'; end if;
  evidence:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-provider-binding-failure-evidence@1.0.0',
    'authority',expected_authority,'stage_ref',stage_ref,
    'expected_readiness','AVAILABLE','observed_readiness','STALE','observed_selectable',false,
    'profile_binding',pg_catalog.jsonb_build_object(
      'model_profile_id',stage.model_profile_id,'model_config_version',stage.model_config_version,
      'execution_profile_hash',stage.execution_profile_hash,
      'certification_run_id',stage.certification_run_id,
      'certification_artifact_id',stage.certification_artifact_id,
      'certification_revision',stage.certification_revision,
      'certification_content_hash',stage.certification_content_hash));
  evidence_hash:=app_data_agent.u2_canonical_sha256(evidence);
  material:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-epoch-closure-failure-receipt@1.0.0',
    'receipt_id',command->'receipt_id','authority',expected_authority,'stage_ref',stage_ref,
    'failure_class','FROZEN_CLOSURE_CHANGE_REQUIRED',
    'failure_code','PROVIDER_PROFILE_BINDING_NOT_SELECTED',
    'expected_readiness','AVAILABLE','observed_readiness','STALE','observed_selectable',false,
    'evidence_hash',evidence_hash);
  receipt_hash:=app_data_agent.u2_canonical_sha256(material);
  document:=material||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash);
  select * into existing from app_data_agent.falcon24_epoch_closure_failure_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and (row.receipt_id=(command->>'receipt_id')::uuid
        or row.idempotency_key=command->>'idempotency_key');
  if existing.receipt_id is not null then
    if existing.receipt_document<>document or existing.command_hash<>command->>'command_hash'
    then raise exception using errcode='23505',
      message='FALCON24_EPOCH_CLOSURE_FAILURE_IDEMPOTENCY_CONFLICT'; end if;
    return existing.receipt_document;
  end if;
  insert into app_data_agent.falcon24_epoch_closure_failure_receipts(
    app_id,tenant_id,environment,principal_id,receipt_id,idempotency_key,authority_epoch,
    baseline_id,baseline_hash,activation_attempt_id,stage_id,stage_proof_hash,
    failure_class,failure_code,expected_readiness,observed_readiness,observed_selectable,
    evidence_hash,command_hash,receipt_hash,receipt_document)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (command->>'receipt_id')::uuid,command->>'idempotency_key',current_epoch.authority_epoch,
    current_epoch.baseline_id,current_epoch.baseline_hash,current_epoch.activation_attempt_id,
    stage.stage_id,stage.proof_hash,'FROZEN_CLOSURE_CHANGE_REQUIRED',
    'PROVIDER_PROFILE_BINDING_NOT_SELECTED','AVAILABLE','STALE',false,evidence_hash,
    command->>'command_hash',receipt_hash,document);
  return document;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',
    message='FALCON24_EPOCH_CLOSURE_FAILURE_COMMAND_INVALID';
end
$function$;
