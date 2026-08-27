create or replace function app_data_agent.resolve_falcon24_run_execution_policy(
  requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; execution_policy jsonb; candidate_count bigint;
begin
  if requested_run_id is null then
    raise exception using errcode='22023',message='FALCON24_RUN_EXECUTION_POLICY_INPUT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  with candidates as (
    select pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind','CAMPAIGN',
      'campaign_id',campaign_run.campaign_id,'case_id',campaign_run.case_id,
      'run_variant',campaign_run.run_variant,'repetition',campaign_run.repetition,
      'policy_id',campaign.policy_id,'mode','FALCON24_STRICT','max_run_attempts',1,
      'max_provider_attempts_per_call',1,'max_root_turns',4,
      'max_text2sql_candidate_attempts',1,'analysis_repair_budget_per_category',0,
      'max_file_transfer_attempts',1,'allow_stage_recovery',false,'hold_on_failure',true) policy
    from app_data_agent.falcon24_acceptance_campaign_runs campaign_run
    join app_data_agent.falcon24_acceptance_campaigns campaign
      on campaign.app_id=campaign_run.app_id and campaign.tenant_id=campaign_run.tenant_id
      and campaign.environment=campaign_run.environment
      and campaign.principal_id=campaign_run.principal_id
      and campaign.campaign_id=campaign_run.campaign_id
    where campaign_run.app_id=authority.app_id and campaign_run.tenant_id=authority.tenant_id
      and campaign_run.environment=authority.environment
      and campaign_run.principal_id=authority.principal_id
      and campaign_run.run_id=requested_run_id
    union all
    select pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind','QUALIFICATION',
      'campaign_id',slot.qualification_id,'case_id',slot.case_id,
      'run_variant',slot.run_variant,'repetition',1,
      'policy_id','falcon24-strict-zero-retry@1.0.0','mode','FALCON24_STRICT',
      'max_run_attempts',1,'max_provider_attempts_per_call',1,'max_root_turns',4,
      'max_text2sql_candidate_attempts',1,'analysis_repair_budget_per_category',0,
      'max_file_transfer_attempts',1,'allow_stage_recovery',false,'hold_on_failure',true) policy
    from app_data_agent.falcon24_qualification_slots slot
    join app_data_agent.falcon24_qualifications qualification
      on qualification.app_id=slot.app_id and qualification.tenant_id=slot.tenant_id
      and qualification.environment=slot.environment
      and qualification.principal_id=slot.principal_id
      and qualification.qualification_id=slot.qualification_id
    where slot.app_id=authority.app_id and slot.tenant_id=authority.tenant_id
      and slot.environment=authority.environment and slot.principal_id=authority.principal_id
      and slot.run_id=requested_run_id), aggregate_candidates as (
    select pg_catalog.count(*) count_value,pg_catalog.jsonb_agg(policy) policies from candidates)
  select count_value,policies->0 into strict candidate_count,execution_policy
    from aggregate_candidates;
  if candidate_count>1 then
    raise exception using errcode='55000',message='FALCON24_RUN_EXECUTION_POLICY_AMBIGUOUS';
  end if;
  if candidate_count=0 then return null; end if;
  return execution_policy;
end
$function$;

do $root_policy_patch$
declare definition text;old_default text;new_default text;old_qualification text;
  new_qualification text;
begin
  old_default:=$$'max_root_turns',2$$;
  new_default:=$$'max_root_turns',4$$;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.assert_provider_active_worker_lease(jsonb)'::pg_catalog.regprocedure)
    into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_default,'')))
      /pg_catalog.length(old_default)<>1
  then raise exception using errcode='P0001',message='ROOT_DEFAULT_POLICY_PATCH_DRIFT'; end if;
  execute pg_catalog.replace(definition,old_default,new_default);

  old_qualification:=$$execution_policy->>'max_root_turns' is distinct from '1'$$;
  new_qualification:=$$execution_policy->>'max_root_turns' is distinct from '4'$$;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.complete_falcon24_qualification_slot(jsonb)'::pg_catalog.regprocedure)
    into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_qualification,'')))
      /pg_catalog.length(old_qualification)<>1
  then raise exception using errcode='P0001',message='ROOT_QUALIFICATION_POLICY_PATCH_DRIFT'; end if;
  execute pg_catalog.replace(definition,old_qualification,new_qualification);
end
$root_policy_patch$;
