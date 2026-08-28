alter function app_data_agent.begin_falcon24_qualification(jsonb)
  rename to begin_falcon24_qualification_e4_diagnostic;

create function app_data_agent.begin_falcon24_qualification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;manifest jsonb;legacy_manifest jsonb;legacy_command jsonb;
  epoch_value text;qualification_id_value text;diagnostic_ref jsonb;
  diagnostic app_data_agent.falcon24_diagnostic_attempts%rowtype;
  diagnostic_receipt app_data_agent.falcon24_diagnostic_receipts%rowtype;
  existing app_data_agent.falcon24_qualifications%rowtype;created jsonb;
begin
  if command->>'schema_version' in(
      'falcon24-qualification-begin@2.0.0','falcon24-qualification-begin@3.0.0') then
    manifest:=command->'manifest';
    if (command->>'schema_version'='falcon24-qualification-begin@2.0.0'
        and pg_catalog.substr(manifest->>'authority_epoch',2)::numeric>=4)
      or (command->>'schema_version'='falcon24-qualification-begin@3.0.0'
        and manifest->>'authority_epoch'<>'E4')
    then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_MANIFEST_INVALID'; end if;
    return app_data_agent.begin_falcon24_qualification_e4_diagnostic(command);
  end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-qualification-begin@4.0.0'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';epoch_value:=manifest->>'authority_epoch';
  qualification_id_value:=manifest->>'qualification_id';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','authority_epoch','qualification_id','attempt_id','authority_baseline_hash',
      'source_commit','source_fingerprint','frozen_contract_hash','semantic_release_hash',
      'schema_snapshot_hash','operator_registry_digest','model_config_hash','web_build_hash',
      'runtime_attestation_hash','model_provider','model_id','slots','diagnostic_receipt_ref',
      'manifest_hash']::text[]) is distinct from true
    or manifest->>'schema_version'<>'falcon24-qualification-manifest@4.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(epoch_value) is distinct from true
    or pg_catalog.substr(epoch_value,2)::numeric<5
    or qualification_id_value is distinct from epoch_value||'-Q1'
    or manifest->>'manifest_hash' is distinct from
      app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or pg_catalog.jsonb_typeof(manifest->'diagnostic_receipt_ref') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(manifest->'diagnostic_receipt_ref',array[
      'attempt_id','run_id','receipt_hash']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest#>'{diagnostic_receipt_ref,attempt_id}') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest#>'{diagnostic_receipt_ref,run_id}') is distinct from true
    or manifest#>>'{diagnostic_receipt_ref,receipt_hash}'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_MANIFEST_INVALID'; end if;
  diagnostic_ref:=manifest->'diagnostic_receipt_ref';
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:'||qualification_id_value||':'||authority.app_id::text||':'||
      authority.tenant_id::text||':'||authority.environment||':'||authority.principal_id::text,0));
  select * into diagnostic from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.attempt_id=(diagnostic_ref->>'attempt_id')::uuid for share;
  select * into diagnostic_receipt from app_data_agent.falcon24_diagnostic_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.attempt_id=(diagnostic_ref->>'attempt_id')::uuid
      and row.run_id=(diagnostic_ref->>'run_id')::uuid
      and row.receipt_hash=diagnostic_ref->>'receipt_hash';
  if diagnostic.status is distinct from 'PASSED'
    or diagnostic.principal_id is distinct from authority.principal_id
    or diagnostic.authority_epoch is distinct from epoch_value
    or diagnostic.authority_baseline_hash is distinct from manifest->>'authority_baseline_hash'
    or diagnostic.source_commit is distinct from manifest->>'source_commit'
    or diagnostic.source_fingerprint is distinct from manifest->>'source_fingerprint'
    or diagnostic.semantic_release_digest is distinct from manifest->>'semantic_release_hash'
    or diagnostic.web_build_id is distinct from manifest->>'web_build_hash'
    or diagnostic.runtime_attestation_hash is distinct from manifest->>'runtime_attestation_hash'
    or diagnostic.terminal_receipt_hash is distinct from diagnostic_ref->>'receipt_hash'
    or diagnostic_receipt.outcome is distinct from 'PASS'
    or diagnostic_receipt.receipt_document->>'schema_version'
      is distinct from 'falcon24-diagnostic-receipt@2.0.0'
    or diagnostic_receipt.receipt_document#>>'{pass_evidence,residual}' is distinct from '0'
  then raise exception using errcode='55000',
    message='FALCON24_QUALIFICATION_DIAGNOSTIC_REQUIRED'; end if;
  select * into existing from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification_id_value for update;
  if found then
    if existing.attempt_id=(manifest->>'attempt_id')::uuid
      and existing.manifest_hash=manifest->>'manifest_hash'
      and existing.diagnostic_attempt_id=(diagnostic_ref->>'attempt_id')::uuid
      and existing.diagnostic_run_id=(diagnostic_ref->>'run_id')::uuid
      and existing.diagnostic_receipt_hash=diagnostic_ref->>'receipt_hash'
    then return pg_catalog.to_jsonb(existing); end if;
    raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_IMMUTABLE';
  end if;
  legacy_manifest:=(manifest-'diagnostic_receipt_ref')
    ||pg_catalog.jsonb_build_object('schema_version','falcon24-qualification-manifest@2.0.0');
  legacy_manifest:=legacy_manifest||pg_catalog.jsonb_build_object(
    'manifest_hash',app_data_agent.u2_canonical_sha256(legacy_manifest-'manifest_hash'));
  legacy_command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-begin@2.0.0','manifest',legacy_manifest);
  legacy_command:=legacy_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(legacy_command));
  created:=app_data_agent.begin_falcon24_qualification_pre_diagnostic(legacy_command);
  update app_data_agent.falcon24_qualifications row set
    manifest_hash=manifest->>'manifest_hash',
    diagnostic_attempt_id=(diagnostic_ref->>'attempt_id')::uuid,
    diagnostic_run_id=(diagnostic_ref->>'run_id')::uuid,
    diagnostic_receipt_hash=diagnostic_ref->>'receipt_hash'
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification_id_value and attempt_id=(manifest->>'attempt_id')::uuid
    returning pg_catalog.to_jsonb(row) into strict created;
  return created;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_BEGIN_INVALID';
end
$function$;
