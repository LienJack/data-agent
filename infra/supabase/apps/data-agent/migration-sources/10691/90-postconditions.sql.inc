do $postconditions$ begin
  if not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_active_pointer'::regclass
        and tgname='semantic_active_release_defaults_promotion' and not tgisinternal)
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid)'::regprocedure),
      'projection.release_id=release.release_id')>0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.resolved_context_ontology_projection(uuid,uuid,text,text,uuid)'::regprocedure),
      'executable.release_id=release.release_id')>0
  then raise exception using errcode='P0001',message='SEMANTIC_TEXT2SQL_PROMOTION_POSTCONDITION_FAILED'; end if;
end $postconditions$;
