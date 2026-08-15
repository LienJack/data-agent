-- falcon_import_migration_checksum: sha256:cbbab2087c808e0daf73ddb1eef7076cb01267d8190316795f05be1ca7fc48a3
-- ============================================================
-- 10646: Fixed Falcon import authority and isolated reader
-- Depends on: 20260725010645_app_data_agent_semantic_authoring_review
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'FALCON_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'FALCON_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010645_app_data_agent_semantic_authoring_review'
  ) then
    raise exception using errcode = 'P0001', message = 'FALCON_BASELINE_10645_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
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
create function app_data_agent.record_falcon_import_receipt(p_receipt_draft jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_receipt jsonb;
  v_hash text;
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or pg_catalog.current_setting('data_agent.allow_falcon_bootstrap', true) <> 'true'
  then
    raise exception using errcode = '42501', message = 'FALCON_IMPORT_RECEIPT_AUTHORITY_UNSAFE';
  end if;
  if p_receipt_draft ->> 'receipt_version' <> 'falcon-import@1.0.0'
    or p_receipt_draft ->> 'source_commit' <> '8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5'
    or p_receipt_draft ->> 'dataset_version' <> 'falcon-fixed-8ff29caa-postgres-v1'
    or p_receipt_draft ->> 'target_database' <> 'data_agent'
    or p_receipt_draft ->> 'reader_role' <> 'falcon_demo_reader'
    or (p_receipt_draft ->> 'database_count')::integer <> 28
    or (p_receipt_draft ->> 'dev_case_count')::integer <> 309
    or (p_receipt_draft ->> 'test_case_count')::integer <> 191
    or pg_catalog.jsonb_array_length(p_receipt_draft -> 'databases') <> 28
    or p_receipt_draft ->> 'status' <> 'READY'
  then
    raise exception using errcode = '22023', message = 'FALCON_IMPORT_RECEIPT_INVALID';
  end if;
  v_hash := semantic.authoring_sha256(p_receipt_draft);
  v_receipt := p_receipt_draft || pg_catalog.jsonb_build_object('receipt_hash', v_hash);
  insert into app_data_agent.falcon_import_receipts (
    source_digest,
    source_commit,
    dataset_version,
    target_database,
    database_count,
    dev_case_count,
    test_case_count,
    status,
    receipt_hash,
    receipt,
    imported_at
  ) values (
    v_receipt ->> 'source_digest',
    v_receipt ->> 'source_commit',
    v_receipt ->> 'dataset_version',
    v_receipt ->> 'target_database',
    (v_receipt ->> 'database_count')::integer,
    (v_receipt ->> 'dev_case_count')::integer,
    (v_receipt ->> 'test_case_count')::integer,
    v_receipt ->> 'status',
    v_hash,
    v_receipt,
    (v_receipt ->> 'imported_at')::timestamptz
  )
  on conflict (source_digest) do nothing;
  select receipt into v_receipt
  from app_data_agent.falcon_import_receipts
  where source_digest = p_receipt_draft ->> 'source_digest';
  return v_receipt;
end
$function$;

create function app_data_agent.configure_falcon_demo_reader(p_password text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or pg_catalog.current_setting('data_agent.allow_falcon_bootstrap', true) <> 'true'
  then
    raise exception using errcode = '42501', message = 'FALCON_READER_CONFIGURATION_UNSAFE';
  end if;
  if pg_catalog.length(p_password) not between 16 and 1024 then
    raise exception using errcode = '22023', message = 'FALCON_READER_PASSWORD_INVALID';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'falcon_demo_reader') then
    create role falcon_demo_reader login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
  execute pg_catalog.format('alter role falcon_demo_reader password %L', p_password);
  alter role falcon_demo_reader set default_transaction_read_only = on;
  alter role falcon_demo_reader set search_path = pg_catalog;
  return pg_catalog.jsonb_build_object(
    'schema_version', 'falcon-reader-result@1.0.0',
    'role_name', 'falcon_demo_reader',
    'credential_rotated', true
  );
end
$function$;
revoke all on app_data_agent.falcon_import_receipts
from public, anon, authenticated, service_role, data_agent_backend;
grant select on app_data_agent.falcon_import_receipts to data_agent_backend;
revoke all on function app_data_agent.record_falcon_import_receipt(jsonb)
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.configure_falcon_demo_reader(text)
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.reject_falcon_import_receipt_mutation()
from public, anon, authenticated, service_role, data_agent_backend;

do $postconditions$
begin
  if pg_catalog.has_function_privilege(
    'data_agent_backend', 'app_data_agent.record_falcon_import_receipt(jsonb)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend', 'app_data_agent.configure_falcon_demo_reader(text)', 'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'FALCON_BOOTSTRAP_FUNCTION_EXPOSED';
  end if;
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.falcon_import_receipts', 'INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'FALCON_IMPORT_RECEIPT_MUTABLE';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010646_app_data_agent_falcon_import',
  'sha256:cbbab2087c808e0daf73ddb1eef7076cb01267d8190316795f05be1ca7fc48a3'
);

commit;
