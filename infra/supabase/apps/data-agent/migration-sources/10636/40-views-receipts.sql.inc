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
