# M2 Semantic Explorer — Design

## 1. Decision summary

1. PostgreSQL active pointer 和 immutable release/projection 继续是唯一 Authority；Explorer 是可重建
   read model。
2. 活动视图只读 release 精确绑定的 projection，不从 candidate current revision 猜回完整 source。
3. 为完整展示添加 release-bound `explorer_sidecar@1.0.0`，而不是新增图数据库或第二张活动指针。
4. Candidate 只作为独立 comparison envelope；active objects/counts/graph 永不吸收候选节点。
5. M2 新页面和组件自包含，不修改当前脏工作区的 `/semantic`、Sidebar、AppShell 和 global CSS。

## 2. End-to-end read path

```text
server PostgreSQL Capability
  -> semantic.get_active_explorer_source(...) READ RPC
  -> pointer + exact release + exact three projections (one statement snapshot)
  -> strict raw-envelope decoder
  -> identity/digest/release-binding checks
  -> runtime-restriction redaction
  -> deterministic SemanticExplorerSnapshot
  -> no-store API
  -> one parsed client snapshot
  -> tree | table | bounded graph | detail | diff | lineage

exact candidate revision
  -> candidate comparison RPC
  -> strict diff + base identity
  -> candidate | stale comparison band
  -X-> active objects / active graph / active counts
```

The RPC result is obtained by one SQL statement, so pointer and projections share the statement snapshot.
Projection payloads are immutable after publish. `pointer_generation` is the response freshness fence; release
generation alone is not used as a client ordering token.

## 3. Contracts

Add `packages/contracts/src/artifacts/semantic-explorer.ts` and export it from the existing artifacts facade.
The public root object is:

```ts
type SemanticExplorerSnapshot = {
  schema_version: "semantic-explorer-snapshot@1.0.0";
  authority: "POSTGRESQL";
  release_identity: {
    semantic_domain: string;
    release_id: string;
    release_generation: number;
    release_digest: `sha256:${string}`;
    executable_projection: ProjectionIdentity;
    relationship_projection: ProjectionIdentity;
    runtime_restriction_projection: ProjectionIdentity;
    published_at: string;
  };
  pointer_observation: {
    current_release_id: string;
    current_release_generation: number;
    current_release_digest: `sha256:${string}`;
    pointer_generation: number;
    observed_at: string;
  };
  is_active: boolean;
  capabilities: {
    business_ontology: boolean;
    physical_binding: boolean;
    catalog_governance: boolean;
  };
  objects: readonly SemanticExplorerObject[];
  edges: readonly SemanticExplorerEdge[];
  counts: SemanticExplorerCounts;
};
```

Object identity is a tuple `{ kind, object_id }`; it is never formed by delimiter concatenation. Object kinds are
`business_entity | business_event | business_term | metric | dimension | relationship | datasource`.
`table/column` remain physical binding detail, not fake business entities. Edge kinds are explicit:
`metric_dependency | dimension_hierarchy | analytical_relationship | business_relationship | physical_binding`.

Active object state is `published | deprecated`. Candidate comparison has a separate union with
`candidate | stale`; these values are intentionally impossible in `SemanticExplorerSnapshot.objects`.

The executable projection gains an optional, additive sidecar:

```ts
type SemanticExplorerSidecar = {
  schema_version: "semantic-explorer-sidecar@1.0.0";
  business_ontology: BusinessOntology | null;
  relationships: readonly SemanticRelationship[];
  formula_signatures: readonly FormulaSignature[];
  physical_binding: PhysicalBinding | null;
  catalog_governance: CatalogGovernance | null;
  sidecar_digest: `sha256:${string}`;
};
```

The compiler derives it from an already validated `SemanticSourceBundle`; `sidecar_digest` covers the sidecar
material excluding itself. Existing projections may omit it and remain readable with capability flags false.

Raw source envelopes carry `source_kind: ACTIVE | HISTORICAL`. The active builder requires pointer and requested
release identity to match exactly. The historical builder still returns the real current pointer observation but
may bind a different immutable release and sets `is_active=false`; it never synthesizes a pointer for history.

## 4. PostgreSQL surface

Create additive migration `10624` from source segments and a checked renderer. It adds no authority table.
It adds narrow `SECURITY DEFINER`, `search_path=''` READ functions:

- `semantic.list_explorer_domains(uuid, uuid, text, uuid, text[])`;
- `semantic.get_active_explorer_source(uuid, uuid, text, uuid, text)`;
- `semantic.get_release_explorer_source(uuid, uuid, text, uuid, text, uuid)`;
- `semantic.list_explorer_releases(uuid, uuid, text, uuid, text, integer, bigint)`;
- `semantic.get_candidate_explorer_comparison(uuid, uuid, text, uuid, text, uuid, uuid)`.

Every function compares `data_agent.*` settings, calls `platform.backend_context_matches(..., false)`, and applies
full scope predicates. Active source validates:

- pointer has a non-null current release;
- release ID/generation/digest equal pointer fields;
- all three projection rows exist under the same scope/domain/release;
- row projection IDs/digests equal the release-bound refs/hashes.

`data_agent_backend` receives only exact function `EXECUTE`; direct privileges on active pointer, source release
and the three projection tables are revoked and verified. `authenticated`/Public receive no schema/function/table
access. Projection mismatch raises a stable marker which the adapter maps to a redacted Explorer error.

## 5. Deterministic builder and redaction

`packages/semantic/src/explorer/` owns strict parsing and pure construction:

1. parse raw envelope and the three versioned payloads;
2. verify release/projection identity binding and sidecar hash;
3. build a structural key map and reject duplicates;
4. derive denied column/table sets from runtime restriction without exporting the policy payload;
5. remove denied objects and all bindings/dependencies/edges that would expose them;
6. build explicit objects and edges, then assert all edge endpoints exist;
7. stable-sort by kind and object ID, recompute counts, freeze the result.

`DENY` removes the referenced object/material. `RESTRICT` never exposes predicates or parameter keys; the UI only
gets a boolean restricted marker when the high-level semantic object remains visible. If the implementation cannot
prove a field is displayable, it omits that field or the object. Object-not-found and object-not-visible collapse to
the same public response.

Lineage is graph reachability over the already filtered edge index. It has cycle detection, a six-hop ceiling,
250-node/500-edge response ceiling and an explicit `truncated` flag. A path is a dependency/navigation path only;
no causal or contribution semantics are inferred.

Release diff compares two exact immutable snapshots, keyed by structured identity and canonical object digest.
Candidate comparison consumes the exact immutable revision and its declared deterministic diff; it never parses
generic candidate content into active objects in M2.

## 6. Web boundary and state

Web 是 M2 的 server composition root。为让 Web 只消费 `@data-agent/semantic` 的统一 read-model kernel、
不复制或重解释 raw projection，workspace 依赖矩阵增加单向 `app -> semantic -> contracts`；Semantic
仍不得依赖 App、Platform 或 Runtime，因此不会形成反向耦合或 Authority 下沉。

Add thin route handlers for:

```text
GET /api/semantic/releases/active?domain=...
GET /api/semantic/releases?domain=...&cursor=...
GET /api/semantic/releases/:releaseId?domain=...
GET /api/semantic/releases/:releaseId/diff?domain=...&base=...
GET /api/semantic/objects/:objectId?domain=...&kind=...&releaseId=...
GET /api/semantic/objects/:objectId/lineage?domain=...&kind=...&releaseId=...
GET /api/semantic/candidates/:candidateId/comparison?domain=...&revisionId=...
```

Routes accept only strict identifiers and domain. Scope/principal/role/digests/payloads come from server
Authority. Responses set `Cache-Control: private, no-store` and stable error envelopes.

The page lives at `apps/web/src/app/semantic/explorer/page.tsx`; components live under a new
`apps/web/src/components/semantic/explorer/` directory. A feature-local reducer holds
`loading | empty | error | permission-denied | success` plus view-only selection/search/toggle state. A response
may replace current server state only when domain/request epoch matches and its `pointer_generation` is not lower.
AbortController cancels superseded requests.

Tree, table, graph and detail all receive the same parsed snapshot object. Table/tree are windowed. Graph stores
the full edge index but renders only the selected bounded neighborhood as accessible SVG. The page uses only stable
existing color/text/border tokens and does not require dirty DataFoundry CSS.

## 7. Performance and observability

`scripts/semantic-explorer-benchmark.ts` generates a deterministic 10k-object fixture, performs warmup and measured
runs, and emits JSON with p50/p95, heap delta, object/edge counts and budgets. It exits nonzero on the PRD limits.
The PG17 integration fixture measures the warm active RPC/API path separately. Browser proof records initial usable
render, selection/filter latency, DOM object-row count and bounded graph node/edge count.

Runtime logs may include domain, release ID, pointer generation, object/edge counts, duration and stable reason code.
They may not include raw projection payload, restriction predicates, candidate content, SQL or database errors.

## 8. Test strategy

- Contract: strict parse, unknown fields, discriminated states, structured identity and round-trip.
- Semantic pure tests: duplicate/collision, dangling edge, sidecar hash, status mapping, redaction, counts, diff,
  lineage cycle/ceiling and candidate non-merging.
- Compiler tests: sidecar determinism and existing projection compatibility.
- Platform/PostgreSQL: clean install, checksum/ledger, exact grants, scope isolation, missing/mismatched projection,
  active pointer swap, candidate exact revision and no direct Backend table access.
- Route/state: input rejection, redaction, no-store, permission/object indistinguishability, out-of-order generation.
- UI: one snapshot identity across all views, accessible controls/SVG, state labels, capability gap and DOM ceilings.
- Headed browser: active generation refresh, table/graph/detail navigation, release diff, candidate/stale band and
  clean console.

## 9. Rollout and rollback

`SEMANTIC_EXPLORER_ENABLED` gates only the read surface. Disabled state links back to Review Workspace. Migration is
expand-only; rollback revokes/ignores the read functions or disables the flag. It never changes release data or
active pointer. Historical releases without sidecar remain readable in reduced-capability mode.

## 10. Owned-file boundary

M2 may add/modify only contracts/semantic Explorer modules, the additive 10624 migration and renderer,
Explorer-specific platform/Web modules/routes/components/tests/scripts, the narrow workspace architecture matrix
and its dependency-boundary test, and this Trellis task. It must not modify
the current dirty `/semantic` page, Sidebar, AppShell, global CSS, DataFoundry stores, `tsconfig.tsbuildinfo`, or
unrelated task artifacts.

## 11. M2.1 handoff — PostgreSQL Authority + Neo4j relationship search

The requested rich relationship graph is an additive follow-up boundary, not a change to semantic Authority:

- PostgreSQL remains the only authority for semantic objects, formulas, release/pointer identity, permissions,
  review and publish. Neo4j may never approve, publish, roll back or write back semantic truth.
- Neo4j stores a rebuildable, release-scoped relationship-search projection. Every node and edge is keyed by
  `semantic_domain + release_id + release_digest + kind + object_id/edge_id` and carries the projection digest used
  to build it. Only the minimum searchable labels and relationship contracts are copied; restriction payloads,
  predicates, credentials and unpublished candidate content are excluded.
- The active release is resolved from PostgreSQL first. A Neo4j result is displayable only when its exact release
  and projection digests match that PostgreSQL observation. Lag, mismatch or an unavailable Neo4j instance yields
  an explicit `INDEX_NOT_READY`/fallback state; it never silently becomes current truth.
- Publication emits an idempotent indexing job after the PostgreSQL commit. Reconciliation compares PostgreSQL
  release manifests with Neo4j counts/digests, supports full rebuild, and records index checkpoints in PostgreSQL
  as operational state rather than semantic Authority.
- Relationship search is bounded by domain, exact release, edge kinds, hop count, node/edge ceilings and server
  timeout. Neo4j credentials stay server-side and all results still pass the PostgreSQL capability fence.
- Agent parity uses the same server-owned read service: list domains, resolve the active exact release, search
  objects/relationships, diff releases, read bounded lineage and compare a candidate. No Agent tool may approve,
  publish, roll back, mutate policy or query Neo4j without the PostgreSQL release/capability fence.

The graph UI target follows the supplied sales semantic graph: filterable `BIZ / JOIN / FORMULA / BIND / GOVERN`
edges with visible direction and contract labels, search-to-focus, drag/zoom, node/edge detail, path traversal and
an accessible table fallback. Compiler/runtime use remains fail-closed: a Neo4j traversal is navigation evidence,
not an executable Join or formula, until the exact PostgreSQL release contract validates it.

M2.1 exit gates are: Neo4j-offline Explorer fallback, idempotent rebuild/reconciliation, cross-domain isolation,
digest mismatch rejection, Agent/UI read parity, bounded traversal/search performance, and headed-browser proof
against the rich graph interaction target. M2 closes the PostgreSQL-authoritative exact-release read model first
so the index has a stable source to mirror.
