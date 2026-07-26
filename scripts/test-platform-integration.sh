#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
support_dir="$repo_dir/infra/supabase/test-support"
infra_dir="$repo_dir/infra/supabase"
container_name="data-agent-platform-integration-$$"
database_name="data_agent_platform_integration"
database_password="data-agent-postgres-test"
backend_user="data_agent_test_backend"
backend_password="data-agent-backend-test"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    echo "PostgreSQL integration failure diagnostics:" >&2
    docker logs "$container_name" >&2 || true
    docker exec "$container_name" \
      psql -X -U postgres -d "$database_name" -c \
      "select tenant_id, environment, run_id, status, active_fence from app_data_agent.runs order by created_at; select tenant_id, environment, outbox_id, run_id, status, attempt_count, lease_owner, lease_expires_at from app_data_agent.outbox order by created_at;" \
      >&2 || true
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

docker run \
  --detach \
  --name "$container_name" \
  --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD="$database_password" \
  --env POSTGRES_DB="$database_name" \
  postgres:17-alpine >/dev/null

ready=0
attempt=0
while [ "$attempt" -lt 60 ]; do
  if docker exec "$container_name" \
    psql -X -U postgres -d "$database_name" -c 'select 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then
  echo "PostgreSQL integration container did not become ready." >&2
  exit 1
fi

apply_sql() {
  sql_file=$1
  echo "Applying ${sql_file#"$repo_dir"/}"
  docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" <"$sql_file"
}

apply_sql "$support_dir/00-bootstrap-stubs.sql"
for sql_file in $(find "$infra_dir/platform/migrations" -type f -name '*.sql' | sort); do
  apply_sql "$sql_file"
done
for sql_file in $(find "$infra_dir/apps/data-agent/migrations" -type f -name '*.sql' | sort); do
  apply_sql "$sql_file"
done
apply_sql "$support_dir/10-fixtures.sql"

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "create role $backend_user login inherit password '$backend_password'; grant data_agent_backend to $backend_user;" \
  >/dev/null

host_port=$(docker port "$container_name" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')
export DATA_AGENT_TEST_DATABASE_URL="postgresql://$backend_user:$backend_password@127.0.0.1:$host_port/$database_name"
export DATA_AGENT_TEST_ADMIN_DATABASE_URL="postgresql://postgres:$database_password@127.0.0.1:$host_port/$database_name"

pnpm --dir "$repo_dir" --filter @data-agent/platform test:integration
pnpm --dir "$repo_dir" --filter @data-agent/worker test:integration
