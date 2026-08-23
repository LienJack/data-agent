# U11 Implementation Plan

## Phase 1 — Contract and kernel red tests

- [x] Add failing Contracts tests for induction source/evidence/taint, stable identity, proposal receipt, metric dry-run and impact receipt hashes.
- [x] Add failing Semantic tests for order-independent IDs, alias merge/conflict, affected closure, unchanged hashes and metric lowering.
- [x] Implement strict Contracts schemas/builders/verifiers and pure Semantic kernels.
- [x] Verify focused tests, Contracts/Semantic typecheck, build, Biome and diff-check.

## Phase 2 — PostgreSQL and Platform Authority

- [x] Add migration source/renderer/assertions for `10662_app_data_agent_semantic_induction_authority`.
- [x] Add append-only receipts, FORCE RLS, NOLOGIN owner, immutable guards and narrow job/backend RPC grants.
- [x] Implement Platform ports/adapters with exact AppCapability, lease/fence, scope, hash and replay correlation.
- [x] Prove U5 Candidate Plane remains the only Candidate write path.

## Phase 3 — Worker and Web composition

- [x] Add `SEMANTIC_INDUCTION` and `METRIC_IMPORT` Job Center handlers with cancellation, stable errors and successor semantics.
- [x] Wire handlers into the production Worker composition without adding a Provider dependency.
- [x] Add workspace-scoped Web enqueue route and runtime adapter.
- [x] Add cross-layer tests for schema/document/metric happy paths plus evidence, taint, conflict, replay and stale-fence failures.

## Phase 4 — Verification and handoff

- [x] Run focused and package-level tests/typechecks/builds.
- [x] Run renderer verify, SQL static assertions, scoped Biome/diff and forbidden scans.
- [x] Run fresh PG17 Authority assertions with ecommerce/Falcon hooks mapped to `/dev/null`; do not import or execute Falcon.
- [x] Run Trellis check, update specs if implementation changes durable patterns, then create one scoped Git commit.
- [x] Archive U11 and automatically continue to the next dependency-ready unit.
