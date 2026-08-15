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
