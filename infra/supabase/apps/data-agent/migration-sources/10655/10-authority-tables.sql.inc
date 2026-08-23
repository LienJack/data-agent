-- ============================================================
-- Immutable package, validation and preview receipts.
-- Existing Candidate Revision and Graph Projection remain the only source authorities.
-- ============================================================

create table semantic.ontology_package_candidates (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  namespace_id uuid not null,
  package_id uuid not null,
  package_version bigint not null check (package_version between 1 and 9007199254740991),
  package_hash text not null check (package_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  revision_id uuid not null,
  revision_digest text not null check (revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  package_json jsonb not null check (
    pg_catalog.jsonb_typeof(package_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(package_json)
  ),
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,package_id,package_version),
  unique (app_id,tenant_id,environment,semantic_domain,namespace_id,package_hash),
  unique (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash),
  foreign key (app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id)
    references semantic.semantic_candidate_revision (
      app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id
    ) on delete restrict
);

create table semantic.ontology_package_validation_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  receipt_id uuid not null,
  namespace_id uuid not null,
  package_id uuid not null,
  package_version bigint not null check (package_version between 1 and 9007199254740991),
  package_hash text not null check (package_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_binding_hash text not null check (source_binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  compiler_digest text not null check (compiler_digest ~ '^sha256:[0-9a-f]{64}$'),
  validator_version text not null check (validator_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  valid boolean not null,
  receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(receipt_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json)
  ),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,package_id,package_version,receipt_hash),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash),
  foreign key (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash)
    references semantic.ontology_package_candidates (
      app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash
    ) on delete restrict
);

create table semantic.ontology_package_preview_bindings (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  preview_id uuid not null,
  namespace_id uuid not null,
  package_id uuid not null,
  package_version bigint not null check (package_version between 1 and 9007199254740991),
  package_hash text not null check (package_hash ~ '^sha256:[0-9a-f]{64}$'),
  validation_receipt_id uuid not null,
  validation_receipt_hash text not null check (validation_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  projection_id uuid not null,
  projection_storage_digest text not null check (projection_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  preview_json jsonb not null check (
    pg_catalog.jsonb_typeof(preview_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(preview_json)
  ),
  preview_hash text not null check (preview_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,preview_id),
  unique (app_id,tenant_id,environment,semantic_domain,package_id,package_version),
  unique (app_id,tenant_id,environment,semantic_domain,preview_hash),
  foreign key (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash)
    references semantic.ontology_package_candidates (
      app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash
    ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,semantic_domain,validation_receipt_id,validation_receipt_hash
  ) references semantic.ontology_package_validation_receipts (
    app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash
  ) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,projection_id)
    references semantic.semantic_graph_projection (
      app_id,tenant_id,environment,semantic_domain,projection_id
    ) on delete restrict
);

create function semantic.reject_ontology_package_authority_mutation()
returns trigger language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'ONTOLOGY_PACKAGE_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger ontology_package_candidates_immutable
before update or delete on semantic.ontology_package_candidates
for each row execute function semantic.reject_ontology_package_authority_mutation();
create trigger ontology_package_validation_receipts_immutable
before update or delete on semantic.ontology_package_validation_receipts
for each row execute function semantic.reject_ontology_package_authority_mutation();
create trigger ontology_package_preview_bindings_immutable
before update or delete on semantic.ontology_package_preview_bindings
for each row execute function semantic.reject_ontology_package_authority_mutation();
