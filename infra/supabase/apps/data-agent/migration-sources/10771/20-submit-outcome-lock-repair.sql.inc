create or replace function app_data_agent.resolve_falcon24_acceptance_submit_outcome(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;
  campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
  actual_count bigint; binding_count bigint; receipt_count bigint; exact_triple_count bigint;
  durable_failure_code text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','observed_failure_code','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-submit-outcome-resolution@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or (command->>'run_id')::uuid::text is distinct from command->>'run_id'
    or pg_catalog.jsonb_typeof(command->'observed_failure_code') is distinct from 'string'
    or command->>'observed_failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_SUBMIT_OUTCOME_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||(command->>'run_id'),0));

  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;

  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id
      and run.run_id=(command->>'run_id')::uuid for update;
  if not found or campaign_run.run_ordinal<>campaign.next_run_ordinal then
    raise exception using errcode='55000',message='FALCON24_SUBMIT_AUTHORITY_CORRUPT';
  end if;

  if campaign.status='HOLD' then
    if campaign.first_failure_run_id is distinct from campaign_run.run_id
      or campaign.first_failure_layer is distinct from 'ROOT_ROUTING'
      or campaign_run.status<>'HOLD'
    then raise exception using errcode='55000',message='FALCON24_SUBMIT_AUTHORITY_CORRUPT'; end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','falcon24-submit-outcome-resolution@1.0.0',
      'disposition','HELD','campaign_id',campaign.campaign_id,
      'run_id',campaign_run.run_id,'failure_code',campaign.first_failure_code);
  end if;

  if campaign.status not in('READY','RUNNING')
    or campaign_run.status not in('PLANNED','CLAIMED')
  then raise exception using errcode='55000',message='FALCON24_SUBMIT_OUTCOME_UNKNOWN'; end if;

  perform 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=campaign_run.run_id for update;
  select pg_catalog.count(*) into strict actual_count from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=campaign_run.run_id;
  select pg_catalog.count(*) into strict binding_count
    from app_data_agent.workspace_run_bindings binding
    where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
      and binding.environment=authority.environment and binding.principal_id=authority.principal_id
      and binding.run_id=campaign_run.run_id;
  select pg_catalog.count(*) into strict receipt_count
    from app_data_agent.effective_run_config_receipts receipt
    where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
      and receipt.environment=authority.environment and receipt.principal_id=authority.principal_id
      and receipt.run_id=campaign_run.run_id;
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
      and actual.run_id=campaign_run.run_id
      and receipt.operation_kind='QUESTION_RUN' and receipt.admission='READY';

  if campaign.status='RUNNING' and campaign_run.status='CLAIMED'
    and campaign_run.claim_fence_hash is not null
    and campaign_run.claim_fence_consumed_at is not null
    and actual_count=1 and binding_count=1 and receipt_count=1 and exact_triple_count=1
  then
    return pg_catalog.jsonb_build_object(
      'schema_version','falcon24-submit-outcome-resolution@1.0.0',
      'disposition','ACCEPTED','campaign_id',campaign.campaign_id,
      'run_id',campaign_run.run_id,'claim_fence_hash',campaign_run.claim_fence_hash,
      'claim_fence_consumed_at',campaign_run.claim_fence_consumed_at);
  end if;

  if campaign.status='READY' and campaign_run.status='PLANNED'
    and campaign_run.claim_fence_hash is null
    and campaign_run.claim_fence_consumed_at is null
    and actual_count=0 and binding_count=0 and receipt_count=0 and exact_triple_count=0
  then
    durable_failure_code:=command->>'observed_failure_code';
  elsif campaign.status='RUNNING' and campaign_run.status='CLAIMED'
    and campaign_run.claim_fence_hash is not null
    and campaign_run.claim_fence_consumed_at is null
    and actual_count=0 and binding_count=0 and receipt_count=0 and exact_triple_count=0
  then
    durable_failure_code:=command->>'observed_failure_code';
  else
    durable_failure_code:='FALCON24_SUBMIT_AUTHORITY_CORRUPT';
  end if;

  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set
    status='HOLD',claimed_at=pg_catalog.coalesce(claimed_at,now_at),completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_ordinal=campaign_run.run_ordinal
      and run_id=campaign_run.run_id and status=campaign_run.status
    returning * into strict campaign_run;
  update app_data_agent.falcon24_acceptance_campaigns set
    status='HOLD',first_failure_run_id=campaign_run.run_id,
    first_failure_layer='ROOT_ROUTING',first_failure_code=durable_failure_code,updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and status=campaign.status
    returning * into strict campaign;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-submit-outcome-resolution@1.0.0',
    'disposition','HELD','campaign_id',campaign.campaign_id,
    'run_id',campaign_run.run_id,'failure_code',campaign.first_failure_code);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_SUBMIT_OUTCOME_INVALID';
end
$function$;
