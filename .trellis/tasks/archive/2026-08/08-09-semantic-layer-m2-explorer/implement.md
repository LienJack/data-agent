# M2 Semantic Explorer — Implementation Plan

## Execution rule

The user approved M2 implementation and the exact M2 commit boundary. M2 implementation and verification are
complete; this task closes with the exact allowlisted commit below. M2.1 remains a separate follow-up.

## U0 — Failing contracts and fixtures

- [x] Add strict Explorer snapshot/object/edge/diff/lineage/comparison schemas and failing contract tests.
- [x] Add a small complete release fixture and a deterministic 10k fixture with explicit expected identities/counts.
- [x] Add fixtures proving same-kind duplicates fail while cross-kind equal object IDs coexist, plus negative fixtures
      for dangling edges, mismatched release/projection, invalid sidecar hash, restricted field leakage and candidate
      merging.

**Gate:** tests fail for the intended missing behavior before production implementation; fixtures have no DB/UI
dependency and encode exact expected results.

## U1 — Projection sidecar and pure read-model kernel

- [x] Add the optional versioned `explorer_sidecar` to U5 executable projection and derive/hash it from validated
      `SemanticSourceBundle` material.
- [x] Implement strict raw-envelope parsing, release/projection binding checks, restriction redaction, objects,
      edges, counts and stable sort in `packages/semantic/src/explorer/`.
- [x] Implement exact release diff, bounded lineage and separate candidate comparison mapping.
- [x] Prove historical projections without a sidecar degrade explicitly and never infer business entities.

**Gate:** contracts/semantic build, typecheck and focused unit tests; same source is deterministic; all negative
identity/redaction/candidate-leak fixtures fail closed.

## U2 — PostgreSQL read authority

- [x] Add 10624 source segments, deterministic renderer, generated migration and checksum verification.
- [x] Add narrow domain/active/exact-release/timeline/candidate-comparison READ RPCs with full scope checks.
- [x] Revoke Backend direct access to active release/projection tables; grant exact function signatures only.
- [x] Add a platform Explorer read adapter that maps SQL markers to stable redacted errors and returns parsed raw
      envelopes to the semantic kernel.

**Gate:** PG17 clean install/ledger/catalog postconditions, cross-scope/domain denial, Browser/Auth denial, Backend
direct table denial, exact happy path and every missing/mismatched projection mutation.

## U3 — API, freshness reducer and Explorer shell

- [x] Compose server Authority, PostgreSQL adapter and semantic builder in an Explorer-only runtime.
- [x] Permit only the one-way `app -> semantic -> contracts` composition dependency and prove the reverse edge
      remains forbidden.
- [x] Add active/release/timeline/object/lineage/diff/candidate comparison routes with strict params and no-store.
- [x] Add feature-local request reducer with AbortController and pointer-generation stale-response protection.
- [x] Add self-contained `/semantic/explorer` three-column shell, category tree/search, table and detail views.

**Gate:** route input/redaction/cache tests; reducer out-of-order tests; all rendered views show the same active
identity and no dirty DataFoundry-owned file changes.

## U4 — Graph, version diff and candidate comparison

- [x] Add accessible bounded-neighborhood SVG derived from the same object/edge indexes.
- [x] Add release timeline, exact release-to-release diff and bounded lineage navigation.
- [x] Add visually distinct candidate/stale comparison band that cannot alter active objects/counts/graph.
- [x] Add explicit capability-gap UI for historical releases without ontology/binding/catalog sidecar.

**Gate:** identity/count/endpoint consistency, candidate non-merging, accessible controls/SVG, cycle/ceiling behavior,
and DOM node ceilings all have automated tests.

## U5 — Scale, security and M2 closure

- [x] Implement and run the 10k structured benchmark; fail nonzero on CPU/heap/API/DOM budgets.
- [x] Run scoped Biome, typecheck, unit/contract, PG17 integration, migration verify and Trellis check.
- [x] Run headed browser proof for generation refresh, tree/table/graph/detail, diff/lineage, candidate/stale labels
      and console cleanliness.
- [x] Produce an exact staged allowlist and receive user approval before the M2 commit operation.

**Gate:** every PRD acceptance criterion has command or browser evidence; M2-owned diff only; rollback flag verified.

## Verification evidence

- Contracts: 31 files / 554 tests passed; Semantic: 7 files / 86 tests passed; Platform: 27 files / 227 tests
  passed; Web: 15 files passed and 1 skipped, with the route bootstrap regression included.
- PostgreSQL 17 authority integration passed cleanly, including allowlisted domains, RLS, direct-table denial,
  projection-binding failures and exact-release reads.
- Migration renderer verification passed with
  `sha256:99724852a453be6b586cfc1defe5ae2e9159d04daad9cd9f5c9f809e6d215643`.
- The deterministic 10k benchmark passed: 10,001 objects, 2,999 rendered test edges, 722,121-byte gzip,
  server p95 563.03 ms, heap delta 115,155,640 bytes and client p95 5.04 ms.
- Package typechecks, scoped Biome, Next production build and Trellis validation passed.
- Headed-browser proof covered active generation 3 / pointer 8, tree/table/graph/detail, two-node lineage,
  release diff, stale candidate labeling, historical generation 1 and refresh back to the active generation.

## Verification commands

```bash
pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/contracts exec vitest run test
pnpm --filter @data-agent/semantic exec vitest run test
pnpm --filter @data-agent/platform exec vitest run test
pnpm --dir apps/web exec vitest run test --testTimeout=30000
pnpm tsx scripts/render-10624-migration.ts --verify
node --expose-gc --import tsx scripts/semantic-explorer-benchmark.ts
pnpm --filter @data-agent/web typecheck
pnpm exec biome check <exact-m2-file-list>
```

The PG17 authority command is `./infra/supabase/test-support/run-semantic-m0-postgres.sh`; it uses isolated
task-scoped databases/roles and includes the additive 10624 assertions.

## Commit boundary

- Stage only exact M2 contract/kernel/migration/adapter/API/UI/test/script/task paths and the reviewed one-way
  workspace architecture rule/test in the final manifest.
- Never use `git add -A` or stage the existing dirty DataFoundry, `/semantic`, Sidebar, AppShell, global CSS,
  `tsconfig.tsbuildinfo`, parent roadmap artifacts or unrelated task files.
- If implementation discovers a necessary overlap with a dirty file, stop that slice and request a separate explicit
  integration decision; do not silently absorb or revert user changes.

## M2.1 relationship-index handoff

- [ ] Add an idempotent PostgreSQL-release-to-Neo4j projection worker and reconciliation checkpoint.
- [ ] Add exact-release relationship/path search with domain, capability, digest, hop and result ceilings.
- [ ] Register read-only Agent primitives over the same service for domain/release/object search, diff, lineage and
      candidate comparison; keep approve/publish/rollback/policy mutation absent.
- [ ] Upgrade the graph toward the supplied reference: typed edge filters/labels, focus search, drag/zoom,
      node/edge contract detail and traversal explanation, with an accessible table fallback.
- [ ] Prove Neo4j is rebuildable and non-authoritative: offline/mismatch states never replace PostgreSQL truth.

These are intentionally not M2 commit gates. They begin only after the exact M2 PostgreSQL Authority/read-model
closure is approved, so the graph index cannot become a second semantic source of truth.
