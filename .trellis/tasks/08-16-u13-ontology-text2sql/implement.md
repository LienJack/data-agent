# U13 Implementation Plan

## Phase 1 - Contract and grounding closure

- [x] Characterize existing Grounding/Text2SQL contracts and sandbox authority inputs.
- [x] Add failing tests for exact U12 package/release/snapshot/mapping closure and non-queryable rejection.
- [x] Add versioned Logical Plan/compiler/firewall binding fields with canonical hash verification.

## Phase 2 - Semantic compiler and graph traversal

- [x] Lower governed Metric/Ontology mappings deterministically into Logical Plan/AST/SQL.
- [x] Bind relationship traversal to PostgreSQL Authority and exact Neo4j generation/checkpoint.
- [x] Add explicit stale/missing Neo4j fallback receipt and ordering regressions.

## Phase 3 - Firewall and Sandbox Authority

- [x] Thread Context/Compiler/Snapshot bindings into PostgreSQL Text2SQL Sandbox Authority.
- [x] Reuse and verify the AST policy deny matrix for single statement, scope, parameters and technical limits.
- [x] Prove rejected SQL is absorbing and executes zero datasource/fallback callbacks.

## Phase 4 - Verification and handoff

- [x] Run focused and package-level Contracts/Semantic/Platform tests, typechecks and builds.
- [x] Run scoped Biome, diff, dependency and forbidden scans.
- [x] Run fresh PG17 U13 assertions without Falcon import/eval or Provider execution.
- [ ] Run Trellis check, update durable specs, create scoped commit and archive U13.
- [ ] Automatically continue to U14.

## Risk and rollback points

- Preserve the existing sandbox AST parser as the single SQL shape implementation; do not add a regex firewall.
- Do not trust Neo4j freshness without PostgreSQL generation evidence.
- Do not stage unrelated shared-worktree changes in compiler/index files.

Validation note: U13 scoped gates pass. The unfiltered Text2SQL suite retains one unrelated public-root export failure from parallel Ontology work; Platform full unit retains one unrelated U11 foundational-source fixture failure. U13 focused Compiler/Graph/Sandbox tests and all Contracts/Semantic suites pass.
