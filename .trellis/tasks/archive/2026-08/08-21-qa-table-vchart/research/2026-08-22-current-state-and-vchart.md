# Current State and VChart Research — 2026-08-22

## Repository Findings

- `packages/contracts/src/artifacts/export-receipt.ts`
  - V1 TABLE supports up to 256 columns and 10,000 stored rows.
  - V1 CHART supports BAR/LINE/POINT but has only title/x/y/table fields.
  - Preview already carries full source reference and viewport.
- `packages/contracts/src/artifacts/product-team-artifact.ts`
  - Product Team output is limited to SqlArtifact, QueryEvidence and AnalysisReport.
  - QueryEvidence must be TABLE and remains the correct Text2SQL acceptance output.
- `packages/platform/src/artifacts/artifact-workspace-service.ts`
  - Preview verifies workspace/product-team documents and exact source identity/hash.
  - Only TABLE currently receives viewport slicing; CHART returns its full nested table.
- `packages/platform/src/agents/postgres-product-team-artifact-store.ts`
  - Product Team commit verifies same scope/run, principal ownership, active worker fence and committed source refs.
  - Generic `artifacts.document_json` can store a strict `ArtifactWorkspaceDocument`; no new table is needed.
- `apps/worker/src/teams/mastra-profile-composition.ts`
  - Tool port currently returns one `ArtifactReference | null` and publishes only that reference.
  - Acceptance consumes the final returned ref, so a chart cannot replace QueryEvidence.
- `apps/worker/src/teams/production-team-tools.ts`
  - Current real demo compiles/executes a table-count query and commits QueryEvidence TABLE.
  - Report consumes accepted QueryEvidence and must remain unchanged.
- `packages/platform/src/runs/agent-dispatch-planner.ts`
  - Planner sees the raw question and freezes a strict hashed plan.
  - Worker receives question class/reason codes, not raw question; visualization intent belongs here.
- `apps/web/src/components/workbench/artifact-workspace.tsx`
  - TABLE is a basic local-scroll table; CHART is a `<dl>` key/value list.
- `apps/web/src/lib/qa-event-assembler.ts` and `apps/web/src/components/qa/qa-inspector.tsx`
  - Public events are deterministically replayed by sequence.
  - Inspector resolves an exact ArtifactReference through the safe preview API.
  - A shared Inline/Inspector preview shell is the smallest parity-preserving change.
- Existing export API submits an authority-backed `ARTIFACT_EXPORT` Job and downloads only from an immutable receipt/output hash. Client-generated CSV would violate the existing boundary.

## VChart Official Sources

- React integration: <https://visactor.io/vchart/guide/tutorial_docs/Cross-terminal_and_Developer_Ecology/react>
  - Official wrapper is `@visactor/react-vchart`.
  - It supports unified `VChart` spec and semantic React tags.
- Getting started: <https://visactor.io/vchart/guide/tutorial_docs/Getting_Started>
  - Core package is `@visactor/vchart`; chart container requires deterministic dimensions.
- On-demand loading: <https://visactor.io/vchart/guide/tutorial_docs/Load_on_Demand>
  - `VChartSimple` plus a supplied constructor supports on-demand registration/loading.
- Import guidance: <https://visactor.io/vchart/guide/tutorial_docs/Basic/How_to_Import_VChart>
  - Official package supports tree-shaking and explicit component registration.
- Animation configuration: <https://visactor.io/vchart/guide/tutorial_docs/Animation/Animation_Attributes_and_Settings>
  - Animation is configurable；本任务在 reduced-motion 下关闭，并避免叙事动画。
- Official repository: <https://github.com/VisActor/VChart>
  - React wrapper and core live in the same MIT-licensed project.

Package registry check on 2026-08-22:

```text
@visactor/vchart        2.1.6
@visactor/react-vchart  2.1.6
```

## Chosen Approach

- Lock `@visactor/vchart` to exact version `2.1.6` and import its registered `esm/vchart-simple` entry.
- Use a dynamically loaded client leaf, a local controlled spec mapper, and explicit Core `renderSync()` / `release()` lifecycle.
- Do not accept a model-provided spec even though the official React wrapper permits arbitrary specs; the project’s security boundary is stricter than the library API.
- Always render an equivalent native table because canvas/SVG tooltip interaction is not an accessible data substitute.
- Preserve V1 and add a versioned V2 Chart document/preview instead of modifying strict V1 schemas.

## Runtime Compatibility Finding

The first real React 19 browser run with `@visactor/react-vchart@2.1.6` failed with `please specify container or renderCanvas!`. A direct named Core import then failed because no chart registrations were installed. The verified solution is the package's `vchart-simple` entry, which registers LINE/BAR/PIE and required axes/tooltips while retaining an isolated dynamic chunk. The React wrapper was removed from the final dependency graph.

## Rejected Alternatives

- **Render QueryEvidence directly as an inferred chart in Web**: rejected because it loses a committed Chart identity, transform hash and replay parity.
- **Make Chart the Text2SQL completion output**: rejected because Report and task acceptance require QueryEvidence.
- **Add a new `ChartArtifact` known type**: rejected for the first version because `ArtifactWorkspaceDocument` already exists as the governed display document type.
- **Let Provider/model return VChart JSON**: rejected because functions/URLs/handlers and untrusted field bindings would cross the presentation authority boundary.
- **Client-side CSV from the current preview window**: rejected because it would look complete while bypassing Export Job/receipt/output hash authority.
