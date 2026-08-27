do $postconditions$
declare
  signature text;
  definition text;
begin
  foreach signature in array array[
    'app_data_agent.semantic_context_metric_projection(uuid,uuid,text,text,uuid)',
    'app_data_agent.semantic_context_ontology_projection(uuid,uuid,text,text,uuid)'
  ]::text[]
  loop
    select pg_catalog.pg_get_functiondef(signature::pg_catalog.regprocedure)
      into strict definition;
    if pg_catalog.strpos(definition,
        $$select distinct element.value#>>'{}' value$$)=0
      or pg_catalog.strpos(definition,
        $$pg_catalog.jsonb_agg(to_jsonb(alias.value) order by alias.value)$$)=0
      or pg_catalog.strpos(definition,
        $$then return initial_value; end if;$$)>0
    then raise exception using errcode='P0001',
      message='SEMANTIC_CONTEXT_CANONICAL_ALIASES_POSTCONDITION_FAILED'; end if;
  end loop;
end
$postconditions$;
