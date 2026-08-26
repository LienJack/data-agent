create function app_data_agent.falcon24_qualification_reclamation_receipt_valid(
  receipt jsonb,qualification_id text,requested_run_id uuid,
  runtime_attestation_hash text,expected_receipt_hash text)
returns boolean language plpgsql immutable security definer set search_path='' as $function$
begin
  return receipt is not null and pg_catalog.jsonb_typeof(receipt)='object'
    and app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','runtime_attestation_hash',
      'management_observation_schema_version','management_operation_id','observation_source',
      'target_metadata_hash','before_observation','killed','after_observation','residual',
      'completed_at','management_observation_hash','receipt_hash']::text[]) is true
    and receipt->>'schema_version'='falcon24-sandbox-reclamation-receipt@2.0.0'
    and receipt->>'campaign_id'=qualification_id
    and receipt->>'run_id'=requested_run_id::text
    and receipt->>'runtime_attestation_hash'=runtime_attestation_hash
    and receipt->>'management_observation_schema_version'=
      'opensandbox-management-reclamation-observation@1.0.0'
    and pg_catalog.jsonb_typeof(receipt->'management_operation_id')='string'
    and (receipt->>'management_operation_id')::uuid is not null
    and receipt->>'observation_source'='OPENSANDBOX_MANAGEMENT_API'
    and pg_catalog.jsonb_typeof(receipt->'target_metadata_hash')='string'
    and receipt->>'target_metadata_hash'~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(receipt->'before_observation')='object'
    and app_data_agent.provider_json_object_has_exact_keys(
      receipt->'before_observation',array['active_count','observation_hash']::text[]) is true
    and pg_catalog.jsonb_typeof(receipt#>'{before_observation,active_count}')='number'
    and receipt#>>'{before_observation,active_count}'~'^(0|[1-9][0-9]*)$'
    and receipt#>>'{before_observation,observation_hash}'~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(receipt->'killed')='number'
    and receipt->>'killed'~'^(0|[1-9][0-9]*)$'
    and receipt->>'killed'=receipt#>>'{before_observation,active_count}'
    and pg_catalog.jsonb_typeof(receipt->'after_observation')='object'
    and app_data_agent.provider_json_object_has_exact_keys(
      receipt->'after_observation',array['active_count','observation_hash']::text[]) is true
    and pg_catalog.jsonb_typeof(receipt#>'{after_observation,active_count}')='number'
    and receipt#>>'{after_observation,active_count}'='0'
    and receipt#>>'{after_observation,observation_hash}'~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(receipt->'residual')='number'
    and receipt->>'residual'='0'
    and pg_catalog.jsonb_typeof(receipt->'completed_at')='string'
    and (receipt->>'completed_at')::timestamptz is not null
    and receipt->>'management_observation_hash'=
      app_data_agent.u2_canonical_sha256(receipt-array[
        'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
    and receipt->>'receipt_hash'=expected_receipt_hash
    and receipt->>'receipt_hash'=app_data_agent.u2_canonical_sha256(receipt-'receipt_hash');
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then return false;
end
$function$;

create function app_data_agent.claim_falcon24_qualification_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; claim_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','reclamation_claim_token',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-sandbox-reclamation-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'reclamation_claim_token') is distinct from 'string'
    or (command->>'reclamation_claim_token')::uuid::text
      is distinct from command->>'reclamation_claim_token'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  claim_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'reclamation_claim_token',command->>'reclamation_claim_token'));
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED'
    or slot.claim_fence_consumed_at is null or slot.result_document is null
    or slot.trace_gate_receipt is null or slot.ui_trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_UI_TRACE_REQUIRED'; end if;
  if slot.sandbox_reclamation_hash is not null then
    if slot.sandbox_reclamation_claim_hash is distinct from claim_hash then
      raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  if slot.sandbox_reclamation_claim_hash is not null then
    if slot.sandbox_reclamation_claim_hash is distinct from claim_hash then
      raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set
    sandbox_reclamation_claim_hash=claim_hash
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and sandbox_reclamation_claim_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID';
end
$function$;

create function app_data_agent.record_falcon24_qualification_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; receipt jsonb; claim_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','reclamation_claim_token',
      'sandbox_reclamation_hash','sandbox_reclamation_receipt','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-sandbox-reclamation-record@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'reclamation_claim_token') is distinct from 'string'
    or (command->>'reclamation_claim_token')::uuid::text
      is distinct from command->>'reclamation_claim_token'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  receipt:=command->'sandbox_reclamation_receipt';
  claim_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'reclamation_claim_token',command->>'reclamation_claim_token'));
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  if not app_data_agent.falcon24_qualification_reclamation_receipt_valid(
    receipt,qualification.qualification_id,(command->>'run_id')::uuid,
    qualification.runtime_attestation_hash,command->>'sandbox_reclamation_hash')
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED'
    or slot.ui_trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_UI_TRACE_REQUIRED'; end if;
  if slot.sandbox_reclamation_claim_hash is distinct from claim_hash then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SANDBOX_RECLAMATION_REQUIRED'; end if;
  if slot.sandbox_reclamation_hash is not null then
    if slot.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
      or slot.sandbox_reclamation_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set
    sandbox_reclamation_hash=command->>'sandbox_reclamation_hash',
    sandbox_reclamation_receipt=receipt,
    sandbox_reclamation_claim_consumed_at=pg_catalog.clock_timestamp()
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and sandbox_reclamation_claim_hash=claim_hash
      and sandbox_reclamation_claim_consumed_at is null and sandbox_reclamation_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID';
end
$function$;
