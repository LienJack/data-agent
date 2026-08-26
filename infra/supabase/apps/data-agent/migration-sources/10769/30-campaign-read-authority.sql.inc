create function app_data_agent.load_falcon24_acceptance_campaign(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-acceptance-campaign-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id';
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  return pg_catalog.to_jsonb(campaign);
end
$function$;

create function app_data_agent.resolve_falcon24_run_execution_policy(requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; execution_policy jsonb;
begin
  if requested_run_id is null then
    raise exception using errcode='22023',message='FALCON24_RUN_EXECUTION_POLICY_INPUT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  select pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'campaign_id',campaign_run.campaign_id,
      'case_id',campaign_run.case_id,
      'run_variant',campaign_run.run_variant,
      'repetition',campaign_run.repetition,
      'policy_id',campaign.policy_id,
      'mode','FALCON24_STRICT',
      'max_run_attempts',1,
      'max_provider_attempts_per_call',1,
      'max_root_turns',1,
      'max_text2sql_candidate_attempts',1,
      'analysis_repair_budget_per_category',0,
      'max_file_transfer_attempts',1,
      'allow_stage_recovery',false,
      'hold_on_failure',true)
    into execution_policy
    from app_data_agent.falcon24_acceptance_campaign_runs campaign_run
    join app_data_agent.falcon24_acceptance_campaigns campaign
      on campaign.app_id=campaign_run.app_id
      and campaign.tenant_id=campaign_run.tenant_id
      and campaign.environment=campaign_run.environment
      and campaign.principal_id=campaign_run.principal_id
      and campaign.campaign_id=campaign_run.campaign_id
    where campaign_run.app_id=authority.app_id
      and campaign_run.tenant_id=authority.tenant_id
      and campaign_run.environment=authority.environment
      and campaign_run.principal_id=authority.principal_id
      and campaign_run.run_id=requested_run_id;
  return execution_policy;
end
$function$;

create function app_data_agent.load_falcon24_pending_failed_run()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; pending jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  begin
    select pg_catalog.jsonb_build_object(
        'campaign_id',campaign.campaign_id,
        'run_id',campaign_run.run_id)
      into strict pending
      from app_data_agent.falcon24_acceptance_campaigns campaign
      join app_data_agent.falcon24_acceptance_campaign_runs campaign_run
        on campaign_run.app_id=campaign.app_id
        and campaign_run.tenant_id=campaign.tenant_id
        and campaign_run.environment=campaign.environment
        and campaign_run.principal_id=campaign.principal_id
        and campaign_run.campaign_id=campaign.campaign_id
        and campaign_run.run_ordinal=campaign.next_run_ordinal
      join app_data_agent.runs run
        on run.app_id=campaign_run.app_id
        and run.tenant_id=campaign_run.tenant_id
        and run.environment=campaign_run.environment
        and run.principal_id=campaign_run.principal_id
        and run.run_id=campaign_run.run_id
      where campaign.app_id=authority.app_id
        and campaign.tenant_id=authority.tenant_id
        and campaign.environment=authority.environment
        and campaign.principal_id=authority.principal_id
        and campaign.status='RUNNING'
        and campaign_run.status='CLAIMED'
        and run.status='FAILED';
  exception
    when no_data_found then return null;
    when too_many_rows then raise exception using errcode='55000',
      message='FALCON24_PENDING_FAILED_RUN_AMBIGUOUS';
  end;
  return pending;
end
$function$;

create function app_data_agent.load_falcon24_acceptance_campaign_run(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-acceptance-campaign-run-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_RUN_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=command->>'campaign_id' and run.run_id=(command->>'run_id')::uuid;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_CAMPAIGN_RUN_LOAD_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_acceptance_trace_gate(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-acceptance-trace-gate-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(command->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_TRACE_GATE_RECEIPT_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=command->>'campaign_id' and run.run_id=(command->>'run_id')::uuid;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  return campaign_run.trace_gate_receipt;
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_TRACE_GATE_RECEIPT_LOAD_INVALID';
end
$function$;
