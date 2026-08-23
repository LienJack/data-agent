# M2.1 Neo4j Relationship Index — Implementation Plan

## Approval

The user explicitly approved and requested implementation after the M2.1 handoff. This plan preserves that
approved scope and does not add a second semantic authority.

## U0 — Contracts and red tests

- [x] Add strict manifest/checkpoint/search/graph/Agent schemas and canonical digest helpers.
- [x] Add graph projection fixtures with BIZ/JOIN/FORMULA/BIND/GOVERN, governance nodes, duplicates,
      dangling endpoints, restricted material and 10k material.
- [x] Add failing conformance tests for idempotent build, active seal, exact search and unavailable fallback.

**Gate:** Contracts/typecheck; every external boundary rejects unknown fields, raw Cypher, credentials and limits.

## U1 — PostgreSQL 10625 projection operations

- [x] Add 10625 source segments, renderer, generated migration and checksum verification.
- [x] Add scoped job/checkpoint/attempt tables and discovery/claim/heartbeat/commit/fail/reconcile/read RPCs.
- [x] Add exact grants/RLS/direct-table denial and stale attempt/release/projection fence assertions.
- [x] Add platform PostgreSQL job/checkpoint adapter with stable redacted errors.

**Gate:** PG17 clean install, ledger/catalog exactness, Browser/Auth denial, cross-scope denial, claim race, lease
expiry, old-fence rejection and idempotent reconciliation.

## U2 — Pure projection and Neo4j adapter

- [x] Build deterministic graph material from the M2 redacted snapshot and add PostgreSQL bounded fallback.
- [x] Add Neo4j driver factory/config, schema setup, staged batched build, exact verify/seal, cleanup and search.
- [x] Add an in-memory port adapter and shared conformance cases; add real Neo4j integration tests.
- [x] Add indexer/reconciler runner that closes PostgreSQL claim -> Neo4j seal -> PostgreSQL checkpoint.

**Gate:** same release rebuild is deterministic/idempotent; partial builds are invisible; deletion and full rebuild
recover exactly; offline/mismatch never produces a Neo4j success result.

## U3 — Shared search service, API and Agent parity

- [x] Extend Explorer service/runtime with exact checkpoint/search and before/after PostgreSQL authority fences.
- [x] Add `POST /api/semantic/relationships/search` with a strict versioned body, no-store and stable errors.
- [x] Add fixed Agent read descriptors and an exhaustive worker-side executor over the same service.
- [x] Prove Web/Agent parity and absence of mutation/raw SQL/raw Cypher capabilities.

**Gate:** pointer swap race never mixes releases; permission redaction and fallback match M2; public DTO parity.

## U4 — Rich graph UI

- [x] Add category filters, directed labels, direction/hop controls and source/index status.
- [x] Add search-to-focus, node drag, pan/zoom/fit, node/edge selection and contract detail.
- [x] Add traversal explanation and accessible relationship table/keyboard controls.
- [x] Keep snapshot/server data immutable and preserve 250-node/500-edge DOM ceiling.

**Gate:** component tests plus headed-browser Neo4j/fallback/refresh/filter/focus/detail/accessibility proof.

## U5 — Operations, scale and closure

- [x] Add compose Neo4j/indexer wiring without making Web/PostgreSQL depend on it.
- [x] Add structured 10k relationship benchmark with nonzero failure on frozen budgets.
- [x] Run scoped Biome, package typecheck/tests, migration verify, PG17, Neo4j integration, compose health,
      production build and Trellis check.
- [x] Run multi-role review, fix blockers, prepare exact staged allowlist and commit only after the user-approved
      boundary remains unchanged.

**Gate:** every PRD acceptance criterion has executable or browser evidence; feature-off rollback is verified;
only M2.1-owned paths are staged.

## Verification commands

```bash
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/worker test:unit
pnpm --dir apps/web exec vitest run test --testTimeout=30000
pnpm tsx scripts/render-10625-migration.ts --verify
./infra/supabase/test-support/run-semantic-m0-postgres.sh
pnpm tsx scripts/semantic-relationship-index-integration.ts
node --expose-gc --import tsx scripts/semantic-relationship-index-benchmark.ts
pnpm --filter @data-agent/web build
pnpm exec biome check <exact-m2.1-file-list>
python3 .trellis/scripts/task.py validate 08-09-semantic-layer-m2-1-neo4j-relationship-index
```

## Rollback points

- After U1: 10625 is additive; disable job discovery and leave existing rows for audit.
- After U2/U3: `SEMANTIC_RELATIONSHIP_INDEX_ENABLED=0` selects PostgreSQL fallback and avoids driver creation.
- After U4/U5: stop indexer/Neo4j; Web/Agent continue over PostgreSQL M2 read model.

## Commit boundary

Use an explicit M2.1 allowlist. Never use `git add -A` or stage/revert existing DataFoundry, `/semantic`, Sidebar,
AppShell, global CSS, UI primitive, `tsconfig.tsbuildinfo`, parent roadmap or unrelated task changes.
