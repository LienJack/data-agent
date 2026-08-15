-- semantic_graph_v2_migration_checksum: sha256:41d7359ba58f101ff9d7905352c8f43cef827bf5daeec4a3f88eb2b1a097c0db
-- ============================================================
-- 10638: Semantic Graph v2 authoritative projections
-- ============================================================
-- Depends on: 20260725010637_app_data_agent_adb_ecommerce_workspace
-- Complete Graph source revisions remain Authority. Normalized Node/Edge rows
-- are immutable, release-bound read projections and may be rebuilt.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_GRAPH_PROJECTION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_GRAPH_PROJECTION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_GRAPH_PROJECTION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010637_app_data_agent_adb_ecommerce_workspace';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_BASELINE_10637_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010638_app_data_agent_semantic_graph_v2'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_MIGRATION_10638_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_source_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_source_release') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate_revision') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
    or pg_catalog.to_regprocedure('platform.canonical_sha256(jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_AUTHORITY_SURFACE_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
-- ============================================================
-- 10638: Immutable native Graph projection and release binding
-- ============================================================

create table semantic.semantic_graph_projection (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  graph_id uuid not null,
  source_revision_id uuid not null,
  source_revision_digest text not null check (source_revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_digest text not null check (source_digest ~ '^sha256:[0-9a-f]{64}$'),
  registry_digest text not null check (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  compiler_version text not null check (compiler_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  projection_payload jsonb not null check (pg_catalog.jsonb_typeof(projection_payload) = 'object'),
  projection_storage_digest text not null check (projection_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  node_count integer not null check (node_count between 0 and 10000000),
  edge_count integer not null check (edge_count between 0 and 20000000),
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, source_revision_id, compiler_version),
  unique (app_id, tenant_id, environment, semantic_domain, projection_storage_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, source_revision_id)
    references semantic.semantic_source_revision (app_id, tenant_id, environment, semantic_domain, revision_id)
);

create table semantic.semantic_graph_node_projection (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  node_id text not null check (node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  node_type text not null check (node_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  node_version integer not null check (node_version between 1 and 2147483647),
  lifecycle text not null check (lifecycle in ('ACTIVE', 'DEPRECATED', 'RETIRED')),
  intrinsic_payload jsonb not null check (pg_catalog.jsonb_typeof(intrinsic_payload) = 'object'),
  entry_storage_digest text not null check (entry_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id, node_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, projection_id)
    references semantic.semantic_graph_projection (app_id, tenant_id, environment, semantic_domain, projection_id)
);

create table semantic.semantic_graph_edge_projection (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  edge_id text not null check (edge_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  edge_type text not null check (edge_type ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  edge_family text not null check (edge_family ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  source_node_id text not null check (source_node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  target_node_id text not null check (target_node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  edge_version integer not null check (edge_version between 1 and 2147483647),
  lifecycle text not null check (lifecycle in ('ACTIVE', 'DEPRECATED', 'RETIRED')),
  edge_payload jsonb not null check (pg_catalog.jsonb_typeof(edge_payload) = 'object'),
  entry_storage_digest text not null check (entry_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id, edge_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, projection_id)
    references semantic.semantic_graph_projection (app_id, tenant_id, environment, semantic_domain, projection_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, projection_id, source_node_id)
    references semantic.semantic_graph_node_projection (app_id, tenant_id, environment, semantic_domain, projection_id, node_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, projection_id, target_node_id)
    references semantic.semantic_graph_node_projection (app_id, tenant_id, environment, semantic_domain, projection_id, node_id)
);

create table semantic.semantic_source_release_graph_projection (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  release_id uuid not null,
  projection_id uuid not null,
  source_revision_id uuid not null,
  source_revision_digest text not null check (source_revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_digest text not null check (source_digest ~ '^sha256:[0-9a-f]{64}$'),
  projection_storage_digest text not null check (projection_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  bound_by uuid not null,
  bound_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, release_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, projection_id)
    references semantic.semantic_graph_projection (app_id, tenant_id, environment, semantic_domain, projection_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, source_revision_id)
    references semantic.semantic_source_revision (app_id, tenant_id, environment, semantic_domain, revision_id)
);

create index semantic_graph_node_projection_type_idx
  on semantic.semantic_graph_node_projection (
    app_id, tenant_id, environment, semantic_domain, projection_id, node_type, lifecycle, node_id
  );
create index semantic_graph_edge_projection_source_idx
  on semantic.semantic_graph_edge_projection (
    app_id, tenant_id, environment, semantic_domain, projection_id, source_node_id, edge_type, lifecycle
  );
create index semantic_graph_edge_projection_target_idx
  on semantic.semantic_graph_edge_projection (
    app_id, tenant_id, environment, semantic_domain, projection_id, target_node_id, edge_type, lifecycle
  );
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
-- ============================================================
-- 10638: RLS, ownership, exact grants and hardening postconditions
-- ============================================================

alter table semantic.semantic_graph_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_graph_node_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_graph_edge_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_source_release_graph_projection owner to data_agent_u6_data_owner;

alter table semantic.semantic_graph_projection enable row level security;
alter table semantic.semantic_graph_projection force row level security;
alter table semantic.semantic_graph_node_projection enable row level security;
alter table semantic.semantic_graph_node_projection force row level security;
alter table semantic.semantic_graph_edge_projection enable row level security;
alter table semantic.semantic_graph_edge_projection force row level security;
alter table semantic.semantic_source_release_graph_projection enable row level security;
alter table semantic.semantic_source_release_graph_projection force row level security;

create policy semantic_graph_projection_rpc_scope_policy
  on semantic.semantic_graph_projection for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
create policy semantic_graph_node_projection_rpc_scope_policy
  on semantic.semantic_graph_node_projection for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
create policy semantic_graph_edge_projection_rpc_scope_policy
  on semantic.semantic_graph_edge_projection for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
create policy semantic_source_release_graph_projection_rpc_scope_policy
  on semantic.semantic_source_release_graph_projection for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

grant select, insert on table semantic.semantic_graph_projection to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_graph_node_projection to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_graph_edge_projection to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_source_release_graph_projection to data_agent_u6_rpc_owner;
grant execute on function platform.canonical_sha256(jsonb) to data_agent_u6_rpc_owner;

alter function semantic.commit_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid,uuid,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.bind_semantic_graph_release(uuid,uuid,text,uuid,text,uuid,uuid)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.commit_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid,uuid,jsonb) from public;
revoke all on function semantic.get_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid) from public;
revoke all on function semantic.bind_semantic_graph_release(uuid,uuid,text,uuid,text,uuid,uuid) from public;
grant execute on function semantic.commit_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid,uuid,jsonb) to data_agent_backend;
grant execute on function semantic.get_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid) to data_agent_backend;
grant execute on function semantic.bind_semantic_graph_release(uuid,uuid,text,uuid,text,uuid,uuid) to data_agent_backend;

revoke all on table semantic.semantic_graph_projection from data_agent_backend;
revoke all on table semantic.semantic_graph_node_projection from data_agent_backend;
revoke all on table semantic.semantic_graph_edge_projection from data_agent_backend;
revoke all on table semantic.semantic_source_release_graph_projection from data_agent_backend;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'semantic_graph_projection', 'semantic_graph_node_projection',
    'semantic_graph_edge_projection', 'semantic_source_release_graph_projection'
  ] loop
    if not (select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'semantic' and class.relname = relation_name)
      or pg_catalog.has_table_privilege(
        'data_agent_backend', pg_catalog.format('semantic.%I', relation_name),
        'SELECT,INSERT,UPDATE,DELETE'
      )
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_TABLE_HARDENING_FAILED';
    end if;
  end loop;
  foreach function_name in array array[
    'commit_semantic_graph_projection', 'get_semantic_graph_projection',
    'bind_semantic_graph_release'
  ] loop
    select procedure.prosecdef, procedure.proconfig, procedure.provolatile, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
      or (function_name = 'get_semantic_graph_projection' and function_record.provolatile <> 's')
      or (function_name <> 'get_semantic_graph_projection' and function_record.provolatile <> 'v')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_PROJECTION_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
-- ============================================================
-- 10638: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010638_app_data_agent_semantic_graph_v2',
  'sha256:41d7359ba58f101ff9d7905352c8f43cef827bf5daeec4a3f88eb2b1a097c0db'
);

commit;
