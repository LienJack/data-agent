-- ============================================================
-- 10638: Narrow Graph projection write, exact read and release bind RPCs
-- ============================================================

create function semantic.commit_semantic_graph_projection(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_projection_id uuid,
  p_source_revision_id uuid,
  p_projection jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_source semantic.semantic_source_revision%rowtype;
  v_existing semantic.semantic_graph_projection%rowtype;
  v_storage_digest text;
  v_node jsonb;
  v_edge jsonb;
  v_node_count integer;
  v_edge_count integer;
  v_graph_id uuid;
  v_graph_source jsonb;
  v_created_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  perform semantic.lock_semantic_authority_fence(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain
  );
  if p_projection_id is null or p_source_revision_id is null or p_projection is null
    or pg_catalog.jsonb_typeof(p_projection) <> 'object'
    or p_projection - array[
      'projection_version', 'graph_id', 'source_digest', 'registry_digest', 'compiler_version',
      'node_count', 'edge_count', 'nodes', 'edges'
    ] <> '{}'::jsonb
    or p_projection ->> 'projection_version' <> 'semantic-graph-projection@1'
    or coalesce(p_projection ->> 'graph_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_projection ->> 'source_digest', '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_projection ->> 'registry_digest', '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_projection ->> 'compiler_version', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    or coalesce(p_projection ->> 'node_count', '') !~ '^[0-9]{1,8}$'
    or coalesce(p_projection ->> 'edge_count', '') !~ '^[0-9]{1,8}$'
    or pg_catalog.jsonb_typeof(p_projection -> 'nodes') <> 'array'
    or pg_catalog.jsonb_typeof(p_projection -> 'edges') <> 'array'
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_GRAPH_PROJECTION_INVALID';
  end if;
  v_node_count := (p_projection ->> 'node_count')::integer;
  v_edge_count := (p_projection ->> 'edge_count')::integer;
  v_graph_id := (p_projection ->> 'graph_id')::uuid;
  if v_node_count <> pg_catalog.jsonb_array_length(p_projection -> 'nodes')
    or v_edge_count <> pg_catalog.jsonb_array_length(p_projection -> 'edges')
    or v_node_count > 10000000 or v_edge_count > 20000000
    or (
      select pg_catalog.count(*) <> pg_catalog.count(distinct node.value ->> 'node_id')
      from pg_catalog.jsonb_array_elements(p_projection -> 'nodes') as node(value)
    )
    or (
      select pg_catalog.count(*) <> pg_catalog.count(distinct edge.value ->> 'edge_id')
      from pg_catalog.jsonb_array_elements(p_projection -> 'edges') as edge(value)
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_projection -> 'nodes') as node(value)
      where pg_catalog.jsonb_typeof(node.value) <> 'object'
        or coalesce(node.value ->> 'node_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
        or coalesce(node.value ->> 'node_type', '') !~ '^[A-Z][A-Z0-9_]{0,63}$'
        or coalesce(node.value ->> 'node_version', '') !~ '^[1-9][0-9]{0,9}$'
        or node.value ->> 'lifecycle' not in ('ACTIVE', 'DEPRECATED', 'RETIRED')
        or (
          node.value ->> 'node_type' = 'METRIC'
          and node.value ?| array['table_id', 'column_id', 'formula', 'dependency_node_ids']
        )
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_projection -> 'edges') as edge(value)
      where pg_catalog.jsonb_typeof(edge.value) <> 'object'
        or coalesce(edge.value ->> 'edge_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
        or coalesce(edge.value ->> 'edge_type', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
        or coalesce(edge.value ->> 'family', '') !~ '^[A-Z][A-Z0-9_]{0,63}$'
        or coalesce(edge.value ->> 'source_node_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
        or coalesce(edge.value ->> 'target_node_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
        or coalesce(edge.value ->> 'edge_version', '') !~ '^[1-9][0-9]{0,9}$'
        or edge.value ->> 'lifecycle' not in ('ACTIVE', 'DEPRECATED', 'RETIRED')
        or not (edge.value ? 'attributes')
    )
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_GRAPH_PROJECTION_INVALID';
  end if;

  select source.*
  into v_source
  from semantic.semantic_source_revision as source
  where source.app_id = p_app_id
    and source.tenant_id = p_tenant_id
    and source.environment = p_environment
    and source.semantic_domain = p_semantic_domain
    and source.revision_id = p_source_revision_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_GRAPH_PROJECTION_SOURCE_NOT_FOUND';
  end if;
  v_graph_source := case
    when v_source.source_payload #>> '{metadata,graph_version}' = 'semantic-graph-source@2'
      then v_source.source_payload
    when v_source.source_payload #>> '{source,content,metadata,graph_version}' = 'semantic-graph-source@2'
      then v_source.source_payload #> '{source,content}'
    else null
  end;
  if v_graph_source is null
    or v_graph_source #>> '{metadata,graph_id}' <> p_projection ->> 'graph_id'
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_SOURCE_DIGEST_MISMATCH';
  end if;

  v_storage_digest := platform.canonical_sha256(p_projection);
  select projection.*
  into v_existing
  from semantic.semantic_graph_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = p_projection_id;
  if found then
    if v_existing.source_revision_id <> p_source_revision_id
      or v_existing.projection_storage_digest <> v_storage_digest
    then
      raise exception using errcode = '23505', message = 'SEMANTIC_GRAPH_PROJECTION_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'projection_id', v_existing.projection_id,
      'graph_id', v_existing.graph_id,
      'source_revision_id', v_existing.source_revision_id,
      'source_revision_digest', v_existing.source_revision_digest,
      'source_digest', v_existing.source_digest,
      'registry_digest', v_existing.registry_digest,
      'compiler_version', v_existing.compiler_version,
      'projection_storage_digest', v_existing.projection_storage_digest,
      'node_count', v_existing.node_count,
      'edge_count', v_existing.edge_count,
      'created_at', v_existing.created_at,
      'created', false
    );
  end if;

  insert into semantic.semantic_graph_projection (
    app_id, tenant_id, environment, semantic_domain, projection_id, graph_id,
    source_revision_id, source_revision_digest, source_digest, registry_digest, compiler_version,
    projection_payload, projection_storage_digest, node_count, edge_count, created_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_projection_id, v_graph_id,
    p_source_revision_id, v_source.source_digest, p_projection ->> 'source_digest',
    p_projection ->> 'registry_digest',
    p_projection ->> 'compiler_version', p_projection, v_storage_digest,
    v_node_count, v_edge_count, p_principal_id
  ) returning created_at into v_created_at;

  for v_node in select value from pg_catalog.jsonb_array_elements(p_projection -> 'nodes')
  loop
    insert into semantic.semantic_graph_node_projection (
      app_id, tenant_id, environment, semantic_domain, projection_id,
      node_id, node_type, node_version, lifecycle, intrinsic_payload, entry_storage_digest
    ) values (
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_projection_id,
      v_node ->> 'node_id', v_node ->> 'node_type', (v_node ->> 'node_version')::integer,
      v_node ->> 'lifecycle', v_node, platform.canonical_sha256(v_node)
    );
  end loop;
  for v_edge in select value from pg_catalog.jsonb_array_elements(p_projection -> 'edges')
  loop
    insert into semantic.semantic_graph_edge_projection (
      app_id, tenant_id, environment, semantic_domain, projection_id,
      edge_id, edge_type, edge_family, source_node_id, target_node_id,
      edge_version, lifecycle, edge_payload, entry_storage_digest
    ) values (
      p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_projection_id,
      v_edge ->> 'edge_id', v_edge ->> 'edge_type', v_edge ->> 'family',
      v_edge ->> 'source_node_id', v_edge ->> 'target_node_id',
      (v_edge ->> 'edge_version')::integer, v_edge ->> 'lifecycle',
      v_edge, platform.canonical_sha256(v_edge)
    );
  end loop;
  return pg_catalog.jsonb_build_object(
    'projection_id', p_projection_id,
    'graph_id', v_graph_id,
    'source_revision_id', p_source_revision_id,
    'source_revision_digest', v_source.source_digest,
    'source_digest', p_projection ->> 'source_digest',
    'registry_digest', p_projection ->> 'registry_digest',
    'compiler_version', p_projection ->> 'compiler_version',
    'projection_storage_digest', v_storage_digest,
    'node_count', v_node_count,
    'edge_count', v_edge_count,
    'created_at', v_created_at,
    'created', true
  );
end;
$function$;

create function semantic.get_semantic_graph_projection(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_projection_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_projection jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select projection.projection_payload
  into v_projection
  from semantic.semantic_graph_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = p_projection_id;
  return v_projection;
end;
$function$;

create function semantic.bind_semantic_graph_release(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_release_id uuid,
  p_projection_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_projection semantic.semantic_graph_projection%rowtype;
  v_release_source_revision_id uuid;
  v_existing semantic.semantic_source_release_graph_projection%rowtype;
  v_bound_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  perform semantic.lock_semantic_authority_fence(
    p_app_id, p_tenant_id, p_environment, p_semantic_domain
  );
  select projection.*
  into v_projection
  from semantic.semantic_graph_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = p_projection_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_GRAPH_PROJECTION_NOT_FOUND';
  end if;
  select revision.source_revision_id
  into v_release_source_revision_id
  from semantic.semantic_source_release as release
  join semantic.semantic_candidate as candidate
    on candidate.app_id = release.app_id
   and candidate.tenant_id = release.tenant_id
   and candidate.environment = release.environment
   and candidate.semantic_domain = release.semantic_domain
   and candidate.candidate_id = release.candidate_id
  join semantic.semantic_candidate_revision as revision
    on revision.app_id = candidate.app_id
   and revision.tenant_id = candidate.tenant_id
   and revision.environment = candidate.environment
   and revision.semantic_domain = candidate.semantic_domain
   and revision.candidate_id = candidate.candidate_id
   and revision.revision_id = candidate.current_revision_id
  where release.app_id = p_app_id
    and release.tenant_id = p_tenant_id
    and release.environment = p_environment
    and release.semantic_domain = p_semantic_domain
    and release.release_id = p_release_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_GRAPH_PROJECTION_RELEASE_NOT_FOUND';
  end if;
  if v_release_source_revision_id <> v_projection.source_revision_id then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_RELEASE_MISMATCH';
  end if;
  select binding.*
  into v_existing
  from semantic.semantic_source_release_graph_projection as binding
  where binding.app_id = p_app_id
    and binding.tenant_id = p_tenant_id
    and binding.environment = p_environment
    and binding.semantic_domain = p_semantic_domain
    and binding.release_id = p_release_id;
  if found then
    if v_existing.projection_id <> p_projection_id then
      raise exception using errcode = '23505', message = 'SEMANTIC_GRAPH_PROJECTION_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'release_id', v_existing.release_id,
      'projection_id', v_existing.projection_id,
      'source_revision_id', v_existing.source_revision_id,
      'source_revision_digest', v_existing.source_revision_digest,
      'source_digest', v_existing.source_digest,
      'projection_storage_digest', v_existing.projection_storage_digest,
      'bound_at', v_existing.bound_at,
      'created', false
    );
  end if;
  insert into semantic.semantic_source_release_graph_projection (
    app_id, tenant_id, environment, semantic_domain, release_id, projection_id,
    source_revision_id, source_revision_digest, source_digest, projection_storage_digest, bound_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_release_id, p_projection_id,
    v_projection.source_revision_id, v_projection.source_revision_digest, v_projection.source_digest,
    v_projection.projection_storage_digest, p_principal_id
  ) returning bound_at into v_bound_at;
  return pg_catalog.jsonb_build_object(
    'release_id', p_release_id,
    'projection_id', p_projection_id,
    'source_revision_id', v_projection.source_revision_id,
    'source_revision_digest', v_projection.source_revision_digest,
    'source_digest', v_projection.source_digest,
    'projection_storage_digest', v_projection.projection_storage_digest,
    'bound_at', v_bound_at,
    'created', true
  );
end;
$function$;
