do $patch_semantic_context_aliases$
declare
  signature text;
  definition text;
  initial_predecessor constant text:=$fragment$
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
$fragment$;
  metric_initial_successor constant text:=$fragment$
  if pg_catalog.jsonb_array_length(initial_value)>0 then
    return coalesce((select pg_catalog.jsonb_agg(
      item.value||pg_catalog.jsonb_build_object(
        'aliases',coalesce((select pg_catalog.jsonb_agg(to_jsonb(alias.value) order by alias.value)
          from (select distinct element.value#>>'{}' value
            from pg_catalog.jsonb_array_elements(
              coalesce(item.value->'aliases','[]'::jsonb)) element(value)
            where pg_catalog.jsonb_typeof(element.value)='string') alias),'[]'::jsonb))
      order by item.value->>'metric_id')
      from pg_catalog.jsonb_array_elements(initial_value) item(value)),'[]'::jsonb);
  end if;
$fragment$;
  ontology_initial_successor constant text:=$fragment$
  if pg_catalog.jsonb_array_length(initial_value)>0 then
    return coalesce((select pg_catalog.jsonb_agg(
      item.value||pg_catalog.jsonb_build_object(
        'aliases',coalesce((select pg_catalog.jsonb_agg(to_jsonb(alias.value) order by alias.value)
          from (select distinct element.value#>>'{}' value
            from pg_catalog.jsonb_array_elements(
              coalesce(item.value->'aliases','[]'::jsonb)) element(value)
            where pg_catalog.jsonb_typeof(element.value)='string') alias),'[]'::jsonb))
      order by item.value->>'object_id')
      from pg_catalog.jsonb_array_elements(initial_value) item(value)),'[]'::jsonb);
  end if;
$fragment$;
  metric_alias_predecessor constant text:=$fragment$
      'aliases',coalesce(metric.value->'aliases','[]'::jsonb),
$fragment$;
  metric_alias_successor constant text:=$fragment$
      'aliases',coalesce((select pg_catalog.jsonb_agg(to_jsonb(alias.value) order by alias.value)
        from (select distinct element.value#>>'{}' value
          from pg_catalog.jsonb_array_elements(
            coalesce(metric.value->'aliases','[]'::jsonb)) element(value)
          where pg_catalog.jsonb_typeof(element.value)='string') alias),'[]'::jsonb),
$fragment$;
  ontology_alias_predecessor constant text:=$fragment$
      'aliases',coalesce(node.value->'aliases','[]'::jsonb),
$fragment$;
  ontology_alias_successor constant text:=$fragment$
      'aliases',coalesce((select pg_catalog.jsonb_agg(to_jsonb(alias.value) order by alias.value)
        from (select distinct element.value#>>'{}' value
          from pg_catalog.jsonb_array_elements(
            coalesce(node.value->'aliases','[]'::jsonb)) element(value)
          where pg_catalog.jsonb_typeof(element.value)='string') alias),'[]'::jsonb),
$fragment$;
begin
  foreach signature in array array[
    'app_data_agent.semantic_context_metric_projection(uuid,uuid,text,text,uuid)',
    'app_data_agent.semantic_context_ontology_projection(uuid,uuid,text,text,uuid)'
  ]::text[]
  loop
    select pg_catalog.pg_get_functiondef(signature::pg_catalog.regprocedure)
      into strict definition;
    if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,initial_predecessor,'')))
      /pg_catalog.length(initial_predecessor)<>1
    then raise exception using errcode='P0001',
      message='SEMANTIC_CONTEXT_CANONICAL_ALIASES_INITIAL_DRIFT'; end if;
    if signature like '%metric_projection(%' then
      if (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,metric_alias_predecessor,'')))
        /pg_catalog.length(metric_alias_predecessor)<>1
      then raise exception using errcode='P0001',
        message='SEMANTIC_CONTEXT_CANONICAL_METRIC_ALIASES_DRIFT'; end if;
      definition:=pg_catalog.replace(
        definition,initial_predecessor,metric_initial_successor);
      definition:=pg_catalog.replace(
        definition,metric_alias_predecessor,metric_alias_successor);
    else
      if (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,ontology_alias_predecessor,'')))
        /pg_catalog.length(ontology_alias_predecessor)<>1
      then raise exception using errcode='P0001',
        message='SEMANTIC_CONTEXT_CANONICAL_ONTOLOGY_ALIASES_DRIFT'; end if;
      definition:=pg_catalog.replace(
        definition,initial_predecessor,ontology_initial_successor);
      definition:=pg_catalog.replace(
        definition,ontology_alias_predecessor,ontology_alias_successor);
    end if;
    execute definition;
  end loop;
end
$patch_semantic_context_aliases$;
