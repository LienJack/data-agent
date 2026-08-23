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
