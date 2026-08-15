\set ON_ERROR_STOP on

begin;
set local data_agent.allow_demo_import = 'true';
set local statement_timeout = '900000ms';
set local lock_timeout = '5000ms';

truncate table
  demo_adb_ecommerce_mart.fact_delivery_state_month,
  demo_adb_ecommerce_mart.fact_amazon_review,
  demo_adb_ecommerce_mart.fact_review,
  demo_adb_ecommerce_mart.fact_payment,
  demo_adb_ecommerce_mart.fact_order_item,
  demo_adb_ecommerce_mart.fact_order,
  demo_adb_ecommerce_mart.dim_ebay_listing,
  demo_adb_ecommerce_mart.dim_amazon_product,
  demo_adb_ecommerce_mart.dim_geolocation_zip,
  demo_adb_ecommerce_mart.dim_product,
  demo_adb_ecommerce_mart.dim_category,
  demo_adb_ecommerce_mart.dim_seller,
  demo_adb_ecommerce_mart.dim_customer,
  demo_adb_ecommerce_mart.dim_date,
  demo_adb_ecommerce_raw.amazon_reviews,
  demo_adb_ecommerce_raw.amazon_metadata,
  demo_adb_ecommerce_raw.ebay_laptops,
  demo_adb_ecommerce_raw.olist_customers,
  demo_adb_ecommerce_raw.olist_geolocation,
  demo_adb_ecommerce_raw.olist_order_items,
  demo_adb_ecommerce_raw.olist_order_payments,
  demo_adb_ecommerce_raw.olist_order_reviews,
  demo_adb_ecommerce_raw.olist_orders,
  demo_adb_ecommerce_raw.olist_products,
  demo_adb_ecommerce_raw.olist_sellers,
  demo_adb_ecommerce_raw.olist_category_translation
restart identity;

create temporary table adb_amazon_reviews_jsonl (payload text not null) on commit drop;
create temporary table adb_amazon_metadata_jsonl (payload text not null) on commit drop;
\copy adb_amazon_reviews_jsonl (payload) from '__SEED_DIR__/amazon_reviews_10000.jsonl' with (format csv, delimiter E'\x01', quote E'\x02', escape E'\x03')
\copy adb_amazon_metadata_jsonl (payload) from '__SEED_DIR__/amazon_metadata_10000.jsonl' with (format csv, delimiter E'\x01', quote E'\x02', escape E'\x03')

insert into demo_adb_ecommerce_raw.amazon_reviews (
  reviewer_id, asin, reviewer_name, helpful, review_text, overall, summary,
  unix_review_time, review_time, raw_payload
)
select
  value->>'reviewerID', value->>'asin', value->>'reviewerName',
  coalesce(value->'helpful', '[]'::jsonb), value->>'reviewText',
  nullif(value->>'overall', '')::numeric, value->>'summary',
  nullif(value->>'unixReviewTime', '')::bigint, value->>'reviewTime', value
from (select replace(payload, E'\\u0000', '')::jsonb as value from adb_amazon_reviews_jsonl) as source;

insert into demo_adb_ecommerce_raw.amazon_metadata (
  category, tech1, description, fit, title, also_buy, tech2, brand, feature,
  rank_text, also_view, details, main_category, similar_item, product_date,
  price_text, asin, image_url, image_url_high_res, raw_payload
)
select
  coalesce(value->'category', '[]'::jsonb), value->>'tech1',
  coalesce(value->'description', '[]'::jsonb), value->>'fit', value->>'title',
  coalesce(value->'also_buy', '[]'::jsonb), value->>'tech2', value->>'brand',
  coalesce(value->'feature', '[]'::jsonb), value->>'rank',
  coalesce(value->'also_view', '[]'::jsonb), coalesce(value->'details', '{}'::jsonb),
  value->>'main_cat', value->>'similar_item', value->>'date', value->>'price',
  value->>'asin', coalesce(value->'imageURL', '[]'::jsonb),
  coalesce(value->'imageURLHighRes', '[]'::jsonb), value
from (select replace(payload, E'\\u0000', '')::jsonb as value from adb_amazon_metadata_jsonl) as source;

\copy demo_adb_ecommerce_raw.ebay_laptops (brand,price,rating,ratings_count,condition,seller_note,processor,screen_size,manufacturer_color,color,ram_size,ssd_capacity,gpu,processor_speed,listing_type,release_year,maximum_resolution,model,os,features,hard_drive_capacity,country_region_of_manufacture,storage_type) from '__SEED_DIR__/ebay_laptops.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_customers from '__SEED_DIR__/olist_customers.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_geolocation (geolocation_zip_code_prefix,geolocation_lat,geolocation_lng,geolocation_city,geolocation_state) from '__SEED_DIR__/olist_geolocation.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_order_items from '__SEED_DIR__/olist_order_items.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_order_payments from '__SEED_DIR__/olist_order_payments.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_order_reviews (review_id,order_id,review_score,review_comment_title,review_comment_message,review_creation_date,review_answer_timestamp) from '__SEED_DIR__/olist_order_reviews.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_orders from '__SEED_DIR__/olist_orders.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_products from '__SEED_DIR__/olist_products.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_sellers from '__SEED_DIR__/olist_sellers.csv' with (format csv, header true)
\copy demo_adb_ecommerce_raw.olist_category_translation from '__SEED_DIR__/olist_category_translation.csv' with (format csv, header true)

insert into demo_adb_ecommerce_mart.dim_date
select day::date, extract(year from day)::integer, extract(quarter from day)::integer,
  extract(month from day)::integer, to_char(day, 'YYYY-MM'), extract(day from day)::integer,
  extract(isodow from day)::integer, extract(isodow from day)::integer in (6, 7)
from generate_series(
  (select min(order_purchase_timestamp)::date from demo_adb_ecommerce_raw.olist_orders),
  (select max(coalesce(order_delivered_customer_date, order_estimated_delivery_date, order_purchase_timestamp))::date
   from demo_adb_ecommerce_raw.olist_orders),
  interval '1 day'
) as day;

insert into demo_adb_ecommerce_mart.dim_customer
select customer_id, customer_unique_id, customer_zip_code_prefix, customer_city, customer_state
from demo_adb_ecommerce_raw.olist_customers;

insert into demo_adb_ecommerce_mart.dim_seller
select seller_id, seller_zip_code_prefix, seller_city, seller_state
from demo_adb_ecommerce_raw.olist_sellers;

insert into demo_adb_ecommerce_mart.dim_category
select product.product_category_name, translation.product_category_name_english,
  coalesce(
    translation.product_category_name_english in ('telephony','computers_accessories','electronics','consoles_games'),
    false
  )
from (select distinct product_category_name from demo_adb_ecommerce_raw.olist_products where product_category_name is not null) as product
left join demo_adb_ecommerce_raw.olist_category_translation as translation using (product_category_name);

insert into demo_adb_ecommerce_mart.dim_product
select product.product_id, product.product_category_name, translation.product_category_name_english,
  product.product_photos_qty, product.product_weight_g, product.product_length_cm,
  product.product_height_cm, product.product_width_cm
from demo_adb_ecommerce_raw.olist_products as product
left join demo_adb_ecommerce_raw.olist_category_translation as translation using (product_category_name);

insert into demo_adb_ecommerce_mart.dim_geolocation_zip
select geolocation_zip_code_prefix, geolocation_state, avg(geolocation_lat), avg(geolocation_lng),
  count(distinct geolocation_city)::integer, count(*)
from demo_adb_ecommerce_raw.olist_geolocation
group by geolocation_zip_code_prefix, geolocation_state;

insert into demo_adb_ecommerce_mart.dim_amazon_product
select distinct on (asin) asin, title, nullif(btrim(brand), ''), main_category,
  substring(price_text from '[0-9]+[.]?[0-9]*')::numeric(14,2), category, feature
from demo_adb_ecommerce_raw.amazon_metadata
where asin is not null
order by asin, source_row_number;

insert into demo_adb_ecommerce_mart.dim_ebay_listing
select source_row_number, nullif(btrim(brand), ''),
  substring(price from '[0-9]+[.]?[0-9]*')::numeric(14,2),
  substring(rating from '[0-9]+[.]?[0-9]*')::numeric(8,3),
  substring(replace(ratings_count, ',', '') from '[0-9]+')::integer,
  processor, substring(ram_size from '[0-9]+[.]?[0-9]*')::numeric(10,2),
  case
    when lower(ssd_capacity) like '%tb%' then substring(ssd_capacity from '[0-9]+[.]?[0-9]*')::numeric * 1024
    else substring(ssd_capacity from '[0-9]+[.]?[0-9]*')::numeric
  end,
  gpu, listing_type, model, os
from demo_adb_ecommerce_raw.ebay_laptops;

insert into demo_adb_ecommerce_mart.fact_order
select order_id, customer_id, order_status, order_purchase_timestamp,
  order_purchase_timestamp::date, order_delivered_customer_date, order_estimated_delivery_date,
  extract(epoch from (order_delivered_customer_date - order_estimated_delivery_date)) / 86400.0
from demo_adb_ecommerce_raw.olist_orders;

insert into demo_adb_ecommerce_mart.fact_order_item
select item.order_id, item.order_item_id, item.product_id, item.seller_id,
  translation.product_category_name_english, item.shipping_limit_date, item.price, item.freight_value
from demo_adb_ecommerce_raw.olist_order_items as item
left join demo_adb_ecommerce_raw.olist_products as product using (product_id)
left join demo_adb_ecommerce_raw.olist_category_translation as translation using (product_category_name);

insert into demo_adb_ecommerce_mart.fact_payment
select order_id, payment_sequential, payment_type, payment_installments, payment_value
from demo_adb_ecommerce_raw.olist_order_payments;

insert into demo_adb_ecommerce_mart.fact_review
select source_row_number, review_id, order_id, review_score, review_comment_title,
  review_comment_message, review_creation_date, review_answer_timestamp
from demo_adb_ecommerce_raw.olist_order_reviews;

insert into demo_adb_ecommerce_mart.fact_amazon_review
select source_row_number, asin, reviewer_id, overall, review_text, summary,
  to_timestamp(unix_review_time)::date
from demo_adb_ecommerce_raw.amazon_reviews;

insert into demo_adb_ecommerce_mart.fact_delivery_state_month
with review_by_order as (
  select order_id, avg(review_score)::double precision as avg_review_score
  from demo_adb_ecommerce_mart.fact_review group by order_id
), electronics as (
  select item.order_id, item.seller_id, orders.customer_id, orders.purchased_at,
    orders.delivery_delay_days, item.freight_value_brl, review.avg_review_score
  from demo_adb_ecommerce_mart.fact_order_item as item
  join demo_adb_ecommerce_mart.fact_order as orders using (order_id)
  left join review_by_order as review using (order_id)
  where item.category_name_english in ('telephony','computers_accessories','electronics','consoles_games')
), located as (
  select electronics.*, seller.state as seller_state, customer.state as customer_state,
    seller_geo.latitude as seller_latitude, seller_geo.longitude as seller_longitude,
    customer_geo.latitude as customer_latitude, customer_geo.longitude as customer_longitude
  from electronics
  join demo_adb_ecommerce_mart.dim_seller as seller using (seller_id)
  join demo_adb_ecommerce_mart.dim_customer as customer using (customer_id)
  join demo_adb_ecommerce_mart.dim_geolocation_zip as seller_geo
    on seller_geo.zip_code_prefix = seller.zip_code_prefix and seller_geo.state = seller.state
  join demo_adb_ecommerce_mart.dim_geolocation_zip as customer_geo
    on customer_geo.zip_code_prefix = customer.zip_code_prefix and customer_geo.state = customer.state
), measured as (
  select *, 6371.0 * 2.0 * asin(sqrt(
    power(sin(radians(customer_latitude - seller_latitude) / 2.0), 2) +
    cos(radians(seller_latitude)) * cos(radians(customer_latitude)) *
    power(sin(radians(customer_longitude - seller_longitude) / 2.0), 2)
  )) as distance_km
  from located
)
select seller_state, customer_state, to_char(purchased_at, 'YYYY-MM'),
  avg(delivery_delay_days), avg(avg_review_score), count(distinct order_id),
  avg(freight_value_brl), avg(distance_km)
from measured
group by seller_state, customer_state, to_char(purchased_at, 'YYYY-MM');

insert into app_data_agent.demo_dataset_versions (
  dataset_id, bundle_digest, source_manifest_digest, dataset_version, status,
  raw_table_count, mart_table_count, view_count, row_counts
)
select
  'agenticdatabench-ecommerce',
  'sha256:54632f39e190c872d2b5c176090ebc2d3b77e135b9bb5aecc96d6bf6d0fa4518',
  '__SOURCE_MANIFEST_DIGEST__',
  'v1', 'READY', 12, 14, 5,
  jsonb_object_agg(layer || '.' || relation_name, row_count order by layer, relation_name)
from demo_adb_ecommerce_mart.v_dataset_quality;

insert into app_data_agent.demo_dataset_active_versions (dataset_id, bundle_digest)
values ('agenticdatabench-ecommerce', 'sha256:54632f39e190c872d2b5c176090ebc2d3b77e135b9bb5aecc96d6bf6d0fa4518')
on conflict (dataset_id) do update set bundle_digest = excluded.bundle_digest, activated_at = clock_timestamp();

analyze demo_adb_ecommerce_raw.amazon_reviews;
analyze demo_adb_ecommerce_raw.amazon_metadata;
analyze demo_adb_ecommerce_raw.ebay_laptops;
analyze demo_adb_ecommerce_raw.olist_geolocation;
analyze demo_adb_ecommerce_mart.fact_order;
analyze demo_adb_ecommerce_mart.fact_order_item;
analyze demo_adb_ecommerce_mart.fact_delivery_state_month;

commit;
