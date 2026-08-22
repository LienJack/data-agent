do $postconditions$ begin
  if not pg_catalog.has_table_privilege(
      'data_agent_u12_context_owner','app_data_agent.model_catalog_entries','SELECT')
    or not exists(select 1 from pg_catalog.pg_policy policy
      where policy.polrelid='app_data_agent.model_catalog_entries'::regclass
        and policy.polname='model_catalog_resolved_context_select')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'semantic.promote_active_semantic_release_to_workspace_defaults()'::regprocedure),
      'semantic.semantic_source_release release')=0
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_PROMOTION_REPAIR_POSTCONDITION_FAILED'; end if;
end $postconditions$;
