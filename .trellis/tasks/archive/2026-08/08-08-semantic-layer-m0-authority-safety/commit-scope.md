# M0 Scoped Commit Boundary

Date: 2026-08-08

This manifest separates M0 from the pre-existing DataFoundry work in the shared dirty worktree.
The original boundary was approved on 2026-08-08, then expanded after pre-commit dependency review
found that migration 10622 requires 10621 and the two reviewed UI files require three direct modules.

## Commit group A — semantic authority core

These files are wholly owned by M0 or contain only M0 semantic-governance changes:

- `apps/web/src/app/api/semantic/governance/candidates/route.ts`
- `apps/web/src/app/api/semantic/governance/decisions/route.ts`
- `apps/web/src/app/api/semantic/governance/domains/route.ts`
- `apps/web/src/app/api/semantic/governance/inbox/route.ts`
- `apps/web/src/app/api/semantic/governance/packets/[id]/route.ts`
- `apps/web/src/app/api/semantic/governance/publish/route.ts`
- `apps/web/src/app/api/semantic/governance/rollback/route.ts`
- `apps/web/src/lib/postgres-semantic-governance-service.ts`
- `apps/web/src/lib/semantic-api.ts`
- `apps/web/src/lib/semantic-authority.ts`
- `apps/web/src/lib/semantic-governance-config.ts`
- `apps/web/src/lib/semantic-governance-error.ts`
- `apps/web/src/lib/semantic-governance-route.ts`
- `apps/web/src/lib/semantic-governance-runtime.ts`
- `apps/web/src/lib/semantic-governance-service.ts`
- `apps/web/test/postgres-semantic-governance-transaction.spec.ts`
- `apps/web/test/semantic-authority.spec.ts`
- `apps/web/test/semantic-governance-config.spec.ts`
- `apps/web/test/semantic-governance-route-material.spec.ts`
- `apps/web/test/semantic-governance-static.spec.ts`
- `packages/contracts/src/artifacts/semantic-governance-requests.ts`
- `packages/contracts/test/semantic-governance-requests.spec.ts`

The following tracked contract files are M0-owned but must be inspected as normal tracked diffs:

- `packages/contracts/src/artifacts/index.ts`
- `packages/contracts/test/u6-wire-compatibility.spec.ts`

The wire-compatibility test deliberately requires `10609`, `10619` and `10622`. Although that test
does not enumerate `10621`, migration `10622` itself fails closed unless the `10621` ledger entry is
present. `10621` was therefore committed first as prerequisite commit `2040b3e`.

## Commit group B — additive PostgreSQL migrations

- `infra/supabase/apps/data-agent/migration-sources/10609/`
- `infra/supabase/apps/data-agent/migration-sources/10619/`
- `infra/supabase/apps/data-agent/migration-sources/10622/`
- `infra/supabase/apps/data-agent/migrations/20260725010609_app_data_agent_semantic_publish_grant_compatibility.sql`
- `infra/supabase/apps/data-agent/migrations/20260725010619_app_data_agent_attribution_canonical_compatibility.sql`
- `infra/supabase/apps/data-agent/migrations/20260725010622_app_data_agent_semantic_candidate_draft.sql`
- `scripts/render-10609-migration.ts`
- `scripts/render-10619-migration.ts`
- `scripts/render-10622-migration.ts`
- `infra/supabase/test-support/run-semantic-m0-postgres.sh`

The `10621` migration, source segments, renderer, lifecycle implementation and platform surface
tests are not part of the M0 commit because they were committed separately in prerequisite commit
`2040b3e` after explicit approval.

## Commit group C — datasource secret-reference overlap

These paths existed as untracked DataFoundry work before M0. M0 changed only the credential-owned
seams, but Git has no baseline from which to stage those edits independently. The original patch
deltas were recovered from the local task session, so the changed behavior is auditable even though
Git still cannot represent it as a partial add against `HEAD`:

- `apps/web/src/app/api/datasources/route.ts`
- `apps/web/src/app/api/datasources/[id]/route.ts`
- `apps/web/src/app/api/datasources/test/route.ts`
- `apps/web/src/lib/datasource-repository.ts`
- `apps/web/src/lib/datasource-route.ts`
- `apps/web/src/lib/datasource-secret.ts`
- `apps/web/src/lib/datasource-types.ts`
- `apps/web/src/lib/datasource-api.ts`
- `apps/web/src/lib/datasource-store.ts`
- `apps/web/src/components/data-sources/connection-form.tsx`
- `apps/web/test/datasource-secret-boundary.spec.ts`
- the `mysql2` dependency hunk in `apps/web/package.json`
- the matching `mysql2` package graph in `pnpm-lock.yaml`

Do not stage the whole datasource directory blindly. Because the pre-M0 files were never in Git,
group C requires explicit acceptance of these eleven reviewed DataFoundry-plus-M0 files and the
narrow dependency hunks as one unit (or a prior commit that establishes the recovered DataFoundry
snapshot as their baseline). The API and store are the direct dependency closure of the reviewed
connection form. The MySQL dependency already belonged to the pre-M0 datasource scaffold; it is
listed here because omitting it would make the combined files fail on a clean checkout.

## Commit group D — Data Link Candidate-result overlap

`apps/web/src/components/data-link/semantic-editor.tsx` also existed as untracked DataFoundry work.
M0 changed only the user-visible transition from a fabricated ReviewPacket result to the real
Candidate Draft result (`candidate_id`, draft status and matching copy). It has the same no-Git-
`apps/web/src/lib/data-link-types.ts` is included as its direct type dependency.

## Trellis task artifacts

The following task evidence may accompany the final M0 code commit or a dedicated metadata commit:

- `.trellis/tasks/08-08-semantic-layer-m0-authority-safety/`

## Explicit exclusions

- Published F9 changes beyond prerequisite commit `2040b3e`;
- all `apps/web/package.json` changes except the group-C `mysql2` dependency, and all lockfile changes
  not transitively owned by that dependency; M0 uses PostgreSQL dependencies already present in
  `HEAD`;
- `apps/web/tsconfig.tsbuildinfo`;
- DataFoundry pages, components, stores and Trellis task files outside the M0 task;
- frontend spec changes and all unrelated layout/UI edits.

## Pre-commit verification

For each commit group:

1. stage only the explicit paths or reviewed hunks;
2. inspect `git diff --cached --stat` and `git diff --cached`;
3. prove no unapproved DataFoundry UI, generated build metadata or raw credential material leaked
   into the staged set;
4. rerun the scoped contract, Web, renderer and PostgreSQL gates recorded in `evidence.md`;
5. archive the task only after all M0 code is committed and the migration ledger evidence remains
   green.
