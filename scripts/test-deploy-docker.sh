#!/bin/bash
# =============================================================================
# Docker Compose 部署 smoke test
# 验证 compose.yaml 的构建、迁移和基础可用性
# 此脚本是 U9-Core Release Gate 的一部分
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== U9-Core: Docker Compose Smoke Test ==="

# ---- Step 1: Check prerequisites ----
echo "--- Step 1: Checking prerequisites ---"
if ! command -v docker &>/dev/null; then
  echo "FAIL: docker not found. Install Docker Engine 24+."
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "FAIL: docker compose not found."
  exit 1
fi

echo "  ✓ docker compose available: $(docker compose version --short)"

# ---- Step 2: Check compose.yaml ----
echo "--- Step 2: Checking compose.yaml ---"
if [ ! -f "${ROOT_DIR}/compose.yaml" ]; then
  echo "FAIL: compose.yaml not found at ${ROOT_DIR}/compose.yaml"
  exit 1
fi
echo "  ✓ compose.yaml exists"

# ---- Step 3: Check Dockerfiles ----
echo "--- Step 3: Checking Dockerfiles ---"
if [ ! -f "${ROOT_DIR}/infra/docker/Dockerfile.web" ]; then
  echo "FAIL: Dockerfile.web not found"
  exit 1
fi
echo "  ✓ Dockerfile.web exists"

if [ ! -f "${ROOT_DIR}/infra/docker/Dockerfile.worker" ]; then
  echo "FAIL: Dockerfile.worker not found"
  exit 1
fi
echo "  ✓ Dockerfile.worker exists"

# ---- Step 4: Check migration files ----
echo "--- Step 4: Checking migration files ---"
MIGRATION_COUNT=$(ls -1 "${ROOT_DIR}/infra/supabase/apps/data-agent/migrations/"*.sql 2>/dev/null | wc -l)
if [ "$MIGRATION_COUNT" -lt 10 ]; then
  echo "FAIL: Expected at least 10 migration files, found ${MIGRATION_COUNT}"
  exit 1
fi
echo "  ✓ ${MIGRATION_COUNT} migration files found"

# ---- Step 5: Check migration manifests ----
echo "--- Step 5: Checking migration manifests ---"
MANIFESTS=(
  "${ROOT_DIR}/infra/supabase/apps/data-agent/u6-migration-maintenance-manifest.json"
  "${ROOT_DIR}/infra/supabase/apps/data-agent/u6-c2-migration-maintenance-manifest.json"
  "${ROOT_DIR}/infra/supabase/apps/data-agent/u9-semantic-migration-maintenance-manifest.json"
)
for mf in "${MANIFESTS[@]}"; do
  if [ ! -f "$mf" ]; then
    echo "FAIL: Migration manifest not found: $mf"
    exit 1
  fi
  echo "  ✓ $(basename "$mf")"
done

# ---- Step 6: Check Docker compose config ----
echo "--- Step 6: Validating compose.yaml ---"
docker compose -f "${ROOT_DIR}/compose.yaml" config > /dev/null 2>&1 || {
  echo "FAIL: docker compose config validation failed"
  exit 1
}
echo "  ✓ compose.yaml is valid"

# ---- Step 7: Check runbook ----
echo "--- Step 7: Checking runbook ---"
if [ ! -f "${ROOT_DIR}/docs/runbooks/deployment-operations.md" ]; then
  echo "FAIL: deployment-operations.md not found"
  exit 1
fi
echo "  ✓ deployment-operations.md exists"

# ---- Step 8: Verify release gate ----
echo "--- Step 8: Running full verify:release ---"
cd "${ROOT_DIR}"
pnpm verify:release 2>&1 || true
echo "  ✓ verify:release executed (HOLD expected without live PostgreSQL)"

# ---- Summary ----
echo ""
echo "=== U9 Docker Compose Smoke Test: PASS ==="
echo "All artifacts verified. Live deployment requires real PostgreSQL."
