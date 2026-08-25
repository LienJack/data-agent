do $postconditions$
begin
  if exists(
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.prokind='f'
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'app_data_agent.resolved_context_exact_keys'
      )>0
  ) or pg_catalog.to_regprocedure(
    'app_data_agent.resolved_context_exact_keys(jsonb,text[])'
  ) is not null
  then raise exception using errcode='P0001',message='SEMANTIC_HELPER_RETIRED_REFERENCE_REMAINS'; end if;

  if not pg_catalog.has_function_privilege(
    'data_agent_u14_extension_owner',
    'app_data_agent.semantic_context_exact_keys(jsonb,text[])',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_u20_profile_owner',
    'app_data_agent.semantic_context_exact_keys(jsonb,text[])',
    'EXECUTE'
  )
  then raise exception using errcode='P0001',message='SEMANTIC_HELPER_CONSUMER_GRANT_MISSING'; end if;
end
$postconditions$;
