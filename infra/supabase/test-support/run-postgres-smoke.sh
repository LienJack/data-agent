#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
infra_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
container_name=${DATA_AGENT_POSTGRES_CONTAINER_NAME:-"data-agent-supabase-smoke-$$"}
database_name=${DATA_AGENT_POSTGRES_DATABASE_NAME:-data_agent_test}
database_password=${DATA_AGENT_POSTGRES_DATABASE_PASSWORD:-data-agent-test-only}
host_port=${DATA_AGENT_POSTGRES_HOST_PORT:-}
keep_container=${DATA_AGENT_POSTGRES_KEEP_CONTAINER:-NO}
assertion_filter=${DATA_AGENT_POSTGRES_ASSERTION_FILTER:-}

cleanup() {
  if [ "$keep_container" = "YES" ]; then
    return
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

"$script_dir/static-check.sh"

if [ -n "$host_port" ]; then
  docker run \
    --detach \
    --name "$container_name" \
    --publish "$host_port:5432" \
    --env POSTGRES_PASSWORD="$database_password" \
    --env POSTGRES_DB="$database_name" \
    postgres:17-alpine >/dev/null
else
  docker run \
    --detach \
    --name "$container_name" \
    --env POSTGRES_PASSWORD="$database_password" \
    --env POSTGRES_DB="$database_name" \
    postgres:17-alpine >/dev/null
fi

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

apply_sql_with_prelude() {
  prelude_file=$1
  sql_file=$2
  echo "Applying ${sql_file#"$infra_dir"/} with ${prelude_file#"$infra_dir"/}"
  awk '1' "$prelude_file" "$sql_file" | docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name"
}

prepare_commercial_archive_history_probe() {
  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      insert into app_data_agent.pricing_control_state (
        app_id, environment, pricing_epoch
      ) values (
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'u5-history-probe',
        17
      );
    " >/dev/null
  commercial_archive_probe_before=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        select pg_catalog.to_jsonb(archived_row)::text
        from app_data_agent.pricing_control_state as archived_row
        where environment = 'u5-history-probe';
      "
  )
}

verify_commercial_archive_history_probe() {
  commercial_archive_probe_after=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        select pg_catalog.to_jsonb(archived_row)::text
        from app_data_agent.pricing_control_state as archived_row
        where environment = 'u5-history-probe';
      "
  )
  if [ "$commercial_archive_probe_before" != "$commercial_archive_probe_after" ]; then
    echo "Commercial archive migration changed historical row bytes." >&2
    exit 1
  fi

  archive_receipt_count=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        select (relation_snapshots #>> '{pricing_control_state,row_count}')::bigint
        from app_data_agent.commercial_archive_retirement_receipts
        where migration_version =
          '20260725010703_app_data_agent_commercial_archive_retirement';
      "
  )
  if [ "$archive_receipt_count" -lt 1 ]; then
    echo "Commercial archive receipt did not capture the history probe." >&2
    exit 1
  fi

  archive_write_output=$(mktemp)
  if docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "update app_data_agent.pricing_control_state set pricing_epoch = 18 where environment = 'u5-history-probe';" \
    >"$archive_write_output" 2>&1; then
    echo "Commercial archive accepted a historical-row mutation." >&2
    rm -f "$archive_write_output"
    exit 1
  fi
  if ! rg -q "COMMERCIAL_ARCHIVE_READ_ONLY" "$archive_write_output"; then
    echo "Commercial archive rejected mutation with the wrong reason." >&2
    cat "$archive_write_output" >&2
    rm -f "$archive_write_output"
    exit 1
  fi
  rm -f "$archive_write_output"
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

prepare_local_maintenance_binding() {
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      insert into platform.app_environment_lifecycle (
        app_id,
        environment,
        lifecycle_state
      ) values (
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'local',
        'ACTIVE'
      ) on conflict (app_id, environment) do nothing;

      insert into platform.deployment_mappings (
        deployment_id,
        app_id,
        environment,
        deployment_key_hash
      ) values (
        '00000000-0000-4000-8000-000000000001'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'local',
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
      ) on conflict (deployment_id) do nothing;
    " \
    >/dev/null
}

apply_sql_to_database() {
  target_database=$1
  sql_file=$2
  docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$target_database" <"$sql_file" \
    >/dev/null
}

run_reset_only_guard_probe() {
  reset_database="data_agent_reset_guard"
  reset_output=$(mktemp)
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "create database $reset_database" >/dev/null
  apply_sql_to_database "$reset_database" "$script_dir/00-bootstrap-stubs.sql"
  for sql_file in $(find "$infra_dir/platform/migrations" -type f -name '*.sql' | sort); do
    apply_sql_to_database "$reset_database" "$sql_file"
  done
  for migration_version in 10100 10200 10300 10400; do
    sql_file=$(find "$infra_dir/apps/data-agent/migrations" \
      -type f -name "*${migration_version}_*.sql")
    apply_sql_to_database "$reset_database" "$sql_file"
  done
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$reset_database" \
    -c "insert into app_data_agent.memberships (app_id, tenant_id, environment, principal_id, membership_role) values ('00000000-0000-4000-8000-00000000da01', '00000000-0000-4000-8000-00000000aa99', 'test', '00000000-0000-4000-8000-000000001099', 'owner'); insert into app_data_agent.runs (app_id, tenant_id, environment, run_id, principal_id, question) values ('00000000-0000-4000-8000-00000000da01', '00000000-0000-4000-8000-00000000aa99', 'test', '00000000-0000-4000-8000-00000000a099', '00000000-0000-4000-8000-000000001099', 'reset guard probe');" \
    >/dev/null
  if docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$reset_database" \
    <"$infra_dir/apps/data-agent/migrations/20260725010500_app_data_agent_runtime_foundation.sql" \
    >"$reset_output" 2>&1; then
    echo "U4 reset-only migration unexpectedly accepted non-empty Runtime tables." >&2
    rm -f "$reset_output"
    exit 1
  fi
  if ! rg -q "DA_U4_RESET_REQUIRES_EMPTY_RUNTIME" "$reset_output"; then
    echo "U4 reset-only migration failed without the expected stable marker." >&2
    sed -n '1,120p' "$reset_output" >&2
    rm -f "$reset_output"
    exit 1
  fi
  rm -f "$reset_output"
}

run_falcon24_e1_unactivated_probe() {
  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      do \$falcon24_e1_unactivated\$
      begin
        if exists(select 1 from app_data_agent.falcon24_current_authority_epoch) then
          raise exception 'FALCON24_E1_UNEXPECTED_CURRENT_AUTHORITY';
        end if;
        begin
          insert into app_data_agent.runs(
            app_id,tenant_id,environment,run_id,principal_id,status,question)
          values(
            '00000000-0000-4000-8000-00000000da01'::uuid,
            '00000000-0000-4000-8000-00000000aa99'::uuid,'e1-preflight',
            '00000000-0000-4000-8000-00000000a999'::uuid,
            '00000000-0000-4000-8000-000000001999'::uuid,'QUEUED',
            'Falcon24 E1 unactivated probe');
          raise exception 'FALCON24_E1_UNACTIVATED_RUN_ACCEPTED';
        exception when sqlstate '55000' then
          if sqlerrm<>'FALCON24_E1_NOT_ACTIVE' then raise; end if;
        end;
      end
      \$falcon24_e1_unactivated\$;
    " >/dev/null
}

run_falcon24_e1_legacy_state_guard_probe() {
  migration_file=$1
  guard_database="${database_name}_falcon24_e1_legacy"
  guard_output=$(mktemp)
  docker exec "$container_name" \
    createdb -U postgres -T "$database_name" "$guard_database"
  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$guard_database" \
    -c "
      insert into app_data_agent.workspaces(
        app_id,workspace_id,environment,slug,display_name)
      values(
        '00000000-0000-4000-8000-00000000da01'::uuid,
        '00000000-0000-4000-8000-00000000aa99'::uuid,'e1-legacy-guard',
        'falcon24-e1-legacy-guard','Falcon24 E1 legacy migration guard');
      insert into app_data_agent.memberships(
        app_id,tenant_id,environment,principal_id,membership_role)
      values(
        '00000000-0000-4000-8000-00000000da01'::uuid,
        '00000000-0000-4000-8000-00000000aa99'::uuid,'e1-legacy-guard',
        '00000000-0000-4000-8000-000000001999'::uuid,'owner');
      insert into app_data_agent.runs(
        app_id,tenant_id,environment,run_id,principal_id,status,question)
      values(
        '00000000-0000-4000-8000-00000000da01'::uuid,
        '00000000-0000-4000-8000-00000000aa99'::uuid,'e1-legacy-guard',
        '00000000-0000-4000-8000-00000000a999'::uuid,
        '00000000-0000-4000-8000-000000001999'::uuid,'QUEUED',
        'Falcon24 E1 legacy migration guard');
    " >/dev/null
  if docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$guard_database" \
    <"$migration_file" >"$guard_output" 2>&1; then
    echo "Falcon24 E1 migration unexpectedly accepted legacy Runtime state." >&2
    rm -f "$guard_output"
    exit 1
  fi
  if ! rg -q "FALCON24_E1_LEGACY_RUNTIME_STATE_PRESENT" "$guard_output"; then
    echo "Falcon24 E1 migration rejected legacy state without the stable marker." >&2
    sed -n '1,120p' "$guard_output" >&2
    rm -f "$guard_output"
    exit 1
  fi
  guard_state=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$guard_database" \
      -c "
        select
          (select pg_catalog.count(*) from app_data_agent.runs)::text || ':' ||
          (pg_catalog.to_regclass('app_data_agent.falcon24_authority_baselines') is null)::text || ':' ||
          (select pg_catalog.count(*) from platform.migration_ledger
            where owner_kind='app'
              and app_id='00000000-0000-4000-8000-00000000da01'::uuid
              and migration_version=
                '20260725010775_app_data_agent_falcon24_e1_authority')::text;
      "
  )
  if [ "$guard_state" != "1:true:0" ]; then
    echo "Falcon24 E1 legacy guard changed state: $guard_state" >&2
    rm -f "$guard_output"
    exit 1
  fi
  rm -f "$guard_output"
  docker exec "$container_name" dropdb -U postgres "$guard_database"
}

run_falcon24_e1_activation_run_race_probe() {
  race_database="${database_name}_falcon24_e1_race"
  docker exec "$container_name" \
    createdb -U postgres -T "$database_name" "$race_database"
  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$race_database" \
    -c "
      do \$falcon24_e1_race_setup\$
      declare
        race_app constant uuid:='00000000-0000-4000-8000-00000000da01'::uuid;
        race_tenant constant uuid:='00000000-0000-4000-8000-00000000aa44'::uuid;
        race_principal constant uuid:='00000000-0000-4000-8000-000000001044'::uuid;
        race_staging constant uuid:='00000000-0000-4000-8000-000000007144'::uuid;
        race_baseline constant uuid:='00000000-0000-4000-8000-000000007244'::uuid;
        race_attempt constant uuid:='00000000-0000-4000-8000-000000007344'::uuid;
        retained_hash constant text:=
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        component text; baseline_key text; receipt jsonb; baseline jsonb;
        receipt_hashes jsonb:='{}'::jsonb;
      begin
        insert into platform.deployment_mappings(
          deployment_id,app_id,environment,deployment_key_hash)
        values(
          '00000000-0000-4000-8000-00000000de01'::uuid,race_app,'test',
          'sha256:1111111111111111111111111111111111111111111111111111111111111111');
        insert into app_data_agent.workspaces(
          app_id,workspace_id,environment,slug,display_name)
        values(race_app,race_tenant,'test','falcon24-e1-race',
          'Falcon24 E1 activation race');
        insert into app_data_agent.memberships(
          app_id,tenant_id,environment,principal_id,membership_role)
        values(race_app,race_tenant,'test',race_principal,'owner');
        insert into app_data_agent.falcon24_e1_staging_sessions(
          app_id,tenant_id,environment,staging_id,retained_assets_hash,status,
          created_by,created_at,updated_at)
        values(race_app,race_tenant,'test',race_staging,retained_hash,'STAGED',
          race_principal,pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp());
        foreach component in array array['AGENT_PROFILES','DATASET','LLM_CONFIGURATION',
            'OPERATOR_REGISTRY','SANDBOX_RUNTIME','SEMANTIC_RELEASE']::text[] loop
          baseline_key:=case component when 'AGENT_PROFILES' then 'agent_profiles'
            when 'DATASET' then 'dataset'
            when 'LLM_CONFIGURATION' then 'llm_configuration'
            when 'OPERATOR_REGISTRY' then 'operator_registry'
            when 'SANDBOX_RUNTIME' then 'sandbox_runtime'
            else 'semantic_release' end;
          receipt:=pg_catalog.jsonb_build_object(
            'schema_version','falcon24-e1-staging-receipt@1.0.0',
            'staging_id',race_staging,'component',component,
            'subject_hash',
              'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            'evidence_hash',
              'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            'production_isolation_proven',false);
          receipt:=receipt||pg_catalog.jsonb_build_object(
            'receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
          insert into app_data_agent.falcon24_e1_staging_receipts(
            app_id,tenant_id,environment,staging_id,component,subject_hash,evidence_hash,
            production_isolation_proven,receipt_hash,receipt_document,created_at)
          values(race_app,race_tenant,'test',race_staging,component,
            receipt->>'subject_hash',receipt->>'evidence_hash',false,
            receipt->>'receipt_hash',receipt,pg_catalog.clock_timestamp());
          receipt_hashes:=receipt_hashes||pg_catalog.jsonb_build_object(
            baseline_key,receipt->>'receipt_hash');
        end loop;
        baseline:=pg_catalog.jsonb_build_object(
          'schema_version','falcon24-authority-baseline@1.0.0',
          'baseline_id',race_baseline,'authority_epoch','E1',
          'source_commit',pg_catalog.repeat('d',40),'retained_assets_hash',retained_hash,
          'web_build_hash',
            'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          'staging_receipts',receipt_hashes,
          'acceptance_contracts',pg_catalog.jsonb_build_object(
            'oracle','sha256:1111111111111111111111111111111111111111111111111111111111111111',
            'qualification','sha256:2222222222222222222222222222222222222222222222222222222222222222',
            'campaign','sha256:3333333333333333333333333333333333333333333333333333333333333333',
            'qa_e2e','sha256:4444444444444444444444444444444444444444444444444444444444444444',
            'trace_ui','sha256:5555555555555555555555555555555555555555555555555555555555555555',
            'reclamation','sha256:6666666666666666666666666666666666666666666666666666666666666666'),
          'production_isolation_proven',false,'production_gate','HOLD');
        baseline:=baseline||pg_catalog.jsonb_build_object(
          'baseline_hash',app_data_agent.u2_canonical_sha256(baseline));
        insert into app_data_agent.falcon24_authority_baselines(
          app_id,tenant_id,environment,baseline_id,authority_epoch,staging_id,
          baseline_hash,baseline_document,source_commit,retained_assets_hash,
          web_build_hash,production_isolation_proven,production_gate,status,
          created_by,created_at)
        values(race_app,race_tenant,'test',race_baseline,'E1',race_staging,
          baseline->>'baseline_hash',baseline,baseline->>'source_commit',retained_hash,
          baseline->>'web_build_hash',false,'HOLD','STAGED',race_principal,
          pg_catalog.clock_timestamp());
        insert into app_data_agent.falcon24_e1_activation_attempts(
          app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash,
          status,created_by,created_at)
        values(race_app,race_tenant,'test',race_attempt,race_baseline,
          baseline->>'baseline_hash','OPEN',race_principal,pg_catalog.clock_timestamp());
      end
      \$falcon24_e1_race_setup\$;
    " >/dev/null

  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$race_database" \
    -c "
      begin;
      select pg_catalog.set_config(
        'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
      select pg_catalog.set_config(
        'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa44',true);
      select pg_catalog.set_config('data_agent.environment','test',true);
      select pg_catalog.set_config(
        'data_agent.principal_id','00000000-0000-4000-8000-000000001044',true);
      select pg_catalog.set_config('data_agent.role','owner',true);
      select pg_catalog.set_config(
        'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
      do \$falcon24_e1_race_activate\$
      declare baseline_hash text; command jsonb;
      begin
        select row.baseline_hash into strict baseline_hash
        from app_data_agent.falcon24_authority_baselines row
        where row.app_id='00000000-0000-4000-8000-00000000da01'::uuid
          and row.tenant_id='00000000-0000-4000-8000-00000000aa44'::uuid
          and row.environment='test'
          and row.baseline_id='00000000-0000-4000-8000-000000007244'::uuid;
        command:=pg_catalog.jsonb_build_object(
          'schema_version','falcon24-e1-authority-activate@1.0.0',
          'attempt_id','00000000-0000-4000-8000-000000007344'::uuid,
          'baseline_id','00000000-0000-4000-8000-000000007244'::uuid,
          'expected_baseline_hash',baseline_hash);
        command:=command||pg_catalog.jsonb_build_object(
          'command_hash',app_data_agent.u2_canonical_sha256(command));
        perform app_data_agent.activate_falcon24_e1_authority(command);
      end
      \$falcon24_e1_race_activate\$;
      select pg_catalog.pg_sleep(2);
      commit;
    " >/dev/null &
  activation_pid=$!
  sleep 0.5

  docker exec "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$race_database" \
    -c "
      do \$falcon24_e1_race_run_before_commit\$
      begin
        perform pg_catalog.set_config(
          'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
        perform pg_catalog.set_config(
          'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa44',true);
        perform pg_catalog.set_config('data_agent.environment','test',true);
        perform pg_catalog.set_config(
          'data_agent.principal_id','00000000-0000-4000-8000-000000001044',true);
        perform pg_catalog.set_config('data_agent.role','owner',true);
        perform pg_catalog.set_config(
          'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
        begin
          insert into app_data_agent.runs(
            app_id,tenant_id,environment,run_id,principal_id,status,question)
          values(
            '00000000-0000-4000-8000-00000000da01'::uuid,
            '00000000-0000-4000-8000-00000000aa44'::uuid,'test',
            '00000000-0000-4000-8000-00000000a441'::uuid,
            '00000000-0000-4000-8000-000000001044'::uuid,'QUEUED',
            'Falcon24 E1 race before activation commit');
          raise exception 'FALCON24_E1_PARTIAL_ACTIVATION_OBSERVED';
        exception when sqlstate '55000' then
          if sqlerrm<>'FALCON24_E1_NOT_ACTIVE' then raise; end if;
        end;
      end
      \$falcon24_e1_race_run_before_commit\$;
    " >/dev/null
  wait "$activation_pid"

  race_binding=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$race_database" \
      -c "
        do \$falcon24_e1_race_run_after_commit\$
        begin
          perform pg_catalog.set_config(
            'data_agent.app_id','00000000-0000-4000-8000-00000000da01',false);
          perform pg_catalog.set_config(
            'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa44',false);
          perform pg_catalog.set_config('data_agent.environment','test',false);
          perform pg_catalog.set_config(
            'data_agent.principal_id','00000000-0000-4000-8000-000000001044',false);
          perform pg_catalog.set_config('data_agent.role','owner',false);
          perform pg_catalog.set_config(
            'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',false);
          insert into app_data_agent.runs(
            app_id,tenant_id,environment,run_id,principal_id,status,question)
          values(
            '00000000-0000-4000-8000-00000000da01'::uuid,
            '00000000-0000-4000-8000-00000000aa44'::uuid,'test',
            '00000000-0000-4000-8000-00000000a442'::uuid,
            '00000000-0000-4000-8000-000000001044'::uuid,'QUEUED',
            'Falcon24 E1 race after activation commit');
        end
        \$falcon24_e1_race_run_after_commit\$;
        select authority_epoch||':'||authority_baseline_id::text||':'||
          authority_activation_attempt_id::text
        from app_data_agent.runs
        where run_id='00000000-0000-4000-8000-00000000a442'::uuid;
      "
  )
  if [ "$race_binding" != \
    "E1:00000000-0000-4000-8000-000000007244:00000000-0000-4000-8000-000000007344" ]; then
    echo "Falcon24 E1 activation/Run race exposed an incomplete binding: $race_binding" >&2
    exit 1
  fi
  docker exec "$container_name" dropdb -U postgres "$race_database"
}

assert_runtime_prefix_fail_closed() {
  target_database=$1
  migration_prefix=$2
  privilege_state=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$target_database" \
      -c "
        select
          pg_catalog.has_function_privilege(
            'authenticated',
            'api.data_agent__accept_run_command(uuid,uuid,uuid,uuid,text,text,jsonb,text)',
            'EXECUTE'
          ) || ':' ||
          pg_catalog.has_table_privilege(
            'data_agent_backend',
            'app_data_agent.runs',
            'INSERT'
          ) || ':' ||
          pg_catalog.has_column_privilege(
            'data_agent_backend',
            'app_data_agent.runs',
            'active_fence',
            'UPDATE'
          ) || ':' ||
          pg_catalog.has_function_privilege(
            'data_agent_backend',
            'app_data_agent.claim_outbox(text,integer,integer)',
            'EXECUTE'
          ) || ':' ||
          pg_catalog.has_function_privilege(
            'data_agent_platform_owner',
            'app_data_agent.advance_run_fence(uuid,bigint)',
            'EXECUTE'
          ) || ':' ||
          coalesce(
            pg_catalog.has_function_privilege(
              'data_agent_backend',
              pg_catalog.to_regprocedure(
                'app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)'
              ),
              'EXECUTE'
            ),
            false
          );
      "
  )
  if [ "$privilege_state" != "false:false:false:false:false:false" ]; then
    echo "Runtime migration prefix $migration_prefix was not fail closed: $privilege_state" >&2
    exit 1
  fi
}

run_runtime_prefix_fail_closed_probe() {
  prefix_database="data_agent_runtime_prefix"
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "create database $prefix_database" >/dev/null
  apply_sql_to_database "$prefix_database" "$script_dir/00-bootstrap-stubs.sql"
  for sql_file in $(find "$infra_dir/platform/migrations" -type f -name '*.sql' | sort); do
    apply_sql_to_database "$prefix_database" "$sql_file"
  done
  for migration_version in 10100 10200 10300 10400; do
    sql_file=$(find "$infra_dir/apps/data-agent/migrations" \
      -type f -name "*${migration_version}_*.sql")
    apply_sql_to_database "$prefix_database" "$sql_file"
  done

  for migration_version in 10500 10505 10510; do
    sql_file=$(find "$infra_dir/apps/data-agent/migrations" \
      -type f -name "*${migration_version}_*.sql")
    apply_sql_to_database "$prefix_database" "$sql_file"
    assert_runtime_prefix_fail_closed "$prefix_database" "$migration_version"
  done
  for migration_version in 10520 10530 10540 10550 10560; do
    sql_file=$(find "$infra_dir/apps/data-agent/migrations" \
      -type f -name "*${migration_version}_*.sql")
    apply_sql_to_database "$prefix_database" "$sql_file"
  done
  assert_runtime_prefix_fail_closed "$prefix_database" "10560"
}

run_concurrent_claim_probe() {
  claim_app="00000000-0000-4000-8000-00000000da01"
  claim_tenant="00000000-0000-4000-8000-00000000aa22"
  claim_deployment="00000000-0000-4000-8000-00000000de01"
  claim_principal="00000000-0000-4000-8000-000000001003"
  claim_run="00000000-0000-4000-8000-00000000a280"

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "begin; set local role data_agent_backend; select pg_catalog.set_config('data_agent.app_id', '$claim_app', true); select pg_catalog.set_config('data_agent.tenant_id', '$claim_tenant', true); select pg_catalog.set_config('data_agent.environment', 'test', true); select pg_catalog.set_config('data_agent.principal_id', '$claim_principal', true); select pg_catalog.set_config('data_agent.role', 'owner', true); select pg_catalog.set_config('data_agent.deployment_id', '$claim_deployment', true); select test_support.accept_backend_start_run('$claim_run'::uuid, '00000000-0000-4000-8000-00000000c280'::uuid, '00000000-0000-4000-8000-00000000e280'::uuid, '00000000-0000-4000-8000-00000000b280'::uuid, '00000000-0000-4000-8000-00000000d280'::uuid, 'runtime-u4-concurrent-claim', 'U4 concurrent claim smoke'); commit;" \
    >/dev/null

  run_claim_session() {
    worker_id=$1
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "begin; set local role data_agent_backend; select pg_catalog.set_config('data_agent.app_id', '$claim_app', true); select pg_catalog.set_config('data_agent.tenant_id', '$claim_tenant', true); select pg_catalog.set_config('data_agent.environment', 'test', true); select pg_catalog.set_config('data_agent.principal_id', '$claim_principal', true); select pg_catalog.set_config('data_agent.role', 'owner', true); select pg_catalog.set_config('data_agent.deployment_id', '$claim_deployment', true); select * from app_data_agent.claim_run_work('$worker_id', 1, 30); select pg_catalog.pg_sleep(2); commit;" \
      >/dev/null
  }

  run_claim_session "runtime-concurrent-a" &
  claim_a_pid=$!
  run_claim_session "runtime-concurrent-b" &
  claim_b_pid=$!
  wait "$claim_a_pid"
  wait "$claim_b_pid"

  claim_state=$(
    docker exec "$container_name" \
      psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "select (select pg_catalog.count(*) from app_data_agent.run_attempts where run_id = '$claim_run'::uuid) || ':' || (select pg_catalog.count(*) from app_data_agent.run_attempts where run_id = '$claim_run'::uuid and status = 'ACTIVE') || ':' || (select attempt_count || ':' || status || ':' || lease_token || ':' || run_fence from app_data_agent.outbox where run_id = '$claim_run'::uuid);"
  )
  if [ "$claim_state" != "1:1:1:LEASED:1:1" ]; then
    echo "Concurrent claim created duplicate authority: $claim_state" >&2
    exit 1
  fi

  claim_outbox="00000000-0000-4000-8000-00000000b280"
  heartbeat_barrier=45454545
  expiry_barrier=46464646
  claim_probe_dir=$(mktemp -d)

  run_claim_heartbeat_session() {
    heartbeat_tail=${1-}
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "begin; set local role data_agent_backend; select pg_catalog.set_config('data_agent.app_id', '$claim_app', true); select pg_catalog.set_config('data_agent.tenant_id', '$claim_tenant', true); select pg_catalog.set_config('data_agent.environment', 'test', true); select pg_catalog.set_config('data_agent.principal_id', '$claim_principal', true); select pg_catalog.set_config('data_agent.role', 'owner', true); select pg_catalog.set_config('data_agent.deployment_id', '$claim_deployment', true); select app_data_agent.heartbeat_run_work(message.outbox_id, message.active_attempt_id, message.lease_owner, message.lease_token, message.run_fence, 30) from app_data_agent.outbox as message where message.outbox_id = '$claim_outbox'::uuid; $heartbeat_tail commit;"
  }

  run_claim_heartbeat_session \
    "select pg_catalog.pg_advisory_xact_lock($heartbeat_barrier); select pg_catalog.pg_sleep(2);" \
    >"$claim_probe_dir/heartbeat-holder.out" 2>&1 &
  heartbeat_holder_pid=$!

  heartbeat_lock_ready=0
  heartbeat_lock_attempt=0
  while [ "$heartbeat_lock_attempt" -lt 30 ]; do
    heartbeat_lock_count=$(
      docker exec "$container_name" \
        psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
        -c "select pg_catalog.count(*) from pg_catalog.pg_locks where locktype = 'advisory' and granted and classid = 0 and objid = $heartbeat_barrier;"
    )
    if [ "$heartbeat_lock_count" = "1" ]; then
      heartbeat_lock_ready=1
      break
    fi
    heartbeat_lock_attempt=$((heartbeat_lock_attempt + 1))
    sleep 0.1
  done
  if [ "$heartbeat_lock_ready" -ne 1 ]; then
    echo "Heartbeat overlap holder did not reach the lock barrier." >&2
    exit 1
  fi
  run_claim_heartbeat_session "" \
    >"$claim_probe_dir/heartbeat-waiter.out" 2>&1
  wait "$heartbeat_holder_pid"

  heartbeat_state=$(
    docker exec "$container_name" \
      psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "select message.lease_expires_at > pg_catalog.clock_timestamp() and attempt.lease_expires_at = message.lease_expires_at and attempt.last_heartbeat_at = message.last_heartbeat_at from app_data_agent.outbox as message join app_data_agent.run_attempts as attempt on attempt.attempt_id = message.active_attempt_id where message.outbox_id = '$claim_outbox'::uuid;"
  )
  if [ "$heartbeat_state" != "t" ]; then
    echo "Overlapping heartbeats did not preserve one monotonic Lease: $heartbeat_state" >&2
    exit 1
  fi

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "set session_replication_role = replica; update app_data_agent.run_attempts set lease_expires_at = pg_catalog.clock_timestamp() + interval '2 seconds' where run_id = '$claim_run'::uuid and status = 'ACTIVE'; update app_data_agent.outbox set lease_expires_at = pg_catalog.clock_timestamp() + interval '2 seconds' where outbox_id = '$claim_outbox'::uuid; set session_replication_role = origin;" \
    >/dev/null

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "begin; select 1 from app_data_agent.runs where run_id = '$claim_run'::uuid for update; select pg_catalog.pg_advisory_xact_lock($expiry_barrier); select pg_catalog.pg_sleep(3); commit;" \
    >"$claim_probe_dir/expiry-holder.out" 2>&1 &
  expiry_holder_pid=$!

  expiry_lock_ready=0
  expiry_lock_attempt=0
  while [ "$expiry_lock_attempt" -lt 30 ]; do
    expiry_lock_count=$(
      docker exec "$container_name" \
        psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
        -c "select pg_catalog.count(*) from pg_catalog.pg_locks where locktype = 'advisory' and granted and classid = 0 and objid = $expiry_barrier;"
    )
    if [ "$expiry_lock_count" = "1" ]; then
      expiry_lock_ready=1
      break
    fi
    expiry_lock_attempt=$((expiry_lock_attempt + 1))
    sleep 0.1
  done
  if [ "$expiry_lock_ready" -ne 1 ]; then
    echo "Lease-expiry holder did not reach the lock barrier." >&2
    exit 1
  fi

  stale_heartbeat_rejected=0
  if run_claim_heartbeat_session "" \
    >"$claim_probe_dir/stale-heartbeat.out" 2>&1; then
    stale_heartbeat_rejected=0
  else
    stale_heartbeat_rejected=1
  fi
  wait "$expiry_holder_pid"
  if [ "$stale_heartbeat_rejected" -ne 1 ] ||
    ! grep -q "DA_RUN_LEASE_STALE" "$claim_probe_dir/stale-heartbeat.out"; then
    echo "Heartbeat revived a Lease that expired while waiting for the Run lock." >&2
    exit 1
  fi

  expiry_state=$(
    docker exec "$container_name" \
      psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "select message.lease_expires_at < pg_catalog.clock_timestamp() and attempt.lease_expires_at < pg_catalog.clock_timestamp() and message.status = 'LEASED' and attempt.status = 'ACTIVE' from app_data_agent.outbox as message join app_data_agent.run_attempts as attempt on attempt.attempt_id = message.active_attempt_id where message.outbox_id = '$claim_outbox'::uuid;"
  )
  if [ "$expiry_state" != "t" ]; then
    echo "Rejected stale heartbeat changed the expired Lease state: $expiry_state" >&2
    exit 1
  fi
  rm -r -- "$claim_probe_dir"
}

run_concurrent_accept_probe() {
  accept_app="00000000-0000-4000-8000-00000000da01"
  accept_tenant="00000000-0000-4000-8000-00000000aa22"
  accept_deployment="00000000-0000-4000-8000-00000000de01"
  accept_principal="00000000-0000-4000-8000-000000001003"
  accept_run="00000000-0000-4000-8000-00000000a2f0"
  accept_barrier=44444444

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      begin;
      set local role data_agent_backend;
      set local data_agent.app_id = '$accept_app';
      set local data_agent.tenant_id = '$accept_tenant';
      set local data_agent.environment = 'test';
      set local data_agent.principal_id = '$accept_principal';
      set local data_agent.role = 'owner';
      set local data_agent.deployment_id = '$accept_deployment';
      select test_support.accept_backend_start_run(
        '$accept_run'::uuid,
        '00000000-0000-4000-8000-00000000c2f0'::uuid,
        '00000000-0000-4000-8000-00000000e2f0'::uuid,
        '00000000-0000-4000-8000-00000000b2f0'::uuid,
        '00000000-0000-4000-8000-00000000d2f0'::uuid,
        'runtime-u4-concurrent-accept-a',
        'U4 concurrent accept winner'
      );
      select pg_catalog.pg_advisory_xact_lock($accept_barrier);
      select pg_catalog.pg_sleep(3);
      commit;
    " \
    >/dev/null &
  accept_holder_pid=$!

  accept_barrier_ready=0
  accept_poll=0
  while [ "$accept_poll" -lt 50 ]; do
    accept_lock_count=$(
      docker exec "$container_name" \
        psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
        -c "select pg_catalog.count(*) from pg_catalog.pg_locks where locktype = 'advisory' and granted and classid = 0 and objid = $accept_barrier;"
    )
    if [ "$accept_lock_count" = "1" ]; then
      accept_barrier_ready=1
      break
    fi
    accept_poll=$((accept_poll + 1))
    sleep 0.1
  done
  if [ "$accept_barrier_ready" -ne 1 ]; then
    wait "$accept_holder_pid" || true
    echo "Concurrent accept probe did not reach its post-write barrier." >&2
    exit 1
  fi

  if accept_loser_output=$(
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        begin;
        set local role data_agent_backend;
        set local data_agent.app_id = '$accept_app';
        set local data_agent.tenant_id = '$accept_tenant';
        set local data_agent.environment = 'test';
        set local data_agent.principal_id = '$accept_principal';
        set local data_agent.role = 'owner';
        set local data_agent.deployment_id = '$accept_deployment';
        select test_support.accept_backend_start_run(
          '$accept_run'::uuid,
          '00000000-0000-4000-8000-00000000c2f1'::uuid,
          '00000000-0000-4000-8000-00000000e2f1'::uuid,
          '00000000-0000-4000-8000-00000000b2f1'::uuid,
          '00000000-0000-4000-8000-00000000d2f1'::uuid,
          'runtime-u4-concurrent-accept-b',
          'U4 concurrent accept loser'
        );
        commit;
      " 2>&1
  ); then
    wait "$accept_holder_pid" || true
    echo "Concurrent accept probe allowed two writers to commit." >&2
    exit 1
  fi
  wait "$accept_holder_pid"

  case "$accept_loser_output" in
    *DA_RUN_ALREADY_EXISTS*) ;;
    *)
      echo "Concurrent accept loser failed without the stable Run conflict marker." >&2
      echo "$accept_loser_output" >&2
      exit 1
      ;;
  esac

  accept_state=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        select
          (
            select pg_catalog.count(*)
            from app_data_agent.runs
            where run_id = '$accept_run'::uuid
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.commands
            where run_id = '$accept_run'::uuid
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.run_events
            where run_id = '$accept_run'::uuid
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.outbox
            where run_id = '$accept_run'::uuid
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.audit_log
            where resource_id = '$accept_run'
              and action = 'RUN_COMMAND_ACCEPTED'
          ) || ':' ||
          (
            select
              (
                select pg_catalog.count(*)
                from app_data_agent.commands
                where command_id =
                  '00000000-0000-4000-8000-00000000c2f1'::uuid
              ) +
              (
                select pg_catalog.count(*)
                from app_data_agent.idempotency_records
                where idempotency_key =
                  'runtime-u4-concurrent-accept-b'
              ) +
              (
                select pg_catalog.count(*)
                from app_data_agent.run_events
                where event_id =
                  '00000000-0000-4000-8000-00000000e2f1'::uuid
              ) +
              (
                select pg_catalog.count(*)
                from app_data_agent.outbox
                where outbox_id =
                  '00000000-0000-4000-8000-00000000b2f1'::uuid
              ) +
              (
                select pg_catalog.count(*)
                from app_data_agent.audit_log
                where audit_id =
                  '00000000-0000-4000-8000-00000000d2f1'::uuid
              )
          );
      "
  )
  if [ "$accept_state" != "1:1:1:1:1:0" ]; then
    echo "Concurrent accept left partial or duplicate state: $accept_state" >&2
    exit 1
  fi
}

run_browser_run_conflict_probe() {
  conflict_mode=$1
  conflict_app="00000000-0000-4000-8000-00000000da01"
  conflict_tenant="00000000-0000-4000-8000-00000000aa22"
  conflict_deployment="00000000-0000-4000-8000-00000000de01"
  conflict_principal="00000000-0000-4000-8000-000000001003"
  case "$conflict_mode" in
    browser)
      conflict_run="00000000-0000-4000-8000-00000000a2f2"
      winner_command="00000000-0000-4000-8000-00000000c2f2"
      loser_command="00000000-0000-4000-8000-00000000c2f3"
      loser_event="00000000-0000-4000-8000-00000000e2f3"
      loser_outbox="00000000-0000-4000-8000-00000000b2f3"
      loser_audit="00000000-0000-4000-8000-00000000d2f3"
      conflict_barrier=45454545
      ;;
    backend)
      conflict_run="00000000-0000-4000-8000-00000000a2f4"
      winner_command="00000000-0000-4000-8000-00000000c2f4"
      loser_command="00000000-0000-4000-8000-00000000c2f5"
      loser_event="00000000-0000-4000-8000-00000000e2f5"
      loser_outbox="00000000-0000-4000-8000-00000000b2f5"
      loser_audit="00000000-0000-4000-8000-00000000d2f5"
      conflict_barrier=46464646
      ;;
    *)
      echo "Unknown Browser conflict probe mode: $conflict_mode" >&2
      exit 1
      ;;
  esac
  winner_key="runtime-u4-browser-${conflict_mode}-winner"
  loser_key="runtime-u4-browser-${conflict_mode}-loser"

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      begin;
      set local role authenticated;
      set local request.jwt.claims =
        '{\"sub\":\"$conflict_principal\"}';
      select api.data_agent__accept_run_command(
        '$conflict_deployment'::uuid,
        '$conflict_tenant'::uuid,
        '$conflict_run'::uuid,
        '$winner_command'::uuid,
        '$winner_key',
        'U4 Browser shared Run lock winner',
        '{\"kind\":\"START_L2_RESEARCH\"}'::jsonb,
        'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
      );
      select pg_catalog.pg_advisory_xact_lock($conflict_barrier);
      select pg_catalog.pg_sleep(3);
      commit;
    " \
    >/dev/null &
  conflict_holder_pid=$!

  conflict_barrier_ready=0
  conflict_poll=0
  while [ "$conflict_poll" -lt 50 ]; do
    conflict_lock_count=$(
      docker exec "$container_name" \
        psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
        -c "select pg_catalog.count(*) from pg_catalog.pg_locks where locktype = 'advisory' and granted and classid = 0 and objid = $conflict_barrier;"
    )
    if [ "$conflict_lock_count" = "1" ]; then
      conflict_barrier_ready=1
      break
    fi
    conflict_poll=$((conflict_poll + 1))
    sleep 0.1
  done
  if [ "$conflict_barrier_ready" -ne 1 ]; then
    wait "$conflict_holder_pid" || true
    echo "Browser $conflict_mode conflict probe did not reach its barrier." >&2
    exit 1
  fi

  if [ "$conflict_mode" = "browser" ]; then
    conflict_loser_command="
      begin;
      set local role authenticated;
      set local request.jwt.claims =
        '{\"sub\":\"$conflict_principal\"}';
      select api.data_agent__accept_run_command(
        '$conflict_deployment'::uuid,
        '$conflict_tenant'::uuid,
        '$conflict_run'::uuid,
        '$loser_command'::uuid,
        '$loser_key',
        'U4 Browser shared Run lock loser',
        '{\"kind\":\"START_L2_RESEARCH\"}'::jsonb,
        'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
      );
      commit;
    "
  else
    conflict_loser_command="
      begin;
      set local role data_agent_backend;
      set local data_agent.app_id = '$conflict_app';
      set local data_agent.tenant_id = '$conflict_tenant';
      set local data_agent.environment = 'test';
      set local data_agent.principal_id = '$conflict_principal';
      set local data_agent.role = 'owner';
      set local data_agent.deployment_id = '$conflict_deployment';
      select test_support.accept_backend_start_run(
        '$conflict_run'::uuid,
        '$loser_command'::uuid,
        '$loser_event'::uuid,
        '$loser_outbox'::uuid,
        '$loser_audit'::uuid,
        '$loser_key',
        'U4 backend shared Run lock loser'
      );
      commit;
    "
  fi

  if conflict_loser_output=$(
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "$conflict_loser_command" 2>&1
  ); then
    wait "$conflict_holder_pid" || true
    echo "Browser $conflict_mode conflict probe allowed two writers." >&2
    exit 1
  fi
  wait "$conflict_holder_pid"

  case "$conflict_loser_output" in
    *DA_RUN_ALREADY_EXISTS*) ;;
    *)
      echo "Browser $conflict_mode conflict loser lacked DA_RUN_ALREADY_EXISTS." >&2
      echo "$conflict_loser_output" >&2
      exit 1
      ;;
  esac

  conflict_state=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        select
          (
            select pg_catalog.count(*)
            from app_data_agent.runs
            where run_id = '$conflict_run'::uuid
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.commands
            where run_id = '$conflict_run'::uuid
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.run_events
            where run_id = '$conflict_run'::uuid
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.outbox
            where run_id = '$conflict_run'::uuid
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.audit_log
            where resource_id in (
              '$conflict_run',
              '$winner_command',
              '$loser_command'
            )
          ) || ':' ||
          (
            (
              select pg_catalog.count(*)
              from app_data_agent.commands
              where command_id = '$loser_command'::uuid
            ) +
            (
              select pg_catalog.count(*)
              from app_data_agent.idempotency_records
              where idempotency_key = '$loser_key'
            ) +
            (
              select pg_catalog.count(*)
              from app_data_agent.run_events
              where event_id = '$loser_event'::uuid
            ) +
            (
              select pg_catalog.count(*)
              from app_data_agent.outbox
              where outbox_id = '$loser_outbox'::uuid
            ) +
            (
              select pg_catalog.count(*)
              from app_data_agent.audit_log
              where audit_id = '$loser_audit'::uuid
            )
          );
      "
  )
  if [ "$conflict_state" != "1:1:1:1:2:0" ]; then
    echo "Browser $conflict_mode conflict left partial state: $conflict_state" >&2
    exit 1
  fi
}

run_locked_fifo_probe() {
  fifo_app="00000000-0000-4000-8000-00000000da01"
  fifo_tenant="00000000-0000-4000-8000-00000000aa22"
  fifo_deployment="00000000-0000-4000-8000-00000000de01"
  fifo_principal="00000000-0000-4000-8000-000000001003"
  fifo_run_a="00000000-0000-4000-8000-00000000a2c0"
  fifo_run_b="00000000-0000-4000-8000-00000000a2d0"
  fifo_head="00000000-0000-4000-8000-00000000b2c0"
  fifo_follower="00000000-0000-4000-8000-00000000b2c1"
  fifo_other="00000000-0000-4000-8000-00000000b2d0"
  fifo_barrier=42424242

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      insert into app_data_agent.runs (
        app_id,
        tenant_id,
        environment,
        run_id,
        principal_id,
        question,
        next_queue_sequence
      )
      values
        (
          '$fifo_app',
          '$fifo_tenant',
          'test',
          '$fifo_run_a',
          '$fifo_principal',
          'locked FIFO run A',
          3
        ),
        (
          '$fifo_app',
          '$fifo_tenant',
          'test',
          '$fifo_run_b',
          '$fifo_principal',
          'locked FIFO run B',
          2
        );
      with fixture(command_id, run_id, idempotency_key, payload_json) as (
        values
          (
            '00000000-0000-4000-8000-00000000c2c0'::uuid,
            '$fifo_run_a'::uuid,
            'locked-fifo-head',
            '{\"kind\":\"START_L2_RESEARCH\",\"mode\":\"L2\"}'::jsonb
          ),
          (
            '00000000-0000-4000-8000-00000000c2c1'::uuid,
            '$fifo_run_a'::uuid,
            'locked-fifo-follower',
            '{\"kind\":\"START_L2_RESEARCH\",\"mode\":\"L2\"}'::jsonb
          ),
          (
            '00000000-0000-4000-8000-00000000c2d0'::uuid,
            '$fifo_run_b'::uuid,
            'locked-fifo-other',
            '{\"kind\":\"START_L2_RESEARCH\",\"mode\":\"L2\"}'::jsonb
          )
      )
      insert into app_data_agent.commands (
        app_id,
        tenant_id,
        environment,
        command_id,
        run_id,
        principal_id,
        idempotency_key,
        payload_json,
        payload_hash
      )
      select
        '$fifo_app',
        '$fifo_tenant',
        'test',
        fixture.command_id,
        fixture.run_id,
        '$fifo_principal',
        fixture.idempotency_key,
        fixture.payload_json,
        platform.canonical_sha256(fixture.payload_json)
      from fixture;
      insert into app_data_agent.outbox (
        app_id,
        tenant_id,
        environment,
        outbox_id,
        run_id,
        command_id,
        topic,
        payload_json,
        available_at,
        queue_sequence
      )
      values
        (
          '$fifo_app',
          '$fifo_tenant',
          'test',
          '$fifo_head',
          '$fifo_run_a',
          '00000000-0000-4000-8000-00000000c2c0',
          'run.command.accepted',
          '{\"fixture\":\"locked-head\"}',
          '2000-01-01T00:00:00Z',
          1
        ),
        (
          '$fifo_app',
          '$fifo_tenant',
          'test',
          '$fifo_follower',
          '$fifo_run_a',
          '00000000-0000-4000-8000-00000000c2c1',
          'run.command.accepted',
          '{\"fixture\":\"locked-follower\"}',
          '2000-01-01T00:00:01Z',
          2
        ),
        (
          '$fifo_app',
          '$fifo_tenant',
          'test',
          '$fifo_other',
          '$fifo_run_b',
          '00000000-0000-4000-8000-00000000c2d0',
          'run.command.accepted',
          '{\"fixture\":\"locked-other\"}',
          '2000-01-01T00:00:02Z',
          1
        );
    " \
    >/dev/null

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "begin; set local role data_agent_backend; select pg_catalog.set_config('data_agent.app_id', '$fifo_app', true); select pg_catalog.set_config('data_agent.tenant_id', '$fifo_tenant', true); select pg_catalog.set_config('data_agent.environment', 'test', true); select pg_catalog.set_config('data_agent.principal_id', '$fifo_principal', true); select pg_catalog.set_config('data_agent.role', 'owner', true); select pg_catalog.set_config('data_agent.deployment_id', '$fifo_deployment', true); select * from app_data_agent.claim_run_work('runtime-locked-fifo-a', 1, 30); select pg_catalog.pg_advisory_xact_lock($fifo_barrier); select pg_catalog.pg_sleep(3); commit;" \
    >/dev/null &
  fifo_holder_pid=$!

  fifo_barrier_ready=0
  fifo_poll=0
  while [ "$fifo_poll" -lt 50 ]; do
    fifo_lock_count=$(
      docker exec "$container_name" \
        psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
        -c "select pg_catalog.count(*) from pg_catalog.pg_locks where locktype = 'advisory' and granted and classid = 0 and objid = $fifo_barrier;"
    )
    if [ "$fifo_lock_count" = "1" ]; then
      fifo_barrier_ready=1
      break
    fi
    fifo_poll=$((fifo_poll + 1))
    sleep 0.1
  done
  if [ "$fifo_barrier_ready" -ne 1 ]; then
    wait "$fifo_holder_pid" || true
    echo "Locked FIFO probe did not reach the post-claim barrier." >&2
    exit 1
  fi

  if ! docker exec --env PGOPTIONS="-c statement_timeout=1000" \
    "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "begin; set local role data_agent_backend; select pg_catalog.set_config('data_agent.app_id', '$fifo_app', true); select pg_catalog.set_config('data_agent.tenant_id', '$fifo_tenant', true); select pg_catalog.set_config('data_agent.environment', 'test', true); select pg_catalog.set_config('data_agent.principal_id', '$fifo_principal', true); select pg_catalog.set_config('data_agent.role', 'owner', true); select pg_catalog.set_config('data_agent.deployment_id', '$fifo_deployment', true); select * from app_data_agent.claim_run_work('runtime-locked-fifo-b', 1, 30); commit;" \
    >/dev/null; then
    wait "$fifo_holder_pid" || true
    echo "Locked FIFO probe blocked instead of leasing another Run." >&2
    exit 1
  fi
  wait "$fifo_holder_pid"

  fifo_state=$(
    docker exec "$container_name" \
      psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "select (select pg_catalog.count(*) from app_data_agent.run_attempts where run_id in ('$fifo_run_a'::uuid, '$fifo_run_b'::uuid)) || ':' || (select attempt_count from app_data_agent.outbox where outbox_id = '$fifo_head'::uuid) || ':' || (select attempt_count from app_data_agent.outbox where outbox_id = '$fifo_follower'::uuid) || ':' || (select attempt_count from app_data_agent.outbox where outbox_id = '$fifo_other'::uuid) || ':' || (select pg_catalog.max(queue_sequence) - pg_catalog.min(queue_sequence) from app_data_agent.outbox where run_id = '$fifo_run_a'::uuid);"
  )
  if [ "$fifo_state" != "2:1:0:1:1" ]; then
    echo "Locked FIFO probe exposed a same-Run follower: $fifo_state" >&2
    exit 1
  fi
}

run_concurrent_resume_probe() {
  resume_app="00000000-0000-4000-8000-00000000da01"
  resume_tenant="00000000-0000-4000-8000-00000000aa11"
  resume_deployment="00000000-0000-4000-8000-00000000de01"
  resume_principal="00000000-0000-4000-8000-000000001001"
  resume_barrier=43434343

  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    -c "
      begin;
      set local role data_agent_backend;
      set local data_agent.app_id = '$resume_app';
      set local data_agent.tenant_id = '$resume_tenant';
      set local data_agent.environment = 'test';
      set local data_agent.principal_id = '$resume_principal';
      set local data_agent.role = 'owner';
      set local data_agent.deployment_id = '$resume_deployment';
      select test_support.concurrent_resume_request(
        '00000000-0000-4000-8000-00000000c2e1',
        '00000000-0000-4000-8000-00000000e2e1',
        '00000000-0000-4000-8000-00000000b2e1',
        '00000000-0000-4000-8000-00000000d2e1',
        'runtime-u4-concurrent-resume-a'
      );
      select pg_catalog.pg_advisory_xact_lock($resume_barrier);
      select pg_catalog.pg_sleep(3);
      commit;
    " \
    >/dev/null &
  resume_holder_pid=$!

  resume_barrier_ready=0
  resume_poll=0
  while [ "$resume_poll" -lt 50 ]; do
    resume_lock_count=$(
      docker exec "$container_name" \
        psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
        -c "select pg_catalog.count(*) from pg_catalog.pg_locks where locktype = 'advisory' and granted and classid = 0 and objid = $resume_barrier;"
    )
    if [ "$resume_lock_count" = "1" ]; then
      resume_barrier_ready=1
      break
    fi
    resume_poll=$((resume_poll + 1))
    sleep 0.1
  done
  if [ "$resume_barrier_ready" -ne 1 ]; then
    wait "$resume_holder_pid" || true
    echo "Concurrent Resume probe did not reach its post-commit barrier." >&2
    exit 1
  fi

  if resume_loser_output=$(
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        begin;
        set local role data_agent_backend;
        set local data_agent.app_id = '$resume_app';
        set local data_agent.tenant_id = '$resume_tenant';
        set local data_agent.environment = 'test';
        set local data_agent.principal_id = '$resume_principal';
        set local data_agent.role = 'owner';
        set local data_agent.deployment_id = '$resume_deployment';
        select test_support.concurrent_resume_request(
          '00000000-0000-4000-8000-00000000c2e2',
          '00000000-0000-4000-8000-00000000e2e2',
          '00000000-0000-4000-8000-00000000b2e2',
          '00000000-0000-4000-8000-00000000d2e2',
          'runtime-u4-concurrent-resume-b'
        );
        commit;
      " 2>&1
  ); then
    wait "$resume_holder_pid" || true
    echo "Concurrent Resume probe allowed two writers to commit." >&2
    exit 1
  fi
  wait "$resume_holder_pid"

  case "$resume_loser_output" in
    *DA_RUN_CONTROL_PROJECTION_CONFLICT*) ;;
    *)
      echo "Concurrent Resume loser failed for an unexpected reason." >&2
      echo "$resume_loser_output" >&2
      exit 1
      ;;
  esac

  resume_replay=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        begin;
        set local role data_agent_backend;
        set local data_agent.app_id = '$resume_app';
        set local data_agent.tenant_id = '$resume_tenant';
        set local data_agent.environment = 'test';
        set local data_agent.principal_id = '$resume_principal';
        set local data_agent.role = 'owner';
        set local data_agent.deployment_id = '$resume_deployment';
        select replay.result ->> 'replayed'
        from (
          select test_support.concurrent_resume_request(
            '00000000-0000-4000-8000-00000000c2e1',
            '00000000-0000-4000-8000-00000000e2e1',
            '00000000-0000-4000-8000-00000000b2e1',
            '00000000-0000-4000-8000-00000000d2e1',
            'runtime-u4-concurrent-resume-a'
          ) as result
        ) as replay;
        commit;
      "
  )
  if [ "$resume_replay" != "true" ]; then
    echo "Concurrent Resume winner did not replay idempotently: $resume_replay" >&2
    exit 1
  fi

  resume_state=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        select
          run.next_queue_sequence || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.outbox as message
            where message.run_id = run.run_id
          ) || ':' ||
          (
            select pg_catalog.min(message.queue_sequence)
            from app_data_agent.outbox as message
            where message.run_id = run.run_id
          ) || ':' ||
          (
            select pg_catalog.max(message.queue_sequence)
            from app_data_agent.outbox as message
            where message.run_id = run.run_id
          ) || ':' ||
          (
            select pg_catalog.count(*)
            from app_data_agent.commands as command
            where command.command_id =
              '00000000-0000-4000-8000-00000000c2e2'::uuid
          ) || ':' ||
          (
            select pg_catalog.max(projection.version)
            from app_data_agent.run_projections as projection
            where projection.run_id = run.run_id
          )
        from app_data_agent.runs as run
        where run.run_id =
          '00000000-0000-4000-8000-00000000a2e0'::uuid;
      "
  )
  if [ "$resume_state" != "3:2:1:2:0:2" ]; then
    echo "Concurrent Resume changed Counter or left partial rows: $resume_state" >&2
    exit 1
  fi
}

run_future_event_acceptance_probe() {
  docker exec -i "$container_name" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
    >/dev/null <<'SQL'
begin;
set local role data_agent_backend;
set local data_agent.app_id = '00000000-0000-4000-8000-00000000da01';
set local data_agent.tenant_id = '00000000-0000-4000-8000-00000000aa22';
set local data_agent.environment = 'test';
set local data_agent.principal_id = '00000000-0000-4000-8000-000000001003';
set local data_agent.role = 'owner';
set local data_agent.deployment_id = '00000000-0000-4000-8000-00000000de01';
do $probe$
declare
  requested_payload jsonb;
  requested_payload_hash text;
  requested_command jsonb;
  requested_event jsonb;
begin
  requested_payload := '{"kind":"RESUME_RUN"}'::jsonb;
  requested_payload_hash := platform.canonical_sha256(requested_payload);
  requested_command := pg_catalog.jsonb_build_object(
    'run_id', '00000000-0000-4000-8000-00000000a2f7'::uuid,
    'command_id', '00000000-0000-4000-8000-00000000c2f7'::uuid,
    'event_id', '00000000-0000-4000-8000-00000000e2f7'::uuid,
    'outbox_id', '00000000-0000-4000-8000-00000000b2f7'::uuid,
    'audit_id', '00000000-0000-4000-8000-00000000d2f7'::uuid,
    'idempotency_key', 'runtime-u4-reject-backend-resume-initial',
    'question', 'unsupported initial backend command',
    'payload', requested_payload
  );
  requested_event := pg_catalog.jsonb_build_object(
    'schema_version', '1.0.0',
    'event_id', '00000000-0000-4000-8000-00000000e2f7'::uuid,
    'scope', pg_catalog.jsonb_build_object(
      'app_id', pg_catalog.current_setting('data_agent.app_id'),
      'tenant_id', pg_catalog.current_setting('data_agent.tenant_id'),
      'environment', pg_catalog.current_setting('data_agent.environment')
    ),
    'run_id', '00000000-0000-4000-8000-00000000a2f7'::uuid,
    'sequence', 1,
    'worker_fence', 0,
    'idempotency_key',
      'event:00000000-0000-4000-8000-00000000e2f7',
    'occurred_at',
      app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
    'event_type', 'run.accepted',
    'payload', pg_catalog.jsonb_build_object(
      'command_id', '00000000-0000-4000-8000-00000000c2f7'::uuid,
      'payload_hash', requested_payload_hash
    )
  );
  begin
    perform app_data_agent.accept_backend_run_command(
      requested_command,
      requested_payload_hash,
      requested_event,
      app_data_agent.runtime_canonical_sha256(requested_event)
    );
    raise exception 'U4_UNSUPPORTED_INITIAL_KIND_WAS_ACCEPTED';
  exception
    when others then
      if SQLERRM <> 'DA_COMMAND_ACCEPTANCE_INPUT_INVALID' then
        raise;
      end if;
  end;

  requested_payload :=
    '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb;
  requested_payload_hash := platform.canonical_sha256(requested_payload);
  requested_command := pg_catalog.jsonb_build_object(
    'run_id', '00000000-0000-4000-8000-00000000a2f6'::uuid,
    'command_id', '00000000-0000-4000-8000-00000000c2f6'::uuid,
    'event_id', '00000000-0000-4000-8000-00000000e2f6'::uuid,
    'outbox_id', '00000000-0000-4000-8000-00000000b2f6'::uuid,
    'audit_id', '00000000-0000-4000-8000-00000000d2f6'::uuid,
    'idempotency_key', 'runtime-u4-future-event',
    'question', 'future occurred_at must not delay work',
    'payload', requested_payload
  );
  requested_event := pg_catalog.jsonb_build_object(
    'schema_version', '1.0.0',
    'event_id', '00000000-0000-4000-8000-00000000e2f6'::uuid,
    'scope', pg_catalog.jsonb_build_object(
      'app_id', pg_catalog.current_setting('data_agent.app_id'),
      'tenant_id', pg_catalog.current_setting('data_agent.tenant_id'),
      'environment', pg_catalog.current_setting('data_agent.environment')
    ),
    'run_id', '00000000-0000-4000-8000-00000000a2f6'::uuid,
    'sequence', 1,
    'worker_fence', 0,
    'idempotency_key',
      'event:00000000-0000-4000-8000-00000000e2f6',
    'occurred_at',
      app_data_agent.runtime_iso_timestamp(
        pg_catalog.clock_timestamp() + interval '1 day'
      ),
    'event_type', 'run.accepted',
    'payload', pg_catalog.jsonb_build_object(
      'command_id', '00000000-0000-4000-8000-00000000c2f6'::uuid,
      'payload_hash', requested_payload_hash
    )
  );
  perform app_data_agent.accept_backend_run_command(
    requested_command,
    requested_payload_hash,
    requested_event,
    app_data_agent.runtime_canonical_sha256(requested_event)
  );
end
$probe$;
commit;
SQL

  future_metadata_state=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        select (
          run.created_at = run.updated_at
          and run.created_at = command.created_at
          and run.created_at = record.created_at
          and run.created_at = message.available_at
          and run.created_at = message.created_at
          and run.created_at = audit.created_at
          and event.created_at
            > run.created_at + pg_catalog.make_interval(hours => 23)
          and run.created_at
            < pg_catalog.clock_timestamp()
              + pg_catalog.make_interval(mins => 1)
          and not exists (
            select 1
            from app_data_agent.runs
            where run_id =
              '00000000-0000-4000-8000-00000000a2f7'::uuid
          )
          and not exists (
            select 1
            from app_data_agent.commands
            where command_id =
              '00000000-0000-4000-8000-00000000c2f7'::uuid
          )
          and not exists (
            select 1
            from app_data_agent.idempotency_records
            where idempotency_key =
              'runtime-u4-reject-backend-resume-initial'
          )
          and not exists (
            select 1
            from app_data_agent.run_events
            where event_id =
              '00000000-0000-4000-8000-00000000e2f7'::uuid
          )
          and not exists (
            select 1
            from app_data_agent.outbox
            where outbox_id =
              '00000000-0000-4000-8000-00000000b2f7'::uuid
          )
          and not exists (
            select 1
            from app_data_agent.audit_log
            where audit_id =
              '00000000-0000-4000-8000-00000000d2f7'::uuid
          )
        )::text
        from app_data_agent.runs as run
        join app_data_agent.commands as command
          on command.run_id = run.run_id
        join app_data_agent.idempotency_records as record
          on record.command_id = command.command_id
        join app_data_agent.run_events as event
          on event.run_id = run.run_id
        join app_data_agent.outbox as message
          on message.run_id = run.run_id
        join app_data_agent.audit_log as audit
          on audit.resource_id = run.run_id::text
         and audit.action = 'RUN_COMMAND_ACCEPTED'
        where run.run_id =
          '00000000-0000-4000-8000-00000000a2f6'::uuid;
      "
  )
  if [ "$future_metadata_state" != "true" ]; then
    echo "Future Event acceptance did not preserve DB accept_at metadata: $future_metadata_state" >&2
    exit 1
  fi

  future_claim_count=$(
    docker exec "$container_name" \
      psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
      -c "
        begin;
        set local role data_agent_backend;
        set local data_agent.app_id =
          '00000000-0000-4000-8000-00000000da01';
        set local data_agent.tenant_id =
          '00000000-0000-4000-8000-00000000aa22';
        set local data_agent.environment = 'test';
        set local data_agent.principal_id =
          '00000000-0000-4000-8000-000000001003';
        set local data_agent.role = 'owner';
        set local data_agent.deployment_id =
          '00000000-0000-4000-8000-00000000de01';
        select pg_catalog.count(*)
        from app_data_agent.claim_run_work(
          'runtime-u4-future-clock-worker',
          100,
          30
        ) as lease
        where lease.run_id =
          '00000000-0000-4000-8000-00000000a2f6'::uuid;
        commit;
      "
  )
  if [ "$future_claim_count" != "1" ]; then
    echo "Future Event occurred_at delayed an otherwise ready Run: $future_claim_count" >&2
    exit 1
  fi
}

operations_release_fingerprint() {
  target_database=$1
  docker exec "$container_name" \
    psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "$target_database" \
    -c "
      select 'migration_ledger=' || pg_catalog.count(*) || ':' ||
        pg_catalog.md5(pg_catalog.string_agg(
          owner_kind || ':' || coalesce(app_id::text, '-') || ':' ||
          migration_version || ':' || migration_checksum,
          '|' order by owner_kind, app_id, migration_version
        ))
      from platform.migration_ledger
      union all
      select 'identity=' ||
        (select pg_catalog.count(*) from app_data_agent.app_users) || ':' ||
        (select pg_catalog.count(*) from app_data_agent.workspaces) || ':' ||
        (select pg_catalog.count(*) from app_data_agent.memberships) || ':' ||
        (select pg_catalog.count(*) from app_data_agent.identity_operation_receipts)
      union all
      select 'model_control=' ||
        (select pg_catalog.count(*) from app_data_agent.model_control_operations) || ':' ||
        (select pg_catalog.count(*) from app_data_agent.model_control_audit_log)
      union all
      select 'commercial_archive=' || pg_catalog.md5(relation_snapshots::text)
      from app_data_agent.commercial_archive_retirement_receipts;
    "
}

run_operations_release_drill() {
  restore_database="${database_name}_operations_restore"
  backup_path="/tmp/data-agent-operations-release.dump"
  source_fingerprint=$(operations_release_fingerprint "$database_name")

  docker exec "$container_name" \
    pg_dump -U postgres -d "$database_name" -F c -f "$backup_path"
  docker exec "$container_name" \
    createdb -U postgres "$restore_database"
  docker exec "$container_name" \
    pg_restore -U postgres -d "$restore_database" --exit-on-error --no-owner "$backup_path"

  restored_fingerprint=$(operations_release_fingerprint "$restore_database")
  if [ "$source_fingerprint" != "$restored_fingerprint" ]; then
    echo "Backup/restore changed authority state." >&2
    echo "source: $source_fingerprint" >&2
    echo "restored: $restored_fingerprint" >&2
    exit 1
  fi

  echo "Operations release drill passed: clean install and backup/restore."
}

run_reset_only_guard_probe
run_runtime_prefix_fail_closed_probe

apply_sql "$script_dir/00-bootstrap-stubs.sql"
for sql_file in $(find "$infra_dir/platform/migrations" -type f -name '*.sql' | sort); do
  apply_sql "$sql_file"
done
for sql_file in $(find "$infra_dir/apps/data-agent/migrations" -type f -name '*.sql' | sort); do
  case "$(basename "$sql_file")" in
    20260725010590_app_data_agent_u6_research_authority.sql)
      prepare_u6_maintenance_binding
      "$script_dir/run-u6-maintenance-migration.sh" \
        "$container_name" \
        "$database_name" \
        "$sql_file" \
        "00000000-0000-4000-8000-00000000de90"
      ;;
    20260725010600_app_data_agent_u6_research_derivation.sql)
      prepare_local_maintenance_binding
      apply_sql_with_prelude \
        "$infra_dir/apps/data-agent/migration-support/10600-local-maintenance-prelude.sql" \
        "$sql_file"
      ;;
    20260725010610_app_data_agent_semantic_control_plane.sql)
      apply_sql_with_prelude \
        "$infra_dir/apps/data-agent/migration-support/10610-local-maintenance-prelude.sql" \
        "$sql_file"
      ;;
    20260725010703_app_data_agent_commercial_archive_retirement.sql)
      prepare_commercial_archive_history_probe
      apply_sql "$sql_file"
      verify_commercial_archive_history_probe
      ;;
    20260725010775_app_data_agent_falcon24_e1_authority.sql)
      run_falcon24_e1_legacy_state_guard_probe "$sql_file"
      apply_sql "$sql_file"
      ;;
    *)
      apply_sql "$sql_file"
      ;;
  esac
done
run_falcon24_e1_unactivated_probe
run_falcon24_e1_activation_run_race_probe
apply_sql "$script_dir/10-fixtures.sql"
apply_sql "$script_dir/28-schema-discovery-authority-assertions.sql"

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

for assertion_file in $(find "$script_dir" -type f -name '*-assertions.sql' | sort); do
  if [ -n "$assertion_filter" ] && [ "$(basename "$assertion_file")" != "$assertion_filter" ]; then
    continue
  fi
  case "$(basename "$assertion_file")" in
    28-schema-discovery-authority-assertions.sql)
      continue
      ;;
    29-semantic-explorer-authority-assertions.sql|30-semantic-relationship-index-authority-assertions.sql)
      # These consume the candidate/release state created by the dedicated
      # semantic M0 runner and are verified there.
      continue
      ;;
    54-falcon24-acceptance-campaign-assertions.sql|55-falcon24-qualification-assertions.sql)
      # The E1 reset deliberately makes the former versioned campaign and
      # qualification identities unrepresentable. Assertion 59 exercises the
      # replacement exact E1-Q1/E1-C1 authority and immutable-attempt contract.
      continue
      ;;
  esac
  apply_sql "$assertion_file"
  case "$assertion_file" in
    *"/19zzzzz-operations-admin-assertions.sql")
      run_operations_release_drill
      ;;
    *"/25-secret-lifecycle-assertions.sql")
      run_concurrent_claim_probe
      run_concurrent_accept_probe
      run_browser_run_conflict_probe browser
      run_browser_run_conflict_probe backend
      run_locked_fifo_probe
      run_future_event_acceptance_probe
      ;;
    *"/25z-runtime-concurrent-resume-setup-assertions.sql")
      run_concurrent_resume_probe
      ;;
  esac
done

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
