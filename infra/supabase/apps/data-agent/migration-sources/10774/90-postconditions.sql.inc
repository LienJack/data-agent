do $postconditions$
declare definition text; function_name text;
  public_functions constant text[]:=array[
    'load_falcon24_qualification','load_falcon24_qualification_slot',
    'begin_falcon24_qualification','claim_falcon24_qualification_slot',
    'accept_falcon24_qualification_run_with_config',
    'resolve_falcon24_qualification_submit_outcome','hold_falcon24_qualification',
    'stage_falcon24_qualification_result','stage_falcon24_qualification_trace',
    'stage_falcon24_qualification_ui_trace','load_falcon24_qualification_pending_failed_run',
    'claim_falcon24_qualification_sandbox_reclamation',
    'record_falcon24_qualification_sandbox_reclamation',
    'claim_falcon24_qualification_forced_cleanup',
    'resolve_falcon24_qualification_forced_cleanup',
    'complete_falcon24_qualification_slot']::text[];
begin
  if pg_catalog.to_regclass('app_data_agent.falcon24_qualifications') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_qualification_slots') is null
    or (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid in(
        'app_data_agent.falcon24_qualifications'::pg_catalog.regclass,
        'app_data_agent.falcon24_qualification_slots'::pg_catalog.regclass)
        and trigger_row.tgname in('falcon24_qualifications_state_fence',
          'falcon24_qualification_slots_state_fence') and not trigger_row.tgisinternal)<>2
    or (select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid=
        'app_data_agent.falcon24_qualification_slots'::pg_catalog.regclass
        and constraint_row.conname in(
          'falcon24_qualification_slot_result_binding_check',
          'falcon24_qualification_slot_trace_binding_check',
          'falcon24_qualification_slot_ui_trace_binding_check',
          'falcon24_qualification_slot_reclamation_binding_check',
          'falcon24_qualification_slot_forced_cleanup_binding_check',
          'falcon24_qualification_slot_forced_cleanup_state_check'))<>6
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_SCHEMA_DRIFT'; end if;

  foreach function_name in array public_functions loop
    if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent' and procedure.proname=function_name)<>1
    then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_FUNCTION_INVENTORY_DRIFT'; end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.proname=any(public_functions)
      and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
        or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_FUNCTION_SECURITY_DRIFT'; end if;

  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_falcon24_qualification_run_with_config(jsonb,jsonb,jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'accept_question_run_with_effective_config')=0
    or pg_catalog.strpos(definition,'claim_fence_consumed_at')=0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'''acceptance_authority_kind'',''QUALIFICATION''')=0
    or pg_catalog.strpos(definition,'''acceptance_authority_kind'',''CAMPAIGN''')=0
    or pg_catalog.strpos(definition,'''analysis_repair_budget_per_category'',0')=0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_EXECUTION_POLICY_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.complete_falcon24_qualification_slot(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'run.retry_scheduled')=0
    or pg_catalog.strpos(definition,'falcon24_qualification_repair_evidence_present')=0
    or pg_catalog.strpos(definition,'ui_trace_gate_receipt')=0
    or pg_catalog.strpos(definition,'sandbox_reclamation_receipt')=0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_COMPLETION_GATE_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.stage_falcon24_qualification_result(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'actual.status=''RUNNING''')=0
    or pg_catalog.strpos(definition,'actual.status=''SUCCEEDED''')>0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_RESULT_STAGE_TIMING_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'>=15')=0
    or pg_catalog.strpos(definition,'FALCON24_QUALIFICATION_V15_GATE_REQUIRED')=0
    or pg_catalog.strpos(definition,'qualification.status=''PASSED''')=0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_FINAL_GATE_DRIFT'; end if;

  if exists(select 1 from pg_catalog.unnest(array[
      'SELECT','INSERT','UPDATE','DELETE']::text[]) privilege_name
    where pg_catalog.has_table_privilege('data_agent_backend',
        'app_data_agent.falcon24_qualifications',privilege_name)
      or pg_catalog.has_table_privilege('data_agent_backend',
        'app_data_agent.falcon24_qualification_slots',privilege_name))
    or exists(select 1 from pg_catalog.unnest(public_functions) name
      where not pg_catalog.has_function_privilege('data_agent_backend',
        case name
          when 'accept_falcon24_qualification_run_with_config'
            then 'app_data_agent.'||name||'(jsonb,jsonb,jsonb)'
          when 'load_falcon24_qualification_pending_failed_run'
            then 'app_data_agent.'||name||'()'
          else 'app_data_agent.'||name||'(jsonb)' end,'EXECUTE'))
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_GRANT_DRIFT'; end if;
end
$postconditions$;
