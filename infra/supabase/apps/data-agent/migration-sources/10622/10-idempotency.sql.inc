-- ============================================================
-- 10622: Candidate draft idempotency ledger
-- ============================================================

create table semantic.semantic_candidate_draft_idempotency (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  principal_id uuid not null,
  idempotency_key uuid not null,
  input_digest text not null
    check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  revision_id uuid not null,
  source_revision_id uuid not null,
  source_digest text not null
    check (source_digest ~ '^sha256:[0-9a-f]{64}$'),
  revision_digest text not null
    check (revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    principal_id,
    idempotency_key
  ),
  unique (app_id, tenant_id, environment, semantic_domain, candidate_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, source_revision_id)
    references semantic.semantic_source_revision (
      app_id,
      tenant_id,
      environment,
      semantic_domain,
      revision_id
    ),
  foreign key (app_id, tenant_id, environment, semantic_domain, candidate_id, revision_id)
    references semantic.semantic_candidate_revision (
      app_id,
      tenant_id,
      environment,
      semantic_domain,
      candidate_id,
      revision_id
    )
);

alter table semantic.semantic_candidate_draft_idempotency
  owner to data_agent_u6_data_owner;

alter table semantic.semantic_candidate_draft_idempotency enable row level security;
alter table semantic.semantic_candidate_draft_idempotency force row level security;

create policy semantic_candidate_draft_idempotency_scope_policy
  on semantic.semantic_candidate_draft_idempotency
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

revoke all on table semantic.semantic_candidate_draft_idempotency from public;
revoke all on table semantic.semantic_candidate_draft_idempotency from data_agent_u6_web_role;
revoke all on table semantic.semantic_candidate_draft_idempotency from data_agent_u6_worker_role;
revoke all on table semantic.semantic_candidate_draft_idempotency from data_agent_u6_rpc_owner;
