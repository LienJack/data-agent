import {
  computeSemanticExplorerSidecarDigest,
  SEMANTIC_EXPLORER_CANDIDATE_SOURCE_VERSION,
  type SemanticExplorerCandidateComparison,
  type SemanticExplorerObjectIdentity,
  type SemanticExplorerRawCandidateComparison,
  type SemanticExplorerRawSourceEnvelope,
  type SemanticExplorerSidecarMaterial,
  type SemanticExplorerSnapshot,
  semanticExplorerSidecarSchema,
  semanticExplorerSnapshotSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { compileU5Projection } from "../src/compiler/u5-compiler.js";
import {
  buildSemanticExplorerCandidateComparison,
  buildSemanticExplorerLineage,
  buildSemanticExplorerSnapshot,
  diffSemanticExplorerSnapshots,
  SemanticExplorerKernelError,
} from "../src/explorer/index.js";
import {
  createCompleteSemanticSourceBundle,
  createDeterministicTenThousandMetricBundle,
  createRawExplorerEnvelope,
  explorerIds,
} from "./fixtures/semantic-explorer.js";

async function withSidecarMaterial(
  envelope: SemanticExplorerRawSourceEnvelope,
  mutate: (material: SemanticExplorerSidecarMaterial) => SemanticExplorerSidecarMaterial,
): Promise<SemanticExplorerRawSourceEnvelope> {
  const payload = envelope.executable_projection.projection_payload as Record<string, unknown>;
  const current = semanticExplorerSidecarSchema.parse(payload.explorer_sidecar);
  const { sidecar_digest: _currentDigest, ...currentMaterial } = current;
  const material = mutate(structuredClone(currentMaterial));
  const sidecar = {
    ...material,
    sidecar_digest: await computeSemanticExplorerSidecarDigest(material),
  };
  const projectionPayload = {
    ...payload,
    formulas: material.formula_signatures.map((formula) => formula.formula_id),
    explorer_sidecar: sidecar,
  };
  const projectionDigest = await sha256ContentHash(projectionPayload);
  return {
    ...envelope,
    release: {
      ...envelope.release,
      executable_projection_hash: projectionDigest,
    },
    executable_projection: {
      ...envelope.executable_projection,
      projection_digest: projectionDigest,
      projection_payload: projectionPayload,
    },
  };
}

function createMetricGraphSnapshot(
  base: SemanticExplorerSnapshot,
  objectCount: number,
  edgePairs: readonly (readonly [number, number])[],
): SemanticExplorerSnapshot {
  const template = base.objects.find((object) => object.identity.kind === "metric");
  if (template?.payload.kind !== "metric") {
    throw new Error("Explorer metric fixture is unavailable.");
  }
  const objects = Array.from({ length: objectCount }, (_, index) => ({
    ...template,
    identity: { kind: "metric" as const, object_id: `metric-lineage-${index}` },
    canonical_digest: `sha256:${"a".repeat(64)}` as const,
    name: `Lineage metric ${index}`,
  }));
  const edges = edgePairs.map(([sourceIndex, targetIndex], index) => {
    const source = objects[sourceIndex];
    const target = objects[targetIndex];
    if (!source || !target) throw new Error("Explorer edge fixture endpoint is unavailable.");
    return {
      edge_id: `metric-lineage-edge-${index}`,
      kind: "metric_dependency" as const,
      source: source.identity,
      target: target.identity,
      canonical_digest: `sha256:${"b".repeat(64)}` as const,
      payload: { kind: "metric_dependency" as const, formula_id: null },
    };
  });
  return semanticExplorerSnapshotSchema.parse({
    ...base,
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
  });
}

describe("Semantic Explorer sidecar compiler", () => {
  it("derives the same content-addressed sidecar from the same validated bundle", async () => {
    const bundle = createCompleteSemanticSourceBundle();
    const first = await compileU5Projection(bundle);
    const second = await compileU5Projection(bundle);

    expect(first.semantic.explorer_sidecar).toEqual(second.semantic.explorer_sidecar);
    expect(first.semantic.explorer_sidecar?.sidecar_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.semantic.explorer_sidecar?.business_ontology?.entities).toHaveLength(2);
  });

  it("provides an explicit deterministic 10k fixture", () => {
    const fixture = createDeterministicTenThousandMetricBundle();
    expect(fixture.metrics).toHaveLength(10_000);
    expect(fixture.physical_binding?.entries).toHaveLength(10_000);
    expect(fixture.catalog_governance?.tables[0]?.columns).toHaveLength(10_000);
    expect(fixture.formulas).toHaveLength(100);
    expect(fixture.metrics[0]?.metric_id).toBe("metric-benchmark-00000");
    expect(fixture.metrics[9_999]?.metric_id).toBe("metric-benchmark-09999");
  });
});

describe("Semantic Explorer read-model kernel", () => {
  it("builds one strict, stable and endpoint-closed active snapshot", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    expect(snapshot.is_active).toBe(true);
    expect(snapshot.capabilities).toEqual({
      business_ontology: true,
      physical_binding: true,
      catalog_governance: true,
    });
    expect(snapshot.objects.map((object) => object.identity.kind)).toEqual(
      [...snapshot.objects.map((object) => object.identity.kind)].sort(),
    );
    expect(snapshot.counts.total_objects).toBe(snapshot.objects.length);
    expect(snapshot.counts.total_edges).toBe(snapshot.edges.length);
    expect(() => semanticExplorerSnapshotSchema.parse(snapshot)).not.toThrow();

    const identities = new Set(
      snapshot.objects.map((object) =>
        JSON.stringify([object.identity.kind, object.identity.object_id]),
      ),
    );
    for (const edge of snapshot.edges) {
      expect(identities.has(JSON.stringify([edge.source.kind, edge.source.object_id]))).toBe(true);
      expect(identities.has(JSON.stringify([edge.target.kind, edge.target.object_id]))).toBe(true);
    }
  });

  it("degrades historical releases without a sidecar without inventing entities", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(
      await createRawExplorerEnvelope({ sourceKind: "HISTORICAL", includeSidecar: false }),
    );
    expect(snapshot.is_active).toBe(false);
    expect(snapshot.capabilities).toEqual({
      business_ontology: false,
      physical_binding: false,
      catalog_governance: false,
    });
    expect(snapshot.objects.some((object) => object.identity.kind === "business_entity")).toBe(
      false,
    );
    expect(snapshot.objects.some((object) => object.identity.kind === "metric")).toBe(true);
    expect(snapshot.objects.some((object) => object.identity.kind === "relationship")).toBe(true);
  });

  it("removes DENY material and never exports predicate or parameter details", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(
      await createRawExplorerEnvelope({ runtimeAction: "DENY" }),
    );
    expect(
      snapshot.objects.some(
        (object) =>
          object.identity.kind === "metric" && object.identity.object_id === "metric-gross",
      ),
    ).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("private-region-parameter");
    expect(JSON.stringify(snapshot)).not.toContain("orders.region_id");
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.source.object_id === "metric-gross" || edge.target.object_id === "metric-gross",
      ),
    ).toBe(false);
  });

  it("accepts immutable projection reuse across releases when the bound digest is exact", async () => {
    const envelope = await createRawExplorerEnvelope();
    const reused = {
      ...envelope,
      executable_projection: {
        ...envelope.executable_projection,
        release_id: "00000000-0000-4000-8000-000000000099",
      },
    };
    await expect(buildSemanticExplorerSnapshot(reused)).resolves.toMatchObject({
      release_identity: { release_id: envelope.release.release_id },
    });
  });

  it("fails closed on unknown projection fields and invalid sidecar hash", async () => {
    const envelope = await createRawExplorerEnvelope();
    const unknownPayload = {
      ...envelope,
      executable_projection: {
        ...envelope.executable_projection,
        projection_payload: {
          ...(envelope.executable_projection.projection_payload as Record<string, unknown>),
          raw_sql: "select secret",
        },
      },
    };
    await expect(buildSemanticExplorerSnapshot(unknownPayload)).rejects.toMatchObject({
      code: "SEMANTIC_EXPLORER_PROJECTION_PAYLOAD_INVALID",
    });

    const payload = envelope.executable_projection.projection_payload as Record<string, unknown>;
    const sidecar = payload.explorer_sidecar as Record<string, unknown>;
    const invalidHash = {
      ...envelope,
      executable_projection: {
        ...envelope.executable_projection,
        projection_payload: {
          ...payload,
          explorer_sidecar: { ...sidecar, sidecar_digest: `sha256:${"0".repeat(64)}` },
        },
      },
    };
    await expect(buildSemanticExplorerSnapshot(invalidHash)).rejects.toMatchObject({
      code: "SEMANTIC_EXPLORER_SIDECAR_DIGEST_MISMATCH",
    });
  });

  it("keeps cross-kind equal IDs distinct and rejects same-kind duplicates", async () => {
    const envelope = await createRawExplorerEnvelope();
    const payload = envelope.executable_projection.projection_payload as Record<string, unknown>;
    const dimensions = payload.dimensions as Array<Record<string, unknown>>;
    const crossKindPayload = {
      ...payload,
      dimensions: [{ ...dimensions[0], dimension_id: "metric-gross" }, ...dimensions],
    };
    const crossKindDigest = await sha256ContentHash(crossKindPayload);
    const crossKindEnvelope = {
      ...envelope,
      release: { ...envelope.release, executable_projection_hash: crossKindDigest },
      executable_projection: {
        ...envelope.executable_projection,
        projection_digest: crossKindDigest,
        projection_payload: crossKindPayload,
      },
    };
    const snapshot = await buildSemanticExplorerSnapshot(crossKindEnvelope);
    expect(
      snapshot.objects.filter((object) => object.identity.object_id === "metric-gross"),
    ).toHaveLength(2);

    const metrics = payload.metrics as Array<Record<string, unknown>>;
    const duplicatePayload = { ...payload, metrics: [metrics[0], ...metrics] };
    const duplicateDigest = await sha256ContentHash(duplicatePayload);
    await expect(
      buildSemanticExplorerSnapshot({
        ...envelope,
        release: { ...envelope.release, executable_projection_hash: duplicateDigest },
        executable_projection: {
          ...envelope.executable_projection,
          projection_digest: duplicateDigest,
          projection_payload: duplicatePayload,
        },
      }),
    ).rejects.toMatchObject({ code: "SEMANTIC_EXPLORER_DUPLICATE_IDENTITY" });
  });

  it("fails closed on a truly dangling hierarchy reference", async () => {
    const envelope = await createRawExplorerEnvelope();
    const payload = envelope.executable_projection.projection_payload as Record<string, unknown>;
    const dimensions = payload.dimensions as Array<Record<string, unknown>>;
    const danglingPayload = {
      ...payload,
      dimensions: [
        {
          ...dimensions[0],
          hierarchical: true,
          parent_dimension_id: "dimension-not-released",
        },
      ],
    };
    const digest = await sha256ContentHash(danglingPayload);
    await expect(
      buildSemanticExplorerSnapshot({
        ...envelope,
        release: { ...envelope.release, executable_projection_hash: digest },
        executable_projection: {
          ...envelope.executable_projection,
          projection_digest: digest,
          projection_payload: danglingPayload,
        },
      }),
    ).rejects.toMatchObject({ code: "SEMANTIC_EXPLORER_DANGLING_EDGE" });
  });

  it("accepts released helper formulas that are not themselves metrics", async () => {
    const envelope = await withSidecarMaterial(await createRawExplorerEnvelope(), (material) => {
      const template = material.formula_signatures.find(
        (formula) => formula.formula_id === "formula-gross",
      );
      if (!template) throw new Error("Explorer helper formula fixture is unavailable.");
      return {
        ...material,
        formula_signatures: [
          ...material.formula_signatures.map((formula) =>
            formula.formula_id === "formula-margin"
              ? { ...formula, dependency_formula_ids: ["formula-helper"] }
              : formula,
          ),
          {
            ...template,
            formula_id: "formula-helper",
            dependency_formula_ids: ["formula-cost"],
          },
        ],
      };
    });

    const snapshot = await buildSemanticExplorerSnapshot(envelope);
    expect(
      snapshot.objects.some(
        (object) =>
          object.identity.kind === "metric" && object.identity.object_id === "metric-margin",
      ),
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.kind === "metric_dependency" &&
          edge.payload.kind === "metric_dependency" &&
          edge.payload.formula_id === "formula-helper",
      ),
    ).toBe(false);
  });

  it("hides a physical binding when its catalog table name is ambiguous", async () => {
    const envelope = await withSidecarMaterial(await createRawExplorerEnvelope(), (material) => {
      const catalog = material.catalog_governance;
      const orders = catalog?.tables.find((table) => table.table_id === "orders");
      if (!catalog || !orders) throw new Error("Explorer catalog fixture is unavailable.");
      return {
        ...material,
        catalog_governance: {
          ...catalog,
          tables: [...catalog.tables, { ...orders, table_id: "archived-orders" }],
        },
      };
    });

    const snapshot = await buildSemanticExplorerSnapshot(envelope);
    const margin = snapshot.objects.find(
      (object) =>
        object.identity.kind === "metric" && object.identity.object_id === "metric-margin",
    );
    expect(margin?.payload.kind).toBe("metric");
    if (margin?.payload.kind !== "metric")
      throw new Error("Explorer metric fixture is unavailable.");
    expect(margin.payload.bindings).toEqual([]);
  });
});

describe("Semantic Explorer diff, lineage and candidate separation", () => {
  it("diffs exact release snapshots by structured identity and canonical digest", async () => {
    const base = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const targetEnvelope = await createRawExplorerEnvelope();
    targetEnvelope.release.release_id = "00000000-0000-4000-8000-000000000020";
    targetEnvelope.release.release_generation = 8;
    targetEnvelope.release.release_digest = `sha256:${"8".repeat(64)}`;
    targetEnvelope.executable_projection.release_id = targetEnvelope.release.release_id;
    targetEnvelope.relationship_projection.release_id = targetEnvelope.release.release_id;
    targetEnvelope.runtime_restriction_projection.release_id = targetEnvelope.release.release_id;
    targetEnvelope.pointer.current_release_id = targetEnvelope.release.release_id;
    targetEnvelope.pointer.current_release_generation = 8;
    targetEnvelope.pointer.current_release_digest = targetEnvelope.release.release_digest;
    targetEnvelope.source_kind = "ACTIVE";
    const target = await buildSemanticExplorerSnapshot(targetEnvelope);
    const changedTarget = semanticExplorerSnapshotSchema.parse({
      ...target,
      objects: target.objects.map((object) =>
        object.identity.kind === "metric" && object.identity.object_id === "metric-margin"
          ? { ...object, canonical_digest: `sha256:${"7".repeat(64)}` }
          : object,
      ),
    });

    const diff = diffSemanticExplorerSnapshots(base, changedTarget);
    expect(diff.base_release.release_id).toBe(explorerIds.release);
    expect(diff.target_release.release_id).toBe(targetEnvelope.release.release_id);
    expect(diff.objects.changed).toEqual([
      expect.objectContaining({
        identity: { kind: "metric", object_id: "metric-margin" },
      }),
    ]);
  });

  it("bounds lineage, detects cycles and rejects an invisible root indistinguishably", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const root = { kind: "business_entity", object_id: "entity-order" } as const;
    const lineage = buildSemanticExplorerLineage(snapshot, root, {
      direction: "both",
      hop_limit: 6,
    });
    expect(lineage.cycles_detected).toBe(true);
    expect(lineage.nodes.length).toBeLessThanOrEqual(250);
    expect(lineage.edges.length).toBeLessThanOrEqual(500);

    const hidden: SemanticExplorerObjectIdentity = {
      kind: "metric",
      object_id: "missing-or-not-visible",
    };
    expect(() =>
      buildSemanticExplorerLineage(snapshot, hidden, { direction: "upstream", hop_limit: 6 }),
    ).toThrowError(SemanticExplorerKernelError);
  });

  it("keeps bounded lineage endpoint-closed at node, edge and hop limits", async () => {
    const base = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const nodeLimited = createMetricGraphSnapshot(
      base,
      300,
      Array.from({ length: 299 }, (_, index) => [0, index + 1] as const),
    );
    const edgeLimited = createMetricGraphSnapshot(
      base,
      2,
      Array.from({ length: 600 }, () => [0, 1] as const),
    );
    const hopLimited = createMetricGraphSnapshot(
      base,
      8,
      Array.from({ length: 7 }, (_, index) => [index, index + 1] as const),
    );

    const cases = [
      {
        snapshot: nodeLimited,
        expectedReason: "NODE_LIMIT" as const,
        expectedNodes: 250,
        expectedEdges: 249,
        hops: 6,
      },
      {
        snapshot: edgeLimited,
        expectedReason: "EDGE_LIMIT" as const,
        expectedNodes: 2,
        expectedEdges: 500,
        hops: 6,
      },
      {
        snapshot: hopLimited,
        expectedReason: "HOP_LIMIT" as const,
        expectedNodes: 4,
        expectedEdges: 3,
        hops: 3,
      },
    ];

    for (const testCase of cases) {
      const root = testCase.snapshot.objects[0];
      if (!root) throw new Error("Explorer lineage root fixture is unavailable.");
      const lineage = buildSemanticExplorerLineage(testCase.snapshot, root.identity, {
        direction: "both",
        hop_limit: testCase.hops,
      });
      const nodeKeys = new Set(
        lineage.nodes.map((node) => JSON.stringify([node.identity.kind, node.identity.object_id])),
      );
      expect(lineage.nodes).toHaveLength(testCase.expectedNodes);
      expect(lineage.edges).toHaveLength(testCase.expectedEdges);
      expect(lineage.truncation_reasons).toContain(testCase.expectedReason);
      for (const edge of lineage.edges) {
        expect(nodeKeys.has(JSON.stringify([edge.source.kind, edge.source.object_id]))).toBe(true);
        expect(nodeKeys.has(JSON.stringify([edge.target.kind, edge.target.object_id]))).toBe(true);
      }
    }
  });

  it("maps exact genesis and stale candidate comparisons without touching active counts", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const genesisInput = {
      schema_version: SEMANTIC_EXPLORER_CANDIDATE_SOURCE_VERSION,
      semantic_domain: "sales",
      candidate_id: "00000000-0000-4000-8000-000000000030",
      revision_id: "00000000-0000-4000-8000-000000000031",
      revision_number: 1,
      source_revision_id: "00000000-0000-4000-8000-000000000032",
      candidate_status: "DRAFT",
      base_release: null,
      compared_release: null,
      candidate_diff: {
        schema_version: "semantic-diff@1.0.0",
        summary: "Create first metric",
        operations: [
          { path: "metrics.metric-first", change_type: "ADD", after: { name: "First" } },
        ],
      },
    } as const;
    const genesis = buildSemanticExplorerCandidateComparison(genesisInput);
    expect(genesis.comparison_state).toEqual({ state: "candidate", reason_code: null });

    const stale = buildSemanticExplorerCandidateComparison({
      ...genesisInput,
      candidate_status: "STALE_REBASE_REQUIRED",
      base_release: snapshot.release_identity,
      compared_release: snapshot.release_identity,
    });
    expect(stale.comparison_state).toEqual({
      state: "stale",
      reason_code: "CANDIDATE_GOVERNANCE_STALE",
    });
    expect(snapshot.counts.total_objects).toBe(snapshot.objects.length);
    expect(snapshot.objects.every((object) => object.status !== ("candidate" as never))).toBe(true);
  });

  it("classifies every candidate base-release drift branch deterministically", async () => {
    const snapshot = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
    const release = snapshot.release_identity;
    const input: SemanticExplorerRawCandidateComparison = {
      schema_version: SEMANTIC_EXPLORER_CANDIDATE_SOURCE_VERSION,
      semantic_domain: release.semantic_domain,
      candidate_id: "00000000-0000-4000-8000-000000000050",
      revision_id: "00000000-0000-4000-8000-000000000051",
      revision_number: 1,
      source_revision_id: "00000000-0000-4000-8000-000000000052",
      candidate_status: "DRAFT",
      base_release: release,
      compared_release: release,
      candidate_diff: {
        schema_version: "semantic-diff@1.0.0",
        summary: "Candidate change",
        operations: [
          {
            path: "metrics.net_revenue",
            change_type: "MODIFY",
            before: "current",
            after: "changed",
          },
        ],
      },
    };
    const cases: Array<{
      name: string;
      base: SemanticExplorerRawCandidateComparison["base_release"];
      compared: SemanticExplorerRawCandidateComparison["compared_release"];
      expected: SemanticExplorerCandidateComparison["comparison_state"]["reason_code"];
    }> = [
      { name: "matching", base: release, compared: release, expected: null },
      { name: "missing base", base: null, compared: release, expected: "BASE_RELEASE_MISSING" },
      {
        name: "release id",
        base: release,
        compared: { ...release, release_id: "00000000-0000-4000-8000-000000000099" },
        expected: "BASE_RELEASE_ID_MISMATCH",
      },
      {
        name: "generation",
        base: release,
        compared: { ...release, release_generation: release.release_generation + 1 },
        expected: "BASE_RELEASE_GENERATION_MISMATCH",
      },
      {
        name: "release digest",
        base: release,
        compared: { ...release, release_digest: `sha256:${"9".repeat(64)}` },
        expected: "BASE_RELEASE_DIGEST_MISMATCH",
      },
      {
        name: "projection identity",
        base: release,
        compared: {
          ...release,
          executable_projection: {
            ...release.executable_projection,
            projection_digest: `sha256:${"8".repeat(64)}`,
          },
        },
        expected: "BASE_RELEASE_DIGEST_MISMATCH",
      },
    ];

    for (const testCase of cases) {
      const comparison = buildSemanticExplorerCandidateComparison({
        ...input,
        base_release: testCase.base,
        compared_release: testCase.compared,
      });
      expect(comparison.comparison_state.reason_code, testCase.name).toBe(testCase.expected);
    }
  });

  it("redacts runtime restriction predicate details from candidate comparison", () => {
    const comparison = buildSemanticExplorerCandidateComparison({
      schema_version: SEMANTIC_EXPLORER_CANDIDATE_SOURCE_VERSION,
      semantic_domain: "sales",
      candidate_id: "00000000-0000-4000-8000-000000000040",
      revision_id: "00000000-0000-4000-8000-000000000041",
      revision_number: 1,
      source_revision_id: "00000000-0000-4000-8000-000000000042",
      candidate_status: "DRAFT",
      base_release: null,
      compared_release: null,
      candidate_diff: {
        schema_version: "semantic-diff@1.0.0",
        summary: "Restrict region_id = private-region-parameter",
        operations: [
          {
            path: "runtime_authorization.table_rules.0.predicates.0.parameter_key",
            change_type: "ADD",
            after: "private-region-parameter",
          },
        ],
      },
    });
    expect(comparison.diff.summary).toBe("1 deterministic semantic operation(s).");
    expect(JSON.stringify(comparison)).not.toContain("private-region-parameter");
    expect(comparison.diff.operations[0]).toEqual({
      path: "restricted",
      change_type: "ADD",
      after: "[REDACTED]",
    });
  });

  it("redacts arbitrary nested values even on otherwise public diff roots", () => {
    const comparison = buildSemanticExplorerCandidateComparison({
      schema_version: SEMANTIC_EXPLORER_CANDIDATE_SOURCE_VERSION,
      semantic_domain: "sales",
      candidate_id: "00000000-0000-4000-8000-000000000060",
      revision_id: "00000000-0000-4000-8000-000000000061",
      revision_number: 1,
      source_revision_id: "00000000-0000-4000-8000-000000000062",
      candidate_status: "DRAFT",
      base_release: null,
      compared_release: null,
      candidate_diff: {
        schema_version: "semantic-diff@1.0.0",
        summary: "leak-me-summary",
        operations: [
          {
            path: "metrics.net_revenue",
            change_type: "MODIFY",
            before: { nested: { predicate: "leak-me-before" } },
            after: { runtime_authorization: { parameter: "leak-me-after" } },
          },
        ],
      },
    });

    expect(comparison.diff.operations[0]).toEqual({
      path: "metrics",
      change_type: "MODIFY",
      before: "[REDACTED]",
      after: "[REDACTED]",
    });
    expect(JSON.stringify(comparison)).not.toContain("leak-me");
  });
});
