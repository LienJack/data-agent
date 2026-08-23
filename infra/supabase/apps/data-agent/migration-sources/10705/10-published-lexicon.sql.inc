create function app_data_agent.resolved_context_published_lexicon(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language sql stable set search_path='' as $function$
  with release_ref as (
    select pg_catalog.jsonb_build_object(
      'resource_id',release.release_id,
      'resource_revision',release.release_generation,
      'resource_hash',release.release_digest
    ) as document
    from semantic.semantic_source_release as release
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id
  ),
  metrics as (
    select item.value as document
    from pg_catalog.jsonb_array_elements(app_data_agent.resolved_context_metric_projection(
      p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
    )) as item(value)
  ),
  ontology as (
    select item.value as document
    from pg_catalog.jsonb_array_elements(app_data_agent.resolved_context_ontology_projection(
      p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
    )) as item(value)
  ),
  direct_candidates as (
    select 0 as match_rank,'METRIC'::text as target_kind,
      metric.document->>'metric_id' as target_id,null::text as term_id,
      'CANONICAL'::text as match_kind,metric.document->>'name' as phrase
    from metrics as metric
    union all
    select 2,'METRIC',metric.document->>'metric_id',null,'ALIAS',alias.value#>>'{}'
    from metrics as metric
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(metric.document->'aliases','[]'::jsonb)
    ) as alias(value)
    union all
    select 0,'ONTOLOGY',object.document->>'object_id',null,'CANONICAL',object.document->>'name'
    from ontology as object where object.document->>'object_kind'<>'TERM'
    union all
    select 2,'ONTOLOGY',object.document->>'object_id',null,'ALIAS',alias.value#>>'{}'
    from ontology as object
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(object.document->'aliases','[]'::jsonb)
    ) as alias(value)
    where object.document->>'object_kind'<>'TERM'
  ),
  glossary_candidates as (
    select case edge.value#>>'{attributes,lexical_role}'
        when 'PREFERRED' then 1 when 'SYNONYM' then 2 else 3 end as match_rank,
      target.target_kind,target.target_id,term.value->>'node_id' as term_id,
      edge.value#>>'{attributes,lexical_role}' as match_kind,
      case when edge.value#>>'{attributes,lexical_role}'='ABBREVIATION'
          and coalesce(term.value->>'abbreviation','')<>''
        then term.value->>'abbreviation' else term.value->>'name' end as phrase
    from semantic.semantic_source_release_graph_projection as binding
    join semantic.semantic_graph_projection as graph
      on graph.app_id=binding.app_id and graph.tenant_id=binding.tenant_id
      and graph.environment=binding.environment and graph.semantic_domain=binding.semantic_domain
      and graph.projection_id=binding.projection_id
      and graph.projection_storage_digest=binding.projection_storage_digest
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(graph.projection_payload->'edges','[]'::jsonb)
    ) as edge(value)
    join lateral (
      select node.value from pg_catalog.jsonb_array_elements(
        coalesce(graph.projection_payload->'nodes','[]'::jsonb)
      ) as node(value)
      where node.value->>'node_id'=edge.value->>'source_node_id'
        and node.value->>'node_type'='GLOSSARY_TERM'
        and node.value->>'lifecycle'='ACTIVE'
      limit 1
    ) as term on true
    join lateral (
      select 'METRIC'::text as target_kind,metric.document->>'metric_id' as target_id
      from metrics as metric
      where metric.document->>'metric_id'=edge.value->>'target_node_id'
      union all
      select 'ONTOLOGY',object.document->>'object_id'
      from ontology as object
      where object.document->>'object_id'=edge.value->>'target_node_id'
      limit 1
    ) as target on true
    where binding.app_id=p_app_id and binding.tenant_id=p_tenant_id
      and binding.environment=p_environment and binding.semantic_domain=p_semantic_domain
      and binding.release_id=p_release_id
      and edge.value->>'lifecycle'='ACTIVE'
      and edge.value->>'family'='TERMINOLOGY'
      and edge.value->>'edge_type'='DENOTES'
      and edge.value#>>'{attributes,kind}'='TERM_LINK'
      and edge.value#>>'{attributes,lexical_role}' in ('PREFERRED','SYNONYM','ABBREVIATION')
  ),
  candidates as (
    select * from direct_candidates
    union all
    select * from glossary_candidates
  ),
  materials as (
    select distinct candidate.match_rank,pg_catalog.jsonb_build_object(
      'schema_version','semantic-lexical-entry@1.0.0',
      'release_ref',release_ref.document,
      'target_kind',candidate.target_kind,
      'target_id',candidate.target_id,
      'term_id',candidate.term_id,
      'match_kind',candidate.match_kind,
      'phrase',candidate.phrase
    ) as document
    from candidates as candidate cross join release_ref
    where coalesce(pg_catalog.btrim(candidate.phrase),'')<>''
  ),
  evidence as (
    select material.match_rank,material.document,
      app_data_agent.u2_canonical_sha256(material.document) as evidence_hash
    from materials as material
  )
  select coalesce(pg_catalog.jsonb_agg(
    evidence.document||pg_catalog.jsonb_build_object('evidence_hash',evidence.evidence_hash)
    order by evidence.match_rank,evidence.evidence_hash
  ),'[]'::jsonb)
  from evidence
$function$;
