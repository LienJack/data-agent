import {
  SEMANTIC_FORMULA_AST_VERSION,
  SEMANTIC_GRAPH_PATCH_VERSION,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  canonicalizeSemanticGraph,
  computeSemanticGraphDigest,
} from "../src/graph-v2/canonicalize.js";
import { compileSemanticGraphV2 } from "../src/graph-v2/compiler.js";
import { SemanticGraphErrorCode } from "../src/graph-v2/errors.js";
import { applySemanticGraphPatch } from "../src/graph-v2/patch-reducer.js";
import {
  createSemanticOntologyCoverageReceipt,
  validateSemanticGraph,
  validateSemanticOntologyCoverage,
} from "../src/graph-v2/validator.js";
import { createSemanticGraphV2Fixture } from "./fixtures/semantic-graph-v2.js";

function activeEdges(graph: ReturnType<typeof createSemanticGraphV2Fixture>) {
  return graph.edges.filter((edge) => edge.lifecycle === "ACTIVE");
}

function required<T>(value: T | undefined, message = "fixture entry missing"): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe("Semantic Graph v2 kernel", () => {
  it("canonicalizes and compiles the same graph deterministically", async () => {
    const graph = createSemanticGraphV2Fixture();
    expect(validateSemanticGraph(graph)).toEqual([]);

    const shuffled = {
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
      node_type_registry: [...graph.node_type_registry].reverse(),
      edge_type_registry: [...graph.edge_type_registry].reverse(),
    };
    expect(await computeSemanticGraphDigest(graph)).toBe(
      await computeSemanticGraphDigest(shuffled),
    );

    const first = await compileSemanticGraphV2(graph);
    const second = await compileSemanticGraphV2(shuffled);
    expect(first).toEqual(second);
    expect(first.runtime_bundle.metrics[0]).toMatchObject({
      metric_id: "metric-product-count",
      table_id: "table-order-item",
      column_id: "table-order-item.column-order-item-product-id",
      aggregation: "count_distinct",
    });
    expect(first.native_projection.node_count).toBe(7);
    expect(first.u5_projection.errors).toEqual([]);
  });

  it("fails closed on dangling and registry-incompatible edges", () => {
    const dangling = createSemanticGraphV2Fixture();
    dangling.edges[0] = { ...required(dangling.edges[0]), target_node_id: "column-missing" };
    expect(validateSemanticGraph(dangling).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.DANGLING_EDGE,
    );

    const illegal = createSemanticGraphV2Fixture();
    illegal.edges[0] = {
      ...required(illegal.edges[0]),
      source_node_id: "metric-product-count",
    };
    expect(validateSemanticGraph(illegal).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.REGISTRY_ENDPOINT_MISMATCH,
    );
  });

  it("fails closed when Formula slots are missing or ambiguously bound", () => {
    const missing = createSemanticGraphV2Fixture();
    missing.edges = missing.edges.filter((edge) => edge.edge_type !== "REFERENCES");
    expect(validateSemanticGraph(missing).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.FORMULA_SLOT_UNBOUND,
    );

    const duplicate = createSemanticGraphV2Fixture();
    const reference = required(duplicate.edges.find((edge) => edge.edge_type === "REFERENCES"));
    duplicate.edges.push({ ...reference, edge_id: "edge-formula-reference-duplicate" });
    expect(validateSemanticGraph(duplicate).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.FORMULA_SLOT_DUPLICATE_BINDING,
    );
  });

  it("fails closed on formula dependency and dimension hierarchy cycles", () => {
    const graph = createSemanticGraphV2Fixture();
    const formula = required(graph.nodes.find((node) => node.node_type === "FORMULA"));
    const secondFormula: SemanticGraphNode = {
      ...formula,
      node_id: "formula-other",
      name: "另一公式",
      language_version: SEMANTIC_FORMULA_AST_VERSION,
      expression: { kind: "SLOT", slot_id: "back" },
    };
    graph.nodes.push(secondFormula);
    const depends = (
      edgeId: string,
      source: string,
      target: string,
      slotId: string,
    ): SemanticGraphEdge => ({
      edge_id: edgeId,
      edge_version: 1,
      edge_type: "DEPENDS_ON",
      family: "FORMULA",
      source_node_id: source,
      target_node_id: target,
      lifecycle: "ACTIVE",
      attributes: { kind: "SLOT_BINDING", slot_id: slotId, role: "DEPENDENCY" },
      evidence_refs: [],
    });
    const original = required(graph.nodes.find((node) => node.node_id === "formula-product-count"));
    if (original.node_type !== "FORMULA") throw new Error("fixture formula missing");
    original.expression = { kind: "SLOT", slot_id: "other" };
    graph.edges = graph.edges.filter((edge) => edge.edge_type !== "REFERENCES");
    graph.edges.push(
      depends("edge-dep-other", "formula-product-count", "formula-other", "other"),
      depends("edge-dep-back", "formula-other", "formula-product-count", "back"),
    );
    expect(validateSemanticGraph(graph).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.FORMULA_DEPENDENCY_CYCLE,
    );

    const hierarchy = createSemanticGraphV2Fixture();
    const dimension = required(hierarchy.nodes.find((node) => node.node_type === "DIMENSION"));
    hierarchy.nodes.push({ ...dimension, node_id: "dimension-category", name: "品类" });
    hierarchy.edges.push(
      {
        edge_id: "edge-rollup-product-category",
        edge_version: 1,
        edge_type: "ROLLS_UP_TO",
        family: "ANALYTICAL",
        source_node_id: "dimension-product",
        target_node_id: "dimension-category",
        lifecycle: "ACTIVE",
        attributes: { kind: "NONE" },
        evidence_refs: [],
      },
      {
        edge_id: "edge-rollup-category-product",
        edge_version: 1,
        edge_type: "ROLLS_UP_TO",
        family: "ANALYTICAL",
        source_node_id: "dimension-category",
        target_node_id: "dimension-product",
        lifecycle: "ACTIVE",
        attributes: { kind: "NONE" },
        evidence_refs: [],
      },
    );
    expect(validateSemanticGraph(hierarchy).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.DIMENSION_HIERARCHY_CYCLE,
    );
  });

  it("fails closed instead of choosing between two active definitions", async () => {
    const graph = createSemanticGraphV2Fixture();
    const definition = required(graph.edges.find((edge) => edge.edge_type === "DEFINED_BY"));
    graph.edges.push({ ...definition, edge_id: "edge-metric-formula-duplicate" });
    await expect(compileSemanticGraphV2(graph)).rejects.toMatchObject({
      code: SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_AMBIGUOUS,
    });
  });

  it("fails closed on type, unit, grain and fanout conflicts", () => {
    const typeConflict = createSemanticGraphV2Fixture();
    const typeFormula = required(typeConflict.nodes.find((node) => node.node_type === "FORMULA"));
    if (typeFormula.node_type !== "FORMULA") throw new Error("fixture formula missing");
    typeFormula.expression = {
      kind: "AGGREGATE",
      function: "SUM",
      input: { kind: "SLOT", slot_id: "product" },
      distinct: false,
      filter: null,
    };
    expect(validateSemanticGraph(typeConflict).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.FORMULA_TYPE_CONFLICT,
    );

    const unitConflict = createSemanticGraphV2Fixture();
    const unitMetric = required(unitConflict.nodes.find((node) => node.node_type === "METRIC"));
    if (unitMetric.node_type !== "METRIC") throw new Error("fixture metric missing");
    unitMetric.unit = {
      unit_id: "unit-cny",
      dimension: "currency",
      base_unit: null,
      conversion_factor: null,
    };
    expect(validateSemanticGraph(unitConflict).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.UNIT_CONFLICT,
    );

    const grainConflict = createSemanticGraphV2Fixture();
    const baseFormula = required(grainConflict.nodes.find((node) => node.node_type === "FORMULA"));
    if (baseFormula.node_type !== "FORMULA") throw new Error("fixture formula missing");
    const dependency: SemanticGraphNode = {
      ...baseFormula,
      node_id: "formula-daily-product-count",
      name: "日商品数",
      expression: { kind: "SLOT", slot_id: "base" },
    };
    grainConflict.nodes.push(dependency);
    grainConflict.edges.push(
      {
        edge_id: "edge-formula-dependency",
        edge_version: 1,
        edge_type: "DEPENDS_ON",
        family: "FORMULA",
        source_node_id: "formula-daily-product-count",
        target_node_id: "formula-product-count",
        lifecycle: "ACTIVE",
        attributes: { kind: "SLOT_BINDING", slot_id: "base", role: "DEPENDENCY" },
        evidence_refs: [],
      },
      {
        edge_id: "edge-daily-formula-grain",
        edge_version: 1,
        edge_type: "AT_GRAIN",
        family: "ANALYTICAL",
        source_node_id: "formula-daily-product-count",
        target_node_id: "subject-order-line",
        lifecycle: "ACTIVE",
        attributes: {
          kind: "GRAIN_BINDING",
          grain: { grain_id: "grain-day", granularity: "day" },
          time_domain: null,
        },
        evidence_refs: [],
      },
    );
    expect(validateSemanticGraph(grainConflict).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.GRAIN_CONFLICT,
    );

    const fanoutConflict = createSemanticGraphV2Fixture();
    const table = required(
      fanoutConflict.nodes.find((node) => node.node_type === "PHYSICAL_TABLE"),
    );
    const column = required(
      fanoutConflict.nodes.find((node) => node.node_type === "PHYSICAL_COLUMN"),
    );
    const fanoutFormula = required(
      fanoutConflict.nodes.find((node) => node.node_type === "FORMULA"),
    );
    if (
      table.node_type !== "PHYSICAL_TABLE" ||
      column.node_type !== "PHYSICAL_COLUMN" ||
      fanoutFormula.node_type !== "FORMULA"
    ) {
      throw new Error("fixture physical graph missing");
    }
    if (fanoutFormula.expression.kind !== "AGGREGATE") {
      throw new Error("fixture aggregate formula missing");
    }
    const otherTable: SemanticGraphNode = {
      ...table,
      node_id: "table-product",
      name: "dim_product",
      table_name: "dim_product",
    };
    const otherColumn: SemanticGraphNode = {
      ...column,
      node_id: "column-product-active",
      name: "is_active",
      table_name: "dim_product",
      column_name: "is_active",
      data_type: "boolean",
      formatted_type: "boolean",
    };
    fanoutConflict.nodes.push(otherTable, otherColumn);
    fanoutFormula.expression = {
      ...fanoutFormula.expression,
      filter: { kind: "SLOT", slot_id: "active" },
    };
    const physicalFact = required(
      fanoutConflict.edges.find((edge) => edge.edge_type === "CONTAINS_COLUMN"),
    );
    const reference = required(
      fanoutConflict.edges.find((edge) => edge.edge_type === "REFERENCES"),
    );
    fanoutConflict.edges.push(
      {
        ...physicalFact,
        edge_id: "edge-product-active-column",
        source_node_id: "table-product",
        target_node_id: "column-product-active",
      },
      {
        ...reference,
        edge_id: "edge-formula-active-reference",
        target_node_id: "column-product-active",
        attributes: { kind: "SLOT_BINDING", slot_id: "active", role: "FILTER" },
      },
    );
    expect(validateSemanticGraph(fanoutConflict).map((error) => error.code)).toContain(
      SemanticGraphErrorCode.FANOUT_CONFLICT,
    );
  });

  it("blocks Agent patches from fabricating physical schema facts", async () => {
    const graph = canonicalizeSemanticGraph(createSemanticGraphV2Fixture());
    const digest = await computeSemanticGraphDigest(graph);
    const physical = required(graph.nodes.find((node) => node.node_type === "PHYSICAL_COLUMN"));
    await expect(
      applySemanticGraphPatch(graph, {
        patch_version: SEMANTIC_GRAPH_PATCH_VERSION,
        patch_id: "00000000-0000-1000-8000-000000000206",
        graph_id: graph.metadata.graph_id,
        candidate_id: "00000000-0000-1000-8000-000000000207",
        from_working_revision: 0,
        to_working_revision: 1,
        before_digest: digest,
        after_digest: digest,
        operations: [
          { operation: "ADD_NODE", node: { ...physical, node_id: "column-fabricated" } },
        ],
        patch_digest: `sha256:${"b".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: SemanticGraphErrorCode.SYSTEM_MANAGED_MUTATION });
  });

  it("applies a valid append-only CAS patch without changing the database schema", async () => {
    const graph = canonicalizeSemanticGraph(createSemanticGraphV2Fixture());
    const addedNode: SemanticGraphNode = {
      node_id: "subject-customer",
      node_version: 1,
      node_type: "BUSINESS_SUBJECT",
      name: "客户",
      aliases: ["customer"],
      owner_ref: "data-team",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags: [],
      domain: "ecommerce",
    };
    const beforeDigest = await computeSemanticGraphDigest(graph);
    const afterDigest = await computeSemanticGraphDigest({
      ...graph,
      nodes: [...graph.nodes, addedNode],
    });
    const patchMaterial = {
      patch_version: SEMANTIC_GRAPH_PATCH_VERSION,
      patch_id: "00000000-0000-1000-8000-000000000208",
      graph_id: graph.metadata.graph_id,
      candidate_id: "00000000-0000-1000-8000-000000000209",
      from_working_revision: 4,
      to_working_revision: 5,
      before_digest: beforeDigest,
      after_digest: afterDigest,
      operations: [{ operation: "ADD_NODE" as const, node: addedNode }],
    };
    const result = await applySemanticGraphPatch(graph, {
      ...patchMaterial,
      patch_digest: await sha256ContentHash(patchMaterial),
    });
    expect(result.nodes.some((node) => node.node_id === "subject-customer")).toBe(true);
    expect(await computeSemanticGraphDigest(result)).toBe(afterDigest);
  });

  it("keeps active relation selection explicit", () => {
    const graph = createSemanticGraphV2Fixture();
    expect(activeEdges(graph).every((edge) => edge.lifecycle === "ACTIVE")).toBe(true);
  });

  it("proves subject, dimension, formula, physical-field, and terminology coverage", async () => {
    const graph = createSemanticGraphV2Fixture();
    expect(validateSemanticOntologyCoverage(graph)).toEqual([]);

    const checkedAt = "2026-08-15T12:00:00Z";
    const first = await createSemanticOntologyCoverageReceipt(graph, checkedAt);
    const second = await createSemanticOntologyCoverageReceipt(
      { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() },
      checkedAt,
    );
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      valid: true,
      active_node_counts: { GLOSSARY_TERM: 1 },
      active_edge_family_counts: { TERMINOLOGY: 1 },
      issues: [],
    });
  });

  it("fails ontology coverage when relationships are embedded or omitted", () => {
    const graph = createSemanticGraphV2Fixture();
    graph.edges = graph.edges.filter(
      (edge) =>
        !["REPRESENTED_BY", "IDENTIFIED_BY", "USES_DIMENSION", "DENOTES"].includes(edge.edge_type),
    );
    expect(validateSemanticGraph(graph)).toEqual([]);
    expect(validateSemanticOntologyCoverage(graph).map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "SUBJECT_PHYSICAL_TABLE_MISSING",
        "SUBJECT_IDENTIFIER_MISSING",
        "FORMULA_DIMENSION_MISSING",
        "GLOSSARY_TERM_UNLINKED",
      ]),
    );
  });
});
