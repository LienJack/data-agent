do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.semantic_context_ontology_projection(uuid,uuid,text,text,uuid)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'assertion-kind:RELATIONSHIP')=0
    or pg_catalog.strpos(definition,'assertion-kind:QUALITY_CONSTRAINT')=0
    or pg_catalog.strpos(definition,'assertion-kind:TIME_SEMANTICS')=0
    or pg_catalog.strpos(definition,'semantic_graph_projection')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CHANGE_SET_PROJECTION_NOT_INSTALLED'; end if;
end
$postconditions$;
