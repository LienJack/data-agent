-- ============================================================
-- 10632: Durable semantic import jobs, mappings, operations and receipts
-- ============================================================

create table app_data_agent.semantic_import_jobs (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  import_id uuid not null,
  principal_id uuid not null,
  file_name text not null check (pg_catalog.length(pg_catalog.btrim(file_name)) between 1 and 255),
  byte_size integer not null check (byte_size between 1 and 1048576),
  upload_hash text not null check (upload_hash ~ '^sha256:[0-9a-f]{64}$'),
  document_content_hash text not null check (document_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  format text not null check (format = 'semantic-workspace-export@1.0.0'),
  source_document jsonb not null check (
    pg_catalog.jsonb_typeof(source_document) = 'object'
    and source_document ->> 'format' = format
    and source_document ->> 'content_hash' = document_content_hash
    and source_document - array[
      'format', 'compatibility', 'datasource_refs', 'domains', 'exported_at', 'content_hash'
    ] = '{}'::jsonb
    and pg_catalog.jsonb_typeof(source_document -> 'compatibility') = 'object'
    and pg_catalog.jsonb_typeof(source_document -> 'datasource_refs') = 'array'
    and pg_catalog.jsonb_array_length(source_document -> 'datasource_refs') between 1 and 64
    and pg_catalog.jsonb_typeof(source_document -> 'domains') = 'array'
    and pg_catalog.jsonb_array_length(source_document -> 'domains') between 1 and 64
    and not app_data_agent.contains_potential_plaintext_secret(source_document)
  ),
  state text not null check (state in (
    'UPLOADED', 'VALIDATED', 'AWAITING_DATASOURCE_MAPPING', 'READY',
    'DRAFT_CREATED', 'FAILED', 'CANCELLED'
  )),
  mapping_hash text check (mapping_hash is null or mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  preview jsonb check (
    preview is null or (
      pg_catalog.jsonb_typeof(preview) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(preview)
    )
  ),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  candidate_refs jsonb not null default '[]'::jsonb check (
    pg_catalog.jsonb_typeof(candidate_refs) = 'array'
    and pg_catalog.jsonb_array_length(candidate_refs) between 0 and 64
    and not app_data_agent.contains_potential_plaintext_secret(candidate_refs)
  ),
  receipt_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, import_id),
  unique (app_id, tenant_id, environment, import_id, principal_id),
  foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment) on delete restrict,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id) on delete restrict,
  check (
    (state = 'DRAFT_CREATED' and receipt_id is not null
      and pg_catalog.jsonb_array_length(candidate_refs) between 1 and 64
      and reason_code is null)
    or (state in ('FAILED', 'CANCELLED') and receipt_id is null
      and pg_catalog.jsonb_array_length(candidate_refs) = 0 and reason_code is not null)
    or (state not in ('DRAFT_CREATED', 'FAILED', 'CANCELLED') and receipt_id is null
      and pg_catalog.jsonb_array_length(candidate_refs) = 0 and reason_code is null)
  ),
  check (
    state <> 'READY'
    or (mapping_hash is not null and preview ->> 'compatible' = 'true')
  )
);

create index semantic_import_jobs_principal_created
  on app_data_agent.semantic_import_jobs (
    app_id, tenant_id, environment, principal_id, created_at desc, import_id
  );

create table app_data_agent.semantic_import_mappings (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  import_id uuid not null,
  logical_ref text not null check (
    pg_catalog.length(logical_ref) between 1 and 128
    and logical_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  ),
  target_datasource_id uuid not null,
  target_semantic_domain text not null check (
    target_semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
  ),
  mapped_by_principal_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, import_id, logical_ref),
  unique (app_id, tenant_id, environment, import_id, target_semantic_domain),
  foreign key (app_id, tenant_id, environment, import_id, mapped_by_principal_id)
    references app_data_agent.semantic_import_jobs (
      app_id, tenant_id, environment, import_id, principal_id
    ) on delete cascade,
  foreign key (app_id, tenant_id, environment, target_datasource_id)
    references app_data_agent.datasource_connections (
      app_id, tenant_id, environment, datasource_id
    ) on delete restrict,
  foreign key (
    app_id, tenant_id, environment, target_semantic_domain, target_datasource_id
  ) references semantic.semantic_domain_registry (
    app_id, tenant_id, environment, semantic_domain, datasource_id
  ) on delete restrict
);

create table app_data_agent.semantic_import_operations (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_id uuid not null,
  operation_id uuid not null,
  idempotency_key uuid not null,
  operation_kind text not null check (operation_kind in ('UPLOAD', 'MAP', 'DRY_RUN', 'COMMIT', 'CANCEL')),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  import_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, principal_id, operation_id),
  foreign key (app_id, tenant_id, environment, import_id)
    references app_data_agent.semantic_import_jobs (
      app_id, tenant_id, environment, import_id
    ) on delete restrict
);

create table app_data_agent.semantic_import_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  receipt_id uuid not null,
  import_id uuid not null,
  principal_id uuid not null,
  upload_hash text not null check (upload_hash ~ '^sha256:[0-9a-f]{64}$'),
  document_content_hash text not null check (document_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  mapping_hash text not null check (mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_refs jsonb not null check (
    pg_catalog.jsonb_typeof(candidate_refs) = 'array'
    and pg_catalog.jsonb_array_length(candidate_refs) between 1 and 64
    and not app_data_agent.contains_potential_plaintext_secret(candidate_refs)
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, receipt_id),
  unique (app_id, tenant_id, environment, import_id),
  foreign key (app_id, tenant_id, environment, import_id, principal_id)
    references app_data_agent.semantic_import_jobs (
      app_id, tenant_id, environment, import_id, principal_id
    ) on delete restrict
);

alter table app_data_agent.semantic_import_jobs
  add constraint semantic_import_jobs_receipt_fk
  foreign key (app_id, tenant_id, environment, receipt_id)
  references app_data_agent.semantic_import_receipts (
    app_id, tenant_id, environment, receipt_id
  ) on delete restrict;

alter table app_data_agent.semantic_import_jobs owner to data_agent_u6_data_owner;
alter table app_data_agent.semantic_import_mappings owner to data_agent_u6_data_owner;
alter table app_data_agent.semantic_import_operations owner to data_agent_u6_data_owner;
alter table app_data_agent.semantic_import_receipts owner to data_agent_u6_data_owner;
