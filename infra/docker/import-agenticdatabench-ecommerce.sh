#!/bin/sh
set -eu

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/data_agent}"
BUNDLE_DIR="${ADB_ECOMMERCE_BUNDLE_DIR:-/agenticdatabench/ecommerce-v1}"
BUNDLE_DIGEST="sha256:54632f39e190c872d2b5c176090ebc2d3b77e135b9bb5aecc96d6bf6d0fa4518"
SOURCE_MANIFEST_DIGEST="sha256:9a23ea0f9d768477d2f73e552f0d55163b71e8b6e7a89ff5c27ea5b7f9e1c483"

if [ ! -d "$BUNDLE_DIR/seed" ] || [ ! -f "$BUNDLE_DIR/import.sql" ]; then
  echo "ADB_ECOMMERCE_BUNDLE_MISSING" >&2
  exit 1
fi

active_digest="$(
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -c \
    "select bundle_digest from app_data_agent.demo_dataset_active_versions where dataset_id='agenticdatabench-ecommerce'"
)"
if [ "$active_digest" = "$BUNDLE_DIGEST" ]; then
  echo "AgenticDataBench E-commerce Demo already ready: $BUNDLE_DIGEST"
  exit 0
fi

verify_chunk() {
  expected_hash="$1"
  expected_bytes="$2"
  path="$3"
  if [ ! -f "$path" ]; then
    echo "ADB_ECOMMERCE_CHUNK_MISSING: $(basename "$path")" >&2
    exit 1
  fi
  actual_hash="$(sha256sum "$path" | awk '{print $1}')"
  actual_bytes="$(wc -c < "$path" | tr -d ' ')"
  if [ "$actual_hash" != "$expected_hash" ] || [ "$actual_bytes" != "$expected_bytes" ]; then
    echo "ADB_ECOMMERCE_CHUNK_MISMATCH: $(basename "$path")" >&2
    exit 1
  fi
}

verify_chunk dae04e5a7d5adb042c75aaed64735bd6e9238d135e66fa68ae576323b8e21073 5117265 "$BUNDLE_DIR/seed/amazon_metadata_10000.jsonl.gz"
verify_chunk 0394284897b9b8720befcbf269c9d264fbcff8061c0bc2600c58b0e1e77b4c28 2746612 "$BUNDLE_DIR/seed/amazon_reviews_10000.jsonl.gz"
verify_chunk 08ea5ada97bc164a2ab4dc7262eb501b963f409237da021254e976d19150e6d9 334245 "$BUNDLE_DIR/seed/ebay_laptops.csv.gz"
verify_chunk f62b1889e6e354fd31e5c27ca6a85521c31aff7a2ef1909b8e44015bb1260968 1090 "$BUNDLE_DIR/seed/olist_category_translation.csv.gz"
verify_chunk 5a30bd490756112c7d97c659c00daa476d823b6b5ca6e02f0b4b93df9c9ee038 4567194 "$BUNDLE_DIR/seed/olist_customers.csv.gz"
verify_chunk e66aa527bb444d4df5ff2b90c857317a03523a592d980a0cab708675b5f0e617 14770003 "$BUNDLE_DIR/seed/olist_geolocation.csv.gz"
verify_chunk 573fea40f1ca57c717f7ccf30a10f15d35f40d8b45972d91bacec40100c87332 6298284 "$BUNDLE_DIR/seed/olist_order_items.csv.gz"
verify_chunk 66d54cbe16d6fcbdcbd8b1e21186faf3f0393bbfdd862b46e2ae2aecf394c624 2430868 "$BUNDLE_DIR/seed/olist_order_payments.csv.gz"
verify_chunk 5953f1005484591082539ca29e03d3c09bce89a27fdb3c95bb0bdf84eaf08300 6422997 "$BUNDLE_DIR/seed/olist_order_reviews.csv.gz"
verify_chunk 210cbfe23e6fde9229ad8d87c29317187bd370e3e924d9cfef87cda2bcf3f578 6625717 "$BUNDLE_DIR/seed/olist_orders.csv.gz"
verify_chunk f9f4567547460d80a3b65b1ae8b8d3c67529fcaaf9357a8f62071c5b594531c0 1003992 "$BUNDLE_DIR/seed/olist_products.csv.gz"
verify_chunk e30b91a3a4208227f22ddb781e819d590feda29d0e984afe72b9e7ff4f3cf535 79881 "$BUNDLE_DIR/seed/olist_sellers.csv.gz"

work_dir="$(mktemp -d /tmp/adb-ecommerce-import.XXXXXX)"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
for compressed in "$BUNDLE_DIR"/seed/*.gz; do
  target="$work_dir/$(basename "$compressed" .gz)"
  gzip -dc "$compressed" > "$target"
done

sed \
  -e "s|__SEED_DIR__|$work_dir|g" \
  -e "s|__SOURCE_MANIFEST_DIGEST__|$SOURCE_MANIFEST_DIGEST|g" \
  "$BUNDLE_DIR/import.sql" > "$work_dir/import.sql"

psql -X "$DB_URL" -v ON_ERROR_STOP=1 -f "$work_dir/import.sql"

ready_digest="$(
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -c \
    "select bundle_digest from app_data_agent.demo_dataset_active_versions where dataset_id='agenticdatabench-ecommerce'"
)"
if [ "$ready_digest" != "$BUNDLE_DIGEST" ]; then
  echo "ADB_ECOMMERCE_ACTIVATION_FAILED" >&2
  exit 1
fi
echo "AgenticDataBench E-commerce Demo imported: $BUNDLE_DIGEST"
