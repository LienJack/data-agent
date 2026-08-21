create table semantic.semantic_candidate_self_publish_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  principal_id uuid not null,
  idempotency_key uuid not null,
  command_hash text not null check (command_hash~'^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  candidate_revision_id uuid not null,
  release_id uuid not null,
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key),
  foreign key (app_id,tenant_id,environment,semantic_domain,release_id)
    references semantic.semantic_source_release(app_id,tenant_id,environment,semantic_domain,release_id)
);

alter table semantic.semantic_candidate_self_publish_idempotency enable row level security;
alter table semantic.semantic_candidate_self_publish_idempotency force row level security;
alter table semantic.semantic_candidate_self_publish_idempotency owner to data_agent_u6_data_owner;
create policy semantic_candidate_self_publish_idempotency_scope
  on semantic.semantic_candidate_self_publish_idempotency for all to data_agent_u6_rpc_owner
  using (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
