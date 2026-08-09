# M2.1 Neo4j Relationship Index — Design

## 1. Decision summary

1. PostgreSQL 的 active pointer、immutable release/projection、Capability 与 restriction 继续是
   唯一 Authority；Neo4j 是可删除、可重建的关系导航加速器。
2. 索引以 M2 strict/redacted `SemanticExplorerSnapshot` 为唯一输入，不读取 candidate current
   revision，也不复制 restriction predicate 或 credential。
3. Neo4j build 使用 `build_id` staging + `GraphReleaseSeal.active_build_id` 原子可见性；PostgreSQL
   checkpoint 只在 seal 回读验证后进入 `READY`。
4. active 搜索采用 PostgreSQL before/after double fence；Neo4j bookmark 只确保图内因果读取，
   不能替代 PostgreSQL release/generation/digest 重验。
5. Neo4j 只返回 identity/path candidate，Public DTO 用同一 PostgreSQL snapshot hydrate；失败时
   使用 M2 pure lineage/search fallback。
6. Web 与 Agent 共享同一 service 与 DTO；Agent 只注册 read descriptors/executor，mutation 和
   raw Cypher 永不注册。

## 2. End-to-end data flow

```text
PostgreSQL publish transaction
  -> semantic_outbox SOURCE_RELEASE_CREATED / ACTIVATED
  -> 10625 scoped index job discovery / reconciliation
  -> claim attempt + monotonically increasing fence
  -> M2 exact-release RPC + strict redacted snapshot builder
  -> deterministic GraphProjectionManifest + digest
  -> Neo4j staging build_id (batched nodes/edges)
  -> Neo4j verify counts/digest -> seal active_build_id
  -> PostgreSQL commit READY checkpoint iff attempt/fence/release still exact

Web or Agent search
  -> server Capability + PostgreSQL exact release observation A
  -> READY checkpoint exact binding
  -> Neo4j query exact release/digests/active_build_id
  -> PostgreSQL snapshot hydrate + observation B
  -> A == B and permission still valid ? NEO4J result : AUTHORITY_CHANGED
  -> unavailable/not-ready/mismatch ? POSTGRESQL_FALLBACK
```

No PostgreSQL transaction is claimed to span Neo4j. The observable success boundary is deliberately three local
steps: PostgreSQL claim, Neo4j atomic seal, PostgreSQL fenced checkpoint commit. Crashes between steps are resolved
by reconciliation and remain fallback-only until PostgreSQL records the verified receipt.

## 3. Contracts

Add `packages/contracts/src/artifacts/semantic-relationship-index.ts` with strict schemas:

- `SemanticRelationshipGraphManifest@1.0.0`: exact scope/domain/release identity, relationship projection
  identity, manifest digest, stable sorted node/edge material and expected counts.
- `SemanticRelationshipIndexCheckpoint@1.0.0`: `DISABLED | PENDING | INDEXING | READY | FAILED |
  STALE`, attempt/fence/build identity, exact release/projection/manifest digests, counts, timestamps and
  allowlisted reason code.
- `SemanticRelationshipSearchRequest@1.0.0`: domain/release selector/root/term/categories/direction/hops/
  ceilings; no scope, digest, Cypher or credential fields.
- `SemanticRelationshipSearchResult@1.0.0`: exact PostgreSQL release/pointer observation, source
  `NEO4J | POSTGRESQL_FALLBACK`, index status, graph nodes/edges, traversal explanation and truncation.
- Graph nodes are a discriminated union of `semantic_object` (M2 object) and `governance_object`
  (`semantic_release | executable_projection | relationship_projection | runtime_restriction_projection`).
- Graph edges use fixed categories `BIZ | JOIN | FORMULA | BIND | GOVERN`, stable edge identity, direction,
  display label and an allowlisted contract payload.

The graph manifest digest covers canonical material excluding itself. It is computed in contracts and reused by
the indexer, checkpoint verifier and integration tests.

## 4. PostgreSQL 10625 surface

Add deterministic source segments, renderer and generated migration `10625`:

- `semantic.semantic_relationship_index_job`: one row per exact release/projection digest with status,
  next attempt time and failure budget.
- `semantic.semantic_relationship_index_checkpoint`: current verified projection receipt per exact release.
- immutable `semantic_relationship_index_attempt` rows for claim/commit/fail/recovery evidence.
- publish-event discovery function inserts missing jobs from `semantic_outbox` idempotently; reconciliation may
  also enqueue any immutable release with missing/stale checkpoint.
- scoped `claim/heartbeat/commit/fail/get_checkpoint` SECURITY DEFINER functions with exact signatures,
  `search_path=''`, PostgreSQL clock, lease/fence and explicit scope predicates.
- Web Backend receives read-only checkpoint access through a narrow RPC. Indexer operations require a server
  capability with the same App/Tenant/Environment/Principal/Deployment revalidation; Browser/Auth has none.

`commit` requires the same attempt ID/fence, unexpired lease, exact release digest, relationship projection
ref/digest, graph manifest digest, build ID and expected counts. A newer attempt or release binding makes the old
worker stale. Direct Backend DML/SELECT on job/attempt/checkpoint tables is revoked.

## 5. Deterministic graph projection

`packages/semantic/src/relationship-index/` converts a parsed M2 snapshot into stable material:

- semantic nodes copy only redacted M2 public object fields required for search/list labels;
- governance nodes derive only from exact release/projection identity;
- existing edge kinds map deterministically:
  `business_relationship -> BIZ`, `analytical_relationship -> JOIN`,
  `metric_dependency/dimension_hierarchy -> FORMULA`, `physical_binding -> BIND`;
- `GOVERN` edges connect the release to its three projections and projections to governed semantic/datasource
  nodes where the binding is explicit. No new business/Join/causal relationship is inferred.

Keys use canonical tuple hashing rather than delimiter concatenation. Material is stable sorted, duplicate keys and
dangling endpoints fail closed, and graph counts/digest are recomputed from the exact collection.

## 6. Neo4j adapter

`packages/platform/src/semantic/neo4j-relationship-index.ts` owns the `neo4j-driver@6.2.0` integration behind
a package-local port so pure conformance tests can use an in-memory adapter.

- Driver is shared; every operation creates a session with explicit database and closes it in `finally`.
- Writes use `executeWrite` and idempotent transaction callbacks. Reads use `executeRead`, validated timeout and
  read access mode. All values are parameters; the only interpolated Cypher fragment is a hop count selected from
  the validated integer allowlist `1..6`.
- A node uniqueness constraint and supporting indexes are created idempotently. Relationship categories are
  fixed query templates; request data cannot create labels/types/properties.
- Build batches are tagged by exact scope/release/build ID and are invisible until a final transaction validates
  counts/digest and switches `GraphReleaseSeal.active_build_id`.
- Search first matches the exact seal and then traverses only nodes/edges sharing its build ID. Results include the
  seal identity for adapter-level verification. Cleanup removes non-active build IDs only after the seal switch.

Official current-driver guidance used here:

- https://neo4j.com/docs/javascript-manual/current/transactions/
- https://neo4j.com/docs/javascript-manual/current/bookmarks/
- https://neo4j.com/docs/javascript-manual/current/performance/
- https://neo4j.com/docs/cypher-manual/current/schema/constraints/create-constraints/

## 7. Search service and TOCTOU closure

Extend the Explorer server service rather than creating a second domain service:

1. parse the public request;
2. resolve server-owned Capability and exact active/historical PostgreSQL snapshot;
3. read an exact READY checkpoint;
4. if enabled and exact, query Neo4j with only fixed search parameters;
5. verify returned seal/checkpoint/manifest identity and hydrate identities from the PostgreSQL snapshot map;
6. re-read active pointer and capability after Neo4j I/O;
7. return Neo4j only if both PostgreSQL observations match; otherwise `AUTHORITY_CHANGED` retry/fallback;
8. on disabled/down/not-ready/mismatch, run the same bounded traversal against snapshot indexes and label the
   response `POSTGRESQL_FALLBACK` with an explicit status.

Historical search does not pretend the release is active, but still revalidates permission and exact immutable
release binding after Neo4j I/O. Raw Neo4j errors are mapped to stable, redacted codes.

## 8. Agent parity

Add fixed descriptors under `packages/agent-runtime/src/tools/semantic-explorer.ts` and a server executor in
`apps/worker/src/semantic/semantic-explorer-tool-executor.ts`. Descriptors use the Public request schemas; the
executor receives the same Explorer service as Web. It dispatches an exhaustive allowlist and returns the same
parsed DTOs. There is no generic database/graph executor and no mutation descriptor.

## 9. Web and graph interaction

Add a thin relationship-search route and extend only the self-contained M2 Explorer components. Do not touch the
dirty `/semantic` page, Sidebar, AppShell, global CSS or shared UI primitives.

The graph view keeps one authoritative result and separate view state: enabled categories, direction, hop limit,
search term, focused/selected node or edge, positions and transform. Drag/zoom/focus never mutates the result.
The SVG shows directed edges and contract labels; the detail panel explains exact release/index/source and selected
contract. An accessible relationship table mirrors all rendered nodes/edges.

## 10. Configuration, compose and rollback

Server-only config: `SEMANTIC_RELATIONSHIP_INDEX_ENABLED`, `NEO4J_URI`, `NEO4J_DATABASE`,
`NEO4J_USERNAME`, credential SecretRef/environment binding, connection acquisition timeout, transaction timeout
and batch size. Validation fails closed without echoing values.

Compose adds an independently health-checked Neo4j service and an indexer process, but Web/PostgreSQL do not
depend on Neo4j. The feature flag off path never initializes the driver. Rollback disables the flag/stops indexer;
M2 PostgreSQL Explorer remains complete.

## 11. Test and benchmark strategy

- Contracts/pure kernel: strict parse, digest, duplicate/dangling, category mapping and fallback traversal.
- PostgreSQL 17: clean install, checksum/ledger, grants/RLS, job discovery/claim/lease/fence/commit/fail/reconcile,
  cross-scope isolation and pointer swap race.
- Neo4j integration: constraints, staging invisibility, exact seal, idempotent rebuild, crash/retry, cleanup,
  digest mismatch, unavailable and full rebuild after deletion.
- Service/API/Agent: exact hydration, before/after fence, redaction, no-store, stable errors and parity.
- UI: filters/labels/focus/drag/zoom/detail/table accessibility and DOM ceilings.
- Benchmark: deterministic 10k manifest and representative sparse/dense traversals with structured nonzero gate.
- Headed browser: Neo4j source, fallback source, active refresh, category filters, search focus, edge detail and
  clean console.

## 12. Owned-file boundary

M2.1 may modify/add contracts relationship-index files, semantic relationship-index files, platform Neo4j/index
adapters, 10625 migration/test support, worker semantic indexer/tool executor, Explorer-specific route/components/
tests, compose/Docker dependency wiring, benchmark/render scripts, package manifests/lockfile, narrow architecture
tests and this task. It must not stage or revert existing DataFoundry, `/semantic`, Sidebar, AppShell, global CSS,
shared UI primitive, `tsconfig.tsbuildinfo`, parent roadmap or unrelated task changes.
