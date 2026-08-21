# Governed Table and VChart Answers — Implementation Plan

## 0. Planning Gate

- [x] Inspect current Artifact contracts, preview service/API, Product Team tools/store, activity assembler, Inspector and export authority.
- [x] Evaluate official VChart React integration, record the React 19 container failure, and lock verified Core `vchart-simple` (`2.1.6`).
- [x] Define versioning, authority, visualization eligibility, accessibility and rollback boundaries.
- [x] Receive explicit user approval of this final PRD/design/plan before `task.py start`.

## 1. Baseline and Task Activation

- [x] Start `08-21-qa-table-vchart` only after approval.
- [x] Load `trellis-before-dev`; re-read relevant backend/frontend specs and this task’s research.
- [x] Record focused Contracts/Platform/Worker/Web validation baseline before final checks.
- [x] Recheck dirty worktree and preserve `next-env.d.ts`, `tsconfig.tsbuildinfo`, knowledge-semantic task and Falcon artifacts.

## 2. Contracts

- [x] Add V2 Chart projection/document/preview strict schemas and renderer/transform version constants while preserving V1 exports.
- [x] Implement canonical dataset/document hash builders and verifiers.
- [x] Enforce chart type, field binding, same-run QueryEvidence source, resolved-context identity, complete bounded dataset, payload/series/point/label/value constraints.
- [x] Add V1 compatibility, V2 positive, tamper, bad field, non-finite/null, negative/zero-sum pie and limit tests.

Validation:

```bash
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts exec vitest run test/artifact-workspace-vchart.spec.ts test/product-team-artifact.spec.ts
```

## 3. Platform Authority and Sandbox

- [x] Add pure QueryEvidence-to-chart projector for LINE/BAR/PIE with deterministic sort/null/fallback rules.
- [x] Extend Product Team Artifact store with a separate V2 Workspace Chart commit port: exact hash/source/principal/scope/run/fence checks and idempotency conflict closure.
- [x] Return V2 chart as one complete bounded dataset in `projectArtifactDocument`; preserve V1 table windowing behavior.
- [x] Add monthly order trend SQL compiler/executor under the existing read-only e-commerce sandbox limits and allowlist.
- [x] Add projector/hash/shape tests, sandbox SQL tests, and prove store authority in the isolated PostgreSQL vertical.

Validation:

```bash
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform exec vitest run \
  test/artifacts/artifact-workspace-service.spec.ts \
  test/agents/postgres-product-team-artifact-store.spec.ts \
  test/sandbox/postgres-ecommerce-benchmark-executor.spec.ts \
  test/runs/agent-dispatch-planner.spec.ts
```

## 4. Planner and Worker

- [x] Add deterministic trend/comparison/composition reason-code classification and canonical sorting to the adaptive plan; keep non-data/legacy behavior unchanged.
- [x] Change the private Tool return boundary to `output_ref + public_artifact_refs`; validate same-run uniqueness and publish only successful commit results.
- [x] Keep QueryEvidence as Text2SQL task output; commit optional V2 Chart as public companion after eligible sandbox evidence.
- [x] Pass frozen dispatch plan and resolved-context identity to the tool factory without passing raw question/provider internals.
- [x] Emit Tool COMPLETED with both exact refs; keep Report accepted-evidence flow unchanged.
- [x] Cover trend, no-chart scalar, invalid shape fallback, replay/idempotency, public-ref scope, Report regression and exact event order.

Validation:

```bash
pnpm --filter @data-agent/worker typecheck
pnpm --filter @data-agent/worker exec vitest run \
  test/teams/mastra-profile-composition.spec.ts \
  test/teams/production-team-tools.spec.ts \
  test/teams/production-team-runtime.spec.ts \
  test/teams/data-agent-team-runner.spec.ts
```

## 5. Web Dependencies and Shared Rendering

- [x] Install and lock the verified Core package:

```bash
pnpm --filter @data-agent/web add @visactor/vchart@2.1.6
```

- [x] Add Artifact activity block projection keyed by exact event sequence/ref; reject START/future inference and duplicate replay.
- [x] Extract shared `ArtifactPreviewPanel` for Inline and Inspector with abort/generation guard, exact-ref validation, loading/error and page state.
- [x] Upgrade table renderer with declared types, null semantics, current range/total/truncation, local horizontal scroll and keyboard pagination.
- [x] Add dynamic `GovernedVChart` Core leaf with local constant LINE/BAR/PIE mapping, fixed skeleton, reduced motion, error state and no untrusted spec spread.
- [x] Add “查看数据表” using the exact shared table projection.
- [x] Display source type/revision/hash, QueryEvidence citation, dataset hash, resolved-context identity and truncation metadata.
- [x] Preserve the existing async Export Authority/route and add no client-side CSV/XLSX synthesis or inferred-permission control.
- [x] Apply `design-taste-frontend` density hierarchy to data surfaces only, using existing semantic tokens and restrained glass reading surfaces.

Validation:

```bash
pnpm --filter @data-agent/web exec vitest run \
  test/qa-event-assembler.spec.ts \
  test/chat-message-activity.spec.tsx \
  test/artifact-workspace-component.spec.tsx \
  test/qa-inspector-component.spec.tsx \
  test/governed-vchart.spec.ts \
  test/artifact-export-routes.spec.ts
pnpm --filter @data-agent/web test:unit
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web build
```

## 6. Cross-Layer and Security Check

- [x] Run scoped Biome on owned files and `git diff --check`.
- [x] Verify V1 fixtures still parse/render and old runs have no synthetic Chart Artifact.
- [x] Verify arbitrary spec/function/HTML/external URL/unknown chart type cannot cross Contracts or mapper.
- [x] Verify denied/stale/unsupported/hash mismatch/limit/page drift/export failure have stable public codes and no raw fallback.
- [x] Inspect production bundle/chunks and prove no-chart Q&A does not load VChart runtime.
- [x] Run Trellis check; resolve discovered V2 completeness, React wrapper lifecycle, provenance and accessibility findings.

## 7. Real Vertical Acceptance

- [x] Keep Web, PostgreSQL, Worker and Indexer running; report Semantic Authoring’s independent readiness separately.
- [x] Execute a real Chinese monthly-order-trend question under ENFORCED adaptive dispatch.
- [x] Prove the Run selects only actual required Subagent(s), commits QueryEvidence + V2 Chart, and publishes both refs on the completed Tool event.
- [x] Capture 1440x1000, 1024x768 and 390x844 screenshots for Inline chart, equivalent table and exact Inspector preview.
- [x] Verify Enter/Space, pagination semantics, reduced motion, refresh/replay, Inspector persistence and `document.scrollWidth === document.clientWidth`.
- [x] Save run IDs, ref identities, event sequences, screenshots and bundle evidence under this task’s `evidence/`.

## 8. Finish

- [x] Update relevant Trellis specs only for reusable, verified conventions.
- [ ] Commit only owned task/product files in one scoped work commit.
- [ ] Archive the task in a separate scoped task-state commit if Trellis archive moves files.
- [ ] Record session journal commit without unrelated dirty files.
- [x] Do not claim parent integration/release complete; remaining child tasks and final parent vertical acceptance remain separate.

## Rollback Points

- Contract/Platform rollback: stop before Worker publication if V2 exact hash/source closure is not proven.
- Worker rollback: disable new visualization reason codes; QueryEvidence TABLE flow remains authoritative.
- Web rollback: keep shared TABLE/Inspector renderer and remove dynamic VChart leaf; V2 Artifact remains safely inspectable as equivalent table.
- Never delete committed Artifact revisions or rewrite prior task commits to roll back this feature.
