import { gzipSync } from "node:zlib";
import { deriveBoundedExplorerGraph } from "../apps/web/src/components/semantic/explorer/graph.js";
import { selectExplorerObjectWindow } from "../apps/web/src/components/semantic/explorer/view-model.js";
import {
  type SemanticExplorerEdge,
  type SemanticExplorerRawSourceEnvelope,
  type SemanticExplorerSnapshot,
  sha256ContentHash,
} from "../packages/contracts/src/index.js";
import { compileU5Projection } from "../packages/semantic/src/compiler/u5-compiler.js";
import { buildSemanticExplorerReadModel } from "../packages/semantic/src/explorer/index.js";
import {
  createDeterministicTenThousandMetricBundle,
  explorerIds,
} from "../packages/semantic/test/fixtures/semantic-explorer.js";

const WARMUP_RUNS = 2;
const MEASURED_RUNS = 10;
const SERVER_P95_BUDGET_MS = 750;
const VIEW_P95_BUDGET_MS = 100;
const HEAP_DELTA_BUDGET_BYTES = 128 * 1024 * 1024;
const COMPRESSED_RESPONSE_BUDGET_BYTES = 8 * 1024 * 1024;

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function withBenchmarkRelationships(snapshot: SemanticExplorerSnapshot): SemanticExplorerSnapshot {
  const root = snapshot.objects[0];
  if (!root) throw new Error("Semantic Explorer benchmark has no graph root.");
  const edges: SemanticExplorerEdge[] = [];
  for (let index = 1; index <= 1_000; index += 1) {
    const target = snapshot.objects[index];
    if (!target) throw new Error("Semantic Explorer high-degree fixture is incomplete.");
    edges.push({
      edge_id: `benchmark-high-degree-${index}`,
      kind: "metric_dependency" as const,
      source: root.identity,
      target: target.identity,
      canonical_digest: `sha256:${"e".repeat(64)}` as const,
      payload: { kind: "metric_dependency" as const, formula_id: null },
    });
  }
  for (let index = 1_001; index < 3_000; index += 1) {
    const source = snapshot.objects[index];
    const target = snapshot.objects[index + 1];
    if (!source || !target) throw new Error("Semantic Explorer sparse fixture is incomplete.");
    edges.push({
      edge_id: `benchmark-sparse-${index}`,
      kind: "metric_dependency" as const,
      source: source.identity,
      target: target.identity,
      canonical_digest: `sha256:${"f".repeat(64)}` as const,
      payload: { kind: "metric_dependency" as const, formula_id: null },
    });
  }
  return {
    ...snapshot,
    edges,
    counts: {
      ...snapshot.counts,
      total_edges: edges.length,
      by_edge_kind: {
        metric_dependency: edges.length,
        dimension_hierarchy: 0,
        analytical_relationship: 0,
        business_relationship: 0,
        physical_binding: 0,
      },
    },
  };
}

async function createBenchmarkEnvelope(): Promise<SemanticExplorerRawSourceEnvelope> {
  const projection = await compileU5Projection(
    createDeterministicTenThousandMetricBundle(),
    "catalog@benchmark",
  );
  const executableDigest = await sha256ContentHash(projection.semantic);
  const relationshipDigest = await sha256ContentHash(projection.relationship);
  const restrictionDigest = await sha256ContentHash(projection.restriction);
  const releaseDigest = await sha256ContentHash({
    release_id: explorerIds.release,
    executableDigest,
    relationshipDigest,
    restrictionDigest,
  });

  return {
    source_kind: "ACTIVE",
    observed_at: "2026-08-09T00:02:00.000Z",
    pointer: {
      semantic_domain: "sales",
      current_release_id: explorerIds.release,
      current_release_generation: 7,
      current_release_digest: releaseDigest,
      pointer_generation: 11,
      updated_at: "2026-08-09T00:01:00.000Z",
    },
    release: {
      semantic_domain: "sales",
      release_id: explorerIds.release,
      release_generation: 7,
      release_digest: releaseDigest,
      compiler_bundle_digest: projection.bundleHash as `sha256:${string}`,
      candidate_id: explorerIds.candidate,
      executable_projection_ref: explorerIds.executableProjection,
      executable_projection_hash: executableDigest,
      relationship_projection_ref: explorerIds.relationshipProjection,
      relationship_projection_hash: relationshipDigest,
      runtime_restriction_projection_ref: explorerIds.restrictionProjection,
      runtime_restriction_projection_hash: restrictionDigest,
      published_at: "2026-08-09T00:00:00.000Z",
      published_by: "semantic-explorer-benchmark",
    },
    executable_projection: {
      projection_id: explorerIds.executableProjection,
      release_id: explorerIds.release,
      projection_digest: executableDigest,
      projection_payload: projection.semantic,
    },
    relationship_projection: {
      projection_id: explorerIds.relationshipProjection,
      release_id: explorerIds.release,
      datasource_id: explorerIds.datasource,
      catalog_epoch: 7,
      projection_digest: relationshipDigest,
      projection_payload: projection.relationship,
    },
    runtime_restriction_projection: {
      projection_id: explorerIds.restrictionProjection,
      release_id: explorerIds.release,
      pointer_generation: 11,
      projection_digest: restrictionDigest,
      projection_payload: projection.restriction,
    },
  };
}

async function main(): Promise<void> {
  const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!collectGarbage) {
    throw new Error(
      "Semantic Explorer heap benchmark requires: node --expose-gc --import tsx scripts/semantic-explorer-benchmark.ts",
    );
  }
  const envelope = await createBenchmarkEnvelope();
  let snapshot: SemanticExplorerSnapshot | null = null;

  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    snapshot = (await buildSemanticExplorerReadModel(envelope)).snapshot;
  }

  snapshot = null;
  collectGarbage();
  let maxHeapDelta = 0;
  const serverDurations: number[] = [];
  for (let index = 0; index < MEASURED_RUNS; index += 1) {
    snapshot = null;
    collectGarbage();
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    snapshot = (await buildSemanticExplorerReadModel(envelope)).snapshot;
    serverDurations.push(performance.now() - startedAt);
    maxHeapDelta = Math.max(maxHeapDelta, process.memoryUsage().heapUsed - heapBefore);
  }
  if (!snapshot) throw new Error("Semantic Explorer benchmark did not produce a snapshot.");
  snapshot = withBenchmarkRelationships(snapshot);

  const viewDurations: number[] = [];
  for (let index = 0; index < MEASURED_RUNS; index += 1) {
    const startedAt = performance.now();
    const window = selectExplorerObjectWindow(snapshot, "metric", "benchmark");
    const root = index % 2 === 0 ? snapshot.objects[0] : window.objects.at(index);
    if (!root) throw new Error("Semantic Explorer benchmark window has no root object.");
    deriveBoundedExplorerGraph(snapshot, root.identity);
    viewDurations.push(performance.now() - startedAt);
  }

  const responseBytes = Buffer.byteLength(JSON.stringify(snapshot));
  const compressedResponseBytes = gzipSync(JSON.stringify(snapshot)).byteLength;
  const serverP95 = percentile(serverDurations, 0.95);
  const viewP95 = percentile(viewDurations, 0.95);
  const heapDelta = Math.max(0, maxHeapDelta);
  const passed =
    snapshot.counts.by_object_kind.metric === 10_000 &&
    snapshot.counts.by_object_kind.datasource === 1 &&
    snapshot.counts.total_edges > 0 &&
    serverP95 <= SERVER_P95_BUDGET_MS &&
    viewP95 <= VIEW_P95_BUDGET_MS &&
    heapDelta <= HEAP_DELTA_BUDGET_BYTES &&
    compressedResponseBytes <= COMPRESSED_RESPONSE_BUDGET_BYTES;

  const result = {
    schema_version: "semantic-explorer-benchmark@1.0.0",
    fixture: {
      object_count: snapshot.counts.total_objects,
      metric_count: snapshot.counts.by_object_kind.metric,
      datasource_count: snapshot.counts.by_object_kind.datasource,
      edge_count: snapshot.counts.total_edges,
      response_bytes: responseBytes,
      compressed_response_bytes: compressedResponseBytes,
    },
    measured_runs: MEASURED_RUNS,
    server: {
      p50_ms: Number(percentile(serverDurations, 0.5).toFixed(2)),
      p95_ms: Number(serverP95.toFixed(2)),
      budget_p95_ms: SERVER_P95_BUDGET_MS,
      heap_delta_bytes: heapDelta,
      heap_budget_bytes: HEAP_DELTA_BUDGET_BYTES,
    },
    client_view: {
      p50_ms: Number(percentile(viewDurations, 0.5).toFixed(2)),
      p95_ms: Number(viewP95.toFixed(2)),
      budget_p95_ms: VIEW_P95_BUDGET_MS,
      rendered_object_row_ceiling: 200,
      rendered_graph_node_ceiling: 250,
      rendered_graph_edge_ceiling: 500,
    },
    budgets: {
      compressed_response_bytes: COMPRESSED_RESPONSE_BUDGET_BYTES,
    },
    passed,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

await main();
