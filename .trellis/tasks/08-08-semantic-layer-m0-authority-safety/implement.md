# M0 Semantic Authority and Safety Foundation — Implementation Plan

## Pre-edit Rules

- Re-read this task, relevant Trellis specs and nested `apps/web/AGENTS.md`.
- Read the installed Next.js 16 Route Handler documentation before changing routes.
- Record `git status --short` and per-file diffs; preserve all unrelated user changes.
- Test-first for behavior changes. Do not start the next unit while the current scoped gate fails.

## U0 — Characterization and Contract Tests

1. Add failing tests for backend selection: unset, invalid, production mock, explicit local mock,
   postgres missing DB/Authority.
2. Add failing tests proving client scope/principal/role are rejected or ignored in favor of server
   Authority.
3. Add failing adapter tests proving scope settings and SQL share one transaction/client.
4. Add a static regression for random/placeholder semantic digest and authority material.

**Gate:** new tests fail for the documented current behavior and do not modify production code.

## U1 — Strict Contracts and Server Composition

1. Add Candidate, publish, rollback and credential-ref contracts to `@data-agent/contracts`.
2. Export contracts from the narrow owning index without creating an App dependency.
3. Add server-only backend configuration parser and `SemanticAuthorityResolver` boundary.
4. Split Mock into an explicitly selected local/test adapter; remove implicit fallback.
5. Centralize redacted `SemanticGovernanceError` mapping.

**Gate:** contracts happy/unknown-field/invalid identity tests, contracts build/typecheck, Web typecheck.

## U2 — Transaction-owned PostgreSQL Service

1. Introduce a single transaction runner for read and write methods.
2. Revalidate injected Authority on the checked-out client before setting local scope.
3. Set all required app/data_agent scope, principal, role and deployment settings in the same transaction.
4. Convert every service method to use the runner and explicit full-scope predicates.
5. Map SQLSTATE/semantic reason codes to stable public errors.

**Gate:** fake-client transaction ordering tests plus rollback/release tests; no query executes after
Authority failure.

## U3 — Additive Candidate Creation Authority

1. Create the next additive migration source segments, renderer/checksum entry and generated migration.
2. Add the narrow Candidate creation RPC with scope lock, currentness, DB-owned canonical hashes,
   replay/conflict behavior and exact grants.
3. Replace direct table inserts in `PostgresSemanticGovernanceService.createCandidate` with the RPC.
4. Persist the real structured diff/source payload, server principal and base release identity.
5. Return draft Candidate identity and remove Postgres ReviewTask creation from this operation.
6. Update API client/editor minimally for the draft result without absorbing other DataFoundry changes.

**Gate:** real PostgreSQL tests cover replay, conflict, cross-scope denial, transaction rollback, exact
source/candidate/revision binding and absence of ReviewTask.

## U4 — Remove Placeholder Publish/Rollback Paths

1. Change service/API method inputs to the strict publish/rollback contracts.
2. Pass exact compiler, catalog, dependency, projection and rollback material to existing 10610 RPCs.
3. Remove random UUID/hash generation and hard-coded publisher/rollback reason.
4. Return missing-material errors before a Postgres query when upstream material is absent.

**Gate:** static search has no semantic placeholder material; contract tests prove every missing field
fails before RPC; valid fixture material is forwarded byte-for-byte.

## U5 — Datasource Credential Reference Boundary

1. Snapshot the untracked datasource files and patch only credential-owned fields.
2. Replace password-bearing in-memory records and response DTOs with `DataSourceCredentialRef`.
3. Add `SecretResolverPort` injection; default implementation is unavailable/fail-closed.
4. Redact connector errors and test common secret/DSN aliases.

**Gate:** no raw password/userinfo/provider locator in store, API response or logs; connector is not called
without an authorized resolver.

## U6 — Full M0 Verification

Run the smallest gates after each unit, then:

```bash
pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
infra/supabase/test-support/static-check.sh
infra/supabase/test-support/run-postgres-smoke.sh
scripts/test-platform-integration.sh
pnpm test:tenancy
pnpm test:security
```

If full-repo gates fail only on pre-existing dirty work, record the exact scoped PASS and unrelated
failure; do not rewrite unrelated files to obtain a green check.

## Review and Commit Gate

- Run `trellis-check` after implementation.
- Run adversarial security/correctness review for auth, tenant scope, secrets and DB mutations.
- Update Trellis specs only for a newly established reusable convention.
- Stage only explicit M0 files and inspect the staged diff before commit.
- Do not archive M0 until PostgreSQL and migration ledger evidence exists.
