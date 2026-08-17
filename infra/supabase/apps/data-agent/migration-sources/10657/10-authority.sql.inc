create table app_data_agent.artifact_export_receipts (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_revision integer not null check (receipt_revision=1),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_artifact_id uuid not null,
  source_artifact_type text not null,
  source_revision integer not null check (source_revision>=1),
  source_content_hash text not null check (source_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  export_format text not null check (export_format in ('CSV','XLSX')),
  idempotency_key text not null check (
    length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_hash text not null check (output_hash ~ '^sha256:[0-9a-f]{64}$'),
  mime_type text not null,
  attachment_filename text not null check (
    attachment_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.(csv|xlsx)$'
    and attachment_filename not like '%..%'
  ),
  row_count integer not null check (row_count between 0 and 10000),
  column_count integer not null check (column_count between 1 and 256),
  receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(receipt_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json)
  ),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,idempotency_key),
  unique (app_id,tenant_id,environment,run_id,receipt_id,receipt_revision,receipt_hash),
  foreign key (
    app_id,tenant_id,environment,run_id,source_artifact_id,source_artifact_type,
    source_revision,source_content_hash
  ) references app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash
  ) on delete restrict
);

alter table app_data_agent.artifact_export_receipts enable row level security;
alter table app_data_agent.artifact_export_receipts force row level security;
alter table app_data_agent.artifact_export_receipts owner to data_agent_u7_artifact_export_owner;

create policy artifact_export_receipts_owner_all
on app_data_agent.artifact_export_receipts
for all to data_agent_u7_artifact_export_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false))
with check (platform.backend_context_matches(app_id,tenant_id,environment,true));

create function app_data_agent.reject_artifact_export_receipt_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using errcode='55000',message='ARTIFACT_EXPORT_RECEIPT_IMMUTABLE';
end
$function$;
alter function app_data_agent.reject_artifact_export_receipt_mutation()
  owner to data_agent_u7_artifact_export_owner;

create trigger artifact_export_receipts_immutable
before update or delete on app_data_agent.artifact_export_receipts
for each row execute function app_data_agent.reject_artifact_export_receipt_mutation();

grant select on app_data_agent.artifacts to data_agent_u7_artifact_export_owner;
create policy artifacts_u7_export_source_select
on app_data_agent.artifacts
as permissive for select to data_agent_u7_artifact_export_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
