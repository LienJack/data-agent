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

prepare_u6_c2_maintenance_binding() {
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      insert into platform.deployment_mappings (
        deployment_id,
        app_id,
        environment,
        deployment_key_hash
      )
      values (
        'a0000000-0000-4000-8000-000000000001'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u6-migration-test',
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      )
      on conflict (deployment_id) do nothing;
    " \
    >/dev/null
}

apply_u6_c2_migration() {
  sql_file=$1
  echo "Applying U6 C2 migration $(basename "$sql_file")"
  cat > /tmp/apply-10600-full.sql << 'PRELUDE_EOF'
set session transaction_timeout = 0;
select pg_catalog.set_config('lock_timeout', '2000ms', false);
select pg_catalog.set_config('statement_timeout', '300000ms', false);
select pg_catalog.set_config('idle_in_transaction_session_timeout', '60000ms', false);
select pg_catalog.set_config('app.u6_maintenance_manifest_hash', 'sha256:d28f8ac324e5453961c2636a7741c1feb36709908f84c7f03f9b9454ed87cced', false);
select pg_catalog.set_config('app.u6_maintenance_window_id', '00000000-0000-4000-8000-000000001600', false);
select pg_catalog.set_config('app.u6_maintenance_deployment_id', 'a0000000-0000-4000-8000-000000000001', false);
select pg_catalog.set_config('app.u6_maintenance_window_expires_at', (pg_catalog.clock_timestamp() + 600000::bigint * interval '1 millisecond')::text, false);

do $u6_c2_prelude$
declare
  active_mapping_count bigint;
  expected_database_identity_hash text;
  remaining_ms bigint;
  arm_ms bigint;
  baseline_checksum text;
begin
  select pg_catalog.count(*) into active_mapping_count
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  where deployment.deployment_id = 'a0000000-0000-4000-8000-000000000001'::uuid
    and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and deployment.is_active and deployment.revoked_at is null
    and lifecycle.lifecycle_state = 'ACTIVE';
  if active_mapping_count <> 1 then
    raise exception using errcode = 'P0001', message = 'U6_MIGRATION_DEPLOYMENT_BINDING_INVALID';
  end if;

  select ledger.migration_checksum into baseline_checksum
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app' and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010590_app_data_agent_u6_research_authority';
  if not found then
    raise exception using errcode = 'P0001', message = 'U6_MIGRATION_BASELINE_MISSING';
  end if;

  expected_database_identity_hash :=
    'sha256:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to('u6-migration-database@1.0.0', 'UTF8')
        || pg_catalog.decode('00', 'hex')
        || pg_catalog.convert_to(
          app_data_agent.runtime_canonical_json(
            pg_catalog.jsonb_build_array(
              pg_catalog.current_database(),
              '00000000-0000-4000-8000-00000000da01',
              'a0000000-0000-4000-8000-000000000001',
              baseline_checksum
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  perform pg_catalog.set_config('app.u6_maintenance_database_identity_hash', expected_database_identity_hash, false);

  remaining_ms := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.current_setting('app.u6_maintenance_window_expires_at')::timestamptz - pg_catalog.clock_timestamp()) * 1000)::bigint;
  arm_ms := remaining_ms - 5000;
  if arm_ms < 30000 then raise exception using errcode = '57014', message = 'U6_MIGRATION_TRANSACTION_TIMEOUT'; end if;
  perform pg_catalog.set_config('app.u6_maintenance_session_arm_ms', arm_ms::text, false);
  perform pg_catalog.set_config('transaction_timeout', arm_ms::text || 'ms', false);
end
$u6_c2_prelude$;
PRELUDE_EOF
  cat "$sql_file" >> /tmp/apply-10600-full.sql
  docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" < /tmp/apply-10600-full.sql
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

apply_semantic_migration() {
  sql_file=$1
  # Extract checksum from the rendered migration file
  local checksum
  checksum=$(grep -m1 "^-- semantic_migration_checksum: " "$sql_file" | sed "s/^-- semantic_migration_checksum: //")
  if [ -z "$checksum" ]; then
    echo "ERROR: Could not extract checksum from $sql_file"
    exit 1
  fi
  echo "Applying semantic migration $(basename "$sql_file")"
  cat > /tmp/apply-semantic-10610.sql << 'PRELUDE_EOF'
set session transaction_timeout = 0;
select pg_catalog.set_config('lock_timeout', '2000ms', false);
select pg_catalog.set_config('statement_timeout', '300000ms', false);
select pg_catalog.set_config('idle_in_transaction_session_timeout', '60000ms', false);
select pg_catalog.set_config('app.semantic_maintenance_manifest_hash', 'CHECKSUM_PLACEHOLDER', false);
select pg_catalog.set_config('app.semantic_maintenance_window_id', '00000000-0000-4000-8000-000000001610', false);
select pg_catalog.set_config('app.semantic_maintenance_deployment_id', 'a0000000-0000-4000-8000-000000000011', false);
select pg_catalog.set_config('app.semantic_maintenance_window_expires_at', (pg_catalog.clock_timestamp() + 600000::bigint * interval '1 millisecond')::text, false);

do $semantic_prelude$
declare
  active_mapping_count bigint;
  expected_database_identity_hash text;
  remaining_ms bigint;
  arm_ms bigint;
  baseline_checksum text;
begin
  select pg_catalog.count(*) into active_mapping_count
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  where deployment.deployment_id = 'a0000000-0000-4000-8000-000000000011'::uuid
    and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and deployment.is_active and deployment.revoked_at is null
    and lifecycle.lifecycle_state = 'ACTIVE';
  if active_mapping_count <> 1 then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_MIGRATION_DEPLOYMENT_BINDING_INVALID';
  end if;

  select ledger.migration_checksum into baseline_checksum
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app' and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010600_app_data_agent_u6_research_derivation';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_MIGRATION_BASELINE_MISSING';
  end if;

  expected_database_identity_hash :=
    'sha256:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to('semantic-migration-database@1.0.0', 'UTF8')
        || pg_catalog.decode('00', 'hex')
        || pg_catalog.convert_to(
          app_data_agent.runtime_canonical_json(
            pg_catalog.jsonb_build_array(
              pg_catalog.current_database(),
              '00000000-0000-4000-8000-00000000da01',
              'a0000000-0000-4000-8000-000000000011',
              baseline_checksum
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  perform pg_catalog.set_config('app.semantic_maintenance_database_identity_hash', expected_database_identity_hash, false);

  remaining_ms := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.current_setting('app.semantic_maintenance_window_expires_at')::timestamptz - pg_catalog.clock_timestamp()) * 1000)::bigint;
  arm_ms := remaining_ms - 5000;
  if arm_ms < 30000 then raise exception using errcode = '57014', message = 'SEMANTIC_MIGRATION_TRANSACTION_TIMEOUT'; end if;
  perform pg_catalog.set_config('app.semantic_maintenance_session_arm_ms', arm_ms::text, false);
  perform pg_catalog.set_config('transaction_timeout', arm_ms::text || 'ms', false);
end
$semantic_prelude$;
PRELUDE_EOF
  # Replace checksum placeholder with actual value
  sed -i "" "s/CHECKSUM_PLACEHOLDER/${checksum}/g" /tmp/apply-semantic-10610.sql
  cat "$sql_file" >> /tmp/apply-semantic-10610.sql
  docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" < /tmp/apply-semantic-10610.sql
}

prepare_semantic_maintenance_binding() {
  docker exec "$container_name"     psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name"     -c "
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
        'a0000000-0000-4000-8000-000000000011'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u6-migration-test',
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
      )
      on conflict (deployment_id) do nothing;

      do \$semantic_binding\$
      begin
        if not exists (
          select 1
          from platform.deployment_mappings as deployment
          join platform.app_environment_lifecycle as lifecycle
            on lifecycle.app_id = deployment.app_id
           and lifecycle.environment = deployment.environment
          where deployment.deployment_id =
              'a0000000-0000-4000-8000-000000000011'::uuid
            and deployment.app_id =
              '00000000-0000-4000-8000-00000000da01'::uuid
            and deployment.environment = 'u6-migration-test'
            and deployment.is_active
            and deployment.revoked_at is null
            and lifecycle.lifecycle_state = 'ACTIVE'
        ) then
          raise exception 'SEMANTIC_TEST_MAINTENANCE_BINDING_INVALID';
        end if;
      end
      \$semantic_binding\$;
    "     >/dev/null
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
  elif [ "$(basename "$sql_file")" = \
    "20260725010610_app_data_agent_semantic_control_plane.sql" ]; then
    prepare_semantic_maintenance_binding
    apply_semantic_migration "$sql_file"
  elif [ "$(basename "$sql_file")" = \
    "20260725010600_app_data_agent_u6_research_derivation.sql" ]; then
    prepare_u6_c2_maintenance_binding
    apply_u6_c2_migration "$sql_file"
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
