#!/bin/sh
# =============================================================================
# Database initialization script for Docker Compose
# Applies all platform and app migrations in order
# =============================================================================
set -e

MIGRATIONS_DIR="/migrations"
DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/data_agent}"

echo "=== Applying platform migrations ==="
for f in $(ls ${MIGRATIONS_DIR}/platform/migrations/*.sql 2>/dev/null | sort); do
  echo "Applying: $(basename $f)"
  psql "$DB_URL" -f "$f" -v ON_ERROR_STOP=1
  echo "  ✓ $(basename $f)"
done

echo "=== Applying app migrations ==="
for f in $(ls ${MIGRATIONS_DIR}/apps/data-agent/migrations/*.sql 2>/dev/null | sort); do
  echo "Applying: $(basename $f)"
  psql "$DB_URL" -f "$f" -v ON_ERROR_STOP=1
  echo "  ✓ $(basename $f)"
done

echo "=== Migration complete ==="
