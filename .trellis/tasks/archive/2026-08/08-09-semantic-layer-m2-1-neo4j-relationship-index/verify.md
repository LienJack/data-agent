# M2.1 Verification Evidence

Verified on 2026-08-09 against the task-owned working tree.

## Automated gates

| Gate | Evidence |
| --- | --- |
| Contracts | 32 files, 559 tests passed |
| Semantic kernel/service | 9 files, 94 tests passed |
| Platform unit | 29 files, 233 tests passed |
| Agent runtime | 14 files, 114 tests passed |
| Worker | 3 files, 42 tests passed |
| Web | 16 files passed, 1 skipped; 72 tests passed, 1 skipped |
| Root typecheck | 14 Turbo tasks passed plus `typecheck:u6-c2` |
| Architecture | 6 Turbo tasks passed; Research architecture 10/10 |
| Scoped Biome | Exact M2.1 TypeScript/TSX/JSON/MJS list passed |
| Migration renderer | 10625 checksum `sha256:e4087361a32b28d408737a822ef5828ccd9c94b71f6622ce04118228c96653c3` |
| PostgreSQL 17 | Fresh install and semantic authority assertions passed |
| Neo4j | Real `neo4j:2026.06.0` staging/seal/rebuild/cleanup/delete/rebuild integration passed |
| Benchmark | 10,000 nodes, 9,999 edges, 25 warm searches; all budgets passed |
| Web production | Local Next build and Docker image build passed |
| Worker production | Docker image build passed; `/live` returned HTTP 200 ready |
| Compose | `--profile relationship-index config --quiet` passed; Neo4j and indexer healthy |
| Trellis | Task context validation passed |

Benchmark observation:

```json
{
  "neo4j_warm_search_p95_ms": 16.239875,
  "service_candidate_hydration_p95_ms": 16.248292,
  "ui_interaction_p95_ms": 0.002875,
  "budgets_ms": [300, 1500, 100],
  "passed": true
}
```

## Headed-browser proof

- Rendered the real `ExplorerWorkspace` and relationship graph with strict public DTO fixtures.
- Verified `NEO4J/READY`, `POSTGRESQL_FALLBACK/INDEX_DISABLED`, category filtering, direction and hop controls.
- Verified active refresh, term-to-node focus, directed edge label/contract detail and traversal explanation.
- Drag changed the node transform; zoom changed graph scale; keyboard Enter selected an edge from the accessible table.
- Reopened a clean session after live editing; no console or page errors remained.
- The temporary fixture route and browser session were removed after proof.

## Rollback and boundary

- Feature-off uses PostgreSQL bounded fallback without constructing the Neo4j driver.
- Web and PostgreSQL have no Neo4j startup dependency; stopping the optional indexer/Neo4j profile preserves Explorer reads.
- Exact staging excludes DataFoundry, Sidebar, `/semantic`, global CSS, UI primitives, `next-env.d.ts`,
  `tsconfig.tsbuildinfo`, parent roadmap and unrelated task files.
