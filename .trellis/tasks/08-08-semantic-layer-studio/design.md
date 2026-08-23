# Semantic Layer Studio Delivery — Design

## Architecture Boundary

```text
PostgreSQL Catalog ──> PhysicalSchemaSnapshot ──> SchemaDriftEvent ─┐
                                                                    ├─> SemanticChangeProposal
User Metric/Formula ──> MetricAuthoringBrief ──> Formula AST ───────┘

SemanticChangeProposal
  -> immutable CandidateRevision
  -> deterministic ValidationReceipt + ImpactReport
  -> exact Human ReviewPacket
  -> transactional Publish/CAS
  -> active SemanticRelease
  -> Query Grounding + Studio read model
```

### Authority plane

PostgreSQL owns all mutable authority and immutable revision history. Candidate content is not runtime
truth. Approval binds exact revision, catalog snapshot, compiler/validator identity, policy and
membership. Publish revalidates those bindings inside one transaction.

### Projection plane

Web read models and graph views are rebuilt from the active PostgreSQL release. They may be cached and
discarded. A future Neo4j projection cannot write Candidate, Review, Release or Active Pointer state.

### Agent plane

Agent tools read snapshots and releases, build proposals, validate, preview impact and submit review.
Approve, publish, rollback, policy mutation and raw-secret access are absent from the tool surface.

## Milestone Task Tree

| Child | Depends on | Output |
|---|---|---|
| M0 Authority and Safety | approved roadmap | production fail-closed service, canonical candidate/release inputs, secret-ref boundary |
| M1 Schema Discovery | M0 | PostgreSQL adapter, snapshot, drift, read-only UI |
| M2 Semantic Explorer | M0 + M1 read models | Explorer tree/table/graph/detail/diff/lineage |
| M3 Schema Candidate | M1 + M2 | deterministic features + AI candidate generator |
| M4 Metric Authoring Agent | M3 governance path | clarification, Formula AST, compile/impact, candidate |
| M5 Runtime Closure | M0 + M2 + M4 | active release to exact Query Grounding and rollback E2E |
| M6 Optional Extensions | measured post-M5 need | extra engines and optional rebuildable graph projection |

## Compatibility

- Reuse `SemanticSourceBundle`, Candidate state, Validation Receipt and U5 compiler contracts.
- Add contracts and migrations additively; do not rewrite an already-applied migration in place.
- Preserve current Review Workspace as the Govern view while Explorer and Builder are introduced.
- Use feature flags for UI surfaces, but never feature-flag around Authority validation.

## Rollout and Rollback

- Each milestone ships behind a capability/read flag until its own Gate passes.
- Database changes are expand-first and append-only; rollback disables the writer or moves active
  pointer forward to a previously verified payload.
- Existing Query Runs keep their frozen release identity.
- Parent integration closes only after M5; M6 is optional and cannot delay the PostgreSQL-first release.
