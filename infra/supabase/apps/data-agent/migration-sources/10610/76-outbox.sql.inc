-- ============================================================
-- 10610: Semantic authority outbox table
-- ============================================================

-- ============================================================
-- 31. semantic_outbox: semantic authority change events
-- envelope: scope/event_id/type, counter_kind=RELEASE|ACTIVATION
-- axis_generation, observed release/activation generation
-- Published with corresponding Authority transaction atomically
-- ============================================================
create table semantic.semantic_outbox (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  event_id uuid not null,
  event_type text not null
    check (event_type in (
      'CANDIDATE_SUBMITTED', 'CANDIDATE_APPROVED', 'CANDIDATE_REJECTED',
      'CANDIDATE_PUBLISHED', 'CANDIDATE_STALE',
      'REVIEW_PACKET_CREATED', 'REVIEW_DECISION_RECORDED',
      'REVIEW_PACKET_CLOSED', 'REVIEW_PACKET_EXPIRED',
      'PUBLISH_ATTEMPT_PREPARED', 'PUBLISH_ATTEMPT_COMMITTED',
      'PUBLISH_ATTEMPT_STALE',
      'SOURCE_RELEASE_CREATED', 'SOURCE_RELEASE_ACTIVATED',
      'ROLLBACK_AUTHORIZED', 'ROLLBACK_EXECUTED',
      'RUNTIME_ACTIVATION_CHANGED', 'APPLICATION_ROLLBACK_EXECUTED',
      'LEGACY_CONTRACT_CLOSED', 'LEGACY_EQUIVALENCE_ATTEMPTED',
      'LEGACY_EQUIVALENCE_COMMITTED', 'LEGACY_CLOSURE_AUTHORIZED',
      'LEGACY_MIRROR_CREATED', 'LEGACY_EQUIVALENCE_RECEIPT_ISSUED'
    )),
  counter_kind text not null
    check (counter_kind in ('RELEASE', 'ACTIVATION')),
  axis_generation bigint not null
    check (axis_generation between 0 and 9007199254740991),
  observed_release_generation bigint
    check (observed_release_generation between 0 and 9007199254740991),
  observed_activation_generation bigint
    check (observed_activation_generation between 1 and 9007199254740991),
  event_payload jsonb not null,
  event_digest text not null
    check (event_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, event_id),
  unique (app_id, tenant_id, environment, semantic_domain, event_digest)
);

-- Outbox high-water mark index for RELEASE axis
create index if not exists idx_semantic_outbox_release_watermark
  on semantic.semantic_outbox (app_id, tenant_id, environment, semantic_domain, counter_kind, axis_generation)
  where counter_kind = 'RELEASE';

-- Outbox high-water mark index for ACTIVATION axis
create index if not exists idx_semantic_outbox_activation_watermark
  on semantic.semantic_outbox (app_id, tenant_id, environment, semantic_domain, counter_kind, axis_generation)
  where counter_kind = 'ACTIVATION';
