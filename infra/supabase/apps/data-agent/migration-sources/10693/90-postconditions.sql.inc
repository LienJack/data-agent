do $postconditions$
declare
  function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(
      function_definition,
      'v_projection.projection_payload ->> ''source_digest'' is distinct from v_projection.source_digest'
    ) = 0
    or pg_catalog.strpos(
      function_definition,
      'v_projection.projection_payload ->> ''source_digest'' is distinct from v_source.source_digest'
    ) > 0
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text)',
      'EXECUTE'
    )
  then
    raise exception using errcode='P0001',message='SEMANTIC_GRAPH_STUDIO_DIGEST_REPAIR_POSTCONDITION_FAILED';
  end if;
end $postconditions$;
