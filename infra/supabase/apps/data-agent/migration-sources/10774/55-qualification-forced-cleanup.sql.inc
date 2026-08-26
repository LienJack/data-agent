create function app_data_agent.claim_falcon24_qualification_forced_cleanup(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; cleanup_hash text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','forced_cleanup_token',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-forced-cleanup-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'forced_cleanup_token') is distinct from 'string'
    or (command->>'forced_cleanup_token')::uuid::text
      is distinct from command->>'forced_cleanup_token'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  cleanup_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'forced_cleanup_token',command->>'forced_cleanup_token'));
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
  if not found or qualification.status<>'HOLD' or slot.status<>'HOLD'
    or qualification.first_failure_run_id is distinct from slot.run_id
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD'; end if;
  if slot.forced_cleanup_claim_hash is not null then
    if slot.forced_cleanup_claim_hash is distinct from cleanup_hash then
      raise exception using errcode='55000',
        message='FALCON24_QUALIFICATION_FORCED_CLEANUP_ALREADY_CLAIMED'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set
    forced_cleanup_claim_hash=cleanup_hash,forced_cleanup_claimed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='HOLD' and forced_cleanup_claim_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID';
end
$function$;

create function app_data_agent.resolve_falcon24_qualification_forced_cleanup(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; cleanup_hash text; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','forced_cleanup_token',
      'forced_cleanup_receipt_hash','forced_cleanup_receipt','secondary_failure_code',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-forced-cleanup-resolve@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'forced_cleanup_token') is distinct from 'string'
    or (command->>'forced_cleanup_token')::uuid::text
      is distinct from command->>'forced_cleanup_token'
    or ((command->'forced_cleanup_receipt' is distinct from 'null'::jsonb)
      =(command->'secondary_failure_code' is distinct from 'null'::jsonb))
    or ((command->'forced_cleanup_receipt' is distinct from 'null'::jsonb)
      <> (command->'forced_cleanup_receipt_hash' is distinct from 'null'::jsonb))
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  cleanup_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'forced_cleanup_token',command->>'forced_cleanup_token'));
  receipt:=command->'forced_cleanup_receipt';
  if receipt is distinct from 'null'::jsonb and (
    pg_catalog.jsonb_typeof(command->'forced_cleanup_receipt_hash') is distinct from 'string'
    or command->>'forced_cleanup_receipt_hash'!~'^sha256:[0-9a-f]{64}$')
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  if command->'secondary_failure_code' is distinct from 'null'::jsonb and (
    pg_catalog.jsonb_typeof(command->'secondary_failure_code') is distinct from 'string'
    or command->>'secondary_failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$')
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
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
  if not found or qualification.status<>'HOLD' or slot.status<>'HOLD'
    or qualification.first_failure_run_id is distinct from slot.run_id
    or slot.forced_cleanup_claim_hash is distinct from cleanup_hash
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  if slot.forced_cleanup_resolved_at is not null then
    if (receipt is distinct from 'null'::jsonb and (
        slot.forced_cleanup_receipt_hash is distinct from command->>'forced_cleanup_receipt_hash'
        or slot.forced_cleanup_receipt is distinct from receipt
        or slot.secondary_failure_code is not null))
      or (command->'secondary_failure_code' is distinct from 'null'::jsonb and (
        slot.secondary_failure_layer is distinct from 'SANDBOX_RECLAMATION'
        or slot.secondary_failure_code is distinct from command->>'secondary_failure_code'
        or slot.forced_cleanup_receipt is not null))
    then raise exception using errcode='55000',
      message='FALCON24_QUALIFICATION_FORCED_CLEANUP_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  if receipt is distinct from 'null'::jsonb and not
    app_data_agent.falcon24_qualification_reclamation_receipt_valid(
      receipt,qualification.qualification_id,slot.run_id,
      qualification.runtime_attestation_hash,command->>'forced_cleanup_receipt_hash')
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  update app_data_agent.falcon24_qualification_slots set
    forced_cleanup_resolved_at=pg_catalog.clock_timestamp(),
    forced_cleanup_receipt_hash=case when receipt is distinct from 'null'::jsonb
      then command->>'forced_cleanup_receipt_hash' else null end,
    forced_cleanup_receipt=case when receipt is distinct from 'null'::jsonb then receipt else null end,
    secondary_failure_layer=case when receipt is distinct from 'null'::jsonb
      then null else 'SANDBOX_RECLAMATION' end,
    secondary_failure_code=case when receipt is distinct from 'null'::jsonb
      then null else command->>'secondary_failure_code' end
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='HOLD' and forced_cleanup_claim_hash=cleanup_hash
      and forced_cleanup_resolved_at is null returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID';
end
$function$;
