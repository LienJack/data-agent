import type { SemanticExplorerSnapshot } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { deriveBoundedExplorerGraph } from "../src/components/semantic/explorer/graph";
import {
  createLatestExplorerOperationGate,
  timelineMatchesSnapshot,
} from "../src/components/semantic/explorer/latest-operation";
import {
  initialExplorerState,
  semanticExplorerReducer,
} from "../src/components/semantic/explorer/state";
import { selectExplorerObjectWindow } from "../src/components/semantic/explorer/view-model";

function snapshot(generation: number, objectCount = 1): SemanticExplorerSnapshot {
  const objects = Array.from({ length: objectCount }, (_, index) => ({
    identity: { kind: "metric" as const, object_id: `metric_${index}` },
    status: "published" as const,
    canonical_digest: `sha256:${String(index % 10).repeat(64)}`,
    name: `Metric ${index}`,
    description: null,
    aliases: [],
    owner: null,
    restricted: false,
    payload: {
      kind: "metric" as const,
      table_id: "orders",
      column_id: `amount_${index}`,
      aggregation: "sum" as const,
      formula: null,
      grain: { grain_id: "order", granularity: "atomic" as const, description: null },
      unit: null,
      time_domain: null,
      time_column_id: null,
      additivity: "additive" as const,
      null_policy: "preserve" as const,
      fanout_policy: "reject" as const,
      dependency_column_ids: [],
      tags: [],
      bindings: [],
    },
  }));
  const edges = objects.slice(1).map((object, index) => {
    const source = objects[index];
    if (!source) throw new Error("Explorer fixture source object missing.");
    return {
      edge_id: `edge_${index}`,
      kind: "metric_dependency" as const,
      source: source.identity,
      target: object.identity,
      canonical_digest: `sha256:${String((index + 1) % 10).repeat(64)}`,
      payload: { kind: "metric_dependency" as const, formula_id: null },
    };
  });
  return {
    schema_version: "semantic-explorer-snapshot@1.0.0",
    authority: "POSTGRESQL",
    release_identity: {
      semantic_domain: "revenue",
      release_id: "00000000-0000-4000-8000-000000000101",
      release_generation: 1,
      release_digest: `sha256:${"d".repeat(64)}`,
      executable_projection: {
        projection_id: "00000000-0000-4000-8000-000000000102",
        projection_digest: `sha256:${"a".repeat(64)}`,
      },
      relationship_projection: {
        projection_id: "00000000-0000-4000-8000-000000000103",
        projection_digest: `sha256:${"b".repeat(64)}`,
      },
      runtime_restriction_projection: {
        projection_id: "00000000-0000-4000-8000-000000000104",
        projection_digest: `sha256:${"c".repeat(64)}`,
      },
      published_at: "2026-08-09T00:00:00.000Z",
      published_by: "publisher",
    },
    pointer_observation: {
      current_release_id: "00000000-0000-4000-8000-000000000101",
      current_release_generation: 1,
      current_release_digest: `sha256:${"d".repeat(64)}`,
      pointer_generation: generation,
      observed_at: "2026-08-09T00:01:00.000Z",
    },
    is_active: true,
    capabilities: {
      business_ontology: false,
      physical_binding: false,
      catalog_governance: false,
    },
    objects,
    edges,
    counts: {
      total_objects: objects.length,
      by_object_kind: {
        business_entity: 0,
        business_event: 0,
        business_term: 0,
        metric: objects.length,
        dimension: 0,
        relationship: 0,
        datasource: 0,
      },
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

describe("Semantic Explorer client state", () => {
  it("ignores superseded epochs and lower pointer generations", () => {
    let state = semanticExplorerReducer(initialExplorerState, {
      type: "request-started",
      domain: "revenue",
      request_epoch: 2,
    });
    state = semanticExplorerReducer(state, {
      type: "request-succeeded",
      domain: "revenue",
      request_epoch: 2,
      snapshot: snapshot(5),
    });
    state = semanticExplorerReducer(state, {
      type: "request-started",
      domain: "revenue",
      request_epoch: 3,
    });
    const afterLowerGeneration = semanticExplorerReducer(state, {
      type: "request-succeeded",
      domain: "revenue",
      request_epoch: 3,
      snapshot: snapshot(4),
    });
    const afterOldEpoch = semanticExplorerReducer(afterLowerGeneration, {
      type: "request-succeeded",
      domain: "revenue",
      request_epoch: 2,
      snapshot: snapshot(9),
    });

    expect(afterLowerGeneration.highest_pointer_generation).toBe(5);
    expect(afterLowerGeneration.server.kind).toBe("success");
    expect(afterLowerGeneration.refreshing).toBe(false);
    expect(afterOldEpoch).toBe(afterLowerGeneration);
  });

  it("retains the highest pointer generation across domain switches", () => {
    let state = semanticExplorerReducer(initialExplorerState, {
      type: "request-started",
      domain: "revenue",
      request_epoch: 1,
    });
    state = semanticExplorerReducer(state, {
      type: "request-succeeded",
      domain: "revenue",
      request_epoch: 1,
      snapshot: snapshot(8),
    });
    state = semanticExplorerReducer(state, {
      type: "request-started",
      domain: "inventory",
      request_epoch: 2,
    });
    state = semanticExplorerReducer(state, {
      type: "request-started",
      domain: "revenue",
      request_epoch: 3,
    });
    const stale = semanticExplorerReducer(state, {
      type: "request-succeeded",
      domain: "revenue",
      request_epoch: 3,
      snapshot: snapshot(7),
    });

    expect(stale.highest_pointer_generation).toBe(8);
    expect(stale.observed_pointer_generations.revenue).toBe(8);
  });

  it("bounds the graph to 250 nodes and 500 edges", () => {
    const large = snapshot(5, 300);
    const root = large.objects.at(0);
    if (!root) throw new Error("Explorer fixture root object missing.");
    const graph = deriveBoundedExplorerGraph(large, root.identity);
    expect(graph.nodes.length).toBeLessThanOrEqual(250);
    expect(graph.edges.length).toBeLessThanOrEqual(500);
    expect(graph.truncated).toBe(true);
  });

  it("keeps graph edges endpoint-closed for sparse and high-degree neighborhoods", () => {
    const sparse = snapshot(5, 300);
    const sparseRoot = sparse.objects.at(0);
    if (!sparseRoot) throw new Error("Explorer fixture root object missing.");
    const sparseGraph = deriveBoundedExplorerGraph(sparse, sparseRoot.identity);
    const sparseNodeKeys = new Set(
      sparseGraph.nodes.map((node) =>
        JSON.stringify([node.identity.kind, node.identity.object_id]),
      ),
    );
    for (const edge of sparseGraph.edges) {
      expect(sparseNodeKeys.has(JSON.stringify([edge.source.kind, edge.source.object_id]))).toBe(
        true,
      );
      expect(sparseNodeKeys.has(JSON.stringify([edge.target.kind, edge.target.object_id]))).toBe(
        true,
      );
    }

    const highDegreeBase = snapshot(5, 2);
    const source = highDegreeBase.objects[0];
    const target = highDegreeBase.objects[1];
    if (!source || !target) throw new Error("Explorer high-degree fixture is unavailable.");
    const highDegree = {
      ...highDegreeBase,
      edges: Array.from({ length: 600 }, (_, index) => ({
        edge_id: `parallel_${index}`,
        kind: "metric_dependency" as const,
        source: source.identity,
        target: target.identity,
        canonical_digest: `sha256:${"e".repeat(64)}` as const,
        payload: { kind: "metric_dependency" as const, formula_id: null },
      })),
    } satisfies SemanticExplorerSnapshot;
    const highDegreeGraph = deriveBoundedExplorerGraph(highDegree, source.identity);
    expect(highDegreeGraph.nodes).toHaveLength(2);
    expect(highDegreeGraph.edges).toHaveLength(500);
    expect(highDegreeGraph.truncated).toBe(true);
  });

  it("prevents superseded and cancelled operations from applying side effects", () => {
    const gate = createLatestExplorerOperationGate();
    const sideEffects: string[] = [];
    const first = gate.begin();
    const second = gate.begin();

    expect(first.signal.aborted).toBe(true);
    if (gate.isLatest(first)) sideEffects.push("stale");
    if (gate.isLatest(second)) sideEffects.push("latest");
    expect(gate.finish(first)).toBe(false);
    expect(gate.finish(second)).toBe(true);

    const cancelled = gate.begin();
    gate.cancel();
    expect(cancelled.signal.aborted).toBe(true);
    if (gate.isLatest(cancelled)) sideEffects.push("cancelled");
    expect(sideEffects).toEqual(["latest"]);
  });

  it("never attaches a release timeline observed from another pointer generation", () => {
    const current = snapshot(5);
    const timeline = {
      schema_version: "semantic-explorer-release-timeline@1.0.0" as const,
      semantic_domain: "revenue",
      pointer_observation: current.pointer_observation,
      releases: [],
      next_generation_cursor: null,
    };

    expect(timelineMatchesSnapshot(timeline, current)).toBe(true);
    expect(
      timelineMatchesSnapshot(
        {
          ...timeline,
          pointer_observation: { ...timeline.pointer_observation, pointer_generation: 6 },
        },
        current,
      ),
    ).toBe(false);
    expect(timelineMatchesSnapshot({ ...timeline, semantic_domain: "inventory" }, current)).toBe(
      false,
    );
  });

  it("renders no more than 200 matching object rows", () => {
    const large = snapshot(5, 10_000);
    const window = selectExplorerObjectWindow(large, "metric", "Metric");
    expect(window.matching_count).toBe(10_000);
    expect(window.objects).toHaveLength(200);
    expect(window.truncated).toBe(true);
  });
});
