-- falcon24_e8_provider_binding_migration_checksum: sha256:f388b153ccc9264b5f68fb4b7d718860331370ce144625ffd2bb24c61f66e307
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010799_app_data_agent_falcon24_e7_recovery_authority')
    or pg_catalog.to_regprocedure('app_data_agent.activate_falcon24_authority(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.list_provider_execution_profiles()') is null
    or pg_catalog.to_regprocedure('app_data_agent.list_provider_execution_profiles_pre_e7()') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_llm_execution_certification_stage') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_epoch_closure_failure_receipts') is not null
  then raise exception using errcode='P0001',
    message='FALCON24_E8_PROVIDER_BINDING_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10800_history_snapshot(
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
    'app_data_agent.falcon24_qualifications','app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.runs','app_data_agent.run_events','app_data_agent.artifacts',
    'app_data_agent.falcon24_llm_execution_certification_stage'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10800_history_snapshot values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create table app_data_agent.falcon24_epoch_closure_failure_receipts(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,principal_id uuid not null,
  receipt_id uuid not null,idempotency_key text not null
    check(pg_catalog.length(idempotency_key) between 1 and 256),
  authority_epoch text not null check(
    app_data_agent.falcon24_authority_epoch_is_canonical(authority_epoch)
    and pg_catalog.substr(authority_epoch,2)::numeric>=7),
  baseline_id uuid not null,baseline_hash text not null
    check(baseline_hash~'^sha256:[0-9a-f]{64}$'),
  activation_attempt_id uuid not null,stage_id uuid not null,
  stage_proof_hash text not null check(stage_proof_hash~'^sha256:[0-9a-f]{64}$'),
  failure_class text not null check(failure_class='FROZEN_CLOSURE_CHANGE_REQUIRED'),
  failure_code text not null check(failure_code='PROVIDER_PROFILE_BINDING_NOT_SELECTED'),
  expected_readiness text not null check(expected_readiness='AVAILABLE'),
  observed_readiness text not null check(observed_readiness='STALE'),
  observed_selectable boolean not null check(not observed_selectable),
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

create function app_data_agent.reject_falcon24_epoch_closure_failure_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',
    message='DA_FALCON24_EPOCH_CLOSURE_FAILURE_IMMUTABLE';
end
$function$;

create trigger falcon24_epoch_closure_failure_immutable
before update or delete on app_data_agent.falcon24_epoch_closure_failure_receipts
for each row execute function app_data_agent.reject_falcon24_epoch_closure_failure_mutation();

alter table app_data_agent.falcon24_epoch_closure_failure_receipts enable row level security;
alter table app_data_agent.falcon24_epoch_closure_failure_receipts force row level security;
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
alter function app_data_agent.list_provider_execution_profiles()
  rename to list_provider_execution_profiles_pre_e8;

create function app_data_agent.list_provider_execution_profiles()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  document jsonb;profile jsonb;profiles jsonb:='[]'::jsonb;matches_stage boolean;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
  then raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  if current_epoch.authority_epoch is null
    or pg_catalog.substr(current_epoch.authority_epoch,2)::numeric<8
  then return app_data_agent.list_provider_execution_profiles_pre_e8(); end if;
  document:=app_data_agent.list_provider_execution_profiles_pre_e7();
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.target_authority_epoch=current_epoch.authority_epoch
      and current_epoch.activation_attempt_id=row.activation_attempt_id
      and row.status='PROMOTED';
  for profile in select item from pg_catalog.jsonb_array_elements(document->'profiles') item loop
    matches_stage:=stage.stage_id is not null
      and profile->>'model_profile_id'=stage.model_profile_id::text
      and profile->>'model_config_version'=stage.model_config_version::text
      and profile->>'execution_profile_hash'=stage.execution_profile_hash
      and profile#>>'{certification_receipt_ref,run_id}'=stage.certification_run_id::text
      and profile#>>'{certification_receipt_ref,artifact_id}'=stage.certification_artifact_id::text
      and profile#>>'{certification_receipt_ref,revision}'=stage.certification_revision::text
      and profile#>>'{certification_receipt_ref,content_hash}'=stage.certification_content_hash;
    if profile->>'readiness'='AVAILABLE' and not matches_stage then
      profile:=(profile-array['adapter_version','certification_receipt_ref',
        'execution_profile_hash','recovery_capabilities','connection',
        'effective_context_ceiling_tokens','effective_output_ceiling_tokens'])
        ||pg_catalog.jsonb_build_object(
          'readiness','STALE','selectable',false,'unavailable_reason','MODEL_PROFILE_STALE');
    end if;
    profiles:=profiles||pg_catalog.jsonb_build_array(profile);
  end loop;
  return pg_catalog.jsonb_set(document,'{profiles}',profiles,false);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='P0001',message='PROVIDER_EXECUTION_PROFILE_LIST_INVALID';
end
$function$;
alter table app_data_agent.falcon24_epoch_closure_failure_receipts
  owner to data_agent_u6_data_owner;
alter function app_data_agent.reject_falcon24_epoch_closure_failure_mutation()
  owner to data_agent_u6_data_owner;
alter function app_data_agent.load_falcon24_epoch_closure_failure(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_epoch_closure_failure(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority_pre_e8(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.list_provider_execution_profiles_pre_e8()
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.list_provider_execution_profiles()
  owner to data_agent_provider_invocation_rpc_owner;

create policy falcon24_epoch_closure_failure_rpc
on app_data_agent.falcon24_epoch_closure_failure_receipts for all
to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));

-- SELECT ... FOR SHARE requires UPDATE privilege even though the immutable
-- trigger rejects every actual UPDATE/DELETE attempt.
grant select,insert,update on table app_data_agent.falcon24_epoch_closure_failure_receipts
  to data_agent_u6_rpc_owner;
grant execute on function
  app_data_agent.list_provider_execution_profiles_pre_e7(),
  app_data_agent.list_provider_execution_profiles()
  to data_agent_u6_rpc_owner;

revoke all on function
  app_data_agent.reject_falcon24_epoch_closure_failure_mutation(),
  app_data_agent.activate_falcon24_authority_pre_e8(jsonb),
  app_data_agent.list_provider_execution_profiles_pre_e8()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function
  app_data_agent.load_falcon24_epoch_closure_failure(uuid),
  app_data_agent.record_falcon24_epoch_closure_failure(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.list_provider_execution_profiles()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function
  app_data_agent.load_falcon24_epoch_closure_failure(uuid),
  app_data_agent.record_falcon24_epoch_closure_failure(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.list_provider_execution_profiles()
  to data_agent_backend;
do $postconditions$
declare relation_name text;schema_name text;table_name text;after_count bigint;after_digest text;
  before_row record;definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_epoch_closure_failure_receipts'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=
        'app_data_agent.falcon24_epoch_closure_failure_receipts'::regclass
        and trigger_row.tgname='falcon24_epoch_closure_failure_immutable'
        and not trigger_row.tgisinternal)
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      'app_data_agent.falcon24_epoch_closure_failure_receipts',
      'SELECT,INSERT,UPDATE')
  then raise exception using errcode='P0001',
    message='FALCON24_E8_CLOSURE_FAILURE_STORAGE_POSTCONDITION_FAILED'; end if;
  foreach definition in array array[
    'app_data_agent.load_falcon24_epoch_closure_failure(uuid)',
    'app_data_agent.record_falcon24_epoch_closure_failure(jsonb)',
    'app_data_agent.activate_falcon24_authority(jsonb)',
    'app_data_agent.list_provider_execution_profiles()']::text[] loop
    if pg_catalog.to_regprocedure(definition) is null
      or pg_catalog.has_function_privilege('public',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',definition,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',definition,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E8_FUNCTION_SECURITY_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_provider_execution_profiles()'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'list_provider_execution_profiles_pre_e8()')=0
    or pg_catalog.strpos(definition,'numeric<8')=0
    or pg_catalog.strpos(definition,
      'current_epoch.activation_attempt_id=row.activation_attempt_id')=0
    or pg_catalog.strpos(definition,
      'current_epoch.activation_attempt_id=stage.activation_attempt_id')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_E8_PROVIDER_DISPATCH_POSTCONDITION_FAILED'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_provider_execution_profiles_pre_e8()'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,
      'current_epoch.activation_attempt_id=stage.activation_attempt_id')=0
  then raise exception using errcode='P0001',
    message='FALCON24_E7_FROZEN_PROVIDER_READER_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10800_history_snapshot order by relation_name loop
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
      message='FALCON24_E8_PROVIDER_BINDING_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010800_app_data_agent_falcon24_e8_provider_binding',
  'sha256:f388b153ccc9264b5f68fb4b7d718860331370ce144625ffd2bb24c61f66e307');

commit;
