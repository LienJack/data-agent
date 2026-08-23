#!/bin/sh
set -eu

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/data_agent}"
BUNDLE_DIR="${FALCON_BUNDLE_DIR:-/falcon/v1}"
READER_PASSWORD="${FALCON_READER_PASSWORD:-data-agent-falcon-demo-change-me}"
REBUILD="${FALCON_REBUILD:-NO}"

if [ ! -f "$BUNDLE_DIR/source-manifest.json" ] \
  || [ ! -f "$BUNDLE_DIR/bundle-checksums.sha256" ] \
  || [ ! -d "$BUNDLE_DIR/bundles" ]; then
  echo "FALCON_BUNDLE_MISSING" >&2
  exit 1
fi

(cd "$BUNDLE_DIR" && sha256sum -c bundle-checksums.sha256)

SOURCE_DIGEST="$(
  sed -n 's/^[[:space:]]*"source_digest": "\(sha256:[0-9a-f]\{64\}\)",*$/\1/p' \
    "$BUNDLE_DIR/source-manifest.json"
)"
if ! printf '%s\n' "$SOURCE_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
  echo "FALCON_SOURCE_DIGEST_INVALID" >&2
  exit 1
fi

active_status="$(
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -c \
    "select status from app_data_agent.falcon_import_receipts where source_digest = '$SOURCE_DIGEST'"
)"

if [ "$REBUILD" = "YES" ]; then
  if [ "${FALCON_REBUILD_CONFIRM:-}" != "$SOURCE_DIGEST" ]; then
    echo "FALCON_REBUILD_CONFIRMATION_REQUIRED" >&2
    exit 1
  fi
  psql -X "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $rebuild$
declare
  db_id integer;
begin
  for db_id in 1..28 loop
    execute pg_catalog.format('drop schema if exists %I cascade', pg_catalog.format('falcon_db_%s', pg_catalog.lpad(db_id::text, 2, '0')));
  end loop;
end
$rebuild$;
SQL
elif [ "$REBUILD" != "NO" ]; then
  echo "FALCON_REBUILD_FLAG_INVALID" >&2
  exit 1
elif [ "$active_status" = "READY" ]; then
  schema_count="$(
    psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -c \
      "select count(*) from pg_catalog.pg_namespace where nspname ~ '^falcon_db_(0[1-9]|1[0-9]|2[0-8])$'"
  )"
  if [ "$schema_count" != "28" ]; then
    echo "FALCON_READY_RECEIPT_SCHEMA_DRIFT" >&2
    exit 1
  fi
  echo "Falcon fixed snapshot already ready: $SOURCE_DIGEST"
  exit 0
fi

psql -X "$DB_URL" -v ON_ERROR_STOP=1 -v reader_password="$READER_PASSWORD" <<'SQL'
begin;
set local data_agent.allow_falcon_bootstrap = 'true';
select app_data_agent.configure_falcon_demo_reader(:'reader_password');
commit;
SQL

DATABASE_SIZE_BEFORE="$(
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -c \
    "select pg_catalog.pg_database_size(pg_catalog.current_database())"
)"

for bundle in "$BUNDLE_DIR"/bundles/falcon_db_??.sql.gz; do
  if [ ! -f "$bundle" ]; then
    echo "FALCON_DATABASE_BUNDLE_MISSING" >&2
    exit 1
  fi
  echo "Importing $(basename "$bundle" .sql.gz)"
  gzip -dc "$bundle" | psql -X "$DB_URL" -v ON_ERROR_STOP=1
done

psql -X "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $permissions$
declare
  db_id integer;
  schema_name text;
begin
  for db_id in 1..28 loop
    schema_name := pg_catalog.format('falcon_db_%s', pg_catalog.lpad(db_id::text, 2, '0'));
    execute pg_catalog.format('revoke all on schema %I from public', schema_name);
    execute pg_catalog.format('revoke all on all tables in schema %I from public', schema_name);
    execute pg_catalog.format('grant usage on schema %I to falcon_demo_reader', schema_name);
    execute pg_catalog.format('grant select on all tables in schema %I to falcon_demo_reader', schema_name);
  end loop;
end
$permissions$;
SQL

DATABASE_SIZE_AFTER="$(
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -c \
    "select pg_catalog.pg_database_size(pg_catalog.current_database())"
)"
MANIFEST_JSON="$(tr -d '\n' < "$BUNDLE_DIR/source-manifest.json")"

psql -X -q -A -t "$DB_URL" \
  -v ON_ERROR_STOP=1 \
  -v manifest_json="$MANIFEST_JSON" \
  -v database_size_before="$DATABASE_SIZE_BEFORE" \
  -v database_size_after="$DATABASE_SIZE_AFTER" <<'SQL'
begin;
set local data_agent.allow_falcon_bootstrap = 'true';
with manifest as (
  select :'manifest_json'::jsonb as value
), database_receipts as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'receipt_version', 'falcon-database-import@1.0.0',
      'db_id', (bundle.value ->> 'db_id')::integer,
      'schema_name', bundle.value ->> 'schema_name',
      'source_sqlite_sha256', bundle.value ->> 'source_sqlite_sha256',
      'bundle_sha256', bundle.value ->> 'bundle_sha256',
      'table_count', (bundle.value ->> 'table_count')::integer,
      'column_count', (bundle.value ->> 'column_count')::integer,
      'row_count', (bundle.value ->> 'row_count')::bigint,
      'null_count', (bundle.value ->> 'null_count')::bigint,
      'content_digest', bundle.value ->> 'content_digest',
      'postgres_size_bytes', (
        select coalesce(pg_catalog.sum(pg_catalog.pg_total_relation_size(class.oid)), 0)::bigint
        from pg_catalog.pg_class as class
        join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
        where namespace.nspname = bundle.value ->> 'schema_name'
          and class.relkind in ('r', 'm')
      ),
      'status', 'READY'
    ) order by (bundle.value ->> 'db_id')::integer
  ) as value
  from manifest,
    pg_catalog.jsonb_array_elements(manifest.value -> 'files') as bundle(value)
), receipt_draft as (
  select pg_catalog.jsonb_build_object(
    'receipt_version', 'falcon-import@1.0.0',
    'suite_version', manifest.value ->> 'suite_version',
    'dataset_version', manifest.value ->> 'dataset_version',
    'source_commit', manifest.value ->> 'source_commit',
    'source_digest', manifest.value ->> 'source_digest',
    'target_database', 'data_agent',
    'reader_role', 'falcon_demo_reader',
    'database_count', 28,
    'case_count', 500,
    'dev_case_count', 309,
    'test_case_count', 191,
    'databases', database_receipts.value,
    'database_size_before_bytes', :'database_size_before'::bigint,
    'database_size_after_bytes', :'database_size_after'::bigint,
    'imported_at', pg_catalog.clock_timestamp(),
    'imported_by', 'migration-runner',
    'status', 'READY'
  ) as value
  from manifest, database_receipts
)
select app_data_agent.record_falcon_import_receipt(receipt_draft.value) ->> 'receipt_hash'
from receipt_draft;
commit;
SQL

ready_status="$(
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -c \
    "select status from app_data_agent.falcon_import_receipts where source_digest = '$SOURCE_DIGEST'"
)"
if [ "$ready_status" != "READY" ]; then
  echo "FALCON_IMPORT_ACTIVATION_FAILED" >&2
  exit 1
fi
echo "Falcon fixed snapshot imported: $SOURCE_DIGEST"
