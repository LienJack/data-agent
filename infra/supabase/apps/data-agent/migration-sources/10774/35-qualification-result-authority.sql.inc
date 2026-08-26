create function app_data_agent.hold_falcon24_qualification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; actual_status text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','failure_layer','failure_code',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-hold@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'failure_layer') is distinct from 'string'
    or command->>'failure_layer' not in('ROOT_ROUTING','SQL_DATA_PREPARATION',
      'GOVERNED_OPERATOR','ORACLE','PUBLISHER','SANDBOX_RECLAMATION')
    or pg_catalog.jsonb_typeof(command->'failure_code') is distinct from 'string'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_HOLD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  if qualification.status='PASSED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ALREADY_PASSED'; end if;
  if qualification.status='HOLD' then
    if qualification.first_failure_run_id is distinct from (command->>'run_id')::uuid
      or qualification.first_failure_layer is distinct from command->>'failure_layer'
      or qualification.first_failure_code is distinct from command->>'failure_code'
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(qualification);
  end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.ordinal=qualification.next_slot_ordinal
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or slot.status not in('PLANNED','CLAIMED')
    or (qualification.status='READY' and slot.status<>'PLANNED')
    or (qualification.status='RUNNING' and slot.status<>'CLAIMED')
    or qualification.status not in('READY','RUNNING')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_ORDER_OR_STATE_INVALID'; end if;
  if slot.status='PLANNED' and command->>'failure_layer'<>'ROOT_ROUTING' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_NOT_CLAIMED'; end if;
  if slot.status='CLAIMED' then
    if slot.claim_fence_consumed_at is null then
      raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_OUTCOME_REQUIRED'; end if;
    select actual.status into actual_status from app_data_agent.runs actual
      where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
        and actual.environment=authority.environment and actual.principal_id=authority.principal_id
        and actual.run_id=slot.run_id for update;
    if not found then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ACTUAL_RUN_REQUIRED'; end if;
    if actual_status not in('SUCCEEDED','FAILED','CANCELLED') then
      raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ACTUAL_RUN_NOT_TERMINAL'; end if;
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set status='HOLD',
    claimed_at=coalesce(claimed_at,now_at),completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and ordinal=slot.ordinal
      and status=slot.status returning * into strict slot;
  update app_data_agent.falcon24_qualifications set status='HOLD',
    first_failure_run_id=slot.run_id,first_failure_layer=command->>'failure_layer',
    first_failure_code=command->>'failure_code',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id returning * into strict qualification;
  return pg_catalog.to_jsonb(qualification);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_HOLD_INVALID';
end
$function$;

create function app_data_agent.stage_falcon24_qualification_result(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; result_document jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','result_hash','result_document',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-result-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'result_hash') is distinct from 'string'
    or command->>'result_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'result_document') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_RESULT_STAGE_INVALID'; end if;
  result_document:=command->'result_document';
  if result_document->>'run_id' is distinct from command->>'run_id'
    or command->>'result_hash' is distinct from
      app_data_agent.u2_canonical_sha256(result_document)
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_RESULT_STAGE_INVALID'; end if;
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
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_NOT_CLAIMED'; end if;
  if slot.claim_fence_consumed_at is null then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id and actual.status='RUNNING')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ACTUAL_RUN_NOT_RUNNING'; end if;
  if result_document->>'case_id' is distinct from slot.case_id
    or result_document->>'run_variant' is distinct from slot.run_variant
    or result_document->>'provider' is distinct from 'deepseek'
    or result_document->>'model_id' is distinct from qualification.model_id
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  if slot.result_hash is not null then
    if slot.result_hash<>command->>'result_hash' or slot.result_document<>result_document
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_RESULT_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set result_hash=command->>'result_hash',
    result_document=result_document
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and result_hash is null and result_document is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_RESULT_STAGE_INVALID';
end
$function$;
