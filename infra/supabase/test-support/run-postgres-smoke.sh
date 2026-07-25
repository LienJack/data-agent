#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
infra_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
container_name="data-agent-supabase-smoke-$$"
database_name="data_agent_test"
database_password="data-agent-test-only"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

"$script_dir/static-check.sh"

docker run \
  --detach \
  --name "$container_name" \
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
  echo "PostgreSQL smoke container did not become ready." >&2
  exit 1
fi

apply_sql() {
  sql_file=$1
  echo "Applying ${sql_file#"$infra_dir"/}"
  docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" <"$sql_file"
}

apply_sql "$script_dir/00-bootstrap-stubs.sql"
for sql_file in $(find "$infra_dir/platform/migrations" -type f -name '*.sql' | sort); do
  apply_sql "$sql_file"
done
for sql_file in $(find "$infra_dir/apps/data-agent/migrations" -type f -name '*.sql' | sort); do
  apply_sql "$sql_file"
done
apply_sql "$script_dir/10-fixtures.sql"

lifecycle_app="00000000-0000-4000-8000-00000000da01"
lifecycle_tenant="00000000-0000-4000-8000-00000000aa11"
lifecycle_deployment="00000000-0000-4000-8000-00000000de02"
lifecycle_principal="00000000-0000-4000-8000-000000001005"
lifecycle_receipt="00000000-0000-4000-8000-00000000f00a"

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "begin; set local role data_agent_backend; select * from platform.revalidate_backend_authority('$lifecycle_app'::uuid, '$lifecycle_tenant'::uuid, 'prod', '$lifecycle_deployment'::uuid, '$lifecycle_principal'::uuid, 'owner', 1, 1, true); select pg_catalog.pg_sleep(3); commit;" \
  >/dev/null &
authority_holder_pid=$!
sleep 0.5

lifecycle_transition_blocked=0
if docker exec --env PGOPTIONS="-c statement_timeout=750" "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "select platform.transition_app_lifecycle('$lifecycle_app'::uuid, 'prod', 'ACTIVE', 'FROZEN', 'FREEZE', '$lifecycle_receipt'::uuid, platform.compute_lifecycle_receipt_hash('$lifecycle_receipt'::uuid, '$lifecycle_app'::uuid, 'prod', 'ACTIVE', 'FROZEN', 'FREEZE', '{\"reason\":\"write-authority-lock\"}'::jsonb), '{\"reason\":\"write-authority-lock\"}'::jsonb);" \
  >/dev/null 2>&1; then
  lifecycle_transition_blocked=0
else
  lifecycle_transition_blocked=1
fi
wait "$authority_holder_pid"
if [ "$lifecycle_transition_blocked" -ne 1 ]; then
  echo "Lifecycle transition was not blocked by an active write authority." >&2
  exit 1
fi

lifecycle_state=$(
  docker exec "$container_name" \
    psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "select lifecycle_state || ':' || authority_epoch from platform.app_environment_lifecycle where app_id = '$lifecycle_app'::uuid and environment = 'prod';"
)
if [ "$lifecycle_state" != "ACTIVE:1" ]; then
  echo "Timed-out lifecycle transition changed prod authority: $lifecycle_state" >&2
  exit 1
fi

apply_sql "$script_dir/20-assertions.sql"

app_a="00000000-0000-4000-8000-00000000da01"
app_b="00000000-0000-4000-8000-00000000bb01"

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "begin; select platform.acquire_migration_lock('app', '$app_a'::uuid); select pg_catalog.pg_sleep(3); commit;" \
  >/dev/null &
lock_holder_pid=$!
sleep 0.5

same_app_blocked=0
if docker exec --env PGOPTIONS="-c statement_timeout=750" "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "select platform.acquire_migration_lock('app', '$app_a'::uuid);" >/dev/null 2>&1; then
  same_app_blocked=0
else
  same_app_blocked=1
fi
if [ "$same_app_blocked" -ne 1 ]; then
  echo "The same app migration lock did not block a concurrent session." >&2
  exit 1
fi

docker exec --env PGOPTIONS="-c statement_timeout=750" "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "select platform.acquire_migration_lock('app', '$app_b'::uuid);" >/dev/null
wait "$lock_holder_pid"

echo "Supabase/PostgreSQL smoke assertions passed."
