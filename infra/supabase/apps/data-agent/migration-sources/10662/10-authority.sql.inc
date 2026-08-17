create table app_data_agent.semantic_induction_source_packages (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  source_kind text not null check (source_kind in ('METRIC_EXCHANGE','FOUNDATIONAL_ONTOLOGY')),
  resource_id uuid not null,
  resource_revision bigint not null check (resource_revision between 1 and 9007199254740991),
  resource_hash text not null check (resource_hash~'^sha256:[0-9a-f]{64}$'),
  content_json jsonb not null check (pg_catalog.jsonb_typeof(content_json)='object'),
  registered_at timestamptz not null,
  primary key (app_id,tenant_id,environment,resource_id,resource_revision),
  unique (app_id,tenant_id,environment,resource_id,resource_revision,resource_hash)
);

create table app_data_agent.semantic_induction_proposals (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  induction_id uuid not null,
  semantic_domain text not null,
  proposal_hash text not null check (proposal_hash~'^sha256:[0-9a-f]{64}$'),
  proposal_json jsonb not null check (pg_catalog.jsonb_typeof(proposal_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,induction_id),
  unique (app_id,tenant_id,environment,induction_id,proposal_hash)
);

create table app_data_agent.semantic_impact_plans (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  induction_id uuid not null,
  semantic_domain text not null,
  plan_hash text not null check (plan_hash~'^sha256:[0-9a-f]{64}$'),
  plan_json jsonb not null check (pg_catalog.jsonb_typeof(plan_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,induction_id),
  unique (app_id,tenant_id,environment,induction_id,plan_hash)
);

create table app_data_agent.semantic_metric_dry_run_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  import_id uuid not null,
  semantic_domain text not null,
  receipt_hash text not null check (receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,import_id),
  unique (app_id,tenant_id,environment,import_id,receipt_hash)
);

create table app_data_agent.semantic_induction_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  induction_id uuid not null,
  semantic_domain text not null,
  job_id uuid not null,
  attempt_id uuid not null,
  worker_fence bigint not null,
  request_hash text not null check (request_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,induction_id),
  unique (app_id,tenant_id,environment,job_id),
  foreign key (app_id,tenant_id,environment,job_id)
    references app_data_agent.jobs(app_id,tenant_id,environment,job_id)
);

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'semantic_induction_source_packages','semantic_induction_proposals','semantic_impact_plans',
    'semantic_metric_dry_run_receipts','semantic_induction_receipts'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u11_induction_owner',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_u11_induction_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      relation_name||'_owner_all',relation_name
    );
  end loop;
end
$rls$;

create index semantic_induction_proposals_domain_idx on app_data_agent.semantic_induction_proposals(
  app_id,tenant_id,environment,semantic_domain,committed_at desc
);
