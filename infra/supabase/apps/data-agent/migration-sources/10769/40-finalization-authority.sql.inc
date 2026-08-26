create function app_data_agent.claim_falcon24_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
  reclamation_recovery_hash text; reclamation_claim_hash text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','runtime_attestation_hash',
      'reclamation_recovery_token','reclamation_claim_token','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-sandbox-reclamation-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'runtime_attestation_hash') is distinct from 'string'
    or command->>'runtime_attestation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'reclamation_recovery_token') is distinct from 'string'
    or (command->>'reclamation_recovery_token')::uuid is null
    or pg_catalog.jsonb_typeof(command->'reclamation_claim_token') is distinct from 'string'
    or (command->>'reclamation_claim_token')::uuid is null
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_CLAIM_INVALID'; end if;
  reclamation_recovery_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'reclamation_recovery_token',command->>'reclamation_recovery_token'));
  reclamation_claim_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('reclamation_claim_token',command->>'reclamation_claim_token'));
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  if campaign.runtime_attestation_hash<>command->>'runtime_attestation_hash'
  then raise exception using errcode='55000',message='FALCON24_SANDBOX_ATTESTATION_MISMATCH'; end if;
  if campaign_run.sandbox_reclamation_hash is not null then
    if campaign_run.sandbox_reclamation_recovery_hash is distinct from
      reclamation_recovery_hash
    then raise exception using errcode='55000',
      message='FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  if campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.claim_fence_hash is null
    or campaign_run.claim_fence_consumed_at is null
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED'; end if;
  if campaign_run.trace_closure_hash is null
    or campaign_run.trace_gate_receipt_hash is null
    or campaign_run.trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_TRACE_STAGE_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  if campaign_run.sandbox_reclamation_claim_hash is not null then
    if campaign_run.sandbox_reclamation_recovery_hash<>reclamation_recovery_hash
      or campaign_run.sandbox_reclamation_claim_expires_at>now_at
    then raise exception using errcode='55000',
      message='FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED'; end if;
    update app_data_agent.falcon24_acceptance_campaign_runs set
      sandbox_reclamation_claim_hash=reclamation_claim_hash,
      sandbox_reclamation_claimed_at=now_at,
      sandbox_reclamation_claim_expires_at=now_at+interval '15 minutes'
      where app_id=authority.app_id and tenant_id=authority.tenant_id
        and environment=authority.environment and principal_id=authority.principal_id
        and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id
        and status='CLAIMED'
        and sandbox_reclamation_recovery_hash=reclamation_recovery_hash
        and sandbox_reclamation_claim_expires_at<=now_at
        and sandbox_reclamation_claim_consumed_at is null
        and sandbox_reclamation_hash is null
      returning * into strict campaign_run;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  update app_data_agent.falcon24_acceptance_campaign_runs set
    sandbox_reclamation_recovery_hash=reclamation_recovery_hash,
    sandbox_reclamation_claim_hash=reclamation_claim_hash,
    sandbox_reclamation_claimed_at=now_at,
    sandbox_reclamation_claim_expires_at=now_at+interval '15 minutes'
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id
      and status='CLAIMED' and sandbox_reclamation_recovery_hash is null
      and sandbox_reclamation_claim_hash is null
    returning * into strict campaign_run;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_CLAIM_INVALID';
end
$function$;

create or replace function app_data_agent.record_falcon24_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','reclamation_claim_token','sandbox_reclamation_hash',
      'sandbox_reclamation_receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-sandbox-reclamation-record@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'reclamation_claim_token') is distinct from 'string'
    or (command->>'reclamation_claim_token')::uuid is null
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID'; end if;
  receipt:=command->'sandbox_reclamation_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','runtime_attestation_hash',
      'management_observation_schema_version','management_operation_id','observation_source',
      'target_metadata_hash','before_observation','killed','after_observation','residual',
      'completed_at','management_observation_hash','receipt_hash']::text[])
      is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-sandbox-reclamation-receipt@2.0.0'
    or receipt->>'campaign_id' is distinct from command->>'campaign_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or receipt->>'management_observation_schema_version' is distinct from
      'opensandbox-management-reclamation-observation@1.0.0'
    or pg_catalog.jsonb_typeof(receipt->'management_operation_id') is distinct from 'string'
    or (receipt->>'management_operation_id')::uuid is null
    or receipt->>'observation_source' is distinct from 'OPENSANDBOX_MANAGEMENT_API'
    or pg_catalog.jsonb_typeof(receipt->'target_metadata_hash') is distinct from 'string'
    or receipt->>'target_metadata_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'before_observation') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'before_observation',array['active_count','observation_hash']::text[])
      is distinct from true
    or pg_catalog.jsonb_typeof(receipt#>'{before_observation,active_count}')
      is distinct from 'number'
    or receipt#>>'{before_observation,active_count}'!~'^(0|[1-9][0-9]*)$'
    or pg_catalog.jsonb_typeof(receipt#>'{before_observation,observation_hash}')
      is distinct from 'string'
    or receipt#>>'{before_observation,observation_hash}'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'runtime_attestation_hash') is distinct from 'string'
    or receipt->>'runtime_attestation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'killed') is distinct from 'number'
    or receipt->>'killed'!~'^(0|[1-9][0-9]*)$'
    or receipt->>'killed' is distinct from receipt#>>'{before_observation,active_count}'
    or pg_catalog.jsonb_typeof(receipt->'after_observation') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'after_observation',array['active_count','observation_hash']::text[])
      is distinct from true
    or pg_catalog.jsonb_typeof(receipt#>'{after_observation,active_count}')
      is distinct from 'number'
    or receipt#>>'{after_observation,active_count}' is distinct from '0'
    or pg_catalog.jsonb_typeof(receipt#>'{after_observation,observation_hash}')
      is distinct from 'string'
    or receipt#>>'{after_observation,observation_hash}'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'residual') is distinct from 'number'
    or receipt->>'residual' is distinct from '0'
    or pg_catalog.jsonb_typeof(receipt->'completed_at') is distinct from 'string'
    or receipt->>'completed_at'!~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
    or pg_catalog.jsonb_typeof(receipt->'management_observation_hash') is distinct from 'string'
    or receipt->>'management_observation_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-array[
        'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
    or pg_catalog.jsonb_typeof(receipt->'receipt_hash') is distinct from 'string'
    or receipt->>'receipt_hash' is distinct from command->>'sandbox_reclamation_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found or campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.trace_closure_hash is null
    or campaign_run.trace_gate_receipt_hash is null
    or campaign_run.trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_TRACE_STAGE_REQUIRED'; end if;
  if campaign_run.claim_fence_hash is null
    or campaign_run.claim_fence_consumed_at is null
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  if receipt->>'runtime_attestation_hash' is distinct from campaign.runtime_attestation_hash
  then raise exception using errcode='55000',message='FALCON24_SANDBOX_ATTESTATION_MISMATCH'; end if;
  if campaign_run.sandbox_reclamation_claim_hash is null
    or campaign_run.sandbox_reclamation_claimed_at is null
  then raise exception using errcode='55000',
    message='FALCON24_SANDBOX_RECLAMATION_CLAIM_REQUIRED'; end if;
  if campaign_run.sandbox_reclamation_claim_hash<>
    app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'reclamation_claim_token',command->>'reclamation_claim_token'))
  then raise exception using errcode='55000',
    message='FALCON24_SANDBOX_RECLAMATION_CLAIM_MISMATCH'; end if;
  if campaign_run.sandbox_reclamation_hash is not null then
    if campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
      or campaign_run.sandbox_reclamation_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  update app_data_agent.falcon24_acceptance_campaign_runs set
    sandbox_reclamation_hash=command->>'sandbox_reclamation_hash',
    sandbox_reclamation_receipt=receipt,
    sandbox_reclamation_claim_consumed_at=pg_catalog.clock_timestamp()
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id and status='CLAIMED'
      and sandbox_reclamation_claim_hash=
        app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
          'reclamation_claim_token',command->>'reclamation_claim_token'))
      and sandbox_reclamation_claim_consumed_at is null
      and sandbox_reclamation_hash is null
    returning * into strict campaign_run;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID';
end
$function$;

create or replace function app_data_agent.complete_falcon24_acceptance_run(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','expected_result_hash',
      'sandbox_reclamation_hash','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-run-complete@2.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'expected_result_hash') is distinct from 'string'
    or command->>'expected_result_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_RUN_COMPLETION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found then raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.status='VERIFIED' then
    if campaign_run.trace_closure_hash is null
      or campaign_run.trace_gate_receipt_hash is null
      or campaign_run.trace_gate_receipt is null
      or campaign_run.result_hash<>command->>'expected_result_hash'
      or campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
    then raise exception using errcode='55000',message='FALCON24_RUN_COMPLETION_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign);
  end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  if campaign_run.claim_fence_hash is null
    or campaign_run.claim_fence_consumed_at is null
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_FENCE_REQUIRED'; end if;
  if campaign_run.trace_closure_hash is null
    or campaign_run.trace_gate_receipt_hash is null
    or campaign_run.trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_TRACE_STAGE_REQUIRED'; end if;
  if campaign_run.result_hash is null or campaign_run.result_document is null
    or campaign_run.result_hash<>command->>'expected_result_hash'
  then raise exception using errcode='55000',message='FALCON24_RESULT_STAGE_REQUIRED'; end if;
  if campaign_run.sandbox_reclamation_hash is null
    or campaign_run.sandbox_reclamation_receipt is null
    or campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
  then raise exception using errcode='55000',message='FALCON24_SANDBOX_RECLAMATION_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set
    status='VERIFIED',completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=(command->>'run_id')::uuid
      and run_ordinal=campaign.next_run_ordinal and status='CLAIMED'
    returning * into strict campaign_run;
  update app_data_agent.falcon24_acceptance_campaigns set
    next_run_ordinal=next_run_ordinal+1,
    status=case when next_run_ordinal+1=run_count then 'PASSED' else 'READY' end,
    updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id returning * into strict campaign;
  return pg_catalog.to_jsonb(campaign);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_RUN_COMPLETION_INVALID';
end
$function$;
