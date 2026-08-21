create or replace function app_data_agent.resolved_context_metric_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language plpgsql stable set search_path='' as $function$
declare initial_value jsonb;
begin
  initial_value:=app_data_agent.resolved_context_metric_projection_initial(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
  );
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'metric_id',metric.value->>'metric_id','name',metric.value->>'name',
      'aliases',coalesce(metric.value->'aliases','[]'::jsonb),
      'mapping_refs',coalesce((select pg_catalog.jsonb_agg(to_jsonb(reference.value) order by reference.value)
        from (select distinct item.value#>>'{}' value
          from pg_catalog.jsonb_array_elements(
            pg_catalog.jsonb_build_array(metric.value->>'column_id')||
              coalesce(metric.value->'dependency_column_ids','[]'::jsonb)
          ) item(value) where item.value#>>'{}' is not null) reference),'[]'::jsonb),
      'mapping_hash',app_data_agent.u2_canonical_sha256(metric.value),
      'formula_hash',app_data_agent.u2_canonical_sha256(coalesce(metric.value->'formula','null'::jsonb))
    ) order by metric.value->>'metric_id')
    from semantic.semantic_source_release release
    join semantic.semantic_executable_projection projection
      on projection.app_id=release.app_id and projection.tenant_id=release.tenant_id
      and projection.environment=release.environment and projection.semantic_domain=release.semantic_domain
      and projection.projection_id=release.executable_projection_ref
      and projection.projection_digest=release.executable_projection_hash
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(projection.projection_payload->'metrics','[]'::jsonb)
    ) metric(value)
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id
  ),'[]'::jsonb);
end
$function$;

create or replace function app_data_agent.resolved_context_ontology_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language plpgsql stable set search_path='' as $function$
declare initial_value jsonb;
begin
  initial_value:=app_data_agent.resolved_context_ontology_projection_initial(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
  );
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'object_id',node.value->>'node_id',
      'object_kind',case node.value->>'node_type' when 'BUSINESS_SUBJECT' then 'ENTITY'
        when 'GLOSSARY_TERM' then 'TERM' else 'DIMENSION' end,
      'name',node.value->>'name','aliases',coalesce(node.value->'aliases','[]'::jsonb),
      'queryable',dimension.value is not null,
      'mapping_refs',case when dimension.value is null then '[]'::jsonb
        else pg_catalog.jsonb_build_array(dimension.value->>'column_id') end,
      'object_hash',app_data_agent.u2_canonical_sha256(node.value)
    ) order by node.value->>'node_id')
    from semantic.semantic_source_release release
    join semantic.semantic_source_release_graph_projection binding
      on binding.app_id=release.app_id and binding.tenant_id=release.tenant_id
      and binding.environment=release.environment and binding.semantic_domain=release.semantic_domain
      and binding.release_id=release.release_id
    join semantic.semantic_graph_projection graph
      on graph.app_id=binding.app_id and graph.tenant_id=binding.tenant_id
      and graph.environment=binding.environment and graph.semantic_domain=binding.semantic_domain
      and graph.projection_id=binding.projection_id
    join semantic.semantic_executable_projection executable
      on executable.app_id=release.app_id and executable.tenant_id=release.tenant_id
      and executable.environment=release.environment and executable.semantic_domain=release.semantic_domain
      and executable.projection_id=release.executable_projection_ref
      and executable.projection_digest=release.executable_projection_hash
    cross join lateral pg_catalog.jsonb_array_elements(graph.projection_payload->'nodes') node(value)
    left join lateral (
      select item.value from pg_catalog.jsonb_array_elements(
        coalesce(executable.projection_payload->'dimensions','[]'::jsonb)
      ) item(value) where item.value->>'dimension_id'=node.value->>'node_id' limit 1
    ) dimension on true
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id and node.value->>'lifecycle'='ACTIVE'
      and node.value->>'node_type' in ('BUSINESS_SUBJECT','DIMENSION','GLOSSARY_TERM')
  ),'[]'::jsonb);
end
$function$;
