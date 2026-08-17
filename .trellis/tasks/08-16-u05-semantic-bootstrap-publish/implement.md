# U5 Implementation Plan

## Ordered Work

1. Add failing Contract tests for canonical policy/validation/release-set/admission hashes, signer separation, raw material rejection,
   package-set ordering/duplicates, cross-scope splice and receipt correlation.
2. Implement `semantic-bootstrap-release.ts` strict schemas, builders and verifiers; add the U5 export through the existing
   capabilities/root barrel chain and export only safe documents/refs/results.
3. Add failing Platform tests for PostgreSQL key resolution, Ed25519 verification, committed verified-domain receipt, DB-held grant and
   exact bootstrap publish/load result verification. Prove plain caller claims and cloned receipts are not authority.
4. Implement the independent verifier and privileged grant/publisher adapters using `withAppTransaction`, dedicated service authority
   contexts and stable database error mapping.
5. Add 10656 renderer and red SQL assertions, then implement tables, RLS/NOLOGIN roles, immutable guards, old bootstrap grant revocation,
   signer activation challenges, verified-domain/policy/grant/validation/publish/load RPCs and postconditions. Forward-extend the 10610
   Review Task/Publish Attempt/Source Release tables with explicit system packet/approval-mode constraints while preserving existing
   HUMAN_REVIEW rows and ordinary RPC behavior.
6. Build a rollback-only, empty Greenfield SQL fixture with one real Candidate Set Root revision and two U4 packages derived from it.
   Prove canonical first publish, exact replay, hash conflict,
   generation/active/tombstone closure, role denial, stale key/grant/validation/projection rejection and full atomic rollback.
7. Add U2 release-resolution integration proving Defaults/Effective Config resolves the generation 1 release id/digest produced by
   10656. Add graph binding/read verification for the same Release Set.
8. Replace the application-facing 10610 positional publish/rollback calls with strict 10656 Human Governance RPCs owned by a scoped
   NOLOGIN/NOBYPASSRLS role. Revoke legacy PUBLIC/application execution, bind all operations to transaction-local backend authority,
   write the real quorum snapshot/decision digest, and prove v1 -> human-reviewed v2 -> rollback/roll-forward in PostgreSQL.
9. Harden Web governance parsers/routes: generic publish rejects Bootstrap fields; bootstrap remains server-internal; portability import
   remains Candidate-only; normal human v2 publish/rollback characterization stays green.
10. Run Contracts/Platform/Web focused tests, relevant package typecheck/build, renderer/static, fresh PostgreSQL 17 with all import hooks
   `/dev/null`, Biome, diff-check and forbidden scans.
11. Run `trellis-check`, fix all U5-owned P0/P1, update task/spec evidence, stage only U5 hunks and create one scoped commit.

## Owned Paths

- `.trellis/tasks/08-16-u05-semantic-bootstrap-publish/**`
- `packages/contracts/src/semantic/semantic-bootstrap-release.ts`
- `packages/contracts/src/capabilities/index.ts` and `packages/contracts/src/index.ts`, U5 export hunks only if the existing export chain
  does not already expose the module
- `packages/contracts/test/semantic-bootstrap-release.spec.ts`
- `packages/platform/src/semantic/greenfield-bootstrap-release-authority.ts`
- `packages/platform/src/authz/postgres-privileged-grant-authority.ts`
- `packages/platform/src/index.ts`, U5 export hunks only
- `packages/platform/test/semantic/greenfield-bootstrap-release-authority.spec.ts`
- `packages/platform/test/authz/postgres-privileged-grant-authority.spec.ts`
- `apps/web/src/lib/postgres-semantic-governance-service.ts`, U5 strict integration hunks only
- `apps/web/src/lib/semantic-governance-route.ts`, U5 parser rejection hunk only
- `apps/web/src/app/api/semantic/governance/publish/route.ts`, U5 fail-closed hunk only if needed
- `apps/web/src/app/api/workspaces/[workspaceId]/semantic/portability/imports/route.ts`, Candidate-only hunk if needed
- `apps/web/test/postgres-semantic-governance-transaction.spec.ts`, U5 cases only
- `apps/web/test/semantic-governance-route-material.spec.ts`, U5 cases only
- `apps/web/test/semantic-portability-route.spec.ts`, U5 cases only
- `infra/supabase/apps/data-agent/migration-sources/10656/**`
- `infra/supabase/apps/data-agent/migrations/20260725010656_app_data_agent_semantic_bootstrap_release.sql`
- `infra/supabase/test-support/34-semantic-bootstrap-release-authority-assertions.sql`
- `infra/supabase/test-support/static-check.sh`, 10656 renderer hunk only
- `scripts/render-10656-migration.ts`

Existing dirty semantic candidate-generation files are dependencies, not U5-owned; adapt through their committed/public boundary and do
not stage unrelated hunks.

## Validation

```text
pnpm --filter @data-agent/contracts exec vitest run test/semantic-bootstrap-release.spec.ts
pnpm --filter @data-agent/platform exec vitest run test/semantic/greenfield-bootstrap-release-authority.spec.ts test/authz/postgres-privileged-grant-authority.spec.ts
pnpm --filter @data-agent/web exec vitest run test/postgres-semantic-governance-transaction.spec.ts test/semantic-governance-route-material.spec.ts test/semantic-portability-route.spec.ts
pnpm --filter @data-agent/contracts typecheck && pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/platform typecheck && pnpm --filter @data-agent/platform build
pnpm --filter @data-agent/web typecheck && pnpm --filter @data-agent/web build
pnpm exec tsx scripts/render-10656-migration.ts --verify
sh infra/supabase/test-support/static-check.sh
```

Fresh PostgreSQL 17 validation sets every ecommerce/Falcon/other import hook to `/dev/null`, runs only migrations and U5 Authority
assertions, and proves all import receipt/data counts remain zero. It does not run the Falcon gate or call a Provider.

## Completion Evidence

- Contracts focused `5/5`, dependency-boundary `12/12`, typecheck and build passed.
- Platform focused `6/6`, typecheck and build passed; the final Trellis review added DB-response bundle hash/order/correlation
  counterexamples and closed them in the shared Contract verifier.
- Web focused `18/18`, typecheck and Next production build passed; the build emitted only pre-existing dynamic filesystem tracing
  warnings outside U5.
- `render-10656-migration.ts --verify` and the complete Supabase SQL static check passed with checksum
  `sha256:efe4a1d3fbfef53e6bb22470e652926f0d7938a7e750806288a7570c76dca0ac`.
- Fresh PostgreSQL 17 installed the full migration chain with ecommerce/Falcon import hooks mounted to `/dev/null`; assertion 34
  passed in a rollback-only transaction and left U5/U4 fixture row counts at zero.
- Scoped Biome, diff-check and production-path forbidden scans passed. No data import, Falcon gate, Provider call, commercial path,
  stage or commit occurred during validation.

## Risk and Rollback Points

- Shared governance/barrel/static-check files are dirty: stage exact U5 hunks only.
- 10610 release tables are runtime dependencies: characterize normal publish/rollback before and after 10656; do not rewrite history.
- Signature verification and Publisher DB roles require separate service authority; if no safe role/login composition is available,
  stop before product writes rather than falling back to backend trust.
- Before v1 commit, revoke/expire policy and grant. After v1, preserve immutable truth and repair through generation≥2 human governance.
