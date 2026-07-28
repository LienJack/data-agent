#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: assert-u6-migration-path.sh <infra-dir> <migration-file>" >&2
  exit 2
fi

infra_dir=$1
migration_file=$2
migration_basename=$(basename "$migration_file")
u6_c1_migration="$infra_dir/apps/data-agent/migrations/20260725010590_app_data_agent_u6_research_authority.sql"
u6_c2_migration="$infra_dir/apps/data-agent/migrations/20260725010600_app_data_agent_u6_research_derivation.sql"

case "$migration_basename" in
  20260725010590_app_data_agent_u6_research_authority.sql)
    if [ "$migration_file" != "$u6_c1_migration" ]; then
      echo "U6 10590 migration is forbidden outside the app data-agent chain: $migration_file" >&2
      exit 1
    fi
    echo "C1"
    ;;
  20260725010600_app_data_agent_u6_research_derivation.sql)
    if [ "$migration_file" != "$u6_c2_migration" ]; then
      echo "U6 10600 migration is forbidden outside the app data-agent chain: $migration_file" >&2
      exit 1
    fi
    echo "C2"
    ;;
  *)
    echo "OTHER"
    ;;
esac
