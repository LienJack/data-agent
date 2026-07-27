#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
support_dir="$repo_dir/infra/supabase/test-support"
infra_dir="$repo_dir/infra/supabase"
sandbox_dir="$repo_dir/services/sandbox"
container_name="data-agent-platform-integration-$$"
database_name="data_agent_platform_integration"
database_password="data-agent-postgres-test"
backend_user="data_agent_test_backend"
backend_password="data-agent-backend-test"
sandbox_reader_password="data-agent-platform-sandbox-reader"

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

prepare_u6_maintenance_binding() {
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      insert into platform.app_environment_lifecycle (
        app_id,
        environment,
        lifecycle_state
      )
      values (
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u6-migration-test',
        'ACTIVE'
      )
      on conflict (app_id, environment) do nothing;

      insert into platform.deployment_mappings (
        deployment_id,
        app_id,
        environment,
        deployment_key_hash
      )
      values (
        '00000000-0000-4000-8000-00000000de90'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u6-migration-test',
        'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      )
      on conflict (deployment_id) do nothing;

      do \$u6_binding\$
      begin
        if not exists (
          select 1
          from platform.deployment_mappings as deployment
          join platform.app_environment_lifecycle as lifecycle
            on lifecycle.app_id = deployment.app_id
           and lifecycle.environment = deployment.environment
          where deployment.deployment_id =
              '00000000-0000-4000-8000-00000000de90'::uuid
            and deployment.app_id =
              '00000000-0000-4000-8000-00000000da01'::uuid
            and deployment.environment = 'u6-migration-test'
            and deployment.is_active
            and deployment.revoked_at is null
            and lifecycle.lifecycle_state = 'ACTIVE'
        ) then
          raise exception 'U6_TEST_MAINTENANCE_BINDING_INVALID';
        end if;
      end
      \$u6_binding\$;
    " \
    >/dev/null
}

apply_sql "$support_dir/00-bootstrap-stubs.sql"
for sql_file in $(find "$infra_dir/platform/migrations" -type f -name '*.sql' | sort); do
  apply_sql "$sql_file"
done
for sql_file in $(find "$infra_dir/apps/data-agent/migrations" -type f -name '*.sql' | sort); do
  if [ "$(basename "$sql_file")" = \
    "20260725010590_app_data_agent_u6_research_authority.sql" ]; then
    prepare_u6_maintenance_binding
    "$support_dir/run-u6-maintenance-migration.sh" \
      "$container_name" \
      "$database_name" \
      "$sql_file" \
      "00000000-0000-4000-8000-00000000de90"
  else
    apply_sql "$sql_file"
  fi
done
apply_sql "$support_dir/10-fixtures.sql"

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "create role $backend_user login inherit password '$backend_password'; grant data_agent_backend to $backend_user; create role sandbox_reader login password '$sandbox_reader_password' nosuperuser nocreatedb nocreaterole noinherit; alter role sandbox_reader set default_transaction_read_only = on; create schema data_agent_sandbox_control; create table data_agent_sandbox_control.datasource_identity (singleton boolean primary key default true check (singleton), datasource_id uuid not null, datasource_fingerprint text not null); insert into data_agent_sandbox_control.datasource_identity (datasource_id, datasource_fingerprint) values ('00000000-0000-4000-8000-00000000d101', 'postgresql-test-datasource@1.0.0'); revoke all on schema data_agent_sandbox_control from public; revoke all on data_agent_sandbox_control.datasource_identity from public; grant usage on schema data_agent_sandbox_control to sandbox_reader; grant select on data_agent_sandbox_control.datasource_identity to sandbox_reader;" \
  >/dev/null

host_port=$(docker port "$container_name" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')
export DATA_AGENT_TEST_DATABASE_URL="postgresql://$backend_user:$backend_password@127.0.0.1:$host_port/$database_name"
export DATA_AGENT_TEST_ADMIN_DATABASE_URL="postgresql://postgres:$database_password@127.0.0.1:$host_port/$database_name"
export DATA_AGENT_SANDBOX_DSN="postgresql://sandbox_reader:$sandbox_reader_password@127.0.0.1:$host_port/$database_name"
export DATA_AGENT_SANDBOX_PROCESS_INTEGRATION=1

uv sync --project "$sandbox_dir" --dev
pnpm --dir "$repo_dir" --filter @data-agent/platform test:integration
pnpm --dir "$repo_dir" --filter @data-agent/worker test:integration
