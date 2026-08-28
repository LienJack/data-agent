create table semantic.semantic_successor_review_preparation(
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  principal_id uuid not null,
  idempotency_key uuid not null,
  input_digest text not null check(input_digest~'^sha256:[0-9a-f]{64}$'),
  predecessor_release_id uuid not null,
  predecessor_release_generation bigint not null
    check(predecessor_release_generation between 1 and 9007199254740991),
  predecessor_release_digest text not null
    check(predecessor_release_digest~'^sha256:[0-9a-f]{64}$'),
  expected_pointer_version bigint not null
    check(expected_pointer_version between 1 and 9007199254740991),
  change_set_id uuid not null,
  change_set_hash text not null check(change_set_hash~'^sha256:[0-9a-f]{64}$'),
  source_revision_id uuid not null,
  candidate_revision_id uuid not null,
  packet_id uuid not null,
  packet_digest text not null check(packet_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key),
  unique(app_id,tenant_id,environment,semantic_domain,idempotency_key),
  unique(app_id,tenant_id,environment,semantic_domain,change_set_id),
  unique(app_id,tenant_id,environment,semantic_domain,packet_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,change_set_id)
    references semantic.semantic_candidate(app_id,tenant_id,environment,semantic_domain,candidate_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,source_revision_id)
    references semantic.semantic_source_revision(app_id,tenant_id,environment,semantic_domain,revision_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,change_set_id,candidate_revision_id)
    references semantic.semantic_candidate_revision(
      app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,packet_id)
    references semantic.semantic_review_task(app_id,tenant_id,environment,semantic_domain,packet_id)
);

create table semantic.semantic_successor_review_decision_document(
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  packet_id uuid not null,
  decision_id uuid not null,
  review_hash text not null check(review_hash~'^sha256:[0-9a-f]{64}$'),
  review_document jsonb not null,
  created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,semantic_domain,packet_id,decision_id),
  unique(app_id,tenant_id,environment,semantic_domain,review_hash),
  foreign key(app_id,tenant_id,environment,semantic_domain,packet_id,decision_id)
    references semantic.semantic_review_decision(
      app_id,tenant_id,environment,semantic_domain,packet_id,decision_id)
);

create trigger semantic_successor_review_preparation_immutable
before update or delete on semantic.semantic_successor_review_preparation
for each row execute function semantic.semantic_successor_receipt_immutable();

create trigger semantic_successor_review_decision_document_immutable
before update or delete on semantic.semantic_successor_review_decision_document
for each row execute function semantic.semantic_successor_receipt_immutable();
