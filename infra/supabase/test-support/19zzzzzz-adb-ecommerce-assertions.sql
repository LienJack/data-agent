begin;

do $assertions$
declare raw_count integer;
declare mart_count integer;
declare view_count integer;
begin
  select count(*) into raw_count from information_schema.tables
  where table_schema = 'demo_adb_ecommerce_raw' and table_type = 'BASE TABLE';
  select count(*) into mart_count from information_schema.tables
  where table_schema = 'demo_adb_ecommerce_mart' and table_type = 'BASE TABLE';
  select count(*) into view_count from information_schema.views
  where table_schema = 'demo_adb_ecommerce_mart';
  if raw_count <> 12 or mart_count <> 14 or view_count <> 5 then
    raise exception 'ADB_ECOMMERCE_ASSERT_RELATION_CLOSURE';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'data_agent_ecommerce_readonly' and not rolcanlogin
      and not rolsuper and not rolcreatedb and not rolcreaterole
  ) then
    raise exception 'ADB_ECOMMERCE_ASSERT_ROLE_HARDENING';
  end if;
  if not pg_catalog.has_schema_privilege(
    'data_agent_ecommerce_readonly', 'demo_adb_ecommerce_mart', 'USAGE'
  ) or not pg_catalog.has_table_privilege(
    'data_agent_ecommerce_readonly', 'demo_adb_ecommerce_mart.fact_order', 'SELECT'
  ) then
    raise exception 'ADB_ECOMMERCE_ASSERT_READ_GRANTS';
  end if;
  if pg_catalog.has_schema_privilege('data_agent_ecommerce_readonly', 'app_data_agent', 'USAGE')
    or pg_catalog.has_table_privilege(
      'data_agent_ecommerce_readonly', 'demo_adb_ecommerce_raw.olist_orders', 'INSERT,UPDATE,DELETE'
    )
  then
    raise exception 'ADB_ECOMMERCE_ASSERT_PRIVILEGE_LEAK';
  end if;

  begin
    insert into demo_adb_ecommerce_raw.olist_orders (
      order_id, customer_id, order_status, order_purchase_timestamp
    ) values ('forbidden', 'forbidden', 'forbidden', clock_timestamp());
    raise exception 'ADB_ECOMMERCE_ASSERT_MUTATION_WAS_ALLOWED';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'ADB_ECOMMERCE_FIXTURE_IMMUTABLE' then raise; end if;
  end;
end
$assertions$;

insert into app_data_agent.demo_dataset_versions (
  dataset_id, bundle_digest, source_manifest_digest, dataset_version, status,
  raw_table_count, mart_table_count, view_count, row_counts
) values (
  'assertion-only',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'assertion', 'READY', 12, 14, 5, '{}'::jsonb
);

do $receipt_assertion$
begin
  begin
    update app_data_agent.demo_dataset_versions
    set status = 'READY'
    where dataset_id = 'assertion-only';
    raise exception 'ADB_ECOMMERCE_ASSERT_RECEIPT_MUTATION_WAS_ALLOWED';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'ADB_ECOMMERCE_RECEIPT_IMMUTABLE' then raise; end if;
  end;
end
$receipt_assertion$;

rollback;
