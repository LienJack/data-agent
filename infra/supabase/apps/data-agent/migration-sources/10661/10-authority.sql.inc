create table app_data_agent.knowledge_embedding_profile_revisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  profile_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  provider text not null,
  model_id text not null,
  dimensions integer not null check (dimensions between 2 and 16384),
  status text not null check (status in ('READY','NOT_READY','STALE')),
  profile_hash text not null check (profile_hash~'^sha256:[0-9a-f]{64}$'),
  profile_json jsonb not null,
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,profile_id,revision),
  unique (app_id,tenant_id,environment,profile_id,revision,profile_hash)
);

create table app_data_agent.knowledge_bases (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  knowledge_base_id uuid not null,
  current_revision bigint not null,
  current_revision_hash text not null,
  current_status text not null check (current_status in ('PENDING','INDEXING','READY','STALE','FAILED','DELETED')),
  updated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,knowledge_base_id)
);

create table app_data_agent.knowledge_base_revisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  knowledge_base_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  revision_hash text not null check (revision_hash~'^sha256:[0-9a-f]{64}$'),
  status text not null check (status in ('PENDING','INDEXING','READY','STALE','FAILED','DELETED')),
  profile_id uuid not null,
  profile_revision bigint not null,
  profile_hash text not null,
  acl_hash text not null check (acl_hash~'^sha256:[0-9a-f]{64}$'),
  source_refs_json jsonb not null check (pg_catalog.jsonb_typeof(source_refs_json)='array'),
  revision_json jsonb not null check (pg_catalog.jsonb_typeof(revision_json)='object'),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,knowledge_base_id,revision),
  unique (app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash),
  foreign key (app_id,tenant_id,environment,profile_id,profile_revision,profile_hash)
    references app_data_agent.knowledge_embedding_profile_revisions(
      app_id,tenant_id,environment,profile_id,revision,profile_hash
    )
);

create table app_data_agent.knowledge_index_generations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  generation_id uuid not null,
  generation_revision bigint not null check (generation_revision between 1 and 9007199254740991),
  generation_hash text not null check (generation_hash~'^sha256:[0-9a-f]{64}$'),
  knowledge_base_id uuid not null,
  knowledge_base_revision bigint not null,
  knowledge_base_revision_hash text not null,
  state text not null check (state in ('PENDING','INDEXING','READY','STALE','FAILED')),
  manifest_hash text not null check (manifest_hash~'^sha256:[0-9a-f]{64}$'),
  chunk_count bigint not null check (chunk_count between 0 and 9007199254740991),
  generation_json jsonb not null check (pg_catalog.jsonb_typeof(generation_json)='object'),
  created_at timestamptz not null,
  completed_at timestamptz,
  primary key (app_id,tenant_id,environment,generation_id,generation_revision),
  unique (app_id,tenant_id,environment,generation_id,generation_revision,generation_hash),
  foreign key (app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,knowledge_base_revision_hash)
    references app_data_agent.knowledge_base_revisions(
      app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash
    )
);

create table app_data_agent.knowledge_projection_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  knowledge_base_id uuid not null,
  generation_id uuid not null,
  projection_kind text not null check (projection_kind in ('CHUNK','QUERY')),
  chunk_id uuid,
  decision text not null check (decision in ('ALLOW','POLICY_BLOCKED')),
  receipt_hash text not null check (receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null,
  projected_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,generation_id,chunk_id),
  check ((projection_kind='CHUNK')=(chunk_id is not null))
);

create table app_data_agent.knowledge_chunks (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  generation_id uuid not null,
  generation_revision bigint not null,
  chunk_id uuid not null,
  knowledge_base_id uuid not null,
  source_file_id uuid not null,
  source_file_revision bigint not null,
  source_file_revision_hash text not null,
  ordinal bigint not null,
  start_byte bigint not null,
  end_byte bigint not null,
  text_hash text not null,
  normalized_text text not null,
  embedding_hash text not null,
  dimensions integer not null,
  vector_json jsonb not null check (pg_catalog.jsonb_typeof(vector_json)='array'),
  chunk_hash text not null check (chunk_hash~'^sha256:[0-9a-f]{64}$'),
  chunk_json jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,generation_id,chunk_id),
  unique (app_id,tenant_id,environment,generation_id,ordinal),
  unique (app_id,tenant_id,environment,generation_id,chunk_id,chunk_hash),
  foreign key (app_id,tenant_id,environment,source_file_id,source_file_revision,source_file_revision_hash)
    references app_data_agent.workspace_file_revisions(
      app_id,tenant_id,environment,file_id,revision,revision_hash
    )
);

create table app_data_agent.knowledge_retrieval_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  principal_id uuid not null,
  knowledge_base_id uuid not null,
  generation_id uuid not null,
  generation_hash text not null,
  query_hash text not null,
  receipt_hash text not null check (receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null,
  retrieved_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id)
);

create table app_data_agent.knowledge_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  principal_id uuid not null,
  operation_kind text not null check (operation_kind in ('CREATE','REBUILD','REGISTER_PROFILE')),
  idempotency_key text not null,
  request_hash text not null,
  result_json jsonb not null,
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key)
);

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'knowledge_embedding_profile_revisions','knowledge_bases','knowledge_base_revisions',
    'knowledge_index_generations','knowledge_projection_receipts','knowledge_chunks',
    'knowledge_retrieval_receipts','knowledge_idempotency'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u15_knowledge_owner',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_u15_knowledge_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      relation_name||'_owner_all',relation_name
    );
  end loop;
end
$rls$;

create index knowledge_bases_status_idx on app_data_agent.knowledge_bases(
  app_id,tenant_id,environment,current_status,updated_at desc
);
create index knowledge_chunks_generation_idx on app_data_agent.knowledge_chunks(
  app_id,tenant_id,environment,generation_id,ordinal
);
