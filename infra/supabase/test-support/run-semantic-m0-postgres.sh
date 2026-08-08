#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
infra_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
container_name="data-agent-semantic-m0-$$"
database_name="data_agent_semantic_m0"
database_password="data-agent-semantic-m0-test-only"
u6_c2_execution_file=""
semantic_execution_file=""

cleanup() {
  if [ -n "$u6_c2_execution_file" ]; then
    rm -f "$u6_c2_execution_file"
  fi
  if [ -n "$semantic_execution_file" ]; then
    rm -f "$semantic_execution_file"
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

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
  echo "Semantic M0 PostgreSQL container did not become ready." >&2
  exit 1
fi

apply_sql() {
  sql_file=$1
  docker exec -i "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" <"$sql_file"
}

prepare_u6_maintenance_binding() {
  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      insert into platform.app_environment_lifecycle (
        app_id,
        environment,
        lifecycle_state
      ) values (
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u6-migration-test',
        'ACTIVE'
      ) on conflict (app_id, environment) do nothing;

      insert into platform.deployment_mappings (
        deployment_id,
        app_id,
        environment,
        deployment_key_hash
      ) values (
        '00000000-0000-4000-8000-00000000de90'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u6-migration-test',
        'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ) on conflict (deployment_id) do nothing;
    " >/dev/null
}

prepare_u6_c2_maintenance_binding() {
  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      insert into platform.deployment_mappings (
        deployment_id,
        app_id,
        environment,
        deployment_key_hash
      ) values (
        'a0000000-0000-4000-8000-000000000001'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u6-migration-test',
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      ) on conflict (deployment_id) do nothing;
    " >/dev/null
}

apply_u6_c2_migration() {
  sql_file=$1
  u6_c2_execution_file=$(mktemp "${TMPDIR:-/tmp}/semantic-m0-10600.XXXXXX")
  chmod 600 "$u6_c2_execution_file"
  sed -n '1,$p' >"$u6_c2_execution_file" <<'PRELUDE_EOF'
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
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
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
  perform pg_catalog.set_config(
    'app.u6_maintenance_database_identity_hash',
    expected_database_identity_hash,
    false
  );

  remaining_ms := pg_catalog.floor(
    pg_catalog.date_part(
      'epoch',
      pg_catalog.current_setting('app.u6_maintenance_window_expires_at')::timestamptz
        - pg_catalog.clock_timestamp()
    ) * 1000
  )::bigint;
  arm_ms := remaining_ms - 5000;
  if arm_ms < 30000 then
    raise exception using errcode = '57014', message = 'U6_MIGRATION_TRANSACTION_TIMEOUT';
  end if;
  perform pg_catalog.set_config('app.u6_maintenance_session_arm_ms', arm_ms::text, false);
  perform pg_catalog.set_config('transaction_timeout', arm_ms::text || 'ms', false);
end
$u6_c2_prelude$;
PRELUDE_EOF
  sed -n '1,$p' "$sql_file" >>"$u6_c2_execution_file"
  docker exec -i "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    <"$u6_c2_execution_file"
  rm -f "$u6_c2_execution_file"
  u6_c2_execution_file=""
}

prepare_semantic_maintenance_binding() {
  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      insert into platform.deployment_mappings (
        deployment_id,
        app_id,
        environment,
        deployment_key_hash
      ) values (
        'a0000000-0000-4000-8000-000000000011'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u6-migration-test',
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
      ) on conflict (deployment_id) do nothing;
    " >/dev/null
}

apply_semantic_migration() {
  sql_file=$1
  checksum=$(sed -n 's/^-- semantic_migration_checksum: //p' "$sql_file" | head -n 1)
  if [ -z "$checksum" ]; then
    echo "Semantic migration checksum is missing." >&2
    exit 1
  fi

  semantic_execution_file=$(mktemp "${TMPDIR:-/tmp}/semantic-m0-10610.XXXXXX")
  chmod 600 "$semantic_execution_file"
  sed "s/CHECKSUM_PLACEHOLDER/$checksum/g" >"$semantic_execution_file" <<'PRELUDE_EOF'
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
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
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
  perform pg_catalog.set_config(
    'app.semantic_maintenance_database_identity_hash',
    expected_database_identity_hash,
    false
  );

  remaining_ms := pg_catalog.floor(
    pg_catalog.date_part(
      'epoch',
      pg_catalog.current_setting('app.semantic_maintenance_window_expires_at')::timestamptz
        - pg_catalog.clock_timestamp()
    ) * 1000
  )::bigint;
  arm_ms := remaining_ms - 5000;
  if arm_ms < 30000 then
    raise exception using errcode = '57014', message = 'SEMANTIC_MIGRATION_TRANSACTION_TIMEOUT';
  end if;
  perform pg_catalog.set_config('app.semantic_maintenance_session_arm_ms', arm_ms::text, false);
  perform pg_catalog.set_config('transaction_timeout', arm_ms::text || 'ms', false);
end
$semantic_prelude$;
PRELUDE_EOF
  sed -n '1,$p' "$sql_file" >>"$semantic_execution_file"
  docker exec -i "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    <"$semantic_execution_file"
  rm -f "$semantic_execution_file"
  semantic_execution_file=""
}

apply_sql "$script_dir/00-bootstrap-stubs.sql"
for sql_file in $(find "$infra_dir/platform/migrations" -type f -name '*.sql' | sort); do
  apply_sql "$sql_file"
done
for sql_file in $(find "$infra_dir/apps/data-agent/migrations" -type f -name '*.sql' | sort); do
  if [ "$(basename "$sql_file")" = \
    "20260725010590_app_data_agent_u6_research_authority.sql" ]; then
    prepare_u6_maintenance_binding
    "$script_dir/run-u6-maintenance-migration.sh" \
      "$container_name" \
      "$database_name" \
      "$sql_file" \
      "00000000-0000-4000-8000-00000000de90"
  elif [ "$(basename "$sql_file")" = \
    "20260725010600_app_data_agent_u6_research_derivation.sql" ]; then
    prepare_u6_c2_maintenance_binding
    apply_u6_c2_migration "$sql_file"
  elif [ "$(basename "$sql_file")" = \
    "20260725010610_app_data_agent_semantic_control_plane.sql" ]; then
    prepare_semantic_maintenance_binding
    apply_semantic_migration "$sql_file"
  else
    apply_sql "$sql_file"
  fi
done
apply_sql "$script_dir/10-fixtures.sql"

app_id="00000000-0000-4000-8000-00000000da01"
tenant_id="00000000-0000-4000-8000-00000000aa22"
other_tenant_id="00000000-0000-4000-8000-00000000aa23"
deployment_id="00000000-0000-4000-8000-00000000de01"
principal_id="00000000-0000-4000-8000-000000001003"
datasource_id="00000000-0000-4000-8000-00000000d501"
idempotency_key="00000000-0000-4000-8000-00000000c501"
rollback_idempotency_key="00000000-0000-4000-8000-00000000c502"

docker exec "$container_name" \
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "
    insert into semantic.semantic_domain_registry (
      app_id,
      tenant_id,
      environment,
      semantic_domain,
      datasource_id,
      domain_display_name,
      created_by
    ) values (
      '$app_id'::uuid,
      '$tenant_id'::uuid,
      'test',
      'revenue',
      '$datasource_id'::uuid,
      'Revenue',
      '$principal_id'
    );

    insert into semantic.semantic_authority_fence (
      app_id,
      tenant_id,
      environment,
      last_fence_update_by
    ) values (
      '$app_id'::uuid,
      '$tenant_id'::uuid,
      'test',
      '$principal_id'
    );

    insert into semantic.semantic_active_pointer (
      app_id,
      tenant_id,
      environment,
      semantic_domain,
      current_release_generation,
      updated_by
    ) values (
      '$app_id'::uuid,
      '$tenant_id'::uuid,
      'test',
      'revenue',
      0,
      '$principal_id'
    );
  " >/dev/null

call_sql="
  semantic.create_candidate_draft(
    '$app_id'::uuid,
    '$tenant_id'::uuid,
    'test',
    'revenue',
    '$principal_id',
    '$idempotency_key'::uuid,
    'Net revenue',
    'Include discounts in net revenue.',
    'MAJOR',
    'HIGH',
    '{\"schema_version\":\"semantic-source-payload@1.0.0\",\"source_kind\":\"MANUAL\",\"content\":{\"metric_id\":\"net_revenue\",\"formula\":\"revenue-refund-discount\"}}'::jsonb,
    '{\"schema_version\":\"semantic-diff@1.0.0\",\"summary\":\"Include discounts\",\"operations\":[{\"path\":\"metrics.net_revenue.formula\",\"change_type\":\"MODIFY\",\"before\":\"revenue-refund\",\"after\":\"revenue-refund-discount\"}]}'::jsonb
  )
"

docker exec "$container_name" \
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "
    begin;
    set local role data_agent_backend;
    select * from platform.revalidate_backend_authority(
      '$app_id'::uuid,
      '$tenant_id'::uuid,
      'test',
      '$deployment_id'::uuid,
      '$principal_id'::uuid,
      'owner',
      1,
      1,
      true
    );
    set local search_path to app_data_agent, pg_catalog;
    select pg_catalog.set_config('data_agent.app_id', '$app_id', true);
    select pg_catalog.set_config('data_agent.tenant_id', '$tenant_id', true);
    select pg_catalog.set_config('data_agent.environment', 'test', true);
    select pg_catalog.set_config('data_agent.principal_id', '$principal_id', true);
    select pg_catalog.set_config('data_agent.role', 'owner', true);
    select pg_catalog.set_config('data_agent.deployment_id', '$deployment_id', true);
    select pg_catalog.set_config('app.app_id', '$app_id', true);
    select pg_catalog.set_config('app.tenant_id', '$tenant_id', true);
    select pg_catalog.set_config('app.environment', 'test', true);
    select pg_catalog.set_config('app.semantic_domain', 'revenue', true);

    do \$candidate\$
    declare
      first_result jsonb;
      replay_result jsonb;
    begin
      select $call_sql into first_result;
      select $call_sql into replay_result;
      if first_result ->> 'created' <> 'true'
        or replay_result ->> 'created' <> 'false'
        or first_result - 'created' <> replay_result - 'created'
      then
        raise exception 'SEMANTIC_M0_REPLAY_ASSERTION_FAILED';
      end if;
    end
    \$candidate\$;
    commit;
  " >/dev/null

docker exec "$container_name" \
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "
    begin;
    set local role data_agent_backend;
    select * from platform.revalidate_backend_authority(
      '$app_id'::uuid,
      '$tenant_id'::uuid,
      'test',
      '$deployment_id'::uuid,
      '$principal_id'::uuid,
      'owner',
      1,
      1,
      true
    );
    select pg_catalog.set_config('data_agent.app_id', '$app_id', true);
    select pg_catalog.set_config('data_agent.tenant_id', '$tenant_id', true);
    select pg_catalog.set_config('data_agent.environment', 'test', true);
    select pg_catalog.set_config('data_agent.principal_id', '$principal_id', true);
    select pg_catalog.set_config('data_agent.role', 'owner', true);
    select pg_catalog.set_config('data_agent.deployment_id', '$deployment_id', true);
    select pg_catalog.set_config('app.app_id', '$app_id', true);
    select pg_catalog.set_config('app.tenant_id', '$tenant_id', true);
    select pg_catalog.set_config('app.environment', 'test', true);
    select pg_catalog.set_config('app.semantic_domain', 'revenue', true);

    do \$scope_denial\$
    begin
      begin
        perform semantic.create_candidate_draft(
          '$app_id'::uuid,
          '$other_tenant_id'::uuid,
          'test',
          'revenue',
          '$principal_id',
          '00000000-0000-4000-8000-00000000c503'::uuid,
          'Cross-scope draft',
          'This tenant mismatch must be rejected.',
          'MINOR',
          'LOW',
          '{\"schema_version\":\"semantic-source-payload@1.0.0\",\"source_kind\":\"MANUAL\",\"content\":{\"metric_id\":\"cross_scope\"}}'::jsonb,
          '{\"schema_version\":\"semantic-diff@1.0.0\",\"summary\":\"Cross scope\",\"operations\":[{\"path\":\"metrics.cross_scope\",\"change_type\":\"ADD\",\"after\":{\"formula\":\"1\"}}]}'::jsonb
        );
        raise exception 'SEMANTIC_M0_CROSS_SCOPE_WAS_NOT_REJECTED';
      exception
        when insufficient_privilege then
          if sqlerrm <> 'SEMANTIC_SCOPE_FORBIDDEN' then
            raise;
          end if;
      end;

      begin
        perform 1 from semantic.semantic_candidate;
        raise exception 'SEMANTIC_M0_DIRECT_TABLE_READ_WAS_NOT_REJECTED';
      exception
        when insufficient_privilege then
          null;
      end;
    end
    \$scope_denial\$;
    commit;
  " >/dev/null

docker exec "$container_name" \
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "
    begin;
    set local role data_agent_backend;
    select * from platform.revalidate_backend_authority(
      '$app_id'::uuid,
      '$tenant_id'::uuid,
      'test',
      '$deployment_id'::uuid,
      '$principal_id'::uuid,
      'owner',
      1,
      1,
      true
    );
    select pg_catalog.set_config('data_agent.app_id', '$app_id', true);
    select pg_catalog.set_config('data_agent.tenant_id', '$tenant_id', true);
    select pg_catalog.set_config('data_agent.environment', 'test', true);
    select pg_catalog.set_config('data_agent.principal_id', '$principal_id', true);
    select pg_catalog.set_config('data_agent.role', 'owner', true);
    select pg_catalog.set_config('data_agent.deployment_id', '$deployment_id', true);
    select pg_catalog.set_config('app.app_id', '$app_id', true);
    select pg_catalog.set_config('app.tenant_id', '$tenant_id', true);
    select pg_catalog.set_config('app.environment', 'test', true);
    select pg_catalog.set_config('app.semantic_domain', 'revenue', true);

    do \$conflict\$
    begin
      perform semantic.create_candidate_draft(
        '$app_id'::uuid,
        '$tenant_id'::uuid,
        'test',
        'revenue',
        '$principal_id',
        '$idempotency_key'::uuid,
        'Changed title',
        'Include discounts in net revenue.',
        'MAJOR',
        'HIGH',
        '{\"schema_version\":\"semantic-source-payload@1.0.0\",\"source_kind\":\"MANUAL\",\"content\":{\"metric_id\":\"net_revenue\"}}'::jsonb,
        '{\"schema_version\":\"semantic-diff@1.0.0\",\"summary\":\"Include discounts\",\"operations\":[{\"path\":\"metrics.net_revenue.formula\",\"change_type\":\"MODIFY\",\"before\":\"old\",\"after\":\"new\"}]}'::jsonb
      );
      raise exception 'SEMANTIC_M0_CONFLICT_WAS_NOT_REJECTED';
    exception
      when unique_violation then
        if sqlerrm <> 'SEMANTIC_CANDIDATE_IDEMPOTENCY_CONFLICT' then
          raise;
        end if;
    end
    \$conflict\$;
    commit;
  " >/dev/null

docker exec "$container_name" \
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "
    begin;
    set local role data_agent_backend;
    select * from platform.revalidate_backend_authority(
      '$app_id'::uuid,
      '$tenant_id'::uuid,
      'test',
      '$deployment_id'::uuid,
      '$principal_id'::uuid,
      'owner',
      1,
      1,
      true
    );
    select pg_catalog.set_config('data_agent.app_id', '$app_id', true);
    select pg_catalog.set_config('data_agent.tenant_id', '$tenant_id', true);
    select pg_catalog.set_config('data_agent.environment', 'test', true);
    select pg_catalog.set_config('data_agent.principal_id', '$principal_id', true);
    select pg_catalog.set_config('data_agent.role', 'owner', true);
    select pg_catalog.set_config('data_agent.deployment_id', '$deployment_id', true);
    select pg_catalog.set_config('app.app_id', '$app_id', true);
    select pg_catalog.set_config('app.tenant_id', '$tenant_id', true);
    select pg_catalog.set_config('app.environment', 'test', true);
    select pg_catalog.set_config('app.semantic_domain', 'revenue', true);
    select semantic.create_candidate_draft(
      '$app_id'::uuid,
      '$tenant_id'::uuid,
      'test',
      'revenue',
      '$principal_id',
      '$rollback_idempotency_key'::uuid,
      'Rolled back draft',
      'This transaction must roll back.',
      'MINOR',
      'LOW',
      '{\"schema_version\":\"semantic-source-payload@1.0.0\",\"source_kind\":\"MANUAL\",\"content\":{\"metric_id\":\"rolled_back\"}}'::jsonb,
      '{\"schema_version\":\"semantic-diff@1.0.0\",\"summary\":\"Rolled back\",\"operations\":[{\"path\":\"metrics.rolled_back\",\"change_type\":\"ADD\",\"after\":{\"formula\":\"1\"}}]}'::jsonb
    );
    rollback;
  " >/dev/null

docker exec "$container_name" \
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "
    begin;
    set local role data_agent_u6_rpc_owner;
    select pg_catalog.set_config('data_agent.app_id', '$app_id', true);
    select pg_catalog.set_config('data_agent.tenant_id', '$other_tenant_id', true);
    select pg_catalog.set_config('data_agent.environment', 'test', true);
    select pg_catalog.set_config('data_agent.principal_id', '$principal_id', true);
    select pg_catalog.set_config('app.semantic_domain', 'revenue', true);
    do \$rls_denial\$
    declare
      visible_rows bigint;
    begin
      select pg_catalog.count(*)
      into visible_rows
      from semantic.semantic_candidate
      where tenant_id = '$tenant_id'::uuid;
      if visible_rows <> 0 then
        raise exception 'SEMANTIC_M0_RLS_CROSS_SCOPE_ROW_VISIBLE';
      end if;
    end
    \$rls_denial\$;
    commit;
  " >/dev/null

state=$(
  docker exec "$container_name" \
    psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      select
        (select pg_catalog.count(*) from semantic.semantic_source_revision where tenant_id = '$tenant_id'::uuid and semantic_domain = 'revenue') || ':' ||
        (select pg_catalog.count(*) from semantic.semantic_candidate where tenant_id = '$tenant_id'::uuid and semantic_domain = 'revenue' and candidate_status = 'DRAFT') || ':' ||
        (select pg_catalog.count(*) from semantic.semantic_candidate_revision where tenant_id = '$tenant_id'::uuid and semantic_domain = 'revenue') || ':' ||
        (select pg_catalog.count(*) from semantic.semantic_candidate_draft_idempotency where tenant_id = '$tenant_id'::uuid and semantic_domain = 'revenue') || ':' ||
        (select pg_catalog.count(*) from semantic.semantic_validation_receipt where tenant_id = '$tenant_id'::uuid and semantic_domain = 'revenue') || ':' ||
        (select pg_catalog.count(*) from semantic.semantic_review_task where tenant_id = '$tenant_id'::uuid and semantic_domain = 'revenue') || ':' ||
        (select pg_catalog.count(*) from app_data_agent.audit_log where tenant_id = '$tenant_id'::uuid and action = 'SEMANTIC_CANDIDATE_DRAFT_CREATED') || ':' ||
        (select pg_catalog.count(*)
         from semantic.semantic_candidate as candidate
         join semantic.semantic_candidate_revision as revision
           on revision.app_id = candidate.app_id
          and revision.tenant_id = candidate.tenant_id
          and revision.environment = candidate.environment
          and revision.semantic_domain = candidate.semantic_domain
          and revision.candidate_id = candidate.candidate_id
          and revision.revision_id = candidate.current_revision_id
         join semantic.semantic_source_revision as source
           on source.app_id = revision.app_id
          and source.tenant_id = revision.tenant_id
          and source.environment = revision.environment
          and source.semantic_domain = revision.semantic_domain
          and source.revision_id = revision.source_revision_id
         where candidate.tenant_id = '$tenant_id'::uuid
           and candidate.semantic_domain = 'revenue'
           and candidate.proposer_principal = '$principal_id'
           and revision.author_principal = '$principal_id'
           and source.author_principal = '$principal_id');
    "
)

if [ "$state" != "1:1:1:1:0:0:1:1" ]; then
  echo "Semantic M0 authority state mismatch: $state" >&2
  exit 1
fi

surface=$(
  docker exec "$container_name" \
    psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      select
        pg_catalog.has_function_privilege(
          'data_agent_backend',
          'semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)',
          'EXECUTE'
        ) || ':' ||
        pg_catalog.has_function_privilege(
          'authenticated',
          'semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)',
          'EXECUTE'
        ) || ':' ||
        pg_catalog.has_schema_privilege('data_agent_backend', 'semantic', 'USAGE') || ':' ||
        pg_catalog.has_schema_privilege('authenticated', 'semantic', 'USAGE') || ':' ||
        (select not procedure.proisstrict
         from pg_catalog.pg_proc as procedure
         join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'semantic'
           and procedure.proname = 'prepare_publish_attempt') || ':' ||
        (select pg_catalog.count(*)
         from platform.migration_ledger as ledger
         where ledger.owner_kind = 'app'
           and ledger.app_id = '$app_id'::uuid
           and ledger.migration_version = '20260725010609_app_data_agent_semantic_publish_grant_compatibility'
           and ledger.migration_checksum = 'sha256:1657bb333a211200c1981e6ed2e85dc1414782f54f3885aece69c65a2f196f4d') || ':' ||
        (select pg_catalog.count(*)
         from platform.migration_ledger as ledger
         where ledger.owner_kind = 'app'
           and ledger.app_id = '$app_id'::uuid
           and ledger.migration_version = '20260725010619_app_data_agent_attribution_canonical_compatibility'
           and ledger.migration_checksum = 'sha256:6031052694e6aa63c1d67951bd2be5f93e7ab8f6bdc2dd1cccadc5294c885696') || ':' ||
        (select pg_catalog.count(*)
         from platform.migration_ledger as ledger
         where ledger.owner_kind = 'app'
           and ledger.app_id = '$app_id'::uuid
           and ledger.migration_version = '20260725010622_app_data_agent_semantic_candidate_draft'
           and ledger.migration_checksum = 'sha256:e1dc3ccc8ecf575ff290992167dc9e8a15782a1c7fb3cba7c758feee76851467') || ':' ||
        (select pg_catalog.count(*)
         from pg_catalog.pg_proc as procedure
         join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'semantic'
           and procedure.proname = 'commit_publish_attempt'
           and procedure.pronargs = 12
           and pg_catalog.oidvectortypes(procedure.proargtypes) =
             'uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid') || ':' ||
        (app_data_agent.attribution_canonical_json('{\"b\":1,\"a\":2}'::jsonb) = '{\"a\":2,\"b\":1}') || ':' ||
        (select pg_catalog.count(*)
         from pg_catalog.pg_proc as procedure
         join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'pg_catalog'
           and procedure.proname = 'digest'
           and procedure.pronargs = 2
           and pg_catalog.oidvectortypes(procedure.proargtypes) = 'bytea, text'
           and pg_catalog.obj_description(procedure.oid, 'pg_proc') =
             'data-agent:10619:temporary-pgcrypto-parser-shim') || ':' ||
        (pg_catalog.length(app_data_agent.attribution_sha256('m0', '{\"a\":1}'::jsonb)) = 64) || ':' ||
        (pg_catalog.length(app_data_agent.hash_f9_evidence('m0', '{\"a\":1}'::jsonb)) = 64);
    "
)

if [ "$surface" != "true:false:true:false:true:1:1:1:0:true:0:true:true" ]; then
  echo "Semantic M0 RPC surface mismatch: $surface" >&2
  exit 1
fi

echo "Semantic M0 PostgreSQL authority checks passed: state=$state surface=$surface"
