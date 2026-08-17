create function app_data_agent.resolved_context_exact_keys(value jsonb,keys text[])
returns boolean language sql immutable strict set search_path='' as $function$
  select pg_catalog.jsonb_typeof(value)='object'
    and value-keys='{}'::jsonb
    and not exists(select 1 from pg_catalog.unnest(keys) required(key) where not value ? required.key)
$function$;

create function app_data_agent.resolved_context_uuid_v8_from_hash(requested_hash text)
returns uuid language plpgsql immutable strict set search_path='' as $function$
declare
  raw bytea;
  encoded text;
begin
  if requested_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='RESOLVED_CONTEXT_HASH_INVALID';
  end if;
  raw:=pg_catalog.decode(pg_catalog.substr(requested_hash,8,32),'hex');
  raw:=pg_catalog.set_byte(raw,6,(pg_catalog.get_byte(raw,6) & 15) | 128);
  raw:=pg_catalog.set_byte(raw,8,(pg_catalog.get_byte(raw,8) & 63) | 128);
  encoded:=pg_catalog.encode(raw,'hex');
  return (
    pg_catalog.substring(encoded,1,8)||'-'||pg_catalog.substring(encoded,9,4)||'-'||
    pg_catalog.substring(encoded,13,4)||'-'||pg_catalog.substring(encoded,17,4)||'-'||
    pg_catalog.substring(encoded,21,12)
  )::uuid;
end
$function$;

create function app_data_agent.resolved_context_package_key_hash(package_document jsonb)
returns text language sql immutable strict set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'scope',package_document->'scope',
    'question_hash',package_document->'question_hash',
    'defaults_ref',package_document->'defaults_ref',
    'semantic_release',package_document->'semantic_release',
    'schema_snapshot',package_document->'schema_snapshot',
    'context_policy',package_document->'context_policy',
    'egress_policy',package_document->'egress_policy',
    'provider',package_document->'provider',
    'authority_snapshot_hash',package_document->'authority_snapshot_hash'
  ))
$function$;

create function app_data_agent.assert_resolved_context_request(requested jsonb)
returns void language plpgsql immutable set search_path='' as $function$
begin
  if requested is null
    or not app_data_agent.resolved_context_exact_keys(requested,
      case when requested#>>'{basis,consumer}'='RUN'
        then array['schema_version','request_id','request_hash','scope','basis']::text[]
        else array['schema_version','request_id','request_hash','scope','question','basis']::text[] end)
    or requested->>'schema_version'<>'resolved-context-request@1.0.0'
    or coalesce(requested->>'request_hash','') !~ '^sha256:[0-9a-f]{64}$'
    or requested->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested-'request_hash')
    or not app_data_agent.resolved_context_exact_keys(requested->'scope',array[
      'app_id','tenant_id','environment'
    ]::text[])
    or (requested#>>'{basis,consumer}'='PREVIEW'
      and pg_catalog.length(pg_catalog.btrim(requested->>'question')) not between 1 and 4000)
    or coalesce(requested->>'request_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or requested#>>'{basis,consumer}' not in ('PREVIEW','RUN')
    or (requested#>>'{basis,consumer}'='PREVIEW' and not app_data_agent.resolved_context_exact_keys(
      requested->'basis',array['consumer','defaults_ref']::text[]))
    or (requested#>>'{basis,consumer}'='PREVIEW' and not app_data_agent.resolved_context_exact_keys(
      requested#>'{basis,defaults_ref}',array['defaults_id','defaults_revision','defaults_hash']::text[]))
    or (requested#>>'{basis,consumer}'='RUN' and not app_data_agent.resolved_context_exact_keys(
      requested->'basis',array['consumer','run_id','config_ref','context_receipt_ref']::text[]))
    or (requested#>>'{basis,consumer}'='RUN' and not app_data_agent.resolved_context_exact_keys(
      requested#>'{basis,config_ref}',array['config_id','config_revision','config_hash']::text[]))
    or (requested#>>'{basis,consumer}'='RUN' and not app_data_agent.resolved_context_exact_keys(
      requested#>'{basis,context_receipt_ref}',array['receipt_id','receipt_hash']::text[]))
  then raise exception using errcode='22023',message='RESOLVED_CONTEXT_REQUEST_INVALID'; end if;
end
$function$;

create function app_data_agent.resolved_context_metric_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language sql stable set search_path='' as $function$
  select coalesce(pg_catalog.jsonb_agg(metric.document order by metric.document->>'metric_id'),'[]'::jsonb)
  from (
    select distinct on (node.value->>'node_id') pg_catalog.jsonb_build_object(
      'metric_id',node.value->>'node_id','name',node.value->>'name',
      'aliases',coalesce((select pg_catalog.jsonb_agg(alias.value order by alias.value#>>'{}')
        from pg_catalog.jsonb_array_elements(coalesce(node.value->'aliases','[]'::jsonb)) alias(value)),'[]'::jsonb),
      'mapping_refs',mapping.refs,
      'mapping_hash',app_data_agent.u2_canonical_sha256(
        pg_catalog.jsonb_build_object('metric_binding',metric_binding.value,'mappings',mapping.documents)),
      'formula_hash',metric_binding.value->>'formula_ast_hash'
    ) as document
    from semantic.initial_semantic_release_sets release_set
    join semantic.initial_semantic_release_package_bindings binding
      using (app_id,tenant_id,environment,semantic_domain,release_set_id)
    join semantic.ontology_package_candidates package
      on package.app_id=binding.app_id and package.tenant_id=binding.tenant_id
     and package.environment=binding.environment and package.semantic_domain=binding.semantic_domain
     and package.package_id=binding.package_id and package.package_version=binding.package_version
     and package.package_hash=binding.package_hash
    cross join lateral pg_catalog.jsonb_array_elements(package.package_json#>'{graph_source,nodes}') node(value)
    join lateral (
      select object.value from pg_catalog.jsonb_array_elements(package.package_json->'objects') object(value)
      where object.value->>'graph_entry_id'=node.value->>'node_id'
        and object.value->>'semantic_role'='METRIC' limit 1
    ) metric_object on true
    join lateral (
      select candidate.value from pg_catalog.jsonb_array_elements(package.package_json->'metric_bindings') candidate(value)
      where candidate.value->>'metric_object_id'=metric_object.value->>'object_id'
        and candidate.value->>'resolution'='RESOLVED' limit 1
    ) metric_binding on true
    join lateral (
      select pg_catalog.jsonb_agg(to_jsonb(candidate.value->>'mapping_id') order by candidate.value->>'mapping_id') refs,
        pg_catalog.jsonb_agg(candidate.value order by candidate.value->>'mapping_id') documents
      from pg_catalog.jsonb_array_elements(package.package_json->'physical_mappings') candidate(value)
      where candidate.value->>'mode'='QUERYABLE' and candidate.value->>'logical_object_id' in (
        select id.value#>>'{}' from pg_catalog.jsonb_array_elements(
          pg_catalog.jsonb_build_array(metric_binding.value->>'metric_object_id',metric_binding.value->>'formula_object_id')
          || coalesce(metric_binding.value->'dimension_object_ids','[]'::jsonb)
          || coalesce(metric_binding.value->'grain_object_ids','[]'::jsonb)
          || case when metric_binding.value->>'time_object_id' is null then '[]'::jsonb else pg_catalog.jsonb_build_array(metric_binding.value->>'time_object_id') end
        ) id(value)
      )
      having pg_catalog.count(*)>0
    ) mapping on true
    where release_set.app_id=p_app_id and release_set.tenant_id=p_tenant_id
      and release_set.environment=p_environment and release_set.semantic_domain=p_semantic_domain
      and release_set.release_id=p_release_id and node.value->>'node_type'='METRIC'
    order by node.value->>'node_id',binding.package_id,binding.package_version
  ) metric
$function$;

create function app_data_agent.resolved_context_ontology_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language sql stable set search_path='' as $function$
  select coalesce(pg_catalog.jsonb_agg(object.document order by object.document->>'object_id'),'[]'::jsonb)
  from (
    select distinct on (node.value->>'node_id') pg_catalog.jsonb_build_object(
      'object_id',node.value->>'node_id',
      'object_kind',case node.value->>'node_type' when 'BUSINESS_SUBJECT' then 'ENTITY'
        when 'GLOSSARY_TERM' then 'TERM' else 'DIMENSION' end,
      'name',node.value->>'name',
      'aliases',coalesce((select pg_catalog.jsonb_agg(alias.value order by alias.value#>>'{}')
        from pg_catalog.jsonb_array_elements(coalesce(node.value->'aliases','[]'::jsonb)) alias(value)),'[]'::jsonb),
      'queryable',exists(select 1 from pg_catalog.jsonb_array_elements(package.package_json->'physical_mappings') mapping(value)
        where mapping.value->>'mode'='QUERYABLE'
          and mapping.value->>'logical_object_id'=semantic_object.value->>'object_id'),
      'mapping_refs',coalesce((select pg_catalog.jsonb_agg(to_jsonb(mapping.value->>'mapping_id') order by mapping.value->>'mapping_id')
        from pg_catalog.jsonb_array_elements(package.package_json->'physical_mappings') mapping(value)
        where mapping.value->>'mode'='QUERYABLE'
          and mapping.value->>'logical_object_id'=semantic_object.value->>'object_id'),'[]'::jsonb),
      'object_hash',app_data_agent.u2_canonical_sha256(node.value)
    ) as document
    from semantic.initial_semantic_release_sets release_set
    join semantic.initial_semantic_release_package_bindings binding
      using (app_id,tenant_id,environment,semantic_domain,release_set_id)
    join semantic.ontology_package_candidates package
      on package.app_id=binding.app_id and package.tenant_id=binding.tenant_id
     and package.environment=binding.environment and package.semantic_domain=binding.semantic_domain
     and package.package_id=binding.package_id and package.package_version=binding.package_version
     and package.package_hash=binding.package_hash
    cross join lateral pg_catalog.jsonb_array_elements(package.package_json#>'{graph_source,nodes}') node(value)
    join lateral (
      select object.value from pg_catalog.jsonb_array_elements(package.package_json->'objects') object(value)
      where object.value->>'graph_entry_id'=node.value->>'node_id' limit 1
    ) semantic_object on true
    where release_set.app_id=p_app_id and release_set.tenant_id=p_tenant_id
      and release_set.environment=p_environment and release_set.semantic_domain=p_semantic_domain
      and release_set.release_id=p_release_id
      and node.value->>'node_type' in ('BUSINESS_SUBJECT','DIMENSION','GLOSSARY_TERM')
    order by node.value->>'node_id',binding.package_id,binding.package_version
  ) object
$function$;

create function app_data_agent.resolved_context_relationship_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language sql stable set search_path='' as $function$
  select coalesce(pg_catalog.jsonb_agg(edge.document order by edge.document->>'relationship_id'),'[]'::jsonb)
  from (
    select distinct on (entry.value->>'edge_id') pg_catalog.jsonb_build_object(
      'relationship_id',entry.value->>'edge_id','source_object_id',entry.value->>'source_node_id',
      'target_object_id',entry.value->>'target_node_id','relationship_kind',entry.value->>'edge_type',
      'relationship_hash',app_data_agent.u2_canonical_sha256(entry.value)) as document
    from semantic.initial_semantic_release_sets release_set
    join semantic.initial_semantic_release_package_bindings binding
      using (app_id,tenant_id,environment,semantic_domain,release_set_id)
    join semantic.ontology_package_candidates package
      on package.app_id=binding.app_id and package.tenant_id=binding.tenant_id
     and package.environment=binding.environment and package.semantic_domain=binding.semantic_domain
     and package.package_id=binding.package_id and package.package_version=binding.package_version
     and package.package_hash=binding.package_hash
    cross join lateral pg_catalog.jsonb_array_elements(package.package_json#>'{graph_source,edges}') entry(value)
    where release_set.app_id=p_app_id and release_set.tenant_id=p_tenant_id
      and release_set.environment=p_environment and release_set.semantic_domain=p_semantic_domain
      and release_set.release_id=p_release_id
    order by entry.value->>'edge_id',binding.package_id,binding.package_version
  ) edge
$function$;
