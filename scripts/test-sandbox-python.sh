#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sandbox_dir="$repo_dir/services/sandbox"
container_name="data-agent-python-sandbox-$$"
database_name="data_agent_sandbox_test"
database_password="data-agent-sandbox-test"
reader_password="data-agent-sandbox-reader"
mutator_password="data-agent-sandbox-mutator"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
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
  echo "PostgreSQL sandbox test container did not become ready." >&2
  exit 1
fi

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "create role sandbox_reader login password '$reader_password' nosuperuser nocreatedb nocreaterole noinherit; alter role sandbox_reader set default_transaction_read_only = on; create role sandbox_mutator login password '$mutator_password' nosuperuser nocreatedb nocreaterole noinherit; create schema data_agent_sandbox_control; create table data_agent_sandbox_control.datasource_identity (singleton boolean primary key default true check (singleton), datasource_id uuid not null, datasource_fingerprint text not null); insert into data_agent_sandbox_control.datasource_identity (datasource_id, datasource_fingerprint) values ('00000000-0000-4000-8000-00000000d101', 'postgresql-test-datasource@1.0.0'); revoke all on schema data_agent_sandbox_control from public; revoke all on data_agent_sandbox_control.datasource_identity from public; grant usage on schema data_agent_sandbox_control to sandbox_reader; grant select on data_agent_sandbox_control.datasource_identity to sandbox_reader;" \
  >/dev/null

host_port=$(docker port "$container_name" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')
export DATA_AGENT_SANDBOX_TEST_ADMIN_DSN="postgresql://postgres:$database_password@127.0.0.1:$host_port/$database_name"
export DATA_AGENT_SANDBOX_DSN="postgresql://sandbox_reader:$reader_password@127.0.0.1:$host_port/$database_name"
export DATA_AGENT_SANDBOX_MUTATOR_DSN="postgresql://sandbox_mutator:$mutator_password@127.0.0.1:$host_port/$database_name"

uv sync --project "$sandbox_dir" --dev
uv run --project "$sandbox_dir" ruff check "$sandbox_dir/src" "$sandbox_dir/tests"
uv run --project "$sandbox_dir" pytest "$sandbox_dir/tests"
DATA_AGENT_SANDBOX_PROCESS_INTEGRATION=1 \
  pnpm --dir "$repo_dir" --filter @data-agent/platform exec vitest run \
  test/integration/python-sandbox-process.spec.ts
