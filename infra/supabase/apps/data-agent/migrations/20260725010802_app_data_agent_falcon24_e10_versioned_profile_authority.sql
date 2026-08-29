-- falcon24_e10_versioned_profile_authority_migration_checksum: sha256:54c1fb80b557c8bd59affc5bd1f817e581587cf0ce6b4d1a2a71d8e1a3ba93b4
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010801_app_data_agent_falcon24_e9_current_profile_authority')
    or pg_catalog.to_regprocedure('app_data_agent.activate_falcon24_authority(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.resolve_current_provider_execution_certification(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)') is not null
    or pg_catalog.to_regclass('app_data_agent.falcon24_finalization_failure_receipts') is not null
    or pg_catalog.to_regclass('app_data_agent.falcon24_llm_execution_certification_stage') is null
  then raise exception using errcode='P0001',
    message='FALCON24_E10_VERSIONED_RESOLVER_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10802_history_snapshot(
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
    insert into falcon24_10802_history_snapshot values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
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
alter table app_data_agent.falcon24_finalization_failure_receipts
  owner to data_agent_u6_data_owner;
alter function app_data_agent.reject_falcon24_finalization_failure_mutation()
  owner to data_agent_u6_data_owner;
alter function app_data_agent.load_falcon24_finalization_failure(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_finalization_failure(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority_pre_e10(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;

create policy falcon24_finalization_failure_rpc
on app_data_agent.falcon24_finalization_failure_receipts for all
to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));

grant select,insert,update on table app_data_agent.falcon24_finalization_failure_receipts
  to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.resolve_current_provider_execution_certification(jsonb)
  to data_agent_u6_rpc_owner;

revoke all on function
  app_data_agent.reject_falcon24_finalization_failure_mutation(),
  app_data_agent.activate_falcon24_authority_pre_e10(jsonb),
  app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function
  app_data_agent.load_falcon24_finalization_failure(uuid),
  app_data_agent.record_falcon24_finalization_failure(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function
  app_data_agent.load_falcon24_finalization_failure(uuid),
  app_data_agent.record_falcon24_finalization_failure(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)
  to data_agent_backend;
do $postconditions$
declare relation_name text;schema_name text;table_name text;after_count bigint;after_digest text;
  before_row record;definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_finalization_failure_receipts'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=
        'app_data_agent.falcon24_finalization_failure_receipts'::regclass
        and trigger_row.tgname='falcon24_finalization_failure_immutable'
        and not trigger_row.tgisinternal)
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner','app_data_agent.falcon24_finalization_failure_receipts',
      'SELECT,INSERT,UPDATE')
  then raise exception using errcode='P0001',
    message='FALCON24_E10_FAILURE_STORAGE_POSTCONDITION_FAILED'; end if;
  foreach definition in array array[
    'app_data_agent.load_falcon24_finalization_failure(uuid)',
    'app_data_agent.record_falcon24_finalization_failure(jsonb)',
    'app_data_agent.activate_falcon24_authority(jsonb)',
    'app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)']::text[] loop
    if pg_catalog.to_regprocedure(definition) is null
      or pg_catalog.has_function_privilege('public',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',definition,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',definition,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E10_FUNCTION_SECURITY_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.resolve_current_provider_execution_certification(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'stage.app_id=authority.app_id')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E9_FROZEN_RESOLVER_POSTCONDITION_FAILED'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.resolve_current_provider_execution_certification_v2(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'current-provider-execution-certification@2.0.0')=0
    or pg_catalog.strpos(definition,'numeric<10')=0
    or pg_catalog.strpos(definition,
      'stage_source.activation_attempt_id=current_epoch_row.activation_attempt_id')=0
    or pg_catalog.strpos(definition,'stage.app_id=authority.app_id')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_E10_VERSIONED_RESOLVER_POSTCONDITION_FAILED'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'falcon24-activation-request@7.0.0')=0
    or pg_catalog.strpos(definition,'activate_falcon24_authority_pre_e10(v3_command)')=0
    or pg_catalog.strpos(definition,'predecessor_finalization_failure_receipt')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E10_ACTIVATION_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10802_history_snapshot order by relation_name loop
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
      message='FALCON24_E10_VERSIONED_RESOLVER_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010802_app_data_agent_falcon24_e10_versioned_profile_authority',
  'sha256:54c1fb80b557c8bd59affc5bd1f817e581587cf0ce6b4d1a2a71d8e1a3ba93b4');

commit;
