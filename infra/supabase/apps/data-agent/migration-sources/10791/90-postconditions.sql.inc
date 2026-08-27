do $postconditions$
begin
  if pg_catalog.to_regprocedure(
      'app_data_agent.load_falcon24_semantic_authority_closure(jsonb)') is null
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_semantic_authority_closure(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_semantic_authority_closure(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_active_pointer','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_runtime_activation','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.workspace_run_defaults','SELECT')
  then raise exception using errcode='P0001',
    message='FALCON24_SEMANTIC_CLOSURE_READBACK_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
