alter function app_data_agent.activate_falcon24_authority(jsonb)
  rename to activate_falcon24_authority_pre_e12;

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
  failed_attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  failed_turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;
  predecessor_baseline app_data_agent.falcon24_authority_baselines%rowtype;
  existing_recovery app_data_agent.falcon24_retained_recovery_activation_receipts%rowtype;
  field_name text;terminal jsonb;business jsonb;qa jsonb;trace jsonb;failed_stage_code text;
  result_document jsonb;expected_release jsonb;versions jsonb;
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
      'falcon24-activation-request@6.0.0','falcon24-activation-request@7.0.0') then
    if app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch') is true
      and pg_catalog.substr(command->>'authority_epoch',2)::numeric>=12
    then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_RECOVERY_PROTOCOL_REQUIRED'; end if;
    return app_data_agent.activate_falcon24_authority_pre_e12(command);
  end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','scope','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'expected_current_authority','expected_semantic_release','expected_versions',
      'retained_semantic_proof_hash','predecessor_four_layer_failure_receipt',
      'llm_execution_stage_ref','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-activation-request@8.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch') is distinct from true
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric<12
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or ((command->>'expected_baseline_hash')~'^sha256:[0-9a-f]{64}$') is distinct from true
    or ((command->>'retained_semantic_proof_hash')~'^sha256:[0-9a-f]{64}$') is distinct from true
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command) is distinct from false
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_RECOVERY_ACTIVATION_INVALID'; end if;
  scope_json:=command->'scope';expected_authority:=command->'expected_current_authority';
  expected_release:=command->'expected_semantic_release';versions:=command->'expected_versions';
  failure_ref:=command->'predecessor_four_layer_failure_receipt';stage_ref:=command->'llm_execution_stage_ref';
  if app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'app_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'tenant_id') is distinct from true
    or ((scope_json->>'environment')~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') is distinct from true
    or ((scope_json->>'semantic_domain')~'^[A-Za-z_][A-Za-z0-9_]{0,63}$') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[]) is distinct from true
    or expected_authority->>'schema_version' is distinct from 'falcon24-authority-binding@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(expected_authority->>'authority_epoch') is distinct from true
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric is distinct from
      pg_catalog.substr(expected_authority->>'authority_epoch',2)::numeric+1
    or app_data_agent.canonical_uuid_json_string_is_valid(expected_authority->'baseline_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(expected_authority->'activation_attempt_id') is distinct from true
    or ((expected_authority->>'baseline_hash')~'^sha256:[0-9a-f]{64}$') is distinct from true
    or command->>'baseline_id'=expected_authority->>'baseline_id'
    or command->>'attempt_id'=expected_authority->>'activation_attempt_id'
    or app_data_agent.provider_json_object_has_exact_keys(expected_release,array[
      'release_id','generation','release_digest','datasource_id']::text[]) is distinct from true
    or expected_release->'generation' is distinct from '2'::jsonb
    or app_data_agent.canonical_uuid_json_string_is_valid(expected_release->'release_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(expected_release->'datasource_id') is distinct from true
    or ((expected_release->>'release_digest')~'^sha256:[0-9a-f]{64}$') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(versions,array[
      'semantic_pointer','semantic_runtime','workspace_defaults']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(versions) entry
      where pg_catalog.jsonb_typeof(entry.value) is distinct from 'number'
        or ((entry.value#>>'{}')~'^[1-9][0-9]*$') is distinct from true
        or (entry.value#>>'{}')::numeric>9007199254740991)
    or app_data_agent.provider_json_object_has_exact_keys(failure_ref,array[
      'attempt_id','manifest_hash','turn_ordinal','run_id','receipt_hash','failure_code']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(failure_ref->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(failure_ref->'run_id') is distinct from true
    or ((failure_ref->>'manifest_hash')~'^sha256:[0-9a-f]{64}$') is distinct from true
    or ((failure_ref->>'receipt_hash')~'^sha256:[0-9a-f]{64}$') is distinct from true
    or ((failure_ref->>'failure_code')~'^[A-Z][A-Z0-9_]{2,127}$') is distinct from true
    or pg_catalog.jsonb_typeof(failure_ref->'turn_ordinal') is distinct from 'number'
    or ((failure_ref->>'turn_ordinal')~'^(0|[1-9][0-9]*)$') is distinct from true
    or (failure_ref->>'turn_ordinal')::numeric not between 0 and 14
    or app_data_agent.provider_json_object_has_exact_keys(stage_ref,array['stage_id','proof_hash']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
    or ((stage_ref->>'proof_hash')~'^sha256:[0-9a-f]{64}$') is distinct from true
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_RECOVERY_ACTIVATION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',
    message='FALCON24_FOUR_LAYER_RECOVERY_SCOPE_FORBIDDEN'; end if;

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
  select * into predecessor_baseline from app_data_agent.falcon24_authority_baselines predecessor_source
    where predecessor_source.app_id=authority.app_id and predecessor_source.tenant_id=authority.tenant_id
      and predecessor_source.environment=authority.environment
      and predecessor_source.baseline_id=(expected_authority->>'baseline_id')::uuid for share;
  select * into failed_attempt
    from app_data_agent.falcon24_four_layer_gate_attempts failure_source
    where failure_source.app_id=authority.app_id and failure_source.tenant_id=authority.tenant_id
      and failure_source.environment=authority.environment and failure_source.principal_id=authority.principal_id
      and failure_source.attempt_id=(failure_ref->>'attempt_id')::uuid for share;
  select * into failed_turn from app_data_agent.falcon24_four_layer_gate_turns turn_source
    where turn_source.app_id=authority.app_id and turn_source.tenant_id=authority.tenant_id
      and turn_source.environment=authority.environment and turn_source.principal_id=authority.principal_id
      and turn_source.attempt_id=failed_attempt.attempt_id
      and turn_source.turn_ordinal=(failure_ref->>'turn_ordinal')::integer for share;
  select * into existing_recovery from app_data_agent.falcon24_retained_recovery_activation_receipts recovery_source
    where recovery_source.app_id=authority.app_id and recovery_source.tenant_id=authority.tenant_id
      and recovery_source.environment=authority.environment
      and recovery_source.activation_attempt_id=(command->>'attempt_id')::uuid;
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

  is_replay:=(current_epoch_row.authority_epoch=command->>'authority_epoch'
    and current_epoch_row.baseline_id=(command->>'baseline_id')::uuid
    and current_epoch_row.baseline_hash=command->>'expected_baseline_hash'
    and current_epoch_row.activation_attempt_id=(command->>'attempt_id')::uuid) is true;
  if not is_replay and (
      current_epoch_row.authority_epoch is distinct from expected_authority->>'authority_epoch'
      or current_epoch_row.baseline_id is distinct from
        (expected_authority->>'baseline_id')::uuid
      or current_epoch_row.baseline_hash is distinct from expected_authority->>'baseline_hash'
      or current_epoch_row.activation_attempt_id is distinct from
        (expected_authority->>'activation_attempt_id')::uuid)
  then raise exception using errcode='40001',
    message='FALCON24_FOUR_LAYER_RECOVERY_PREDECESSOR_MISMATCH'; end if;
  if (is_replay and existing_recovery.activation_attempt_id is null)
    or (not is_replay and existing_recovery.activation_attempt_id is not null)
    or (existing_recovery.activation_attempt_id is not null and (
      existing_recovery.principal_id is distinct from authority.principal_id
      or existing_recovery.command_hash is distinct from command->>'command_hash'
      or existing_recovery.command_document is distinct from command
      or existing_recovery.result_hash is distinct from app_data_agent.u2_canonical_sha256(existing_recovery.result_document)))
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_REPLAY_CONFLICT'; end if;
  if failed_attempt.status is distinct from 'FAILED' or failed_turn.status is distinct from 'FAILED'
    or failed_attempt.first_failure_turn_ordinal is distinct from (failure_ref->>'turn_ordinal')::integer
    or failed_attempt.first_failure_run_id is distinct from (failure_ref->>'run_id')::uuid
    or failed_attempt.first_failure_code is distinct from failure_ref->>'failure_code'
    or failed_attempt.manifest_hash is distinct from failure_ref->>'manifest_hash'
    or failed_attempt.manifest_hash is distinct from app_data_agent.u2_canonical_sha256(failed_attempt.manifest_document-'manifest_hash')
    or failed_attempt.authority_epoch is distinct from expected_authority->>'authority_epoch'
    or failed_attempt.authority_baseline_id is distinct from (expected_authority->>'baseline_id')::uuid
    or failed_attempt.authority_baseline_hash is distinct from expected_authority->>'baseline_hash'
    or failed_attempt.authority_activation_attempt_id is distinct from (expected_authority->>'activation_attempt_id')::uuid
    or predecessor_baseline.status is distinct from 'ACTIVE'
    or predecessor_baseline.baseline_hash is distinct from expected_authority->>'baseline_hash'
    or predecessor_baseline.activation_attempt_id is distinct from (expected_authority->>'activation_attempt_id')::uuid
    or failed_attempt.source_commit is distinct from predecessor_baseline.source_commit
    or failed_attempt.web_build_hash is distinct from predecessor_baseline.web_build_hash
    or failed_attempt.semantic_release_hash is distinct from expected_release->>'release_digest'
    or failed_turn.run_id is distinct from failed_attempt.first_failure_run_id
    or failed_turn.terminal_receipt_hash is distinct from failure_ref->>'receipt_hash'
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_RECEIPT_MISMATCH'; end if;
  foreach field_name in array array[
    'gate_id','attempt_id','authority_epoch','authority_baseline_id','authority_baseline_hash',
    'authority_activation_attempt_id','source_commit','worker_build_hash','worker_generation_hash',
    'web_build_hash','web_generation_hash','semantic_release_hash','datasource_binding_hash',
    'model_config_hash','runtime_attestation_hash','manifest_hash']::text[] loop
    if pg_catalog.to_jsonb(failed_attempt)->field_name is distinct from failed_attempt.manifest_document->field_name
    then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_RECEIPT_MISMATCH'; end if;
  end loop;
  foreach field_name in array array['turn_id','layer','scenario_id','scenario_turn_index','question_hash']::text[] loop
    if pg_catalog.to_jsonb(failed_turn)->field_name is distinct from
      (failed_attempt.manifest_document->'turns'->failed_turn.turn_ordinal)->field_name
    then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_RECEIPT_MISMATCH'; end if;
  end loop;
  terminal:=failed_turn.terminal_receipt;business:=failed_turn.business_receipt;
  qa:=failed_turn.qa_ui_receipt;trace:=failed_turn.trace_ui_receipt;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(pg_catalog.to_jsonb(failed_attempt),
      pg_catalog.to_jsonb(failed_turn),terminal,'falcon24-four-layer-turn-terminal-receipt@1.0.0',false) is distinct from true
    or terminal->>'status' is distinct from 'FAILED'
    or terminal->>'failure_code' is distinct from failure_ref->>'failure_code'
    or terminal->>'receipt_hash' is distinct from failed_turn.terminal_receipt_hash
    or terminal->>'business_receipt_hash' is distinct from failed_turn.business_receipt_hash
    or terminal->'qa_ui_receipt_hash' is distinct from coalesce(pg_catalog.to_jsonb(failed_turn.qa_ui_receipt_hash),'null'::jsonb)
    or terminal->'trace_ui_receipt_hash' is distinct from coalesce(pg_catalog.to_jsonb(failed_turn.trace_ui_receipt_hash),'null'::jsonb)
    or app_data_agent.falcon24_four_layer_receipt_identity_matches(pg_catalog.to_jsonb(failed_attempt),
      pg_catalog.to_jsonb(failed_turn),business,'falcon24-four-layer-business-receipt@1.0.0',false) is distinct from true
    or business->>'receipt_hash' is distinct from failed_turn.business_receipt_hash
    or (qa is null) is distinct from (failed_turn.qa_ui_receipt_hash is null)
    or (trace is null) is distinct from (failed_turn.trace_ui_receipt_hash is null)
    or (qa is not null and (app_data_agent.falcon24_four_layer_receipt_identity_matches(pg_catalog.to_jsonb(failed_attempt),
      pg_catalog.to_jsonb(failed_turn),qa,'falcon24-four-layer-qa-ui-receipt@1.0.0',true) is distinct from true
      or qa->>'receipt_hash' is distinct from failed_turn.qa_ui_receipt_hash
      or qa->>'answer_hash' is distinct from business->>'answer_hash'))
    or (trace is not null and (app_data_agent.falcon24_four_layer_receipt_identity_matches(pg_catalog.to_jsonb(failed_attempt),
      pg_catalog.to_jsonb(failed_turn),trace,'falcon24-four-layer-trace-ui-receipt@1.0.0',true) is distinct from true
      or trace->>'receipt_hash' is distinct from failed_turn.trace_ui_receipt_hash
      or trace->>'public_event_hash' is distinct from business->>'public_event_hash'
      or trace->>'accepted_artifact_refs_hash' is distinct from app_data_agent.u2_canonical_sha256(business->'accepted_artifact_refs')))
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_RECEIPT_MISMATCH'; end if;
  failed_stage_code:=case
    when business->>'status'='FAIL' and qa is null and trace is null then business->>'failure_code'
    when business->>'status'='PASS' and qa->>'status'='FAIL' and trace is null then qa->>'failure_code'
    when business->>'status'='PASS' and qa->>'status'='PASS' and trace->>'status'='FAIL' then trace->>'failure_code'
    else null end;
  if failed_stage_code is distinct from failure_ref->>'failure_code'
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_RECEIPT_MISMATCH'; end if;
  if candidate_stage.stage_id is null or certification_artifact.artifact_id is null
    or certification_artifact.artifact_type is distinct from 'ModelCertificationReceipt'
    or candidate_stage.target_authority_epoch is distinct from command->>'authority_epoch'
    or target_baseline_row.baseline_id is null or llm_receipt_row.staging_id is null
    or candidate_stage.staging_id is distinct from target_baseline_row.staging_id
    or candidate_stage.proof_hash is distinct from stage_ref->>'proof_hash'
    or candidate_stage.proof_document->>'proof_hash' is distinct from candidate_stage.proof_hash
    or candidate_stage.proof_hash is distinct from app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','falcon24-llm-execution-authority-proof@1.0.0','proof',candidate_stage.proof_document-'proof_hash'))
    or llm_receipt_row.evidence_hash is distinct from candidate_stage.proof_hash
    or llm_receipt_row.subject_hash is distinct from candidate_stage.model_resource_hash
    or (not is_replay and (candidate_stage.status is distinct from 'STAGED'
      or certification_artifact.is_active is distinct from false or candidate_stage.activation_attempt_id is not null))
    or (is_replay and (candidate_stage.status is distinct from 'PROMOTED'
      or certification_artifact.is_active is distinct from true
      or candidate_stage.activation_attempt_id is distinct from (command->>'attempt_id')::uuid))
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_LLM_STAGE_MISMATCH'; end if;
  if catalog_row.model_profile_id is null or catalog_row.status is distinct from 'ACTIVE'
    or catalog_row.is_system_default is distinct from true or model_revision_row.model_profile_id is null
    or platform.canonical_sha256(model_revision_row.snapshot) is distinct from candidate_stage.model_resource_hash
    or deployment_row.deployment_id is null or deployment_row.is_active is distinct from true
    or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'deployment_id',deployment_row.deployment_id,'app_id',deployment_row.app_id,
      'environment',deployment_row.environment,'deployment_key_hash',deployment_row.deployment_key_hash))
      is distinct from candidate_stage.deployment_hash
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_LLM_CATALOG_DRIFT'; end if;
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
      message='FALCON24_FOUR_LAYER_RECOVERY_STAGE_PROMOTION_RACE'; end if;
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
      message='FALCON24_FOUR_LAYER_RECOVERY_CERTIFICATION_PROMOTION_RACE'; end if;
  end if;
  v3_command:=(command-array[
    'predecessor_four_layer_failure_receipt','llm_execution_stage_ref','command_hash'])
    ||pg_catalog.jsonb_build_object('schema_version','falcon24-activation-request@3.0.0');
  v3_command:=v3_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(v3_command));
  authority_document:=app_data_agent.activate_falcon24_authority_pre_e10(v3_command);
  result_document:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-retained-activation-result@8.0.0',
    'activation_command_hash',command->>'command_hash','authority',authority_document,
    'predecessor_four_layer_failure_receipt',failure_ref,
    'llm_execution_certification',pg_catalog.jsonb_build_object(
      'stage_id',candidate_stage.stage_id,'proof_hash',candidate_stage.proof_hash,
      'certification_receipt_ref',candidate_stage.proof_document->'certification_receipt_ref',
      'execution_profile_hash',candidate_stage.execution_profile_hash));
  if is_replay then
    if existing_recovery.result_document is distinct from result_document
    then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RECOVERY_REPLAY_CONFLICT'; end if;
    return existing_recovery.result_document;
  end if;
  insert into app_data_agent.falcon24_retained_recovery_activation_receipts(
    app_id,tenant_id,environment,principal_id,activation_attempt_id,predecessor_attempt_id,
    command_hash,command_document,result_hash,result_document)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (command->>'attempt_id')::uuid,failed_attempt.attempt_id,command->>'command_hash',command,
    app_data_agent.u2_canonical_sha256(result_document),result_document);
  return result_document;
exception when invalid_text_representation or numeric_value_out_of_range or no_data_found then
  raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_RECOVERY_ACTIVATION_INVALID';
end
$function$;
