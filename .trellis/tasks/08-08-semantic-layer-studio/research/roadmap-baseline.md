# Roadmap Baseline

- Canonical product roadmap: `docs/plans/2026-08-08-001-semantic-layer-studio-roadmap.md`.
- Research authority: `data-agent-system-design/RQ311–RQ317` under the external research workspace.
- Existing implementation assets: semantic source contracts, Candidate/Validation contracts, U5
  compiler, 10610 semantic control-plane migration, Review Workspace and PostgreSQL service adapter.
- Delivery invariant: PostgreSQL is the only write authority; Agent and graph capabilities remain
  candidate/projection only.
- Current worktree is dirty from user-owned DataFoundry work. Every child must record pre-edit paths,
  preserve unrelated diffs and stage only files owned by that child.
