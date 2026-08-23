# M0 Current Baseline — 2026-08-08

## Pinned Code Findings

- `apps/web/src/lib/semantic-governance-service.ts:392-407` silently selects Mock unless
  `USE_POSTGRES_SERVICE=true`.
- `apps/web/src/lib/postgres-semantic-governance-service.ts:97-121` uses transaction-local settings,
  while reads begin no shared transaction.
- `apps/web/src/lib/postgres-semantic-governance-service.ts:603-725` directly inserts Candidate,
  CandidateRevision and ReviewTask with hard-coded principal, empty structured diff and random digests.
- `apps/web/src/lib/postgres-semantic-governance-service.ts:730-895` generates compiler, idempotency,
  projection and rollback identity material rather than consuming Authority output.
- `apps/web/src/app/api/semantic/governance/candidates/route.ts:17-56` accepts client app/tenant/
  environment/domain fields.
- `apps/web/src/lib/semantic-api.ts:24-37,93-109` uses a Mock current user and posts principal/role as
  decision Authority.
- `infra/supabase/apps/data-agent/migrations/20260725010610_app_data_agent_semantic_control_plane.sql`
  already owns semantic tables, locks, decisions, publish, rollback, active pointer, outbox and RLS.
- `packages/contracts/src/common/canonical-json.ts:3-62` states TypeScript canonical JSON and the
  PostgreSQL persisted-hash boundary; persisted Authority should propagate the DB hash.

## Dirty Worktree Boundary

- The current branch is `feat/datafoundry-platform-modules`.
- DataFoundry UI and U13.2 migration work are pre-existing user changes.
- `apps/web/src/app/api/datasources/`, `apps/web/src/components/data-sources/`,
  `apps/web/src/lib/datasource-*`, `apps/web/src/components/data-link/` and
  `apps/web/src/lib/data-link-*` are currently untracked user work.
- M0 may patch credential or Candidate response seams in those paths only after inspecting their exact
  content; it must not stage unrelated files from those directories.

## Research Decisions Reused

- PostgreSQL remains the only write Authority; graph and Agent outputs are candidates/projections.
- A database schema scan can provide physical evidence but cannot prove business semantic truth.
- Human review binds an exact immutable revision and cannot be replaced by Agent confidence.
- Roadmap source: `docs/plans/2026-08-08-001-semantic-layer-studio-roadmap.md`.
