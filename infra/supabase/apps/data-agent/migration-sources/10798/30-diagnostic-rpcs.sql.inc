alter function app_data_agent.begin_falcon24_diagnostic(jsonb)
  rename to begin_falcon24_diagnostic_e4_history;
alter function app_data_agent.complete_falcon24_diagnostic(jsonb)
  rename to complete_falcon24_diagnostic_e4_history;

create function app_data_agent.begin_falcon24_diagnostic(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;manifest jsonb;semantic_release jsonb;semantic_domain_value text;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  source_release semantic.semantic_source_release%rowtype;
  existing app_data_agent.falcon24_diagnostic_attempts%rowtype;
begin
  if command->>'schema_version'='falcon24-diagnostic-begin@1.0.0'
  then return app_data_agent.begin_falcon24_diagnostic_e4_history(command); end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-diagnostic-begin@2.0.0'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';semantic_release:=manifest->'semantic_release';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','attempt_id','run_id','authority','semantic_release','source_commit',
      'source_fingerprint','web_build','worker_build','runtime_attestation_hash','question',
      'question_hash','manifest_hash']::text[]) is distinct from true
    or manifest->>'schema_version'<>'falcon24-diagnostic-attempt@2.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'run_id') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(manifest->'authority',array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
      is distinct from true
    or manifest#>>'{authority,schema_version}'<>'falcon24-authority-binding@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(
      manifest#>>'{authority,authority_epoch}') is distinct from true
    or pg_catalog.substr(manifest#>>'{authority,authority_epoch}',2)::numeric<5
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest#>'{authority,baseline_id}')
      is distinct from true
    or manifest#>>'{authority,baseline_hash}'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest#>'{authority,activation_attempt_id}') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(semantic_release,array[
      'release_id','generation','release_digest','datasource_id']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(semantic_release->'release_id')
      is distinct from true
    or semantic_release->>'generation'<>'2'
    or semantic_release->>'release_digest'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(semantic_release->'datasource_id')
      is distinct from true
    or manifest->>'source_commit'!~'^[0-9a-f]{40}$'
    or manifest->>'source_fingerprint'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.provider_json_object_has_exact_keys(manifest->'web_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(manifest->'worker_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.unnest(array[
      manifest#>>'{web_build,build_id}',manifest#>>'{web_build,generation_id}',
      manifest#>>'{worker_build,build_id}',manifest#>>'{worker_build,generation_id}',
      manifest->>'runtime_attestation_hash']::text[]) value
      where value!~'^sha256:[0-9a-f]{64}$')
    or manifest->>'question'<>'最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。'
    or manifest->>'question_hash' is distinct from
      app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(manifest->>'question'))
    or manifest->>'manifest_hash' is distinct from
      app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
  then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_MANIFEST_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  semantic_domain_value:=nullif(pg_catalog.current_setting('app.semantic_domain',true),'');
  if semantic_domain_value is null
  then raise exception using errcode='42501',message='FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-diagnostic:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  select * into baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=current_epoch.baseline_id
      and row.baseline_hash=current_epoch.baseline_hash
      and row.authority_epoch=current_epoch.authority_epoch for share;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=semantic_domain_value for share;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=semantic_domain_value for share;
  select * into defaults_pointer from app_data_agent.workspace_run_defaults row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  select * into defaults_revision from app_data_agent.workspace_run_default_revisions row
    where row.app_id=defaults_pointer.app_id and row.tenant_id=defaults_pointer.tenant_id
      and row.environment=defaults_pointer.environment and row.defaults_id=defaults_pointer.defaults_id
      and row.defaults_revision=defaults_pointer.defaults_revision
      and row.revision_id=defaults_pointer.revision_id and row.defaults_hash=defaults_pointer.defaults_hash
    for share;
  select * into source_release from semantic.semantic_source_release row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=semantic_domain_value
      and row.release_id=(semantic_release->>'release_id')::uuid;
  if current_epoch.authority_epoch is distinct from manifest#>>'{authority,authority_epoch}'
    or pg_catalog.substr(current_epoch.authority_epoch,2)::numeric<5
    or current_epoch.baseline_id is distinct from (manifest#>>'{authority,baseline_id}')::uuid
    or current_epoch.baseline_hash is distinct from manifest#>>'{authority,baseline_hash}'
    or current_epoch.activation_attempt_id is distinct from
      (manifest#>>'{authority,activation_attempt_id}')::uuid
    or baseline.status is distinct from 'ACTIVE'
    or baseline.source_commit is distinct from manifest->>'source_commit'
    or baseline.web_build_hash is distinct from manifest#>>'{web_build,build_id}'
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH'; end if;
  if source_release.release_generation is distinct from 2
    or source_release.release_digest is distinct from semantic_release->>'release_digest'
    or pointer.current_release_id is distinct from source_release.release_id
    or pointer.current_release_generation is distinct from 2
    or pointer.current_release_digest is distinct from source_release.release_digest
    or runtime.current_release_id is distinct from source_release.release_id
    or runtime.current_release_generation is distinct from 2
    or defaults_revision.defaults_json#>>'{semantic_release,resource_id}'
      is distinct from source_release.release_id::text
    or defaults_revision.defaults_json#>>'{semantic_release,resource_revision}' is distinct from '2'
    or defaults_revision.defaults_json#>>'{semantic_release,resource_hash}'
      is distinct from source_release.release_digest
    or not exists(select 1 from semantic.semantic_relationship_projection row
      where row.app_id=source_release.app_id and row.tenant_id=source_release.tenant_id
        and row.environment=source_release.environment and row.semantic_domain=source_release.semantic_domain
        and row.release_id=source_release.release_id
        and row.datasource_id=(semantic_release->>'datasource_id')::uuid)
  then raise exception using errcode='55000',
    message='FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_MISMATCH'; end if;
  if exists(select 1 from app_data_agent.falcon24_qualifications row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=current_epoch.authority_epoch)
  then raise exception using errcode='55000',
    message='FALCON24_DIAGNOSTIC_FORMAL_GATE_ALREADY_STARTED'; end if;
  select * into existing from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=(manifest->>'attempt_id')::uuid;
  if found then
    if existing.manifest_hash=manifest->>'manifest_hash' then return pg_catalog.to_jsonb(existing); end if;
    raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE';
  end if;
  if exists(select 1 from app_data_agent.falcon24_diagnostic_attempts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_baseline_id=current_epoch.baseline_id
        and row.semantic_release_id=source_release.release_id and row.status='ACTIVE')
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_ACTIVE_ATTEMPT_EXISTS'; end if;
  insert into app_data_agent.falcon24_diagnostic_attempts(
    app_id,tenant_id,environment,principal_id,attempt_id,run_id,authority_epoch,
    authority_baseline_id,authority_baseline_hash,authority_activation_attempt_id,
    semantic_domain,semantic_release_id,semantic_release_generation,semantic_release_digest,
    datasource_id,source_commit,source_fingerprint,web_build_id,web_generation_id,
    worker_build_id,worker_generation_id,runtime_attestation_hash,question_hash,
    manifest_hash,manifest_document,status)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (manifest->>'attempt_id')::uuid,(manifest->>'run_id')::uuid,current_epoch.authority_epoch,
    current_epoch.baseline_id,current_epoch.baseline_hash,current_epoch.activation_attempt_id,
    semantic_domain_value,source_release.release_id,2,source_release.release_digest,
    (semantic_release->>'datasource_id')::uuid,manifest->>'source_commit',
    manifest->>'source_fingerprint',manifest#>>'{web_build,build_id}',
    manifest#>>'{web_build,generation_id}',manifest#>>'{worker_build,build_id}',
    manifest#>>'{worker_build,generation_id}',manifest->>'runtime_attestation_hash',
    manifest->>'question_hash',manifest->>'manifest_hash',manifest,'ACTIVE')
  returning * into strict existing;
  return pg_catalog.to_jsonb(existing);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_MANIFEST_INVALID';
end
$function$;

create function app_data_agent.complete_falcon24_diagnostic(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch record;pointer record;runtime record;run_row record;
  attempt app_data_agent.falcon24_diagnostic_attempts%rowtype;
  existing app_data_agent.falcon24_diagnostic_receipts%rowtype;
  qa_receipt app_data_agent.falcon24_ui_receipts%rowtype;
  trace_receipt app_data_agent.falcon24_ui_receipts%rowtype;
  outcome_value text;now_at timestamptz;pass_evidence jsonb;receipt jsonb;receipt_hash_value text;
  failure_class_value text;failure_code_value text;reference jsonb;artifact_count integer;
  reclamation jsonb;receipt_version text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or command->>'schema_version'<>'falcon24-diagnostic-complete@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or command->>'outcome' not in('PASS','FAIL')
  then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
  outcome_value:=command->>'outcome';
  if (outcome_value='PASS' and app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','outcome','viewport_width','observed_execution_path',
      'sandbox_reclamation_receipt','command_hash']::text[]) is distinct from true)
    or (outcome_value='FAIL' and app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','outcome','failure_class','failure_code','command_hash']::text[])
      is distinct from true)
  then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-diagnostic:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into attempt from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid for update;
  if not found then raise exception using errcode='02000',message='FALCON24_DIAGNOSTIC_ATTEMPT_NOT_FOUND'; end if;
  if attempt.manifest_document->>'schema_version'='falcon24-diagnostic-attempt@1.0.0'
  then return app_data_agent.complete_falcon24_diagnostic_e4_history(command); end if;
  select * into existing from app_data_agent.falcon24_diagnostic_receipts row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.attempt_id=attempt.attempt_id;
  if found then
    if existing.completion_command_hash=command->>'command_hash'
    then return existing.receipt_document; end if;
    raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_REPLAY_MISMATCH';
  end if;
  if attempt.status<>'ACTIVE'
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE'; end if;
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment for share;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.semantic_domain=attempt.semantic_domain for share;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.semantic_domain=attempt.semantic_domain for share;
  if current_epoch.authority_epoch is distinct from attempt.authority_epoch
    or current_epoch.baseline_id is distinct from attempt.authority_baseline_id
    or current_epoch.baseline_hash is distinct from attempt.authority_baseline_hash
    or current_epoch.activation_attempt_id is distinct from attempt.authority_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH'; end if;
  if pointer.current_release_id is distinct from attempt.semantic_release_id
    or pointer.current_release_generation is distinct from attempt.semantic_release_generation
    or pointer.current_release_digest is distinct from attempt.semantic_release_digest
    or runtime.current_release_id is distinct from attempt.semantic_release_id
    or runtime.current_release_generation is distinct from attempt.semantic_release_generation
  then raise exception using errcode='55000',
    message='FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_MISMATCH'; end if;
  pass_evidence:=null;failure_class_value:=null;failure_code_value:=null;
  if outcome_value='FAIL' then
    failure_class_value:=command->>'failure_class';failure_code_value:=command->>'failure_code';
    if failure_class_value not in('FROZEN_CLOSURE_CHANGE_REQUIRED','EXTERNAL_DEPENDENCY')
      or failure_code_value!~'^[A-Z][A-Z0-9_]{2,127}$'
    then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
  else
    reclamation:=command->'sandbox_reclamation_receipt';
    if pg_catalog.jsonb_typeof(command->'viewport_width') is distinct from 'number'
      or command->>'viewport_width' not in('390','1440')
      or command->'observed_execution_path' is distinct from
        '["SEMANTIC","TEXT2SQL","SQL","QUERY_EVIDENCE","TYPED_ARROW","PYTHON_OPERATOR","ANALYSIS_REPORT","CHART"]'::jsonb
      or pg_catalog.jsonb_typeof(reclamation) is distinct from 'object'
      or reclamation->>'schema_version'<>'falcon24-sandbox-reclamation-receipt@3.0.0'
      or reclamation->>'authority_epoch'<>attempt.authority_epoch
      or reclamation->>'campaign_id'<>attempt.authority_epoch||'-Q1'
      or reclamation->>'run_id'<>attempt.run_id::text or reclamation->>'residual'<>'0'
      or reclamation->>'runtime_attestation_hash'<>attempt.runtime_attestation_hash
      or reclamation->>'receipt_hash' is distinct from
        app_data_agent.u2_canonical_sha256(reclamation-'receipt_hash')
    then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
    select * into run_row from app_data_agent.runs row
      where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
        and row.environment=attempt.environment and row.run_id=attempt.run_id
        and row.principal_id=attempt.principal_id and row.status='SUCCEEDED' for share;
    if not found or run_row.question<>'最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。'
      or run_row.authority_epoch is distinct from attempt.authority_epoch
      or run_row.authority_baseline_id is distinct from attempt.authority_baseline_id
      or run_row.authority_baseline_hash is distinct from attempt.authority_baseline_hash
      or run_row.authority_activation_attempt_id is distinct from attempt.authority_activation_attempt_id
    then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_RUN_NOT_READY'; end if;
    select * into qa_receipt from app_data_agent.falcon24_ui_receipts row
      where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
        and row.environment=attempt.environment and row.run_id=attempt.run_id
        and row.receipt_kind='QA_E2E' and row.viewport_width=(command->>'viewport_width')::integer;
    select * into trace_receipt from app_data_agent.falcon24_ui_receipts row
      where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
        and row.environment=attempt.environment and row.run_id=attempt.run_id
        and row.receipt_kind='TRACE_UI' and row.viewport_width=(command->>'viewport_width')::integer;
    if qa_receipt.receipt_hash is null or trace_receipt.receipt_hash is null
      or qa_receipt.authority_epoch is distinct from attempt.authority_epoch
      or qa_receipt.baseline_id is distinct from attempt.authority_baseline_id
      or qa_receipt.baseline_hash is distinct from attempt.authority_baseline_hash
      or qa_receipt.activation_attempt_id is distinct from attempt.authority_activation_attempt_id
      or qa_receipt.web_build_hash is distinct from attempt.web_build_id
      or trace_receipt.authority_epoch is distinct from qa_receipt.authority_epoch
      or trace_receipt.baseline_id is distinct from qa_receipt.baseline_id
      or trace_receipt.baseline_hash is distinct from qa_receipt.baseline_hash
      or trace_receipt.activation_attempt_id is distinct from qa_receipt.activation_attempt_id
      or trace_receipt.web_build_hash is distinct from attempt.web_build_id
      or qa_receipt.receipt_json->>'question_hash' is distinct from attempt.question_hash
      or trace_receipt.receipt_json->>'trace_hash' is null
      or pg_catalog.jsonb_array_length(trace_receipt.receipt_json->'opened_artifact_refs')<>5
    then raise exception using errcode='55000',
      message='FALCON24_DIAGNOSTIC_UI_RECEIPT_PAIR_REQUIRED'; end if;
    if (select pg_catalog.array_agg(item->>'artifact_type' order by item->>'artifact_type')
        from pg_catalog.jsonb_array_elements(trace_receipt.receipt_json->'opened_artifact_refs') item)
      is distinct from array['AnalysisReport','ArtifactWorkspaceDocument',
        'DerivedAnalysisEvidence','QueryEvidence','SqlArtifact']::text[]
    then raise exception using errcode='55000',
      message='FALCON24_DIAGNOSTIC_ARTIFACT_CLOSURE_INVALID'; end if;
    artifact_count:=0;
    for reference in select item from pg_catalog.jsonb_array_elements(
        trace_receipt.receipt_json->'opened_artifact_refs') item loop
      if not exists(select 1 from app_data_agent.artifacts row
        where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
          and row.environment=attempt.environment and row.run_id=attempt.run_id
          and row.artifact_id=(reference->>'artifact_id')::uuid
          and row.artifact_type=reference->>'artifact_type'
          and row.revision=(reference->>'revision')::integer
          and row.content_hash=reference->>'content_hash' and row.is_active
          and row.authority_epoch=attempt.authority_epoch
          and row.authority_baseline_id=attempt.authority_baseline_id
          and row.authority_baseline_hash=attempt.authority_baseline_hash
          and row.authority_activation_attempt_id=attempt.authority_activation_attempt_id)
      then raise exception using errcode='55000',
        message='FALCON24_DIAGNOSTIC_ARTIFACT_CLOSURE_INVALID'; end if;
      artifact_count:=artifact_count+1;
    end loop;
    if artifact_count<>5 then raise exception using errcode='55000',
      message='FALCON24_DIAGNOSTIC_ARTIFACT_CLOSURE_INVALID'; end if;
    pass_evidence:=pg_catalog.jsonb_build_object(
      'qa_e2e_receipt_hash',qa_receipt.receipt_hash,
      'trace_ui_receipt_hash',trace_receipt.receipt_hash,
      'trace_hash',trace_receipt.receipt_json->>'trace_hash',
      'opened_artifact_refs',trace_receipt.receipt_json->'opened_artifact_refs',
      'observed_execution_path',command->'observed_execution_path',
      'sandbox_reclamation_receipt_hash',reclamation->>'receipt_hash','residual',0);
  end if;
  now_at:=pg_catalog.clock_timestamp();receipt_version:='falcon24-diagnostic-receipt@2.0.0';
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version',receipt_version,'attempt_id',attempt.attempt_id,'run_id',attempt.run_id,
    'attempt_manifest_hash',attempt.manifest_hash,'authority',attempt.manifest_document->'authority',
    'semantic_release',attempt.manifest_document->'semantic_release','outcome',outcome_value,
    'pass_evidence',pass_evidence,'failure_class',failure_class_value,
    'failure_code',failure_code_value,'completed_at',app_data_agent.runtime_iso_timestamp(now_at));
  receipt_hash_value:=app_data_agent.u2_canonical_sha256(receipt);
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash_value);
  insert into app_data_agent.falcon24_diagnostic_receipts(
    app_id,tenant_id,environment,attempt_id,run_id,outcome,completion_command_hash,
    receipt_hash,receipt_document,created_at)
  values(attempt.app_id,attempt.tenant_id,attempt.environment,attempt.attempt_id,attempt.run_id,
    outcome_value,command->>'command_hash',receipt_hash_value,receipt,now_at);
  update app_data_agent.falcon24_diagnostic_attempts set
    status=case when outcome_value='PASS' then 'PASSED' else 'FAILED' end,
    failure_class=failure_class_value,failure_code=failure_code_value,
    terminal_receipt_hash=receipt_hash_value,completed_at=now_at
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and attempt_id=attempt.attempt_id and status='ACTIVE';
  if not found then raise exception using errcode='55000',
    message='FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE'; end if;
  return receipt;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID';
end
$function$;
