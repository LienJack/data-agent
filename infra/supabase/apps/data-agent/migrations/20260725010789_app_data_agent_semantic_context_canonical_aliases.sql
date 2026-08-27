-- semantic_context_canonical_aliases_migration_checksum: sha256:9bdc5ee971effe1e358785ccb55c1d411e23f12a64d73d95908d43950bbace31
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010788_app_data_agent_root_default_policy_compatibility')
    or pg_catalog.to_regprocedure(
      'app_data_agent.semantic_context_metric_projection(uuid,uuid,text,text,uuid)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.semantic_context_ontology_projection(uuid,uuid,text,text,uuid)') is null
  then raise exception using errcode='P0001',
    message='SEMANTIC_CONTEXT_CANONICAL_ALIASES_BASELINE_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
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
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010789_app_data_agent_semantic_context_canonical_aliases',
  'sha256:9bdc5ee971effe1e358785ccb55c1d411e23f12a64d73d95908d43950bbace31');
commit;
