do $postconditions$
declare definition text;
begin
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)'
        ::pg_catalog.regprocedure;

  if pg_catalog.strpos(definition,'falcon24-submit-outcome-resolution@1.0.0')=0
    or pg_catalog.strpos(definition,'pg_advisory_xact_lock')=0
    or pg_catalog.strpos(definition,'''data-agent:run:''')=0
    or pg_catalog.strpos(definition,'for update')=0
    or pg_catalog.strpos(definition,'workspace_run_bindings')=0
    or pg_catalog.strpos(definition,'effective_run_config_receipts')=0
    or pg_catalog.strpos(definition,'receipt.datasource_id=binding.datasource_id')=0
    or pg_catalog.strpos(definition,'receipt.model_profile_id=binding.model_profile_id')=0
    or pg_catalog.strpos(definition,'FALCON24_SUBMIT_AUTHORITY_CORRUPT')=0
    or pg_catalog.strpos(definition,'''disposition'',''HELD''')=0
    or pg_catalog.strpos(definition,'''disposition'',''ACCEPTED''')=0
    or pg_catalog.regexp_count(definition,'for update')<>3
  then raise exception using errcode='P0001',message='FALCON24_SUBMIT_OUTCOME_LOCK_REPAIR_FUNCTION_DRIFT'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='resolve_falcon24_acceptance_submit_outcome')<>1
    or exists(select 1 from pg_catalog.pg_proc procedure
      where procedure.oid=
        'app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)'
          ::pg_catalog.regprocedure
        and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
          or not procedure.prosecdef
          or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_SUBMIT_OUTCOME_LOCK_REPAIR_SECURITY_DRIFT'; end if;

  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
      'app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role',
      'app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_job_authority',
      'app_data_agent.resolve_falcon24_acceptance_submit_outcome(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='FALCON24_SUBMIT_OUTCOME_LOCK_REPAIR_GRANT_DRIFT'; end if;
end
$postconditions$;
