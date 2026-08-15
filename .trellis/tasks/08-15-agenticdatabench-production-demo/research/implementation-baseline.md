# Implementation Baseline — 2026-08-15

## Task activation

- Trellis task: `.trellis/tasks/08-15-agenticdatabench-production-demo`
- Status: `in_progress`
- Branch: `feat/datafoundry-platform-modules`
- Migration slot: `10636` was unclaimed at activation time; it must be checked again immediately before migration work.

## Dirty-tree boundary

The shared worktree contained 174 uncommitted entries at activation. The following planned integration surfaces already had unrelated changes and are not safe first-edit targets:

- `compose.yaml`, `package.json`, `pnpm-lock.yaml`
- `scripts/local-dev-runtime.ts`, `tests/local-dev-runtime.spec.ts`
- `apps/worker/**`, `apps/web/**`
- `packages/contracts/**`, `packages/evals/**`, `packages/platform/**`, `packages/agent-runtime/**`, `packages/semantic/**`
- migration assertions and the untracked Test Center implementation

Initial implementation therefore starts with task-owned new paths under `infra/agenticdatabench/ecommerce-v1/`, new bundle tools/tests, and new Python Sandbox modules/tests. Shared-file integration is deferred until the relevant phase can re-read and preserve the live parallel diff.

## Baseline commands

| Command | Result |
| --- | --- |
| `pnpm --filter @data-agent/contracts test:unit` | PASS — 41 files, 596 tests |
| `pnpm --filter @data-agent/evals test:unit` | PASS — 3 files, 24 tests |
| `uv run --group dev pytest -q` from `services/sandbox` | PASS — 53 passed, 17 PostgreSQL-dependent skipped |
| `git diff --check` | PASS |

The first sandbox invocation from the repository root failed because nested `services/sandbox/pyproject.toml` pytest configuration was not selected. Running from the package directory is the authoritative baseline command; this was a command-context issue, not a product test failure.

## Fixed upstream boundary

- Repository commit: `61bb0d6be3439797d2c75a6ede198b0b296cc226`
- Dataset revision: `3b0ac3fde63fd615de92bf70c1dd93b73f92d92f`
- v1 source closure: 9 complete Olist CSVs, complete eBay CSV, first 10,000 physical records of each Amazon JSON source.
- Standard startup remains offline; source download is a maintainer-only bundle build step.
