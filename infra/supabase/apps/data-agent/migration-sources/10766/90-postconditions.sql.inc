do $postconditions$
begin
  if exists(select 1 from pg_catalog.pg_class relation
      where relation.oid in(
        'app_data_agent.falcon24_acceptance_campaigns'::pg_catalog.regclass,
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass)
        and (pg_catalog.pg_get_userbyid(relation.relowner)<>'data_agent_u6_rpc_owner'
          or not relation.relrowsecurity or not relation.relforcerowsecurity))
    or exists(select 1 from pg_catalog.pg_proc procedure
      where procedure.oid in(
        'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.claim_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.stage_falcon24_acceptance_result(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.complete_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_run_result(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_results(jsonb)'::pg_catalog.regprocedure)
        and pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner')
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='falcon24_acceptance_campaigns'
        and policyname='falcon24_acceptance_campaign_authority' and cmd='ALL'
        and roles='{data_agent_u6_rpc_owner}'
        and pg_catalog.strpos(qual,'backend_context_matches')>0
        and pg_catalog.strpos(with_check,'backend_context_matches')>0)
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='falcon24_acceptance_campaign_runs'
        and policyname='falcon24_acceptance_campaign_run_authority' and cmd='ALL'
        and roles='{data_agent_u6_rpc_owner}'
        and pg_catalog.strpos(qual,'backend_context_matches')>0
        and pg_catalog.strpos(with_check,'backend_context_matches')>0)
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.claim_falcon24_acceptance_run(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.stage_falcon24_acceptance_result(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_run_result(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_results(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.claim_falcon24_acceptance_run(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.stage_falcon24_acceptance_result(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_acceptance_run_result(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_acceptance_results(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_acceptance_campaigns','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_acceptance_campaign_runs','SELECT')
  then raise exception using errcode='P0001',message='FALCON24_CAMPAIGN_AUTHORITY_NOT_INSTALLED'; end if;
end
$postconditions$;
