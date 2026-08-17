# U12 Implementation Plan

## Phase 1 — Contract and deterministic kernels

- [x] Add failing Contracts tests for request/snapshot/package/receipt hash closure and Preview/Run parity.
- [x] Add failing Semantic tests for exact Metric/alias, ambiguity, route priority and deterministic capacity.
- [x] Implement strict versioned Contracts and pure Semantic resolver/router/capacity kernels.
- [x] Run focused Contracts/Semantic test, typecheck, build and Biome gates.

## Phase 2 — PostgreSQL Authority and Platform resolver

- [x] Add 10663 source, renderer and Authority assertions.
- [x] Add append-only receipt, FORCE RLS, NOLOGIN owner, immutable guard and narrow backend/worker RPC grants.
- [x] Resolve PREVIEW Defaults and RUN Effective Config/Context into one exact Authority Snapshot.
- [x] Implement Platform resolver with AppCapability, hash/scope/reference/replay and lease/fence correlation.

## Phase 3 — Worker and Web composition

- [x] Add run-bound Worker context resolver capability and enforce resolution before Provider dispatch.
- [x] Add provider-zero-call regressions for rejected/stale context.
- [x] Add workspace context-preview API using current Defaults and the same Platform resolver.
- [x] Add read-only Context Preview component and route tests for ready/partial/clarification/rejected/stale.

## Phase 4 — Verification and handoff

- [x] Run focused and package-level tests/typechecks/builds.
- [x] Run renderer/static assertions, scoped Biome/diff and forbidden scans.
- [x] Run fresh PG17 U12 assertions without ecommerce/Falcon data import or Provider execution.
- [ ] Run Trellis check, update durable specs, create one scoped commit and archive U12.
- [ ] Automatically continue to the next dependency-ready unit.

Validation note: scoped U12 gates pass. The unfiltered PostgreSQL assertion sweep remains blocked by the parallel `18zzzy-semantic-authoring` request-digest fixture, and Platform full unit has one unrelated U11 foundational-source fixture failure; U12 focused Platform surface/adapter tests pass 5/5.
