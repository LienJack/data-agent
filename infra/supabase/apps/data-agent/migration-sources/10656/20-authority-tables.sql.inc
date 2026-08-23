-- ============================================================
-- U5 append-only Authority and receipt tables.
-- ============================================================

create table semantic.semantic_bootstrap_signer_key_revisions (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  key_id text not null,
  key_revision bigint not null check (key_revision between 1 and 9007199254740991),
  principal_id uuid not null,
  signer_role text not null check (signer_role in ('WORKSPACE_ADMIN','PLATFORM_ATTESTOR')),
  key_purpose text not null check (key_purpose in ('SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE','PLATFORM_ATTESTATION')),
  key_status text not null default 'STAGED' check (key_status in ('STAGED','ACTIVE','COMPROMISED','RETIRED')),
  public_material jsonb not null,
  public_material_hash text not null check (public_material_hash ~ '^sha256:[0-9a-f]{64}$'),
  activation_receipt_hash text check (activation_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  revocation_epoch bigint not null default 0,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,key_id,key_revision),
  unique (app_id,tenant_id,environment,semantic_domain,public_material_hash),
  check (
    (signer_role='WORKSPACE_ADMIN' and key_purpose='SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE') or
    (signer_role='PLATFORM_ATTESTOR' and key_purpose='PLATFORM_ATTESTATION')
  ),
  check ((key_status='ACTIVE') = (activation_receipt_hash is not null) or key_status in ('COMPROMISED','RETIRED'))
);

create table semantic.semantic_bootstrap_signer_activations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  activation_id uuid not null,
  key_id text not null,
  key_revision bigint not null,
  challenge_hash text not null check (challenge_hash ~ '^sha256:[0-9a-f]{64}$'),
  proof_signature_hash text not null check (proof_signature_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  activated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,activation_id),
  unique (app_id,tenant_id,environment,semantic_domain,key_id,key_revision),
  foreign key (app_id,tenant_id,environment,semantic_domain,key_id,key_revision)
    references semantic.semantic_bootstrap_signer_key_revisions
      (app_id,tenant_id,environment,semantic_domain,key_id,key_revision) on delete restrict
);

create table semantic.verified_semantic_domain_bootstrap_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  receipt_id uuid not null,
  datasource_id uuid not null,
  packet_id uuid not null,
  packet_digest text not null check (packet_digest ~ '^sha256:[0-9a-f]{64}$'),
  release_set_id uuid not null,
  candidate_id uuid not null,
  candidate_revision_id uuid not null,
  candidate_set_hash text not null check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_id uuid not null,
  policy_revision bigint not null,
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  nonce_hash text not null check (nonce_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  verified_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,packet_digest),
  unique (app_id,tenant_id,environment,semantic_domain,nonce_hash),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash)
);

create table semantic.semantic_bootstrap_policy_revisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  policy_id uuid not null,
  policy_revision bigint not null,
  policy_json jsonb not null,
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,policy_id,policy_revision),
  unique (app_id,tenant_id,environment,semantic_domain,policy_hash),
  check (valid_until > valid_from)
);

create table semantic.semantic_bootstrap_policy_pointer (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  policy_id uuid not null,
  policy_revision bigint not null,
  policy_hash text not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain),
  foreign key (app_id,tenant_id,environment,semantic_domain,policy_id,policy_revision)
    references semantic.semantic_bootstrap_policy_revisions
      (app_id,tenant_id,environment,semantic_domain,policy_id,policy_revision) on delete restrict
);

create table semantic.semantic_bootstrap_publisher_grants (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  grant_id uuid not null,
  grant_hash text not null check (grant_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text not null,
  grant_nonce uuid not null,
  command_json jsonb not null,
  issuer_principal_id uuid not null,
  operator_principal_id uuid not null,
  release_set_id uuid not null,
  candidate_set_hash text not null check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_id uuid not null,
  policy_revision bigint not null,
  policy_hash text not null,
  revocation_epoch bigint not null,
  grant_status text not null default 'ACTIVE' check (grant_status in ('ACTIVE','REVOKED','CONSUMED','EXPIRED')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  primary key (app_id,tenant_id,environment,semantic_domain,grant_id),
  unique (app_id,tenant_id,environment,semantic_domain,grant_hash),
  unique (app_id,tenant_id,environment,semantic_domain,issuer_principal_id,idempotency_key),
  unique (app_id,tenant_id,environment,semantic_domain,grant_nonce),
  check (expires_at > issued_at),
  check ((grant_status='CONSUMED') = (consumed_at is not null))
);

create table semantic.semantic_bootstrap_validation_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  receipt_id uuid not null,
  candidate_id uuid not null,
  candidate_revision_id uuid not null,
  candidate_set_hash text not null check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  validated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash)
);

create table semantic.initial_semantic_release_sets (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  release_set_id uuid not null,
  release_id uuid not null,
  release_set_hash text not null check (release_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  candidate_revision_id uuid not null,
  policy_hash text not null,
  validation_receipt_id uuid not null,
  validation_receipt_hash text not null,
  release_set_json jsonb not null,
  published_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,release_set_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_set_hash)
);

create table semantic.initial_semantic_release_package_bindings (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  release_set_id uuid not null,
  namespace_id uuid not null,
  package_id uuid not null,
  package_version bigint not null,
  package_hash text not null,
  validation_receipt_id uuid not null,
  validation_receipt_hash text not null,
  preview_id uuid not null,
  preview_hash text not null,
  graph_projection_id uuid not null,
  graph_projection_hash text not null,
  binding_json jsonb not null,
  primary key (app_id,tenant_id,environment,semantic_domain,release_set_id,package_id,package_version),
  foreign key (app_id,tenant_id,environment,semantic_domain,release_set_id)
    references semantic.initial_semantic_release_sets
      (app_id,tenant_id,environment,semantic_domain,release_set_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash)
    references semantic.ontology_package_candidates
      (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,validation_receipt_id,validation_receipt_hash)
    references semantic.ontology_package_validation_receipts
      (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,preview_id)
    references semantic.ontology_package_preview_bindings
      (app_id,tenant_id,environment,semantic_domain,preview_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,graph_projection_id)
    references semantic.semantic_graph_projection
      (app_id,tenant_id,environment,semantic_domain,projection_id) on delete restrict
);

create table semantic.semantic_package_admission_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  receipt_id uuid not null,
  release_set_id uuid not null,
  package_id uuid not null,
  package_version bigint not null,
  package_hash text not null,
  receipt_json jsonb not null,
  receipt_hash text not null,
  admitted_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_set_id,package_id,package_version),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash)
);

create table semantic.first_release_admission_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  receipt_id uuid not null,
  release_set_id uuid not null,
  receipt_json jsonb not null,
  receipt_hash text not null,
  decision_set_digest text not null,
  admitted_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_set_id),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash)
);

create table semantic.semantic_bootstrap_capability_tombstones (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  tombstone_id uuid not null,
  release_set_id uuid not null,
  grant_id uuid not null,
  tombstone_json jsonb not null,
  tombstone_hash text not null,
  closed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain),
  unique (app_id,tenant_id,environment,semantic_domain,tombstone_id),
  unique (app_id,tenant_id,environment,semantic_domain,tombstone_hash)
);

create table semantic.semantic_bootstrap_publish_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  principal_id uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  result_json jsonb not null,
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key)
);

create table semantic.semantic_bootstrap_outbox (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  outbox_id uuid not null,
  release_set_id uuid not null,
  topic text not null check (topic='semantic.initial_release.published'),
  payload_json jsonb not null,
  payload_hash text not null,
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,outbox_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_set_id)
);
