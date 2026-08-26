#!/bin/sh
# =============================================================================
# Database initialization script for Docker Compose
# Applies only missing platform and app migrations in order, using the ledger.
# =============================================================================
set -eu

MIGRATIONS_DIR="/migrations"
DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/data_agent}"

bootstrap_local_postgres_compatibility() {
  compatibility_ready="$(
    psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 \
      -c "select pg_catalog.to_regprocedure('auth.uid()') is not null
                 and pg_catalog.to_regclass('storage.objects') is not null
                 and exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
                 and exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
                 and exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')"
  )"
  if [ "$compatibility_ready" != "t" ]; then
    echo "Bootstrapping local PostgreSQL Supabase compatibility objects"
    psql -X "$DB_URL" -f "$MIGRATIONS_DIR/test-support/00-bootstrap-stubs.sql" \
      -v ON_ERROR_STOP=1
  fi
}

ledger_exists() {
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 \
    -c "select pg_catalog.to_regclass('platform.migration_ledger') is not null"
}

ledger_checksum() {
  owner_kind="$1"
  app_id="$2"
  migration_version="$3"

  case "$owner_kind" in
    platform)
      app_predicate="app_id is null"
      ;;
    app)
      if ! printf '%s\n' "$app_id" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
        echo "Invalid app id for migration ledger query." >&2
        exit 1
      fi
      app_predicate="app_id = '$app_id'::uuid"
      ;;
    *)
      echo "Invalid migration owner kind: $owner_kind" >&2
      exit 1
      ;;
  esac

  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 \
    -c "select migration_checksum
        from platform.migration_ledger
        where owner_kind = '$owner_kind'
          and migration_version = '$migration_version'
          and $app_predicate"
}

declared_checksum() {
  awk '
    /^[[:space:]]*select platform\.assert_migration_checksum\(/ { capture = 1; next }
    capture && match($0, /sha256:[0-9a-f]+/) {
      value = substr($0, RSTART, RLENGTH)
      capture = 0
    }
    END { print value }
  ' "$1"
}

apply_migration() {
  owner_kind="$1"
  app_id="$2"
  migration_file="$3"
  migration_version="$(basename "$migration_file" .sql)"
  checksum="$(declared_checksum "$migration_file")"

  if ! printf '%s\n' "$migration_version" | grep -Eq '^[0-9]{14}_[a-z][a-z0-9_]{1,96}$'; then
    echo "Invalid migration filename: $migration_file" >&2
    exit 1
  fi
  if [ "${#checksum}" -ne 71 ] || ! printf '%s\n' "$checksum" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
    echo "Missing or invalid migration checksum: $migration_file" >&2
    exit 1
  fi

  if [ "$(ledger_exists)" = "t" ]; then
    existing_checksum="$(ledger_checksum "$owner_kind" "$app_id" "$migration_version")"
  else
    existing_checksum=""
  fi

  if [ -n "$existing_checksum" ]; then
    if [ "$existing_checksum" != "$checksum" ]; then
      echo "Migration checksum mismatch: $migration_version" >&2
      echo "ledger=$existing_checksum migration=$checksum" >&2
      exit 1
    fi
    echo "Skipping already applied migration: $migration_version"
    return
  fi

  maintenance_prelude=""
  case "$migration_version" in
    20260725010590_app_data_agent_u6_research_authority)
      maintenance_prelude="$MIGRATIONS_DIR/apps/data-agent/migration-support/10590-local-maintenance-prelude.sql"
      ;;
    20260725010600_app_data_agent_u6_research_derivation)
      maintenance_prelude="$MIGRATIONS_DIR/apps/data-agent/migration-support/10600-local-maintenance-prelude.sql"
      ;;
    20260725010610_app_data_agent_semantic_control_plane)
      maintenance_prelude="$MIGRATIONS_DIR/apps/data-agent/migration-support/10610-local-maintenance-prelude.sql"
      ;;
  esac

  echo "Applying: $migration_version"
  if [ -n "$maintenance_prelude" ]; then
    psql -X "$DB_URL" -f "$maintenance_prelude" -f "$migration_file" -v ON_ERROR_STOP=1
  else
    psql -X "$DB_URL" -f "$migration_file" -v ON_ERROR_STOP=1
  fi
  applied_checksum="$(ledger_checksum "$owner_kind" "$app_id" "$migration_version")"
  if [ "$applied_checksum" != "$checksum" ]; then
    echo "Migration ledger verification failed: $migration_version" >&2
    exit 1
  fi
  echo "  ✓ $migration_version"
}

bootstrap_local_postgres_compatibility

echo "=== Applying platform migrations ==="
for migration_file in "$MIGRATIONS_DIR"/platform/migrations/*.sql; do
  [ -f "$migration_file" ] || continue
  apply_migration "platform" "" "$migration_file"
done

echo "=== Applying app migrations ==="
for migration_file in "$MIGRATIONS_DIR"/apps/data-agent/migrations/*.sql; do
  [ -f "$migration_file" ] || continue
  apply_migration "app" "00000000-0000-4000-8000-00000000da01" "$migration_file"
done

echo "=== Migration complete ==="

IMPORT_MODE="${DATA_AGENT_IMPORT_MODE:-FULL}"
case "$IMPORT_MODE" in
  FULL)
    echo "=== Importing bundled AgenticDataBench E-commerce Demo ==="
    sh /import-agenticdatabench-ecommerce.sh
    echo "=== AgenticDataBench E-commerce Demo ready ==="
    echo "=== Importing bundled Falcon fixed snapshot ==="
    sh /import-falcon.sh
    echo "=== Falcon fixed snapshot ready ==="
    ;;
  FALCON24_E1)
    echo "=== Importing Falcon24 E1 db24-only snapshot ==="
    sh /import-falcon24-e1.sh
    echo "=== Falcon24 E1 db24-only snapshot staged ==="
    ;;
  NONE)
    echo "=== Dataset import disabled by explicit mode ==="
    ;;
  *)
    echo "DATA_AGENT_IMPORT_MODE_INVALID" >&2
    exit 1
    ;;
esac
