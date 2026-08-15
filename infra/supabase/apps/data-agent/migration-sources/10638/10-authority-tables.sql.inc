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
