import { semanticRelationshipGraphManifestSchema } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { buildSemanticExplorerSnapshot } from "../src/explorer/index.js";
import {
  buildSemanticRelationshipGraphManifest,
  searchSemanticRelationshipGraphFallback,
} from "../src/relationship-index/index.js";
import { createRawExplorerEnvelope, explorerIds } from "./fixtures/semantic-explorer.js";

const scope = {
  app_id: explorerIds.app,
  tenant_id: explorerIds.tenant,
  environment: "test",
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "semantic-relationship-search-request@1.0.0",
    semantic_domain: "sales",
    release: { kind: "ACTIVE" },
    root: null,
    term: "margin",
    categories: ["FORMULA", "BIND", "GOVERN"],
    direction: "both",
    hop_limit: 2,
    node_limit: 50,
    edge_limit: 100,
    ...overrides,
  };
}

describe("Semantic relationship index kernel", () => {
  it("builds one deterministic, endpoint-closed graph for the exact PostgreSQL release", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const first = await buildSemanticRelationshipGraphManifest(scope, snapshot);
    const second = await buildSemanticRelationshipGraphManifest(scope, snapshot);

    expect(first).toEqual(second);
    expect(first.release_identity).toEqual(snapshot.release_identity);
    expect(first.relationship_projection_digest).toBe(
      snapshot.release_identity.relationship_projection.projection_digest,
    );
    expect(first.counts.governance_nodes).toBe(4);
    expect(first.counts.by_category.GOVERN).toBeGreaterThan(3);
    expect(first.counts.by_category.BIZ).toBeGreaterThan(0);
    expect(first.counts.by_category.JOIN).toBeGreaterThan(0);
    expect(first.counts.by_category.FORMULA).toBeGreaterThan(0);
    expect(first.counts.by_category.BIND).toBeGreaterThan(0);
    expect(() => semanticRelationshipGraphManifestSchema.parse(first)).not.toThrow();

    const nodeKeys = new Set(first.nodes.map((node) => node.node_key));
    expect(
      first.edges.every(
        (edge) => nodeKeys.has(edge.source_node_key) && nodeKeys.has(edge.target_node_key),
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain("private-region-parameter");
    expect(JSON.stringify(first)).not.toContain("orders.region_id");
  });

  it("provides a bounded exact-release PostgreSQL fallback with explicit reason", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const manifest = await buildSemanticRelationshipGraphManifest(scope, snapshot);
    const result = searchSemanticRelationshipGraphFallback(snapshot, manifest, request(), {
      index_state: "FAILED",
      reason_code: "INDEX_UNAVAILABLE",
      authority_revalidated: true,
    });

    expect(result.source).toBe("POSTGRESQL_FALLBACK");
    expect(result.index_state).toBe("FAILED");
    expect(result.index_reason_code).toBe("INDEX_UNAVAILABLE");
    expect(result.release_identity.release_id).toBe(explorerIds.release);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.length).toBeLessThanOrEqual(50);
    expect(result.edges.length).toBeLessThanOrEqual(100);
    expect(result.explanation.authority_revalidated).toBe(true);
  });

  it("respects category, direction, hop and endpoint bounds", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const manifest = await buildSemanticRelationshipGraphManifest(scope, snapshot);
    const result = searchSemanticRelationshipGraphFallback(
      snapshot,
      manifest,
      request({
        root: { kind: "metric", object_id: "metric-margin" },
        term: null,
        categories: ["FORMULA"],
        direction: "upstream",
        hop_limit: 1,
        node_limit: 2,
        edge_limit: 1,
      }),
    );

    expect(result.edges.every((edge) => edge.category === "FORMULA")).toBe(true);
    expect(result.nodes.length).toBeLessThanOrEqual(2);
    expect(result.edges.length).toBeLessThanOrEqual(1);
    const nodeKeys = new Set(result.nodes.map((node) => node.node_key));
    expect(
      result.edges.every(
        (edge) => nodeKeys.has(edge.source_node_key) && nodeKeys.has(edge.target_node_key),
      ),
    ).toBe(true);
  });

  it("fails closed when active or historical release identity does not match", async () => {
    const active = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const historical = await buildSemanticExplorerSnapshot(
      await createRawExplorerEnvelope({ sourceKind: "HISTORICAL" }),
    );
    const manifest = await buildSemanticRelationshipGraphManifest(scope, active);

    expect(() =>
      searchSemanticRelationshipGraphFallback(
        historical,
        manifest,
        request({ release: { kind: "ACTIVE" } }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "SEMANTIC_RELATIONSHIP_ACTIVE_RELEASE_REQUIRED",
      }),
    );
    expect(() =>
      searchSemanticRelationshipGraphFallback(
        active,
        manifest,
        request({
          release: {
            kind: "HISTORICAL",
            release_id: "00000000-0000-4000-8000-000000000099",
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "SEMANTIC_RELATIONSHIP_RELEASE_MISMATCH",
      }),
    );
  });
});
