# U12 Resolved Context Design

## Authority flow

```text
PREVIEW defaults_ref ─┐
                     ├─ PostgreSQL load Authority Snapshot
RUN config/context ──┘      ├─ active Published Release + projections
                            ├─ exact Schema Snapshot + policies
                            └─ governed Knowledge refs
                                      ↓
                           pure Semantic resolver
                    Metric → Ontology/Text2SQL → Knowledge → Graph
                                      ↓
                         deterministic capacity planner
                                      ↓
                      Resolved Context Package + Receipt
                                      ↓
                 PostgreSQL exact revalidation / append-only commit
```

## Contracts

`context/resolved-context-package.ts` defines PREVIEW/RUN requests, a common Authority Snapshot, published Metric/ontology/relationship/knowledge summaries, route/clarification results, capacity decisions, a content-addressed package, consumer-specific receipt and strict RPC envelopes.

The package hash excludes consumer/request/run identity. It includes the normalized question hash, exact semantic/schema/policy refs, projection policy, route decision, selected summaries and capacity decisions. Preview and Run can therefore share a package hash while retaining separate receipts.

## Semantic kernels

`metric-resolver.ts` performs Unicode NFKC case-folded phrase matching only against published Metric names/aliases. Zero matches falls through; one selects; multiple emit canonical clarification candidates.

`context-router.ts` applies the fixed capability order. Ontology/Text2SQL requires an exact published term/entity plus queryable mapping summary. Knowledge is returned as an on-demand governed reference, never as uncommitted raw chunks. Graph is last and only uses the published relationship projection.

`context-capacity-policy.ts` counts canonical UTF-8 bytes. Authority refs, policies and selected mapping are mandatory. Optional evidence is sorted by priority/kind/ref and included until capacity; the remainder is marked CROPPED/OMITTED/ON_DEMAND. No price, credit or billing field exists.

## PostgreSQL and Platform

Greenfield migration `10663_app_data_agent_resolved_context` adds one append-only receipt table and two narrow RPCs: `load_resolved_context_authority_snapshot(request)` and `commit_resolved_context_receipt(request, package, receipt)`. PREVIEW resolves current Defaults; RUN resolves Effective Config and Context Receipt. Commit revalidates active Release, Snapshot, policies, knowledge refs, RUN lease/fence, hash closure and replay.

The SQL does not persist raw question or raw content; only question/package hashes and bounded summaries are stored.

## Worker and Web

Worker receives a run-bound context resolver capability created in the composition root. `research-workflow-executor` must resolve successfully before invoking the existing opaque Provider dispatch capability and emits only public-safe route/hash summaries.

Web preview reads current Workspace Defaults, builds a PREVIEW request server-side, calls the same Platform resolver, and returns the resolved package/receipt. The component renders state, exact release/snapshot, route, capacity and evidence decisions. It never creates a Run.

## Verification

Red-first tests cover exact/ambiguous Metric resolution, route order, capacity, preview/run parity, stale/tampered authority, lease/fence and replay. Fresh PG17 maps both import hooks to `/dev/null` and runs only U12 assertions. No Provider or Falcon execution is allowed.
