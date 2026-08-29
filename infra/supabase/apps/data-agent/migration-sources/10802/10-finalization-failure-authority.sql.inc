create table app_data_agent.falcon24_finalization_failure_receipts(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,principal_id uuid not null,
  receipt_id uuid not null,idempotency_key text not null
    check(pg_catalog.length(idempotency_key) between 1 and 256),
  authority_epoch text not null check(authority_epoch='E9'),
  baseline_id uuid not null,baseline_hash text not null
    check(baseline_hash~'^sha256:[0-9a-f]{64}$'),
  activation_attempt_id uuid not null,stage_id uuid not null,
  stage_proof_hash text not null check(stage_proof_hash~'^sha256:[0-9a-f]{64}$'),
  failed_rpc_identity text not null check(
    failed_rpc_identity=
      'app_data_agent.resolve_current_provider_execution_certification(jsonb)'),
  failure_class text not null check(failure_class='FROZEN_CLOSURE_CHANGE_REQUIRED'),
  failure_code text not null check(
    failure_code='CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS'),
  observed_sqlstate text not null check(observed_sqlstate='42702'),
  definition_hash text not null check(definition_hash~'^sha256:[0-9a-f]{64}$'),
  evidence_hash text not null check(evidence_hash~'^sha256:[0-9a-f]{64}$'),
  command_hash text not null check(command_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_document jsonb not null check(pg_catalog.jsonb_typeof(receipt_document)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,receipt_id),
  unique(app_id,tenant_id,environment,idempotency_key),
  unique(app_id,tenant_id,environment,authority_epoch,baseline_id,activation_attempt_id,failure_code),
  foreign key(app_id,tenant_id,environment,stage_id)
    references app_data_agent.falcon24_llm_execution_certification_stage(
      app_id,tenant_id,environment,stage_id) on delete restrict,
  check(receipt_document->>'receipt_hash'=receipt_hash),
  check(receipt_document->>'evidence_hash'=evidence_hash),
  check(receipt_document->>'receipt_id'=receipt_id::text)
);

create function app_data_agent.reject_falcon24_finalization_failure_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',
    message='DA_FALCON24_FINALIZATION_FAILURE_IMMUTABLE';
end
$function$;

create trigger falcon24_finalization_failure_immutable
before update or delete on app_data_agent.falcon24_finalization_failure_receipts
for each row execute function app_data_agent.reject_falcon24_finalization_failure_mutation();

alter table app_data_agent.falcon24_finalization_failure_receipts enable row level security;
alter table app_data_agent.falcon24_finalization_failure_receipts force row level security;

create function app_data_agent.load_falcon24_finalization_failure(requested_receipt_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;
  failure_row app_data_agent.falcon24_finalization_failure_receipts%rowtype;
begin
  if requested_receipt_id is null then raise exception using errcode='22023',
    message='FALCON24_FINALIZATION_FAILURE_ID_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into failure_row from app_data_agent.falcon24_finalization_failure_receipts row_source
    where row_source.app_id=authority.app_id and row_source.tenant_id=authority.tenant_id
      and row_source.environment=authority.environment
      and row_source.principal_id=authority.principal_id
      and row_source.receipt_id=requested_receipt_id;
  if failure_row.receipt_id is null then raise exception using errcode='02000',
    message='FALCON24_FINALIZATION_FAILURE_NOT_FOUND'; end if;
  return failure_row.receipt_document;
end
$function$;

create function app_data_agent.record_falcon24_finalization_failure(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;expected_authority jsonb;stage_ref jsonb;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  certification_stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  existing_failure app_data_agent.falcon24_finalization_failure_receipts%rowtype;
  resolver_command jsonb;resolver_definition text;definition_hash text;
  observed_sqlstate text;evidence jsonb;evidence_hash text;material jsonb;
  receipt_hash text;document jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt_id','idempotency_key','expected_authority','stage_ref','command_hash'
    ]::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-finalization-failure-record@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'receipt_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_FINALIZATION_FAILURE_COMMAND_INVALID'; end if;
  expected_authority:=command->'expected_authority';stage_ref:=command->'stage_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
    or expected_authority->>'schema_version'<>'falcon24-authority-binding@2.0.0'
    or expected_authority->>'authority_epoch'<>'E9'
    or expected_authority->>'baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or not app_data_agent.provider_json_object_has_exact_keys(
      stage_ref,array['stage_id','proof_hash']::text[])
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
    or stage_ref->>'proof_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',
    message='FALCON24_FINALIZATION_FAILURE_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch current_source
    where current_source.app_id=authority.app_id
      and current_source.tenant_id=authority.tenant_id
      and current_source.environment=authority.environment for share;
  select * into certification_stage
    from app_data_agent.falcon24_llm_execution_certification_stage stage_source
    where stage_source.app_id=authority.app_id and stage_source.tenant_id=authority.tenant_id
      and stage_source.environment=authority.environment
      and stage_source.principal_id=authority.principal_id
      and stage_source.stage_id=(stage_ref->>'stage_id')::uuid for share;
  if current_epoch.authority_epoch is distinct from expected_authority->>'authority_epoch'
    or current_epoch.baseline_id is distinct from (expected_authority->>'baseline_id')::uuid
    or current_epoch.baseline_hash is distinct from expected_authority->>'baseline_hash'
    or current_epoch.activation_attempt_id is distinct from
      (expected_authority->>'activation_attempt_id')::uuid
    or certification_stage.stage_id is null
    or certification_stage.target_authority_epoch<>'E9'
    or certification_stage.status<>'PROMOTED'
    or certification_stage.activation_attempt_id<>current_epoch.activation_attempt_id
    or certification_stage.proof_hash<>stage_ref->>'proof_hash'
  then raise exception using errcode='55000',
    message='FALCON24_FINALIZATION_FAILURE_NOT_PROVEN'; end if;
  resolver_command:=pg_catalog.jsonb_build_object(
    'schema_version','current-provider-execution-certification-resolve@1.0.0',
    'model_profile_id',certification_stage.model_profile_id,
    'model_config_version',certification_stage.model_config_version,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',certification_stage.certification_artifact_id,
      'artifact_type','ModelCertificationReceipt','app_id',certification_stage.app_id,
      'tenant_id',certification_stage.tenant_id,
      'environment',certification_stage.environment,
      'run_id',certification_stage.certification_run_id,
      'revision',certification_stage.certification_revision,
      'content_hash',certification_stage.certification_content_hash));
  observed_sqlstate:=null;
  begin
    perform app_data_agent.resolve_current_provider_execution_certification(resolver_command);
  exception when ambiguous_column then
    observed_sqlstate:=sqlstate;
  end;
  if observed_sqlstate is distinct from '42702' then raise exception using errcode='55000',
    message='FALCON24_FINALIZATION_FAILURE_NOT_PROVEN'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.resolve_current_provider_execution_certification(jsonb)'::regprocedure)
    into strict resolver_definition;
  definition_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'rpc_identity','app_data_agent.resolve_current_provider_execution_certification(jsonb)',
    'definition',resolver_definition));
  evidence:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-finalization-failure-evidence@1.0.0',
    'authority',expected_authority,'stage_ref',stage_ref,
    'failed_rpc_identity',
      'app_data_agent.resolve_current_provider_execution_certification(jsonb)',
    'resolver_command_hash',app_data_agent.u2_canonical_sha256(resolver_command),
    'observed_sqlstate',observed_sqlstate,'definition_hash',definition_hash);
  evidence_hash:=app_data_agent.u2_canonical_sha256(evidence);
  material:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-finalization-failure-receipt@1.0.0',
    'receipt_id',command->'receipt_id','authority',expected_authority,'stage_ref',stage_ref,
    'failed_rpc_identity',
      'app_data_agent.resolve_current_provider_execution_certification(jsonb)',
    'failure_class','FROZEN_CLOSURE_CHANGE_REQUIRED',
    'failure_code','CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS',
    'observed_sqlstate',observed_sqlstate,'definition_hash',definition_hash,
    'evidence_hash',evidence_hash);
  receipt_hash:=app_data_agent.u2_canonical_sha256(material);
  document:=material||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash);
  select * into existing_failure
    from app_data_agent.falcon24_finalization_failure_receipts existing_source
    where existing_source.app_id=authority.app_id
      and existing_source.tenant_id=authority.tenant_id
      and existing_source.environment=authority.environment
      and (existing_source.receipt_id=(command->>'receipt_id')::uuid
        or existing_source.idempotency_key=command->>'idempotency_key');
  if existing_failure.receipt_id is not null then
    if existing_failure.receipt_document<>document
      or existing_failure.command_hash<>command->>'command_hash'
    then raise exception using errcode='23505',
      message='FALCON24_FINALIZATION_FAILURE_IDEMPOTENCY_CONFLICT'; end if;
    return existing_failure.receipt_document;
  end if;
  insert into app_data_agent.falcon24_finalization_failure_receipts(
    app_id,tenant_id,environment,principal_id,receipt_id,idempotency_key,authority_epoch,
    baseline_id,baseline_hash,activation_attempt_id,stage_id,stage_proof_hash,
    failed_rpc_identity,failure_class,failure_code,observed_sqlstate,definition_hash,
    evidence_hash,command_hash,receipt_hash,receipt_document)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (command->>'receipt_id')::uuid,command->>'idempotency_key',current_epoch.authority_epoch,
    current_epoch.baseline_id,current_epoch.baseline_hash,current_epoch.activation_attempt_id,
    certification_stage.stage_id,certification_stage.proof_hash,
    'app_data_agent.resolve_current_provider_execution_certification(jsonb)',
    'FROZEN_CLOSURE_CHANGE_REQUIRED',
    'CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS',observed_sqlstate,definition_hash,
    evidence_hash,command->>'command_hash',receipt_hash,document);
  return document;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',
    message='FALCON24_FINALIZATION_FAILURE_COMMAND_INVALID';
end
$function$;
