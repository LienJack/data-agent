-- adb_ecommerce_demo_migration_checksum: sha256:3b8c5bccbb9e8a4c51243c4b0a51827a98171f57f551bf9d6b4a62b2fae92f19
-- ============================================================
-- 10636: AgenticDataBench E-commerce PostgreSQL Demo v1
-- Depends on: 20260725010635_app_data_agent_superadmin_email_sync
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'ADB_ECOMMERCE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'ADB_ECOMMERCE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010635_app_data_agent_superadmin_email_sync'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_BASELINE_10635_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010636_app_data_agent_adb_ecommerce_demo'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_MIGRATION_10636_ALREADY_RECORDED';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
-- ============================================================
-- 10636: Isolated schemas and read-only group role
-- ============================================================

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_ecommerce_readonly') then
    create role data_agent_ecommerce_readonly nologin nosuperuser nocreatedb nocreaterole noinherit noreplication;
  end if;
end
$roles$;

create schema demo_adb_ecommerce_raw authorization postgres;
create schema demo_adb_ecommerce_mart authorization postgres;

revoke all on schema demo_adb_ecommerce_raw, demo_adb_ecommerce_mart from public;
grant usage on schema demo_adb_ecommerce_raw, demo_adb_ecommerce_mart to data_agent_ecommerce_readonly;
-- ============================================================
-- 10636: Twelve immutable source-shaped raw tables
-- ============================================================

create table demo_adb_ecommerce_raw.amazon_reviews (
  source_row_number bigint generated always as identity primary key,
  reviewer_id text,
  asin text,
  reviewer_name text,
  helpful jsonb not null,
  review_text text,
  overall numeric(4,2),
  summary text,
  unix_review_time bigint,
  review_time text,
  raw_payload jsonb not null
);

create table demo_adb_ecommerce_raw.amazon_metadata (
  source_row_number bigint generated always as identity primary key,
  category jsonb not null,
  tech1 text,
  description jsonb not null,
  fit text,
  title text,
  also_buy jsonb not null,
  tech2 text,
  brand text,
  feature jsonb not null,
  rank_text text,
  also_view jsonb not null,
  details jsonb not null,
  main_category text,
  similar_item text,
  product_date text,
  price_text text,
  asin text,
  image_url jsonb not null,
  image_url_high_res jsonb not null,
  raw_payload jsonb not null
);

create table demo_adb_ecommerce_raw.ebay_laptops (
  source_row_number bigint generated always as identity primary key,
  brand text,
  price text,
  rating text,
  ratings_count text,
  condition text,
  seller_note text,
  processor text,
  screen_size text,
  manufacturer_color text,
  color text,
  ram_size text,
  ssd_capacity text,
  gpu text,
  processor_speed text,
  listing_type text,
  release_year text,
  maximum_resolution text,
  model text,
  os text,
  features text,
  hard_drive_capacity text,
  country_region_of_manufacture text,
  storage_type text
);

create table demo_adb_ecommerce_raw.olist_customers (
  customer_id text primary key,
  customer_unique_id text not null,
  customer_zip_code_prefix integer not null,
  customer_city text not null,
  customer_state text not null
);

create table demo_adb_ecommerce_raw.olist_geolocation (
  source_row_number bigint generated always as identity primary key,
  geolocation_zip_code_prefix integer not null,
  geolocation_lat double precision not null,
  geolocation_lng double precision not null,
  geolocation_city text not null,
  geolocation_state text not null
);

create table demo_adb_ecommerce_raw.olist_order_items (
  order_id text not null,
  order_item_id integer not null,
  product_id text not null,
  seller_id text not null,
  shipping_limit_date timestamp without time zone,
  price numeric(14,2) not null,
  freight_value numeric(14,2) not null,
  primary key (order_id, order_item_id)
);

create table demo_adb_ecommerce_raw.olist_order_payments (
  order_id text not null,
  payment_sequential integer not null,
  payment_type text not null,
  payment_installments integer not null,
  payment_value numeric(14,2) not null,
  primary key (order_id, payment_sequential)
);

create table demo_adb_ecommerce_raw.olist_order_reviews (
  source_row_number bigint generated always as identity primary key,
  review_id text not null,
  order_id text not null,
  review_score smallint not null check (review_score between 1 and 5),
  review_comment_title text,
  review_comment_message text,
  review_creation_date timestamp without time zone,
  review_answer_timestamp timestamp without time zone
);

create table demo_adb_ecommerce_raw.olist_orders (
  order_id text primary key,
  customer_id text not null,
  order_status text not null,
  order_purchase_timestamp timestamp without time zone not null,
  order_approved_at timestamp without time zone,
  order_delivered_carrier_date timestamp without time zone,
  order_delivered_customer_date timestamp without time zone,
  order_estimated_delivery_date timestamp without time zone
);

create table demo_adb_ecommerce_raw.olist_products (
  product_id text primary key,
  product_category_name text,
  product_name_lenght integer,
  product_description_lenght integer,
  product_photos_qty integer,
  product_weight_g numeric(14,3),
  product_length_cm numeric(14,3),
  product_height_cm numeric(14,3),
  product_width_cm numeric(14,3)
);

create table demo_adb_ecommerce_raw.olist_sellers (
  seller_id text primary key,
  seller_zip_code_prefix integer not null,
  seller_city text not null,
  seller_state text not null
);

create table demo_adb_ecommerce_raw.olist_category_translation (
  product_category_name text primary key,
  product_category_name_english text not null
);

create index adb_raw_amazon_reviews_asin_idx on demo_adb_ecommerce_raw.amazon_reviews (asin);
create index adb_raw_amazon_metadata_asin_idx on demo_adb_ecommerce_raw.amazon_metadata (asin);
create index adb_raw_geolocation_zip_idx on demo_adb_ecommerce_raw.olist_geolocation (geolocation_zip_code_prefix);
create index adb_raw_reviews_order_idx on demo_adb_ecommerce_raw.olist_order_reviews (order_id);
create index adb_raw_items_product_idx on demo_adb_ecommerce_raw.olist_order_items (product_id);
create index adb_raw_items_seller_idx on demo_adb_ecommerce_raw.olist_order_items (seller_id);
-- ============================================================
-- 10636: Fourteen production-shaped mart tables
-- ============================================================

create table demo_adb_ecommerce_mart.dim_date (
  date_key date primary key,
  calendar_year integer not null,
  calendar_quarter integer not null,
  calendar_month integer not null,
  month_key text not null,
  day_of_month integer not null,
  day_of_week integer not null,
  is_weekend boolean not null
);

create table demo_adb_ecommerce_mart.dim_customer (
  customer_id text primary key,
  customer_unique_id text not null,
  zip_code_prefix integer not null,
  city text not null,
  state text not null
);

create table demo_adb_ecommerce_mart.dim_seller (
  seller_id text primary key,
  zip_code_prefix integer not null,
  city text not null,
  state text not null
);

create table demo_adb_ecommerce_mart.dim_category (
  category_name text primary key,
  category_name_english text,
  is_electronics boolean not null
);

create table demo_adb_ecommerce_mart.dim_product (
  product_id text primary key,
  category_name text,
  category_name_english text,
  photos_quantity integer,
  weight_g numeric(14,3),
  length_cm numeric(14,3),
  height_cm numeric(14,3),
  width_cm numeric(14,3)
);

create table demo_adb_ecommerce_mart.dim_geolocation_zip (
  zip_code_prefix integer not null,
  state text not null,
  latitude double precision not null,
  longitude double precision not null,
  city_count integer not null,
  source_point_count bigint not null,
  primary key (zip_code_prefix, state)
);

create table demo_adb_ecommerce_mart.dim_amazon_product (
  asin text primary key,
  title text,
  brand text,
  main_category text,
  price_usd numeric(14,2),
  category jsonb not null,
  feature jsonb not null
);

create table demo_adb_ecommerce_mart.dim_ebay_listing (
  listing_id bigint primary key,
  brand text,
  price_usd numeric(14,2),
  seller_rating numeric(8,3),
  ratings_count integer,
  processor text,
  ram_gb numeric(10,2),
  ssd_gb numeric(10,2),
  gpu text,
  listing_type text,
  model text,
  operating_system text
);

create table demo_adb_ecommerce_mart.fact_order (
  order_id text primary key,
  customer_id text not null,
  order_status text not null,
  purchased_at timestamp without time zone not null,
  purchase_date date not null,
  delivered_at timestamp without time zone,
  estimated_delivery_at timestamp without time zone,
  delivery_delay_days double precision
);

create table demo_adb_ecommerce_mart.fact_order_item (
  order_id text not null,
  order_item_id integer not null,
  product_id text not null,
  seller_id text not null,
  category_name_english text,
  shipping_limit_at timestamp without time zone,
  price_brl numeric(14,2) not null,
  freight_value_brl numeric(14,2) not null,
  primary key (order_id, order_item_id)
);

create table demo_adb_ecommerce_mart.fact_payment (
  order_id text not null,
  payment_sequence integer not null,
  payment_type text not null,
  installments integer not null,
  payment_value_brl numeric(14,2) not null,
  primary key (order_id, payment_sequence)
);

create table demo_adb_ecommerce_mart.fact_review (
  review_row_id bigint primary key,
  review_id text not null,
  order_id text not null,
  review_score smallint not null,
  comment_title text,
  comment_message text,
  created_at timestamp without time zone,
  answered_at timestamp without time zone
);

create table demo_adb_ecommerce_mart.fact_amazon_review (
  review_row_id bigint primary key,
  asin text,
  reviewer_id text,
  rating numeric(4,2),
  review_text text,
  summary text,
  reviewed_at date
);

create table demo_adb_ecommerce_mart.fact_delivery_state_month (
  seller_state text not null,
  customer_state text not null,
  purchase_month text not null,
  avg_delivery_delay_days double precision,
  avg_review_score double precision,
  total_orders bigint not null,
  avg_freight_value_brl numeric(14,4),
  avg_haversine_distance_km double precision,
  primary key (seller_state, customer_state, purchase_month)
);

create index adb_mart_order_customer_idx on demo_adb_ecommerce_mart.fact_order (customer_id);
create index adb_mart_item_product_idx on demo_adb_ecommerce_mart.fact_order_item (product_id);
create index adb_mart_item_seller_idx on demo_adb_ecommerce_mart.fact_order_item (seller_id);
create index adb_mart_review_order_idx on demo_adb_ecommerce_mart.fact_review (order_id);
create index adb_mart_amazon_review_asin_idx on demo_adb_ecommerce_mart.fact_amazon_review (asin);
-- ============================================================
-- 10636: Five governed views and immutable dataset receipts
-- ============================================================

create view demo_adb_ecommerce_mart.v_order_360 as
select
  orders.order_id,
  orders.purchased_at,
  orders.order_status,
  customers.customer_unique_id,
  customers.city as customer_city,
  customers.state as customer_state,
  orders.delivery_delay_days,
  items.item_count,
  items.gross_merchandise_value_brl,
  items.freight_value_brl,
  payments.payment_value_brl,
  reviews.avg_review_score
from demo_adb_ecommerce_mart.fact_order as orders
join demo_adb_ecommerce_mart.dim_customer as customers using (customer_id)
left join lateral (
  select count(*) as item_count, sum(price_brl) as gross_merchandise_value_brl,
    sum(freight_value_brl) as freight_value_brl
  from demo_adb_ecommerce_mart.fact_order_item as item
  where item.order_id = orders.order_id
) as items on true
left join lateral (
  select sum(payment_value_brl) as payment_value_brl
  from demo_adb_ecommerce_mart.fact_payment as payment
  where payment.order_id = orders.order_id
) as payments on true
left join lateral (
  select avg(review_score)::double precision as avg_review_score
  from demo_adb_ecommerce_mart.fact_review as review
  where review.order_id = orders.order_id
) as reviews on true;

create view demo_adb_ecommerce_mart.v_electronics_order_items as
select item.*, orders.purchase_date, orders.delivery_delay_days, review.avg_review_score,
  seller.state as seller_state, customer.state as customer_state
from demo_adb_ecommerce_mart.fact_order_item as item
join demo_adb_ecommerce_mart.fact_order as orders using (order_id)
join demo_adb_ecommerce_mart.dim_customer as customer using (customer_id)
join demo_adb_ecommerce_mart.dim_seller as seller using (seller_id)
left join lateral (
  select avg(review_score)::double precision as avg_review_score
  from demo_adb_ecommerce_mart.fact_review as source_review
  where source_review.order_id = item.order_id
) as review on true
where item.category_name_english in ('telephony', 'computers_accessories', 'electronics', 'consoles_games');

create view demo_adb_ecommerce_mart.v_state_pair_monthly as
select * from demo_adb_ecommerce_mart.fact_delivery_state_month;

create view demo_adb_ecommerce_mart.v_cross_platform_products as
select 'amazon'::text as platform, amazon.asin as product_key, amazon.brand,
  amazon.title as product_name, amazon.main_category as category, amazon.price_usd,
  null::numeric as ram_gb, null::numeric as ssd_gb, null::numeric as rating
from demo_adb_ecommerce_mart.dim_amazon_product as amazon
union all
select 'ebay'::text, ebay.listing_id::text, ebay.brand, ebay.model, ebay.listing_type,
  ebay.price_usd, ebay.ram_gb, ebay.ssd_gb, ebay.seller_rating
from demo_adb_ecommerce_mart.dim_ebay_listing as ebay;

create view demo_adb_ecommerce_mart.v_dataset_quality as
select 'raw'::text as layer, 'amazon_reviews'::text as relation_name, count(*)::bigint as row_count from demo_adb_ecommerce_raw.amazon_reviews
union all select 'raw','amazon_metadata',count(*) from demo_adb_ecommerce_raw.amazon_metadata
union all select 'raw','ebay_laptops',count(*) from demo_adb_ecommerce_raw.ebay_laptops
union all select 'raw','olist_customers',count(*) from demo_adb_ecommerce_raw.olist_customers
union all select 'raw','olist_geolocation',count(*) from demo_adb_ecommerce_raw.olist_geolocation
union all select 'raw','olist_order_items',count(*) from demo_adb_ecommerce_raw.olist_order_items
union all select 'raw','olist_order_payments',count(*) from demo_adb_ecommerce_raw.olist_order_payments
union all select 'raw','olist_order_reviews',count(*) from demo_adb_ecommerce_raw.olist_order_reviews
union all select 'raw','olist_orders',count(*) from demo_adb_ecommerce_raw.olist_orders
union all select 'raw','olist_products',count(*) from demo_adb_ecommerce_raw.olist_products
union all select 'raw','olist_sellers',count(*) from demo_adb_ecommerce_raw.olist_sellers
union all select 'raw','olist_category_translation',count(*) from demo_adb_ecommerce_raw.olist_category_translation
union all select 'mart','dim_date',count(*) from demo_adb_ecommerce_mart.dim_date
union all select 'mart','dim_customer',count(*) from demo_adb_ecommerce_mart.dim_customer
union all select 'mart','dim_seller',count(*) from demo_adb_ecommerce_mart.dim_seller
union all select 'mart','dim_category',count(*) from demo_adb_ecommerce_mart.dim_category
union all select 'mart','dim_product',count(*) from demo_adb_ecommerce_mart.dim_product
union all select 'mart','dim_geolocation_zip',count(*) from demo_adb_ecommerce_mart.dim_geolocation_zip
union all select 'mart','dim_amazon_product',count(*) from demo_adb_ecommerce_mart.dim_amazon_product
union all select 'mart','dim_ebay_listing',count(*) from demo_adb_ecommerce_mart.dim_ebay_listing
union all select 'mart','fact_order',count(*) from demo_adb_ecommerce_mart.fact_order
union all select 'mart','fact_order_item',count(*) from demo_adb_ecommerce_mart.fact_order_item
union all select 'mart','fact_payment',count(*) from demo_adb_ecommerce_mart.fact_payment
union all select 'mart','fact_review',count(*) from demo_adb_ecommerce_mart.fact_review
union all select 'mart','fact_amazon_review',count(*) from demo_adb_ecommerce_mart.fact_amazon_review
union all select 'mart','fact_delivery_state_month',count(*) from demo_adb_ecommerce_mart.fact_delivery_state_month;

create table app_data_agent.demo_dataset_versions (
  dataset_id text not null,
  bundle_digest text not null check (bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_manifest_digest text not null check (source_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  dataset_version text not null,
  status text not null check (status in ('READY')),
  raw_table_count integer not null check (raw_table_count = 12),
  mart_table_count integer not null check (mart_table_count = 14),
  view_count integer not null check (view_count = 5),
  row_counts jsonb not null check (jsonb_typeof(row_counts) = 'object'),
  installed_at timestamptz not null default clock_timestamp(),
  primary key (dataset_id, bundle_digest)
);

create table app_data_agent.demo_dataset_active_versions (
  dataset_id text primary key,
  bundle_digest text not null,
  activated_at timestamptz not null default clock_timestamp(),
  foreign key (dataset_id, bundle_digest)
    references app_data_agent.demo_dataset_versions (dataset_id, bundle_digest)
);

create function app_data_agent.guard_demo_fixture_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if session_user = 'postgres'
    and current_user = 'postgres'
    and pg_catalog.current_setting('data_agent.allow_demo_import', true) = 'true'
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception using errcode = '42501', message = 'ADB_ECOMMERCE_FIXTURE_IMMUTABLE';
end
$function$;

create function app_data_agent.reject_demo_dataset_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'ADB_ECOMMERCE_RECEIPT_IMMUTABLE';
end
$function$;

create trigger demo_dataset_versions_immutable
before update or delete on app_data_agent.demo_dataset_versions
for each row execute function app_data_agent.reject_demo_dataset_receipt_mutation();

do $fixture_triggers$
declare target record;
begin
  for target in
    select table_schema, table_name
    from information_schema.tables
    where table_schema in ('demo_adb_ecommerce_raw', 'demo_adb_ecommerce_mart')
      and table_type = 'BASE TABLE'
  loop
    execute pg_catalog.format(
      'create trigger %I before insert or update or delete on %I.%I for each row execute function app_data_agent.guard_demo_fixture_mutation()',
      'guard_' || target.table_name || '_rows', target.table_schema, target.table_name
    );
    execute pg_catalog.format(
      'create trigger %I before truncate on %I.%I for each statement execute function app_data_agent.guard_demo_fixture_mutation()',
      'guard_' || target.table_name || '_truncate', target.table_schema, target.table_name
    );
  end loop;
end
$fixture_triggers$;
-- ============================================================
-- 10636: Least privilege and executable closure checks
-- ============================================================

revoke all on all tables in schema demo_adb_ecommerce_raw, demo_adb_ecommerce_mart from public;
grant select on all tables in schema demo_adb_ecommerce_raw, demo_adb_ecommerce_mart to data_agent_ecommerce_readonly;
alter default privileges for role postgres in schema demo_adb_ecommerce_raw revoke all on tables from public;
alter default privileges for role postgres in schema demo_adb_ecommerce_mart revoke all on tables from public;
alter default privileges for role postgres in schema demo_adb_ecommerce_raw grant select on tables to data_agent_ecommerce_readonly;
alter default privileges for role postgres in schema demo_adb_ecommerce_mart grant select on tables to data_agent_ecommerce_readonly;

revoke all on app_data_agent.demo_dataset_versions, app_data_agent.demo_dataset_active_versions
from public, anon, authenticated, service_role, data_agent_backend, data_agent_ecommerce_readonly;
grant select on app_data_agent.demo_dataset_versions, app_data_agent.demo_dataset_active_versions
to data_agent_backend;
revoke all on function app_data_agent.guard_demo_fixture_mutation() from public;
revoke all on function app_data_agent.reject_demo_dataset_receipt_mutation() from public;

do $postconditions$
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
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_RELATION_CLOSURE_FAILED';
  end if;
  if pg_catalog.has_schema_privilege('data_agent_ecommerce_readonly', 'app_data_agent', 'USAGE') then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_CONTROL_SCHEMA_EXPOSED';
  end if;
  if not pg_catalog.has_table_privilege(
    'data_agent_ecommerce_readonly', 'demo_adb_ecommerce_mart.v_order_360', 'SELECT'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_READ_ROLE_INCOMPLETE';
  end if;
  if pg_catalog.has_table_privilege(
    'data_agent_ecommerce_readonly', 'demo_adb_ecommerce_raw.olist_orders', 'INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'ADB_ECOMMERCE_READ_ROLE_MUTABLE';
  end if;
end
$postconditions$;
-- ============================================================
-- 10636: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010636_app_data_agent_adb_ecommerce_demo',
  'sha256:3b8c5bccbb9e8a4c51243c4b0a51827a98171f57f551bf9d6b4a62b2fae92f19'
);

commit;
