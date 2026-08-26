create or replace function app_data_agent.claim_falcon24_acceptance_run(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  claimed app_data_agent.falcon24_acceptance_campaign_runs%rowtype; now_at timestamptz;
  normalized_fence_token text; fence_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_ordinal','run_id','case_id','run_variant',
      'repetition','claim_fence_token','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-run-claim@2.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_ordinal') is distinct from 'number'
    or command->>'run_ordinal'!~'^(0|[1-9][0-9]*)$'
    or (command->>'run_ordinal')::integer not between 0 and 29
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'case_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_variant') is distinct from 'string'
    or command->>'run_variant' not in('COLD','WARM')
    or pg_catalog.jsonb_typeof(command->'repetition') is distinct from 'number'
    or command->>'repetition'!~'^[1-3]$'
    or pg_catalog.jsonb_typeof(command->'claim_fence_token') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_RUN_CLAIM_INVALID'; end if;
  normalized_fence_token:=(command->>'claim_fence_token')::uuid::text;
  if normalized_fence_token is distinct from command->>'claim_fence_token' then
    raise exception using errcode='22023',message='FALCON24_RUN_CLAIM_INVALID'; end if;
  fence_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('claim_fence_token',normalized_fence_token));
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status='HOLD' then raise exception using errcode='55000',message='FALCON24_CAMPAIGN_HOLD'; end if;
  if campaign.status<>'READY'
    or campaign.next_run_ordinal<>(command->>'run_ordinal')::integer
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaign_runs run
      where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
        and run.environment=authority.environment and run.principal_id=authority.principal_id
        and run.campaign_id=campaign.campaign_id and run.status='CLAIMED')
  then raise exception using errcode='55000',message='FALCON24_RUN_ORDER_OR_STATE_INVALID'; end if;
  select * into claimed from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id
      and run.run_ordinal=(command->>'run_ordinal')::integer for update;
  if not found or claimed.status<>'PLANNED'
    or claimed.run_id is distinct from (command->>'run_id')::uuid
    or claimed.case_id is distinct from command->>'case_id'
    or claimed.run_variant is distinct from command->>'run_variant'
    or claimed.repetition is distinct from (command->>'repetition')::integer
  then raise exception using errcode='55000',message='FALCON24_RUN_SCHEDULE_MISMATCH'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set
    status='CLAIMED',claimed_at=now_at,claim_fence_hash=fence_hash,
    claim_fence_consumed_at=null
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_ordinal=claimed.run_ordinal
      and status='PLANNED'
    returning * into strict claimed;
  update app_data_agent.falcon24_acceptance_campaigns set status='RUNNING',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id;
  return pg_catalog.to_jsonb(claimed);
exception when unique_violation then
  raise exception using errcode='55000',message='FALCON24_RUN_ALREADY_CLAIMED';
when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_RUN_CLAIM_INVALID';
end
$function$;

create or replace function app_data_agent.hold_falcon24_acceptance_campaign(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; now_at timestamptz;
  actual_run_status text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','failure_layer','failure_code','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-campaign-hold@2.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'failure_layer') is distinct from 'string'
    or command->>'failure_layer' not in('ROOT_ROUTING','SQL_DATA_PREPARATION',
      'GOVERNED_OPERATOR','ORACLE','PUBLISHER','SANDBOX_RECLAMATION')
    or pg_catalog.jsonb_typeof(command->'failure_code') is distinct from 'string'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_HOLD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status='PASSED' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_ALREADY_PASSED'; end if;
  if campaign.status='HOLD' then
    if campaign.first_failure_run_id is distinct from (command->>'run_id')::uuid
      or campaign.first_failure_layer is distinct from command->>'failure_layer'
      or campaign.first_failure_code is distinct from command->>'failure_code'
    then raise exception using errcode='55000',message='FALCON24_CAMPAIGN_HOLD_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign);
  end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_ordinal=campaign.next_run_ordinal
      and run.run_id=(command->>'run_id')::uuid for update;
  if not found or campaign_run.status not in('PLANNED','CLAIMED')
    or (campaign.status='READY' and campaign_run.status<>'PLANNED')
    or (campaign.status='RUNNING' and campaign_run.status<>'CLAIMED')
    or campaign.status not in('READY','RUNNING')
  then raise exception using errcode='55000',message='FALCON24_RUN_ORDER_OR_STATE_INVALID'; end if;
  if campaign_run.status='PLANNED' and command->>'failure_layer'<>'ROOT_ROUTING' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.status='CLAIMED' then
    if campaign_run.claim_fence_consumed_at is null then
      raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED';
    end if;
    select actual.status into actual_run_status from app_data_agent.runs actual
      where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
        and actual.environment=authority.environment and actual.principal_id=authority.principal_id
        and actual.run_id=campaign_run.run_id for update;
    if not found then
      raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_REQUIRED';
    end if;
    if actual_run_status not in('SUCCEEDED','FAILED','CANCELLED') then
      raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_TERMINAL';
    end if;
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set status='HOLD',
    claimed_at=coalesce(claimed_at,now_at),completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_ordinal=campaign.next_run_ordinal
      and run_id=campaign_run.run_id and status=campaign_run.status;
  if not found then raise exception using errcode='55000',message='FALCON24_RUN_ORDER_OR_STATE_INVALID'; end if;
  update app_data_agent.falcon24_acceptance_campaigns set status='HOLD',
    first_failure_run_id=campaign_run.run_id,
    first_failure_layer=command->>'failure_layer',first_failure_code=command->>'failure_code',
    updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id returning * into strict campaign;
  return pg_catalog.to_jsonb(campaign);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_CAMPAIGN_HOLD_INVALID';
end
$function$;

create function app_data_agent.accept_falcon24_question_run_with_effective_config(
  requested_command jsonb,requested_config jsonb,submit_fence_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
  normalized_fence_token text; expected_fence_hash text; now_at timestamptz;
  acceptance jsonb; submit_fence_receipt jsonb;
begin
  if submit_fence_command is null
    or pg_catalog.jsonb_typeof(submit_fence_command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(submit_fence_command,array[
      'schema_version','campaign_id','run_id','claim_fence_token','command_hash']::text[])
      is distinct from true
    or submit_fence_command->>'schema_version' is distinct from
      'falcon24-question-run-acceptance@1.0.0'
    or submit_fence_command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(submit_fence_command-'command_hash')
    or pg_catalog.jsonb_typeof(submit_fence_command->'campaign_id') is distinct from 'string'
    or submit_fence_command->>'campaign_id'!~
      '^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(submit_fence_command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(submit_fence_command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(submit_fence_command->'claim_fence_token') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_command) is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_config) is distinct from 'object'
    or requested_command->>'run_id' is distinct from submit_fence_command->>'run_id'
    or requested_config->>'run_id' is distinct from submit_fence_command->>'run_id'
  then raise exception using errcode='22023',message='FALCON24_QUESTION_ACCEPTANCE_INVALID'; end if;
  normalized_fence_token:=(submit_fence_command->>'claim_fence_token')::uuid::text;
  if normalized_fence_token is distinct from submit_fence_command->>'claim_fence_token' then
    raise exception using errcode='22023',message='FALCON24_QUESTION_ACCEPTANCE_INVALID'; end if;
  expected_fence_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('claim_fence_token',normalized_fence_token));
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||(submit_fence_command->>'run_id'),0));
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=submit_fence_command->>'campaign_id'
      and run.run_id=(submit_fence_command->>'run_id')::uuid
    for update;
  if not found or campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.claim_fence_hash is distinct from expected_fence_hash then
    raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_MISMATCH'; end if;
  if campaign_run.claim_fence_consumed_at is not null then
    raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_ALREADY_CONSUMED'; end if;
  if exists(select 1 from app_data_agent.runs actual
      where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
        and actual.environment=authority.environment and actual.principal_id=authority.principal_id
        and actual.run_id=campaign_run.run_id)
    or exists(select 1 from app_data_agent.workspace_run_bindings binding
      where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
        and binding.environment=authority.environment and binding.principal_id=authority.principal_id
        and binding.run_id=campaign_run.run_id)
    or exists(select 1 from app_data_agent.effective_run_config_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.principal_id=authority.principal_id
        and receipt.run_id=campaign_run.run_id)
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_RUN_PREEXISTS'; end if;
  acceptance:=app_data_agent.accept_question_run_with_effective_config(
    requested_command,requested_config);
  if acceptance#>>'{resolution,operation}' is distinct from 'QUESTION_RUN'
    or acceptance#>>'{resolution,admission}' is distinct from 'READY'
    or acceptance#>>'{resolution,run_id}' is distinct from campaign_run.run_id::text
    or pg_catalog.jsonb_typeof(acceptance->'effective_config') is distinct from 'object'
  then raise exception using errcode='55000',message='FALCON24_QUESTION_ACCEPTANCE_NOT_READY'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    join app_data_agent.workspace_run_bindings binding
      on binding.app_id=actual.app_id and binding.tenant_id=actual.tenant_id
      and binding.environment=actual.environment and binding.run_id=actual.run_id
      and binding.principal_id=actual.principal_id
    join app_data_agent.effective_run_config_receipts receipt
      on receipt.app_id=actual.app_id and receipt.tenant_id=actual.tenant_id
      and receipt.environment=actual.environment and receipt.run_id=actual.run_id
      and receipt.principal_id=actual.principal_id
      and receipt.datasource_id=binding.datasource_id
      and receipt.model_profile_id=binding.model_profile_id
      and receipt.model_config_version=binding.model_config_version
      and receipt.provider=binding.provider and receipt.model_id=binding.model_id
      and receipt.datasource_revision_hash=binding.datasource_binding_hash
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=campaign_run.run_id and actual.status='QUEUED'
      and receipt.operation_kind='QUESTION_RUN' and receipt.admission='READY')
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_ACCEPTANCE_NOT_ATOMIC'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set claim_fence_consumed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign_run.campaign_id and run_id=campaign_run.run_id
      and status='CLAIMED' and claim_fence_hash=expected_fence_hash
      and claim_fence_consumed_at is null
    returning * into strict campaign_run;
  submit_fence_receipt:=pg_catalog.jsonb_build_object(
    'campaign_id',campaign_run.campaign_id,
    'run_id',campaign_run.run_id,
    'claim_fence_hash',campaign_run.claim_fence_hash,
    'claim_fence_consumed_at',campaign_run.claim_fence_consumed_at);
  return pg_catalog.jsonb_build_object(
    'acceptance',acceptance,'submit_fence',submit_fence_receipt);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUESTION_ACCEPTANCE_INVALID';
end
$function$;
