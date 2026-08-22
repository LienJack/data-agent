create table app_data_agent.knowledge_document_revisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  knowledge_base_id uuid not null,
  knowledge_base_revision bigint not null,
  knowledge_base_revision_hash text not null,
  document_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  source_file_id uuid not null,
  source_file_revision bigint not null,
  source_file_revision_hash text not null,
  parent_document_id uuid,
  parent_document_revision bigint,
  parent_canonical_markdown_hash text,
  parser_version text not null,
  policy_version text not null,
  canonical_markdown_hash text not null check (canonical_markdown_hash~'^sha256:[0-9a-f]{64}$'),
  block_manifest_hash text not null check (block_manifest_hash~'^sha256:[0-9a-f]{64}$'),
  block_count bigint not null check (block_count between 0 and 9007199254740991),
  status text not null check (status in ('PENDING','PARSING','READY','FAILED')),
  reason_code text,
  revision_hash text not null check (revision_hash~'^sha256:[0-9a-f]{64}$'),
  revision_json jsonb not null check (pg_catalog.jsonb_typeof(revision_json)='object'),
  created_by_principal_id uuid not null,
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,document_id,revision),
  unique (app_id,tenant_id,environment,document_id,revision,canonical_markdown_hash),
  unique (app_id,tenant_id,environment,document_id,revision,revision_hash),
  foreign key (app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,knowledge_base_revision_hash)
    references app_data_agent.knowledge_base_revisions(
      app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash
    ),
  foreign key (app_id,tenant_id,environment,source_file_id,source_file_revision,source_file_revision_hash)
    references app_data_agent.workspace_file_revisions(
      app_id,tenant_id,environment,file_id,revision,revision_hash
    ),
  foreign key (app_id,tenant_id,environment,parent_document_id,parent_document_revision,parent_canonical_markdown_hash)
    references app_data_agent.knowledge_document_revisions(
      app_id,tenant_id,environment,document_id,revision,canonical_markdown_hash
    ),
  check ((parent_document_id is null)=(parent_document_revision is null)
    and (parent_document_id is null)=(parent_canonical_markdown_hash is null)),
  check ((status='FAILED')=(reason_code is not null)),
  check ((status='READY' and block_count>0) or (status<>'READY' and block_count=0))
);

create table app_data_agent.knowledge_document_blocks (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  knowledge_base_id uuid not null,
  knowledge_base_revision bigint not null,
  knowledge_base_revision_hash text not null,
  document_id uuid not null,
  document_revision bigint not null,
  canonical_markdown_hash text not null,
  block_id uuid not null,
  ordinal bigint not null check (ordinal between 0 and 9007199254740991),
  block_kind text not null check (block_kind in ('HEADING','PARAGRAPH','LIST','TABLE','CODE')),
  start_byte bigint not null check (start_byte between 0 and 9007199254740991),
  end_byte bigint not null check (end_byte between 1 and 9007199254740991),
  start_line bigint not null check (start_line between 1 and 9007199254740991),
  end_line bigint not null check (end_line between 1 and 9007199254740991),
  normalized_text_hash text not null check (normalized_text_hash~'^sha256:[0-9a-f]{64}$'),
  canonical_text text not null check (pg_catalog.octet_length(canonical_text) between 1 and 800000),
  block_hash text not null check (block_hash~'^sha256:[0-9a-f]{64}$'),
  block_json jsonb not null check (pg_catalog.jsonb_typeof(block_json)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,document_id,document_revision,block_id),
  unique (app_id,tenant_id,environment,document_id,document_revision,ordinal),
  unique (app_id,tenant_id,environment,document_id,document_revision,block_id,block_hash),
  foreign key (app_id,tenant_id,environment,document_id,document_revision,canonical_markdown_hash)
    references app_data_agent.knowledge_document_revisions(
      app_id,tenant_id,environment,document_id,revision,canonical_markdown_hash
    ),
  check (end_byte>start_byte and end_line>=start_line)
);

create table app_data_agent.knowledge_correction_annotations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  annotation_id uuid not null,
  knowledge_base_id uuid not null,
  document_id uuid not null,
  document_revision bigint not null,
  block_id uuid not null,
  block_hash text not null,
  annotation_kind text not null check (annotation_kind in ('CORRECTION','SUPPLEMENT')),
  correction_text text not null check (pg_catalog.length(correction_text) between 1 and 20000),
  reason text not null check (pg_catalog.length(reason) between 1 and 2000),
  effective_knowledge_base_revision bigint not null,
  created_by_principal_id uuid not null,
  created_at timestamptz not null,
  annotation_hash text not null check (annotation_hash~'^sha256:[0-9a-f]{64}$'),
  annotation_json jsonb not null check (pg_catalog.jsonb_typeof(annotation_json)='object'),
  primary key (app_id,tenant_id,environment,annotation_id),
  unique (app_id,tenant_id,environment,annotation_id,annotation_hash),
  foreign key (app_id,tenant_id,environment,document_id,document_revision,block_id,block_hash)
    references app_data_agent.knowledge_document_blocks(
      app_id,tenant_id,environment,document_id,document_revision,block_id,block_hash
    )
);

create table app_data_agent.knowledge_evidence_selections (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  selection_id uuid not null,
  knowledge_base_id uuid not null,
  knowledge_base_revision bigint not null,
  knowledge_base_revision_hash text not null,
  intended_semantic_domain text not null,
  selected_by_principal_id uuid not null,
  selected_at timestamptz not null,
  selection_hash text not null check (selection_hash~'^sha256:[0-9a-f]{64}$'),
  selection_json jsonb not null check (pg_catalog.jsonb_typeof(selection_json)='object'),
  primary key (app_id,tenant_id,environment,selection_id),
  unique (app_id,tenant_id,environment,selection_id,selection_hash),
  foreign key (app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,knowledge_base_revision_hash)
    references app_data_agent.knowledge_base_revisions(
      app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash
    )
);

create table app_data_agent.knowledge_evidence_selection_blocks (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  selection_id uuid not null,
  ordinal bigint not null check (ordinal between 0 and 255),
  document_id uuid not null,
  document_revision bigint not null,
  block_id uuid not null,
  block_hash text not null,
  primary key (app_id,tenant_id,environment,selection_id,ordinal),
  unique (app_id,tenant_id,environment,selection_id,document_id,document_revision,block_id),
  foreign key (app_id,tenant_id,environment,selection_id)
    references app_data_agent.knowledge_evidence_selections(app_id,tenant_id,environment,selection_id),
  foreign key (app_id,tenant_id,environment,document_id,document_revision,block_id,block_hash)
    references app_data_agent.knowledge_document_blocks(
      app_id,tenant_id,environment,document_id,document_revision,block_id,block_hash
    )
);

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'knowledge_document_revisions','knowledge_document_blocks','knowledge_correction_annotations',
    'knowledge_evidence_selections','knowledge_evidence_selection_blocks'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u15_knowledge_owner',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_u15_knowledge_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      relation_name||'_owner_all',relation_name
    );
    execute pg_catalog.format(
      'create trigger %I before update or delete on app_data_agent.%I for each statement execute function app_data_agent.reject_knowledge_immutable_mutation()',
      relation_name||'_immutable',relation_name
    );
  end loop;
end
$rls$;

create index knowledge_document_revisions_base_idx on app_data_agent.knowledge_document_revisions(
  app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,created_at desc
);
create index knowledge_document_blocks_read_idx on app_data_agent.knowledge_document_blocks(
  app_id,tenant_id,environment,document_id,document_revision,ordinal
);
