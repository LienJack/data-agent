create function app_data_agent.claim_falcon24_qualification_slot(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; normalized_fence_token text;
  fence_hash text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','ordinal','run_id','slot_id','stage','case_id',
      'run_variant','claim_fence_token','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-slot-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'ordinal') is distinct from 'number'
    or command->>'ordinal'!~'^(0|[1-9][0-9]*)$'
    or (command->>'ordinal')::integer not between 0 and 15
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'slot_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'stage') is distinct from 'string'
    or command->>'stage' not in('G1','G2','G3','G4')
    or pg_catalog.jsonb_typeof(command->'case_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_variant') is distinct from 'string'
    or command->>'run_variant' not in('COLD','WARM')
    or pg_catalog.jsonb_typeof(command->'claim_fence_token') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SLOT_CLAIM_INVALID'; end if;
  normalized_fence_token:=(command->>'claim_fence_token')::uuid::text;
  if normalized_fence_token is distinct from command->>'claim_fence_token' then
    raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SLOT_CLAIM_INVALID'; end if;
  fence_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('claim_fence_token',normalized_fence_token));
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  if qualification.status='HOLD' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD'; end if;
  if qualification.status<>'READY'
    or qualification.next_slot_ordinal<>(command->>'ordinal')::integer
    or exists(select 1 from app_data_agent.falcon24_qualification_slots candidate
      where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
        and candidate.environment=authority.environment
        and candidate.principal_id=authority.principal_id
        and candidate.qualification_id=qualification.qualification_id
        and candidate.status='CLAIMED')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_ORDER_OR_STATE_INVALID'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.ordinal=(command->>'ordinal')::integer for update;
  if not found or slot.status<>'PLANNED'
    or slot.run_id is distinct from (command->>'run_id')::uuid
    or slot.slot_id is distinct from command->>'slot_id'
    or slot.stage is distinct from command->>'stage'
    or slot.case_id is distinct from command->>'case_id'
    or slot.run_variant is distinct from command->>'run_variant'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SCHEDULE_MISMATCH'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set status='CLAIMED',claimed_at=now_at,
    claim_fence_hash=fence_hash,claim_fence_consumed_at=null
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and ordinal=slot.ordinal
      and status='PLANNED' returning * into strict slot;
  update app_data_agent.falcon24_qualifications set status='RUNNING',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and status='READY';
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SLOT_CLAIM_INVALID';
end
$function$;

create function app_data_agent.accept_falcon24_qualification_run_with_config(
  requested_command jsonb,requested_config jsonb,submit_fence_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; slot app_data_agent.falcon24_qualification_slots%rowtype;
  qualification app_data_agent.falcon24_qualifications%rowtype;
  normalized_fence_token text; expected_fence_hash text; now_at timestamptz;
  acceptance jsonb; submit_fence_receipt jsonb;
begin
  if submit_fence_command is null
    or pg_catalog.jsonb_typeof(submit_fence_command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(submit_fence_command,array[
      'schema_version','qualification_id','run_id','claim_fence_token','command_hash']::text[])
      is distinct from true
    or submit_fence_command->>'schema_version' is distinct from
      'falcon24-qualification-question-run-acceptance@1.0.0'
    or submit_fence_command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(submit_fence_command-'command_hash')
    or pg_catalog.jsonb_typeof(submit_fence_command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(submit_fence_command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(submit_fence_command->'claim_fence_token') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_command) is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_config) is distinct from 'object'
    or requested_command->>'run_id' is distinct from submit_fence_command->>'run_id'
    or requested_config->>'run_id' is distinct from submit_fence_command->>'run_id'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_QUESTION_ACCEPTANCE_INVALID'; end if;
  normalized_fence_token:=(submit_fence_command->>'claim_fence_token')::uuid::text;
  if normalized_fence_token is distinct from submit_fence_command->>'claim_fence_token' then
    raise exception using errcode='22023',message='FALCON24_QUALIFICATION_QUESTION_ACCEPTANCE_INVALID'; end if;
  expected_fence_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('claim_fence_token',normalized_fence_token));
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||(submit_fence_command->>'run_id'),0));
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=submit_fence_command->>'qualification_id' for update;
  if not found or qualification.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_NOT_RUNNING'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(submit_fence_command->>'run_id')::uuid for update;
  if not found or slot.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_NOT_CLAIMED'; end if;
  if slot.claim_fence_hash is distinct from expected_fence_hash then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_MISMATCH'; end if;
  if slot.claim_fence_consumed_at is not null then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_ALREADY_CONSUMED'; end if;
  if exists(select 1 from app_data_agent.runs actual
      where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
        and actual.environment=authority.environment and actual.principal_id=authority.principal_id
        and actual.run_id=slot.run_id)
    or exists(select 1 from app_data_agent.workspace_run_bindings binding
      where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
        and binding.environment=authority.environment and binding.principal_id=authority.principal_id
        and binding.run_id=slot.run_id)
    or exists(select 1 from app_data_agent.effective_run_config_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.principal_id=authority.principal_id
        and receipt.run_id=slot.run_id)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_RUN_PREEXISTS'; end if;
  acceptance:=app_data_agent.accept_question_run_with_effective_config(
    requested_command,requested_config);
  if acceptance#>>'{resolution,operation}' is distinct from 'QUESTION_RUN'
    or acceptance#>>'{resolution,admission}' is distinct from 'READY'
    or acceptance#>>'{resolution,run_id}' is distinct from slot.run_id::text
    or pg_catalog.jsonb_typeof(acceptance->'effective_config') is distinct from 'object'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_QUESTION_ACCEPTANCE_NOT_READY'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    join app_data_agent.workspace_run_bindings binding
      on binding.app_id=actual.app_id and binding.tenant_id=actual.tenant_id
      and binding.environment=actual.environment and binding.run_id=actual.run_id
      and binding.principal_id=actual.principal_id
    join app_data_agent.effective_run_config_receipts receipt
      on receipt.app_id=actual.app_id and receipt.tenant_id=actual.tenant_id
      and receipt.environment=actual.environment and receipt.run_id=actual.run_id
      and receipt.principal_id=actual.principal_id and receipt.datasource_id=binding.datasource_id
      and receipt.model_profile_id=binding.model_profile_id
      and receipt.model_config_version=binding.model_config_version
      and receipt.provider=binding.provider and receipt.model_id=binding.model_id
      and receipt.datasource_revision_hash=binding.datasource_binding_hash
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id and actual.status='QUEUED'
      and receipt.operation_kind='QUESTION_RUN' and receipt.admission='READY')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_ACCEPTANCE_NOT_ATOMIC'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set claim_fence_consumed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and claim_fence_hash=expected_fence_hash
      and claim_fence_consumed_at is null returning * into strict slot;
  submit_fence_receipt:=pg_catalog.jsonb_build_object(
    'qualification_id',qualification.qualification_id,'run_id',slot.run_id,
    'claim_fence_hash',slot.claim_fence_hash,
    'claim_fence_consumed_at',slot.claim_fence_consumed_at);
  return pg_catalog.jsonb_build_object(
    'acceptance',acceptance,'submit_fence',submit_fence_receipt);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_QUESTION_ACCEPTANCE_INVALID';
end
$function$;

create function app_data_agent.resolve_falcon24_qualification_submit_outcome(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype;
  actual_count bigint; binding_count bigint; receipt_count bigint; exact_triple_count bigint;
  durable_failure_code text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','observed_failure_code','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-submit-outcome@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or (command->>'run_id')::uuid::text is distinct from command->>'run_id'
    or pg_catalog.jsonb_typeof(command->'observed_failure_code') is distinct from 'string'
    or command->>'observed_failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SUBMIT_OUTCOME_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||(command->>'run_id'),0));
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
  if not found or slot.ordinal<>qualification.next_slot_ordinal then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_AUTHORITY_CORRUPT'; end if;
  if qualification.status='HOLD' then
    if qualification.first_failure_run_id is distinct from slot.run_id
      or qualification.first_failure_layer is distinct from 'ROOT_ROUTING'
      or slot.status<>'HOLD'
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_AUTHORITY_CORRUPT'; end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','falcon24-qualification-submit-outcome@1.0.0',
      'disposition','HELD','qualification_id',qualification.qualification_id,
      'run_id',slot.run_id,'failure_code',qualification.first_failure_code);
  end if;
  if qualification.status not in('READY','RUNNING') or slot.status not in('PLANNED','CLAIMED') then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_OUTCOME_UNKNOWN'; end if;
  perform 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id for update;
  select pg_catalog.count(*) into strict actual_count from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id;
  select pg_catalog.count(*) into strict binding_count from app_data_agent.workspace_run_bindings binding
    where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
      and binding.environment=authority.environment and binding.principal_id=authority.principal_id
      and binding.run_id=slot.run_id;
  select pg_catalog.count(*) into strict receipt_count from app_data_agent.effective_run_config_receipts receipt
    where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
      and receipt.environment=authority.environment and receipt.principal_id=authority.principal_id
      and receipt.run_id=slot.run_id;
  select pg_catalog.count(*) into strict exact_triple_count
    from app_data_agent.runs actual
    join app_data_agent.workspace_run_bindings binding
      on binding.app_id=actual.app_id and binding.tenant_id=actual.tenant_id
      and binding.environment=actual.environment and binding.principal_id=actual.principal_id
      and binding.run_id=actual.run_id
    join app_data_agent.effective_run_config_receipts receipt
      on receipt.app_id=actual.app_id and receipt.tenant_id=actual.tenant_id
      and receipt.environment=actual.environment and receipt.principal_id=actual.principal_id
      and receipt.run_id=actual.run_id and receipt.datasource_id=binding.datasource_id
      and receipt.model_profile_id=binding.model_profile_id
      and receipt.model_config_version=binding.model_config_version
      and receipt.provider=binding.provider and receipt.model_id=binding.model_id
      and receipt.datasource_revision_hash=binding.datasource_binding_hash
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id
      and receipt.operation_kind='QUESTION_RUN' and receipt.admission='READY';
  if qualification.status='RUNNING' and slot.status='CLAIMED'
    and slot.claim_fence_hash is not null and slot.claim_fence_consumed_at is not null
    and actual_count=1 and binding_count=1 and receipt_count=1 and exact_triple_count=1
  then return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-submit-outcome@1.0.0',
    'disposition','ACCEPTED','qualification_id',qualification.qualification_id,
    'run_id',slot.run_id,'claim_fence_hash',slot.claim_fence_hash,
    'claim_fence_consumed_at',slot.claim_fence_consumed_at); end if;
  if qualification.status='READY' and slot.status='PLANNED'
    and slot.claim_fence_hash is null and slot.claim_fence_consumed_at is null
    and actual_count=0 and binding_count=0 and receipt_count=0 and exact_triple_count=0
  then durable_failure_code:=command->>'observed_failure_code';
  elsif qualification.status='RUNNING' and slot.status='CLAIMED'
    and slot.claim_fence_hash is not null and slot.claim_fence_consumed_at is null
    and actual_count=0 and binding_count=0 and receipt_count=0 and exact_triple_count=0
  then durable_failure_code:=command->>'observed_failure_code';
  else durable_failure_code:='FALCON24_QUALIFICATION_SUBMIT_AUTHORITY_CORRUPT'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set status='HOLD',
    claimed_at=coalesce(claimed_at,now_at),completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and ordinal=slot.ordinal
      and run_id=slot.run_id and status=slot.status returning * into strict slot;
  update app_data_agent.falcon24_qualifications set status='HOLD',
    first_failure_run_id=slot.run_id,first_failure_layer='ROOT_ROUTING',
    first_failure_code=durable_failure_code,updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and status=qualification.status
    returning * into strict qualification;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-submit-outcome@1.0.0',
    'disposition','HELD','qualification_id',qualification.qualification_id,
    'run_id',slot.run_id,'failure_code',qualification.first_failure_code);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SUBMIT_OUTCOME_INVALID';
end
$function$;
