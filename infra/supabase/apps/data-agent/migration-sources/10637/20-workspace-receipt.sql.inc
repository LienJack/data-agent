-- ============================================================
-- 10637: Workspace-scoped installation receipt
-- ============================================================

create table app_data_agent.demo_workspace_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  dataset_id text not null,
  bundle_digest text not null check (bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  datasource_id uuid not null,
  secret_ref_id uuid not null,
  created_by_principal_id uuid not null,
  status text not null check (status = 'READY'),
  attached_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, dataset_id, bundle_digest),
  foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment) on delete restrict,
  foreign key (app_id, tenant_id, environment, datasource_id)
    references app_data_agent.datasource_connections (app_id, tenant_id, environment, datasource_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, secret_ref_id)
    references app_data_agent.secret_refs (app_id, tenant_id, environment, secret_ref_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, created_by_principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict,
  foreign key (dataset_id, bundle_digest)
    references app_data_agent.demo_dataset_versions (dataset_id, bundle_digest) on delete restrict
);

create trigger demo_workspace_receipts_immutable
before update or delete on app_data_agent.demo_workspace_receipts
for each row execute function app_data_agent.reject_demo_dataset_receipt_mutation();
