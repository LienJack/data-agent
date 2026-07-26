#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

pnpm --dir "$repo_dir" --filter @data-agent/contracts build
pnpm --dir "$repo_dir" --filter @data-agent/contracts test:unit
pnpm --dir "$repo_dir" --filter @data-agent/platform test:unit

"$repo_dir/infra/supabase/test-support/run-postgres-smoke.sh"
"$repo_dir/scripts/test-platform-integration.sh"
"$repo_dir/scripts/test-sandbox-python.sh"
