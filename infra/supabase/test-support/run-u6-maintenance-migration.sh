#!/bin/sh
set -eu

if [ "$#" -lt 4 ] || [ "$#" -gt 5 ]; then
  echo "usage: $0 <container> <database> <migration.sql> <deployment-id> [database-user]" >&2
  exit 2
fi

container_name=$1
database_name=$2
migration_file=$3
deployment_id=$4
database_user=${5:-postgres}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
app_infra_dir=$(CDPATH= cd -- "$script_dir/../apps/data-agent" && pwd)
manifest_file="$app_infra_dir/u6-migration-maintenance-manifest.json"
expected_migration_name="20260725010590_app_data_agent_u6_research_authority.sql"
expected_migration_version=${expected_migration_name%.sql}
canonical_migration_file="$app_infra_dir/migrations/$expected_migration_name"

if [ "$(basename "$migration_file")" != "$expected_migration_name" ]; then
  echo "U6 maintenance runner only accepts $expected_migration_name" >&2
  exit 2
fi
canonical_migration_path=$(
  node -e '
    process.stdout.write(require("node:fs").realpathSync(process.argv[1]));
  ' "$canonical_migration_file"
)
requested_migration_path=$(
  node -e '
    process.stdout.write(require("node:fs").realpathSync(process.argv[1]));
  ' "$migration_file"
)
if [ "$requested_migration_path" != "$canonical_migration_path" ]; then
  echo "U6 maintenance runner only accepts the canonical generated migration." >&2
  exit 2
fi
if ! printf '%s' "$deployment_id" \
  | rg -q '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'; then
  echo "U6 maintenance deployment id is not a canonical UUID." >&2
  exit 2
fi

pnpm --dir "$repo_dir" exec tsx scripts/render-u6-migration.ts --verify

snapshot_dir=$(mktemp -d "${TMPDIR:-/tmp}/data-agent-u6-migration.XXXXXX")
snapshot_file="$snapshot_dir/$expected_migration_name"
snapshot_manifest_file="$snapshot_dir/u6-migration-maintenance-manifest.json"
execution_file="$snapshot_dir/u6-maintenance-session.sql"
cleanup_snapshot() {
  rm -f "$snapshot_file" "$snapshot_manifest_file" "$execution_file"
  rmdir "$snapshot_dir" 2>/dev/null || true
}
trap cleanup_snapshot 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

chmod 700 "$snapshot_dir"
cp "$canonical_migration_path" "$snapshot_file"
cp "$manifest_file" "$snapshot_manifest_file"
chmod 400 "$snapshot_file" "$snapshot_manifest_file"
manifest_values=$(
  pnpm --dir "$repo_dir" exec tsx scripts/render-u6-migration.ts \
    --verify-migration-snapshot "$snapshot_file" \
    --maintenance-manifest-snapshot "$snapshot_manifest_file" \
    --print-maintenance-session-values
)
migration_file=$snapshot_file

tab=$(printf '\t')
saved_ifs=$IFS
IFS=$tab
read -r \
  manifest_hash \
  manifest_app_id \
  window_id \
  max_duration_ms \
  lock_timeout_ms \
  statement_timeout_ms \
  idle_timeout_ms <<EOF
$manifest_values
EOF
IFS=$saved_ifs

is_canonical_uuid() {
  printf '%s' "$1" \
    | rg -q '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
}

if ! printf '%s' "$manifest_hash" | rg -q '^sha256:[0-9a-f]{64}$'; then
  echo "U6 maintenance manifest hash is invalid." >&2
  exit 2
fi
if ! is_canonical_uuid "$manifest_app_id" || ! is_canonical_uuid "$window_id"; then
  echo "U6 maintenance manifest contains a non-canonical UUID." >&2
  exit 2
fi
for numeric_value in \
  "$max_duration_ms" \
  "$lock_timeout_ms" \
  "$statement_timeout_ms" \
  "$idle_timeout_ms"; do
  case "$numeric_value" in
    ''|*[!0-9]*)
      echo "U6 maintenance manifest contains a non-numeric timeout." >&2
      exit 2
      ;;
  esac
done

declared_checksum=$(
  sed -n 's/^-- u6_migration_checksum: \(sha256:[0-9a-f]\{64\}\)$/\1/p' \
    "$migration_file"
)
declared_count=$(
  sed -n 's/^-- u6_migration_checksum: \(sha256:[0-9a-f]\{64\}\)$/\1/p' \
    "$migration_file" \
    | wc -l \
    | tr -d ' '
)
if [ "$declared_count" -ne 1 ]; then
  echo "U6 migration must contain exactly one checksum marker." >&2
  exit 1
fi

read_ledger_state() {
  docker exec "$container_name" \
    psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$database_user" -d "$database_name" \
    -c "
      select
        pg_catalog.count(*)::text || ':' ||
        coalesce(pg_catalog.min(ledger.migration_checksum), '')
      from platform.migration_ledger as ledger
      where ledger.owner_kind = 'app'
        and ledger.app_id = '$manifest_app_id'::uuid
        and ledger.migration_version = '$expected_migration_version';
    "
}

ledger_state=$(read_ledger_state)
case "$ledger_state" in
  "0:")
    ;;
  "1:$declared_checksum")
    echo "Skipping already applied U6 migration with matching checksum."
    exit 0
    ;;
  1:*)
    echo "U6 migration ledger contains the same name with a different checksum." >&2
    echo "ledger=$ledger_state migration=$declared_checksum" >&2
    exit 1
    ;;
  *)
    echo "U6 migration ledger is not a unique authority row: $ledger_state" >&2
    exit 1
    ;;
esac

prelude_sql="
set session transaction_timeout = 0;
select pg_catalog.set_config(
  'lock_timeout',
  '${lock_timeout_ms}ms',
  false
);
select pg_catalog.set_config(
  'statement_timeout',
  '${statement_timeout_ms}ms',
  false
);
select pg_catalog.set_config(
  'idle_in_transaction_session_timeout',
  '${idle_timeout_ms}ms',
  false
);
select pg_catalog.set_config(
  'app.u6_maintenance_manifest_hash',
  '${manifest_hash}',
  false
);
select pg_catalog.set_config(
  'app.u6_maintenance_window_id',
  '${window_id}',
  false
);
select pg_catalog.set_config(
  'app.u6_maintenance_deployment_id',
  '${deployment_id}',
  false
);
select pg_catalog.set_config(
  'app.u6_maintenance_window_expires_at',
  (
    pg_catalog.clock_timestamp()
    + ${max_duration_ms}::bigint * interval '1 millisecond'
  )::text,
  false
);

do \$u6_runner\$
declare
  active_mapping_count bigint;
  expected_database_identity_hash text;
  remaining_ms bigint;
  arm_ms bigint;
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'U6_MIGRATION_EXECUTOR_UNSAFE';
  end if;

  select pg_catalog.count(*)
  into active_mapping_count
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  where deployment.deployment_id =
      pg_catalog.current_setting('app.u6_maintenance_deployment_id')::uuid
    and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and deployment.is_active
    and deployment.revoked_at is null
    and lifecycle.lifecycle_state = 'ACTIVE';
  if active_mapping_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_DEPLOYMENT_BINDING_INVALID';
  end if;

  expected_database_identity_hash :=
    'sha256:' || pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to('u6-migration-database@1.0.0', 'UTF8')
        || pg_catalog.decode('00', 'hex')
        || pg_catalog.convert_to(
          app_data_agent.runtime_canonical_json(
            pg_catalog.jsonb_build_array(
              pg_catalog.current_database(),
              '00000000-0000-4000-8000-00000000da01',
              pg_catalog.current_setting('app.u6_maintenance_deployment_id'),
              'sha256:28a47b75076c9248621af8dd9d0b16091693a2c44add6f3d0edad6bcff7d0ad4'
            )
          ),
          'UTF8'
        )
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
      pg_catalog.current_setting(
        'app.u6_maintenance_window_expires_at'
      )::timestamptz - pg_catalog.clock_timestamp()
    ) * 1000
  )::bigint;
  arm_ms := remaining_ms - 5000;
  if arm_ms < 30000 then
    raise exception using
      errcode = '57014',
      message = 'U6_MIGRATION_TRANSACTION_TIMEOUT';
  end if;
  perform pg_catalog.set_config(
    'app.u6_maintenance_session_arm_ms',
    arm_ms::text,
    false
  );
  perform pg_catalog.set_config('transaction_timeout', arm_ms::text || 'ms', false);

  if (
    select setting::bigint <> arm_ms
    from pg_catalog.pg_settings
    where name = 'transaction_timeout'
  ) then
    raise exception using
      errcode = '57014',
      message = 'U6_MIGRATION_TRANSACTION_TIMEOUT';
  end if;
end
\$u6_runner\$;
"

echo "Applying U6 maintenance migration ${expected_migration_name}"
printf '%s\n' "$prelude_sql" > "$execution_file"
sed -n 'p' "$migration_file" >> "$execution_file"
chmod 400 "$execution_file"
docker exec -i "$container_name" \
  psql -X -v ON_ERROR_STOP=1 \
  -U "$database_user" \
  -d "$database_name" \
  -f - < "$execution_file"

ledger_state=$(read_ledger_state)
if [ "$ledger_state" != "1:$declared_checksum" ]; then
  echo "U6 migration completed without the exact authoritative ledger row." >&2
  echo "ledger=$ledger_state migration=$declared_checksum" >&2
  exit 1
fi
