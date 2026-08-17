#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
infra_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$infra_dir/../.." && pwd)
migration_files=$(find "$infra_dir/platform/migrations" "$infra_dir/apps/data-agent/migrations" \
  -type f -name '*.sql' | sort)

if [ -z "$migration_files" ]; then
  echo "No Supabase migrations found." >&2
  exit 1
fi

pnpm --dir "$repo_dir" typecheck:u6-c2

pnpm --dir "$repo_dir" exec tsx --test \
  infra/supabase/test-support/render-u6-migration.test.ts \
  infra/supabase/test-support/render-u6-c2-migration.test.ts \
  infra/supabase/test-support/u6-c2-physical-schema.test.ts

u6_source_dir="$infra_dir/apps/data-agent/migration-sources/10590"
if [ -d "$u6_source_dir" ] \
  && rg -n '\bpg_catalog\.jsonb_object_length\b' "$u6_source_dir"; then
  echo "PostgreSQL does not provide pg_catalog.jsonb_object_length; use jsonb_object_keys count." >&2
  exit 1
fi

if rg -n -i '\bgrant[[:space:]]+all\b' $migration_files; then
  echo "GRANT ALL is forbidden in production migrations." >&2
  exit 1
fi

if rg -n -i 'create[[:space:]]+schema([[:space:]]+if[[:space:]]+not[[:space:]]+exists)?[[:space:]]+(auth|storage)\b' $migration_files; then
  echo "Production migrations must not create Supabase auth/storage system schemas." >&2
  exit 1
fi

for migration_file in $migration_files; do
  if ! awk '
    BEGIN {
      in_function_header = 0
      is_security_definer = 0
      has_empty_search_path = 0
      failed = 0
    }
    {
      normalized = tolower($0)
      if (normalized ~ /^[[:space:]]*create([[:space:]]+or[[:space:]]+replace)?[[:space:]]+function[[:space:]]/) {
        in_function_header = 1
        is_security_definer = 0
        has_empty_search_path = 0
        function_line = NR
      }
      if (in_function_header) {
        if (normalized ~ /security[[:space:]]+definer/) {
          is_security_definer = 1
        }
        if (normalized ~ /set[[:space:]]+search_path[[:space:]]*=[[:space:]]*'\'''\''/) {
          has_empty_search_path = 1
        }
        if (normalized ~ /^[[:space:]]*as[[:space:]]+\$[a-z0-9_]*\$[[:space:]]*$/) {
          if (is_security_definer && !has_empty_search_path) {
            printf("SECURITY DEFINER without empty search_path at %s:%d\n", FILENAME, function_line) > "/dev/stderr"
            failed = 1
          }
          in_function_header = 0
        }
      }
    }
    END {
      exit failed
    }
  ' "$migration_file"; then
    exit 1
  fi
done

zero_hash=$(printf '%064d' 0)
for migration_file in $migration_files; do
  u6_migration_kind=$(sh "$script_dir/assert-u6-migration-path.sh" "$infra_dir" "$migration_file")
  if [ "$u6_migration_kind" = "C1" ]; then
    pnpm --dir "$repo_dir" exec tsx scripts/render-u6-migration.ts --verify
    continue
  fi
  if [ "$u6_migration_kind" = "C2" ]; then
    pnpm --dir "$repo_dir" exec tsx scripts/render-u6-c2-migration.ts --verify-generated
    continue
  fi
  case "$(basename "$migration_file")" in
    20260725010609_*) renderer="scripts/render-10609-migration.ts" ;;
    20260725010610_*) renderer="scripts/render-semantic-migration.ts" ;;
    20260725010615_*) renderer="scripts/render-10615-migration.ts" ;;
    20260725010619_*) renderer="scripts/render-10619-migration.ts" ;;
    20260725010620_*) renderer="scripts/render-u20-migration.ts" ;;
    20260725010621_*) renderer="scripts/render-10621-migration.ts" ;;
    20260725010622_*) renderer="scripts/render-10622-migration.ts" ;;
    20260725010623_*) renderer="scripts/render-10623-migration.ts" ;;
    20260725010624_*) renderer="scripts/render-10624-migration.ts" ;;
    20260725010625_*) renderer="scripts/render-10625-migration.ts" ;;
    20260725010626_*) renderer="scripts/render-10626-migration.ts" ;;
    20260725010627_*) renderer="scripts/render-10627-migration.ts" ;;
    20260725010628_*) renderer="scripts/render-10628-migration.ts" ;;
    20260725010629_*) renderer="scripts/render-10629-migration.ts" ;;
    20260725010630_*) renderer="scripts/render-10630-migration.ts" ;;
    20260725010631_*) renderer="scripts/render-10631-migration.ts" ;;
    20260725010632_*) renderer="scripts/render-10632-migration.ts" ;;
    20260725010633_*) renderer="scripts/render-10633-migration.ts" ;;
    20260725010636_*) renderer="scripts/render-10636-migration.ts" ;;
    20260725010637_*) renderer="scripts/render-10637-migration.ts" ;;
    20260725010638_*) renderer="scripts/render-10638-migration.ts" ;;
    20260725010639_*) renderer="scripts/render-10639-migration.ts" ;;
    20260725010640_*) renderer="scripts/render-10640-migration.ts" ;;
    20260725010641_*) renderer="scripts/render-10641-migration.ts" ;;
    20260725010642_*) renderer="scripts/render-10642-migration.ts" ;;
    20260725010643_*) renderer="scripts/render-10643-migration.ts" ;;
    20260725010644_*) renderer="scripts/render-10644-migration.ts" ;;
    20260725010645_*) renderer="scripts/render-10645-migration.ts" ;;
    20260725010646_*) renderer="scripts/render-10646-migration.ts" ;;
    20260725010647_*) renderer="scripts/render-10647-migration.ts" ;;
    20260725010648_*) renderer="scripts/render-10648-migration.ts" ;;
    20260725010649_*) renderer="scripts/render-10649-migration.ts" ;;
    20260725010650_*) renderer="scripts/render-10650-migration.ts" ;;
    20260725010651_*) renderer="scripts/render-10651-migration.ts" ;;
    20260725010652_*) renderer="scripts/render-10652-migration.ts" ;;
    20260725010653_*) renderer="scripts/render-10653-migration.ts" ;;
    20260725010654_*) renderer="scripts/render-10654-migration.ts" ;;
    20260725010655_*) renderer="scripts/render-10655-migration.ts" ;;
    20260725010656_*) renderer="scripts/render-10656-migration.ts" ;;
    20260725010657_*) renderer="scripts/render-10657-migration.ts" ;;
    20260725010658_*) renderer="scripts/render-10658-migration.ts" ;;
    20260725010659_*) renderer="scripts/render-10659-migration.ts" ;;
    20260725010660_*) renderer="scripts/render-10660-migration.ts" ;;
    *) renderer="" ;;
  esac
  if [ -n "$renderer" ]; then
    pnpm --dir "$repo_dir" exec tsx "$renderer" --verify
    continue
  fi
  checksum_count=$(rg -o 'sha256:[0-9a-f]{64}' "$migration_file" | wc -l | tr -d ' ')
  if [ "$checksum_count" -ne 1 ]; then
    echo "Expected exactly one self-checksum literal: $migration_file" >&2
    echo "found=$checksum_count" >&2
    exit 1
  fi
  declared_hash=$(rg -o 'sha256:[0-9a-f]{64}' "$migration_file")
  if [ -z "$declared_hash" ]; then
    echo "Missing declared migration checksum: $migration_file" >&2
    exit 1
  fi

  computed_hash=$(
    sed -E "s/sha256:[0-9a-f]{64}/sha256:$zero_hash/g" "$migration_file" \
      | shasum -a 256 \
      | awk '{ print $1 }'
  )
  if [ "$declared_hash" != "sha256:$computed_hash" ]; then
    echo "Migration checksum mismatch: $migration_file" >&2
    echo "declared=$declared_hash computed=sha256:$computed_hash" >&2
    exit 1
  fi
done

echo "Supabase SQL static checks passed."
