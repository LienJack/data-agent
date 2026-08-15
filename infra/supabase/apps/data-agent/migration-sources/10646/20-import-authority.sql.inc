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
