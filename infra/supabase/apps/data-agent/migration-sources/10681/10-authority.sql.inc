do $replace_terminal_constraint$
declare constraint_name text;
begin
  select constraint_record.conname into strict constraint_name
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid='semantic.semantic_authoring_run'::regclass
    and constraint_record.contype='c'
    and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%READY_FOR_REVIEW%materialized_source_revision_id%';
  execute pg_catalog.format(
    'alter table semantic.semantic_authoring_run drop constraint %I',constraint_name
  );
end
$replace_terminal_constraint$;

alter table semantic.semantic_authoring_run
  add constraint semantic_authoring_run_terminal_closure check (
    (status='READY_FOR_REVIEW' and failure_code is null)
    or (status='FAILED' and materialized_source_revision_id is null and failure_code is not null)
    or (status not in ('READY_FOR_REVIEW','FAILED')
      and materialized_source_revision_id is null and failure_code is null)
  );

create table semantic.semantic_candidate_revision_save_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  principal_id uuid not null,
  idempotency_key uuid not null,
  command_hash text not null check (command_hash~'^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  source_revision_id uuid not null,
  candidate_revision_id uuid not null,
  revision_number integer not null check (revision_number between 1 and 2147483647),
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key),
  foreign key (app_id,tenant_id,environment,semantic_domain,candidate_id,candidate_revision_id)
    references semantic.semantic_candidate_revision(
      app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id
    )
);

create table app_data_agent.knowledge_semantic_usage_references (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  usage_id uuid not null,
  selection_id uuid not null,
  selection_hash text not null check (selection_hash~'^sha256:[0-9a-f]{64}$'),
  semantic_domain text not null,
  usage_kind text not null check (usage_kind in ('CANDIDATE_REVISION','PUBLISHED_SEMANTIC_OBJECT')),
  subject_id uuid not null,
  subject_revision integer not null check (subject_revision between 1 and 2147483647),
  subject_hash text not null check (subject_hash~'^sha256:[0-9a-f]{64}$'),
  created_by_principal_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,usage_id),
  unique (app_id,tenant_id,environment,selection_id,usage_kind,subject_id,subject_revision),
  foreign key (app_id,tenant_id,environment,selection_id,selection_hash)
    references app_data_agent.knowledge_evidence_selections(
      app_id,tenant_id,environment,selection_id,selection_hash
    )
);

alter table semantic.semantic_candidate_revision_save_idempotency enable row level security;
alter table semantic.semantic_candidate_revision_save_idempotency force row level security;
alter table semantic.semantic_candidate_revision_save_idempotency owner to data_agent_u6_data_owner;
create policy semantic_candidate_revision_save_idempotency_scope
  on semantic.semantic_candidate_revision_save_idempotency for all to data_agent_u6_rpc_owner
  using (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

alter table app_data_agent.knowledge_semantic_usage_references enable row level security;
alter table app_data_agent.knowledge_semantic_usage_references force row level security;
alter table app_data_agent.knowledge_semantic_usage_references owner to data_agent_u15_knowledge_owner;
create policy knowledge_semantic_usage_references_owner_all
  on app_data_agent.knowledge_semantic_usage_references for all to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create trigger knowledge_semantic_usage_references_immutable
  before update or delete on app_data_agent.knowledge_semantic_usage_references
  for each statement execute function app_data_agent.reject_knowledge_immutable_mutation();

create index knowledge_semantic_usage_selection_idx
  on app_data_agent.knowledge_semantic_usage_references(
    app_id,tenant_id,environment,selection_id,created_at desc
  );
