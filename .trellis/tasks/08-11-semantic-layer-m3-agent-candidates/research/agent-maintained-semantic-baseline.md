# Agent-maintained Semantic Candidate Baseline

## Research conclusion

The target architecture separates Raw/Evidence, Candidate, Published Release and Runtime Projection.
The Agent maintains candidate operations; deterministic validation and human review maintain published
semantic authority. Graph and vector stores are rebuildable release-scoped projections.

The full reader answer is preserved at:

`/Users/lienli/Documents/work/深度调研/research/ontology-learning/answers/RQ020-如何设计一套由物理数据库-业务指标-公式和知识库共同驱动-Agent-编译候选-Node-Edge-人工审核发布-并以活动语义图优先服务-SQL-与-RAG-召.md`

## M3 implications

- Reuse Graphiti-like episode/evidence, entity resolution, dedupe, temporal validity and hybrid search
  ideas only in Candidate/Evidence behavior; do not import automatic write authority.
- Bind every operation to raw source evidence and exact compile identity.
- Keep physical, business, analytical and evidence relationships distinct.
- Treat semantic-first as graph-constrained hybrid retrieval, not graph-only retrieval.
- Defer knowledge document ingestion and metric formula authoring to separate milestones that reuse the
  same Source/Evidence/CompileRun/Candidate contracts.

## Repository evidence

- M0: `.trellis/tasks/archive/2026-08/08-08-semantic-layer-m0-authority-safety/evidence.md`
- M1: `.trellis/tasks/archive/2026-08/08-08-semantic-layer-m1-schema-discovery/check.md`
- M2: `.trellis/tasks/archive/2026-08/08-09-semantic-layer-m2-explorer/`
- Parent roadmap: `docs/plans/2026-08-08-001-semantic-layer-studio-roadmap.md`
