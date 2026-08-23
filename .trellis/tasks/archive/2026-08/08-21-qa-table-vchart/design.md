# Governed Table and VChart Answers — Design

## 1. Architecture Boundary

```text
Question
  -> deterministic dispatch planner
     -> frozen visualization reason code
  -> Text2SQL Tool chain
     -> committed QueryEvidence (accepted output)
     -> deterministic chart projector (optional)
        -> committed ArtifactWorkspaceDocument V2 (public companion)
  -> durable Tool COMPLETED event
     -> output_ref + public_artifact_refs
  -> pure QA activity assembler by sequence
     -> Inline ArtifactPreviewPanel
     -> Inspector ArtifactPreviewPanel
        -> exact Artifact Preview API
           -> shared ArtifactWorkspace renderer
              -> paged accessible table
              -> dynamic controlled VChart leaf + equivalent table
```

PostgreSQL/Artifact authority remains the source of truth. The planner owns question intent, the deterministic projector owns visualization eligibility, the Preview service owns safe slicing, and Web owns presentation only.

## 2. Contract Evolution

### 2.1 Preserve V1

Keep the existing V1 schemas and constants intact:

- `artifact-workspace-document@1.0.0`
- `artifact-preview-result@1.0.0`
- `artifact-workspace-renderer@1.0.0`

Export union decoders/types that accept V1 and V2. Existing V1 callers continue to parse and render without backfill.

### 2.2 V2 derived Chart document

Add a strict Chart-only branch:

```ts
type ArtifactWorkspaceChartDocumentV2 = {
  schema_version: "artifact-workspace-chart-document@2.0.0";
  document_ref: ArtifactReference<"ArtifactWorkspaceDocument">;
  source_refs: [ArtifactReference<"QueryEvidence">];
  provenance: {
    transform_version: "query-evidence-chart@1.0.0";
    dataset_hash: ContentHash;
    resolved_context: {
      package_id: UUID;
      package_hash: ContentHash;
      receipt_id: UUID;
      receipt_hash: ContentHash;
    };
  };
  projection: {
    kind: "CHART";
    chart_type: "LINE" | "BAR" | "PIE";
    title: string;
    description: string | null;
    unit: string | null;
    x_key: ColumnKey;
    y_keys: readonly ColumnKey[];
    legend: { visible: boolean };
    table: ArtifactWorkspaceTableProjection;
  };
};
```

`dataset_hash` is calculated from canonical columns, ordered rows, chart type, field bindings and unit. The document hash excludes only `document_ref.content_hash` and includes every other field. The QueryEvidence ref must be exact same scope/run, unique, already committed and the sole source.

The current runtime freezes a Resolved Context package/receipt identity rather than an `ArtifactReference<"SemanticRelease">`; V2 records that exact authority identity and does not falsely label it a direct SemanticRelease ref. A future semantic runtime can version the provenance branch when it exposes an exact SemanticRelease reference.

### 2.3 Preview V2

Add `artifact-preview-result@2.0.0` with renderer `artifact-workspace-renderer@2.0.0`. It returns the V2 projection and provenance metadata, plus the existing exact source ref and viewport. Preview union decoding is version-discriminated.

V2 CHART document 必须原子携带完整且受限的数据集（LINE ≤100、BAR ≤30、PIE ≤12，`total_rows === rows.length`）；preview 原样返回这一 bounded dataset，图表与等价表始终同源。普通 QueryEvidence TABLE 继续使用受控 offset/limit 分页。伪造的部分或超限 Chart document 以 `CHART_DATA_LIMIT_EXCEEDED` 或 strict input error 失败，绝不返回 raw JSON。

## 3. Intent and Eligibility

`planAgentDispatch` adds sorted reason codes without changing the existing plan schema:

| Intent | Deterministic question signals | Data gate | Output |
|---|---|---|---|
| TREND | 趋势、变化、走势、按月/周/日、over time | ordered x, 2–100 rows, numeric y | LINE |
| COMPARISON | 比较、排名、Top、最高/最低、按类别 | 2–30 categories, 1–4 numeric y | BAR |
| COMPOSITION | 占比、构成、份额、比例 | 2–12 categories, one nonnegative y, sum > 0 | PIE |
| NONE | other data query | n/a | TABLE only |

Intent matching is fail-closed and ordered from the more explicit composition/comparison forms before generic trend signals. Reason codes are canonical-sorted before plan hashing.

The Worker never receives raw question text. It consumes only the verified plan and checks both reason code and evidence shape. The chart projector is a pure function and cannot access Provider output.

## 4. Worker Artifact Flow

Replace the private `ProductProfileToolPort` return with:

```ts
interface ProductProfileToolResult {
  output_ref: ArtifactReference | null;
  public_artifact_refs: readonly ArtifactReference[];
}
```

`visibleToolPort` validates/deduplicates the public list and emits it on Tool COMPLETED. The workflow registry uses only `output_ref` for task success. Existing null/single-output tools are migrated mechanically.

For `sql.sandbox.execute`:

1. Commit `QueryEvidence(TABLE)` from the sandbox result.
2. If the frozen plan requests visualization, run the pure projector.
3. If eligible, build and commit `ArtifactWorkspaceChartDocumentV2` with source `[QueryEvidence]` under the same lease/fence transaction rules.
4. Return QueryEvidence as `output_ref`; return both refs as `public_artifact_refs`.
5. If no visualization applies, return QueryEvidence only.

The Product Team Postgres store gains a separate `commitWorkspaceDocument` path rather than weakening `ProductTeamArtifactDocument`. It verifies the V2 document/hash, same principal/scope/run, active worker fence and committed QueryEvidence source before inserting generic `artifacts.document_json`. `resolveCommitted` used by Report remains Product-Team-only.

The initial real trend path adds a fixed compiler/executor branch for monthly order counts over `demo_adb_ecommerce_mart.fact_order.purchase_date`. It retains the existing read-only sandbox controls, stable ordering, row/byte/time limits and reader role. Non-trend data queries keep the current table-count path.

## 5. Event and Activity Projection

Tool COMPLETED is the publication boundary. `assembleConversationActivity` creates Artifact blocks from exact refs in that event and keys them by:

```text
run_id : event_sequence : artifact_id : revision : content_hash
```

Rules:

- never create blocks from START, raw output or later answer text;
- deduplicate replayed frames by exact identity;
- keep Subagent/Tool hierarchy one level deep; Artifact blocks are sequence peers in the answer document and remain available as chips inside the owning Tool detail;
- QueryEvidence maps to TABLE preview; V2 `ArtifactWorkspaceDocument` maps to CHART preview after strict API resolution;
- unsupported references remain inspectable chips but do not claim a TABLE/CHART inline block.

## 6. Shared Web Rendering

### 6.1 Fetch shell

Create a shared `ArtifactPreviewPanel` client shell used by Inline and Inspector. It owns exact-reference fetch, abort/generation guards, loading/error states and table pagination. It passes only parsed `ArtifactPreviewResult` into `ArtifactWorkspace`.

### 6.2 Table

`ArtifactWorkspaceTable` renders semantic `<table>`, declared data types in accessible column labels, `—` for null with screen-reader text, current range/total/truncated state and previous/next controls. The table container uses local horizontal overflow; the outer document remains width-safe.

Pagination calls the same preview route with `offset` and `limit` and validates that returned `source_ref` exactly matches the selected reference. Page size is 50 Inline and 100 Inspector unless viewport constraints require less.

### 6.3 VChart leaf

`GovernedVChart` is a dynamic client-only leaf. It imports `@visactor/vchart/esm/vchart-simple`, receives the already parsed V2 projection and maps it to a local constant spec:

- LINE: `type: "line"`, local values, x/y fields, axis unit, tooltip, optional legend;
- BAR: `type: "bar"`, local values, x/y fields, optional grouped series;
- PIE: `type: "pie"`, category/value fields and legend;
- `animation: false` when reduced motion is requested.

No object spread from untrusted input enters the spec. There are no callback formatters, event handlers, HTML tooltip, external URLs or remote datasets. The leaf creates `new VChart(spec, { dom, autoFit: true })`, calls `renderSync()` and always `release()` in effect cleanup. The initial official React wrapper integration was removed after a real React 19 browser run returned `please specify container or renderCanvas!`; direct Core ownership is the verified compatibility concession. VChart is dynamically imported with a deterministic fixed-height skeleton so SSR is stable and no-chart answers avoid the chart chunk.

### 6.4 Equivalent table

Every CHART includes a native disclosure button labelled “查看数据表”. It renders the same `projection.table` window with the shared table component. Title, description, unit, dataset hash and truncation status are outside the canvas and associated with `aria-describedby`.

## 7. Export

This task preserves the existing strict `artifact-export-command@1.0.0` route and Job authority, but does not add a new Q&A export control because the current preview response does not carry a server-authoritative write-capability projection. It must not infer permission from client role text or synthesize a browser CSV from preview rows. The authorized Job Center entry remains a separate follow-up.

CHART equivalent tables do not submit export against the Chart document in this version; users export the source QueryEvidence ref exposed in provenance/Inspector.

## 8. Errors

| Boundary | Public code |
|---|---|
| invalid/oversized chart document | `CHART_DATA_LIMIT_EXCEEDED` or `ARTIFACT_PREVIEW_INPUT_INVALID` |
| exact ref mismatch | `ARTIFACT_SOURCE_IDENTITY_MISMATCH` |
| content hash mismatch | `ARTIFACT_SOURCE_HASH_MISMATCH` |
| denied/missing source | existing workspace not-found/denied or `ARTIFACT_SOURCE_NOT_COMMITTED` |
| unsupported document | `ARTIFACT_PREVIEW_UNSUPPORTED` |
| stale Inspector target | `ARTIFACT_INSPECTOR_TARGET_STALE` |
| page response drift | `ARTIFACT_PREVIEW_SOURCE_DRIFT` |
| export authority failure | existing `ARTIFACT_EXPORT_*` code |

Errors render bounded public messages and codes. No boundary returns raw database JSON or Tool output.

## 9. Compatibility, Rollout and Rollback

- Additive V2 decoder/renderer; no DB migration is required because generic `artifacts.document_json` already stores strict documents and type `ArtifactWorkspaceDocument` already exists.
- Feature activates only when a new frozen visualization reason code and an eligible QueryEvidence coexist. Old runs remain V1/table-only.
- Rollback can disable planner visualization reason codes, leaving QueryEvidence and V1 previews intact. Already committed V2 documents remain readable while V2 decoder exists.
- If VChart fails at runtime, show the equivalent table and a stable chart-render error; do not discard the authoritative Artifact.

## 10. Security and Performance Checks

- strict versioned Zod parsing at Contracts and API boundaries;
- exact same-run source and PostgreSQL commit/fence verification;
- canonical dataset/document hashes and metamorphic tamper tests;
- no arbitrary VChart spec, functions, HTML, URL or handler;
- max 256 KiB chart document, 4 series, 100 points/series, 200-char labels;
- dynamic chart chunk; ResizeObserver scoped to chart container; no SSE-coupled rerender;
- accessible table remains functional with JavaScript chart error, reduced motion and narrow viewport.
