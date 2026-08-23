create table app_data_agent.falcon_import_receipts (
  source_digest text primary key check (source_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_commit text not null check (source_commit = '8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5'),
  dataset_version text not null check (dataset_version = 'falcon-fixed-8ff29caa-postgres-v1'),
  target_database text not null check (target_database = 'data_agent'),
  database_count integer not null check (database_count = 28),
  dev_case_count integer not null check (dev_case_count = 309),
  test_case_count integer not null check (test_case_count = 191),
  status text not null check (status = 'READY'),
  receipt_hash text not null unique check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt jsonb not null,
  imported_at timestamptz not null,
  check (receipt ->> 'source_digest' = source_digest),
  check (receipt ->> 'receipt_hash' = receipt_hash),
  check (receipt ->> 'status' = status)
);

create function app_data_agent.reject_falcon_import_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'FALCON_IMPORT_RECEIPT_IMMUTABLE';
end
$function$;

create trigger falcon_import_receipts_immutable
before update or delete on app_data_agent.falcon_import_receipts
for each row execute function app_data_agent.reject_falcon_import_receipt_mutation();
