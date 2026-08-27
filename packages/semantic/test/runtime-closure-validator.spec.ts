import { buildSemanticSuccessorStage } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import { describe, expect, it } from "vitest";
import {
  validateSemanticRuntimeClosure,
  verifySemanticReleaseEnvelope,
} from "../src/production/runtime-closure-validator.js";

const id = (suffix: number) => `40000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const scope = {
  app_id: id(1),
  tenant_id: id(2),
  environment: "test" as const,
  semantic_domain: "falcon24",
};
const datasourceId = id(3);
const snapshotId = id(4);
const snapshotHash = hash("1");
const changeSetHash = hash("2");
const compilerVersion = "semantic-change-set-publication@2";
const compilerBundleHash = hash("3");
const grain = { grain_id: "grain.order", granularity: "atomic" as const };
const timeDomain = {
  time_domain_id: "time.order",
  calendar: "gregorian" as const,
  timezone: "Asia/Shanghai",
  min_time: null,
  max_time: null,
};
const metricAnalysis = {
  primary: true,
  priority: 10_000,
  missing_period_policy: "ZERO_IF_SEMANTICALLY_EMPTY" as const,
  seasonality: null,
  allowed_dimension_ids: ["dimension.order_month"],
  capabilities: ["CHART_DATASET" as const, "TREND_CHANGE" as const],
  causal_role: "OUTCOME" as const,
};
const dimensionAnalysis = { groupable: true, pivotable: true, causal_role: null };

type RuntimeEnvelopeVariant =
  | "VALID"
  | "DUPLICATE_METRIC"
  | "MISSING_METRIC_BINDING"
  | "MISSING_ALLOWED_DIMENSION"
  | "INVALID_DIMENSION_HIERARCHY"
  | "INVALID_RELATIONSHIP_ENDPOINT"
  | "INVALID_FORMULA_SLOT"
  | "INVALID_TIME_CLOSURE"
  | "DUPLICATE_QUALITY_CONSTRAINT"
  | "WRONG_DATASOURCE"
  | "DANGLING_GRAPH_EDGE"
  | "WRONG_GRAPH_SOURCE";

async function runtimeEnvelope(variant: RuntimeEnvelopeVariant = "VALID") {
  const executable = {
    schema_version: "semantic-executable-projection@1.0.0" as const,
    metrics: [
      {
        metric_id: "metric.order_revenue",
        name: "订单收入",
        aliases: ["收入"],
        table_id: "orders",
        column_id: "order_total",
        aggregation: "sum" as const,
        formula: {
          formula_id: "formula.order_revenue",
          expression: "SUM(order_total)",
          dialect: "text2sql" as const,
        },
        grain,
        unit: null,
        time_domain: timeDomain,
        time_column_id: "order_date",
        additivity: "additive" as const,
        null_policy: "coalesce-zero" as const,
        fanout_policy: "preaggregate" as const,
        dependency_column_ids: ["order_total"],
        tags: [],
        analysis: {
          ...metricAnalysis,
          allowed_dimension_ids:
            variant === "MISSING_ALLOWED_DIMENSION"
              ? ["dimension.missing"]
              : metricAnalysis.allowed_dimension_ids,
        },
      },
    ],
    dimensions: [
      {
        dimension_id: "dimension.order_month",
        name: "订单月份",
        aliases: ["月份"],
        table_id: "orders",
        column_id: "order_date",
        grain,
        data_type: "date" as const,
        sensitivity: "PUBLIC" as const,
        hierarchical: variant === "INVALID_DIMENSION_HIERARCHY",
        parent_dimension_id: variant === "INVALID_DIMENSION_HIERARCHY" ? "dimension.missing" : null,
        tags: [],
        analysis: dimensionAnalysis,
      },
    ],
    formulas: [
      {
        node_id: "formula.order_revenue",
        node_version: 1,
        node_type: "FORMULA" as const,
        name: "订单收入公式",
        aliases: [],
        owner_ref: "semantic-publication-authority",
        lifecycle: "ACTIVE" as const,
        evidence_refs: [],
        tags: [],
        formula_type: "additive_aggregate" as const,
        return_type: "numeric" as const,
        language: "semantic-ast" as const,
        language_version: "semantic-formula-ast@1" as const,
        expression: {
          kind: "SLOT" as const,
          slot_id: variant === "INVALID_FORMULA_SLOT" ? "missing_column" : "order_total",
        },
      },
    ],
    physical_bindings: [
      {
        logical_object_id: "metric.order_revenue",
        logical_object_type: "metric" as const,
        datasource_id: datasourceId,
        schema_name: "public",
        table_name: "orders",
        column_name: "order_total",
        binding_lifecycle: "active" as const,
        valid_from: null,
        valid_until: null,
      },
      {
        logical_object_id: "dimension.order_month",
        logical_object_type: "dimension" as const,
        datasource_id: datasourceId,
        schema_name: "public",
        table_name: "orders",
        column_name: "order_date",
        binding_lifecycle: "active" as const,
        valid_from: null,
        valid_until: null,
      },
      ...[
        ["table.orders", "table", "orders", null],
        ["column.orders.order_total", "column", "orders", "order_total"],
        ["column.orders.order_date", "column", "orders", "order_date"],
        ["column.orders.customer_id", "column", "orders", "customer_id"],
        ["table.customers", "table", "customers", null],
        ["column.customers.customer_id", "column", "customers", "customer_id"],
      ].map(([logical_object_id, logical_object_type, table_name, column_name]) => ({
        logical_object_id: logical_object_id ?? "",
        logical_object_type: logical_object_type as "table" | "column",
        datasource_id: datasourceId,
        schema_name: "public",
        table_name: table_name ?? "",
        column_name,
        binding_lifecycle: "active" as const,
        valid_from: null,
        valid_until: null,
      })),
    ],
  };
  if (variant === "DUPLICATE_METRIC") {
    const [metric] = executable.metrics;
    if (!metric) throw new Error("RUNTIME_CLOSURE_FIXTURE_METRIC_MISSING");
    executable.metrics.push({ ...metric });
  }
  if (variant === "MISSING_METRIC_BINDING") {
    executable.physical_bindings.splice(0, 1);
  }
  if (variant === "WRONG_DATASOURCE") {
    const [binding] = executable.physical_bindings;
    if (!binding) throw new Error("RUNTIME_CLOSURE_FIXTURE_BINDING_MISSING");
    executable.physical_bindings[0] = {
      ...binding,
      datasource_id: id(99),
    };
  }
  const relationship = {
    schema_version: "semantic-relationship-projection@1.0.0" as const,
    relationships: [
      {
        relationship_id: "relationship.order-customer",
        name: "订单到客户",
        kind: "analytical" as const,
        left_table_id: "orders",
        left_column_ids:
          variant === "INVALID_RELATIONSHIP_ENDPOINT" ? ["missing_column"] : ["customer_id"],
        right_table_id: "customers",
        right_column_ids: ["customer_id"],
        cardinality: "many-to-one" as const,
        left_row_preservation: "required" as const,
        right_row_preservation: "optional" as const,
        proof_kind: "DDL_ENFORCED" as const,
        proof_detail: "orders_customer_fk",
        tags: [],
        analysis: {
          join_allowed: true,
          fanout_closed: true,
          ontology_path: ["entity.customer", "entity.order"],
        },
      },
    ],
  };
  const restriction = {
    schema_version: "semantic-runtime-restriction-projection@1.0.0" as const,
    quality_constraints: [
      {
        constraint_id: "quality.orders.nonnegative_revenue",
        expression: "order_total >= 0",
        severity: "ERROR" as const,
        sensitivity: "INTERNAL" as const,
      },
    ],
    time_semantics: variant === "INVALID_TIME_CLOSURE" ? [] : [timeDomain],
  };
  if (variant === "DUPLICATE_QUALITY_CONSTRAINT") {
    const [constraint] = restriction.quality_constraints;
    if (!constraint) throw new Error("RUNTIME_CLOSURE_FIXTURE_CONSTRAINT_MISSING");
    restriction.quality_constraints.push({ ...constraint });
  }
  const nodes = [
    {
      node_id: "metric.order_revenue",
      node_version: 1,
      node_type: "METRIC" as const,
      name: "订单收入",
      aliases: ["收入"],
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE" as const,
      evidence_refs: [],
      tags: [],
      unit: null,
      additivity: "additive" as const,
      null_policy: "coalesce-zero" as const,
      fanout_policy: "preaggregate" as const,
      analysis: metricAnalysis,
    },
    {
      node_id: "dimension.order_month",
      node_version: 1,
      node_type: "DIMENSION" as const,
      name: "订单月份",
      aliases: ["月份"],
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE" as const,
      evidence_refs: [],
      tags: [],
      data_type: "date" as const,
      sensitivity: "PUBLIC" as const,
      filter_semantics: "TEMPORAL" as const,
      analysis: dimensionAnalysis,
    },
    executable.formulas[0],
    ...[
      ["table.orders", "PHYSICAL_TABLE", "orders", null, 0],
      ["column.orders.order_total", "PHYSICAL_COLUMN", "orders", "order_total", 1],
      ["column.orders.order_date", "PHYSICAL_COLUMN", "orders", "order_date", 2],
      ["column.orders.customer_id", "PHYSICAL_COLUMN", "orders", "customer_id", 3],
      ["table.customers", "PHYSICAL_TABLE", "customers", null, 0],
      ["column.customers.customer_id", "PHYSICAL_COLUMN", "customers", "customer_id", 1],
    ].map(([node_id, node_type, table_name, column_name, ordinal]) =>
      node_type === "PHYSICAL_TABLE"
        ? {
            node_id: String(node_id),
            node_version: 1,
            node_type: "PHYSICAL_TABLE" as const,
            name: String(table_name),
            aliases: [],
            owner_ref: "semantic-publication-authority",
            lifecycle: "ACTIVE" as const,
            evidence_refs: [],
            tags: [],
            schema_snapshot_id: snapshotId,
            snapshot_content_hash: snapshotHash,
            datasource_id: datasourceId,
            schema_name: "public",
            table_name: String(table_name),
            relation_kind: "TABLE" as const,
          }
        : {
            node_id: String(node_id),
            node_version: 1,
            node_type: "PHYSICAL_COLUMN" as const,
            name: String(column_name),
            aliases: [],
            owner_ref: "semantic-publication-authority",
            lifecycle: "ACTIVE" as const,
            evidence_refs: [],
            tags: [],
            schema_snapshot_id: snapshotId,
            snapshot_content_hash: snapshotHash,
            datasource_id: datasourceId,
            schema_name: "public",
            table_name: String(table_name),
            column_name: String(column_name),
            ordinal: Number(ordinal),
            formatted_type: column_name === "order_date" ? "date" : "numeric",
            data_type: column_name === "order_date" ? ("date" as const) : ("numeric" as const),
            nullable: false,
            sensitivity: "PUBLIC" as const,
          },
    ),
  ];
  const edges = [
    {
      edge_id: "formula.order_revenue.slot.order_total",
      edge_version: 1,
      edge_type: "BINDS_SLOT",
      family: "FORMULA" as const,
      source_node_id: "formula.order_revenue",
      target_node_id:
        variant === "DANGLING_GRAPH_EDGE" ? "column.orders.missing" : "column.orders.order_total",
      lifecycle: "ACTIVE" as const,
      attributes: {
        kind: "SLOT_BINDING" as const,
        slot_id: "order_total",
        role: "MEASURE" as const,
      },
      evidence_refs: [],
    },
    {
      edge_id: "relationship.order-customer",
      edge_version: 1,
      edge_type: "ANALYTICAL_JOIN",
      family: "JOIN" as const,
      source_node_id: "table.orders",
      target_node_id: "table.customers",
      lifecycle: "ACTIVE" as const,
      attributes: {
        kind: "JOIN_PROOF" as const,
        cardinality: "many-to-one" as const,
        left_row_preservation: "required" as const,
        right_row_preservation: "optional" as const,
        proof_kind: "DDL_ENFORCED" as const,
        proof_detail: "orders_customer_fk",
        analysis: relationship.relationships[0]?.analysis,
      },
      evidence_refs: [],
    },
  ];
  const graph = {
    projection_version: "semantic-graph-projection@1" as const,
    graph_id: id(10),
    source_digest: variant === "WRONG_GRAPH_SOURCE" ? hash("f") : changeSetHash,
    registry_digest: hash("4"),
    compiler_version: compilerVersion,
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
  };
  const [executableDigest, relationshipDigest, restrictionDigest, graphDigest] = await Promise.all([
    sha256ContentHash(executable),
    sha256ContentHash(relationship),
    sha256ContentHash(restriction),
    sha256ContentHash(graph),
  ]);
  const releaseDigest = await sha256ContentHash({
    change_set_hash: changeSetHash,
    generation: 2,
    compiler_bundle_digest: compilerBundleHash,
    executable_projection_digest: executableDigest,
    relationship_projection_digest: relationshipDigest,
    restriction_projection_digest: restrictionDigest,
    graph_projection_digest: graphDigest,
  });
  const projectionRefs = {
    executable: { projection_id: id(11), projection_digest: executableDigest },
    relationship: { projection_id: id(12), projection_digest: relationshipDigest },
    runtime_restriction: { projection_id: id(13), projection_digest: restrictionDigest },
    graph: { projection_id: id(14), projection_digest: graphDigest },
  };
  const stage = await buildSemanticSuccessorStage({
    schema_version: "semantic-successor-stage@1.0.0",
    stage_id: id(15),
    scope,
    predecessor_release: { release_id: id(16), generation: 1, release_digest: hash("5") },
    expected_pointer_version: 3,
    target_generation: 2,
    change_set_ref: { change_set_id: id(17), change_set_hash: changeSetHash },
    review_ref: { review_id: id(18), review_hash: hash("6") },
    source_snapshot_ref: {
      snapshot_id: snapshotId,
      snapshot_revision: 7,
      snapshot_hash: snapshotHash,
    },
    compiler_bundle_ref: {
      compiler_version: compilerVersion,
      compiler_bundle_hash: compilerBundleHash,
    },
    candidate_release: {
      release_id: id(19),
      generation: 2,
      release_digest: releaseDigest,
      datasource_id: datasourceId,
    },
    projection_refs: projectionRefs,
    status: "STAGED",
  });
  return {
    stage,
    projections: {
      executable: {
        projection_kind: "EXECUTABLE" as const,
        ...projectionRefs.executable,
        projection_payload: executable,
      },
      relationship: {
        projection_kind: "RELATIONSHIP" as const,
        ...projectionRefs.relationship,
        projection_payload: relationship,
      },
      runtime_restriction: {
        projection_kind: "RUNTIME_RESTRICTION" as const,
        ...projectionRefs.runtime_restriction,
        projection_payload: restriction,
      },
      graph: {
        projection_kind: "GRAPH" as const,
        ...projectionRefs.graph,
        projection_payload: graph,
      },
    },
  };
}

describe("semantic runtime closure validator", () => {
  it("verifies and closes a generation 2 executable runtime envelope", async () => {
    const verified = await verifySemanticReleaseEnvelope(await runtimeEnvelope());
    const [receipt, replay] = await Promise.all([
      validateSemanticRuntimeClosure(verified),
      validateSemanticRuntimeClosure(verified),
    ]);
    expect(receipt.outcome).toBe("PASS");
    expect(receipt.reason_codes).toEqual([]);
    expect(replay).toEqual(receipt);
  });

  it("rejects projection payload tampering before semantic closure validation", async () => {
    const envelope = await runtimeEnvelope();
    await expect(
      verifySemanticReleaseEnvelope({
        ...envelope,
        projections: {
          ...envelope.projections,
          executable: {
            ...envelope.projections.executable,
            projection_payload: {
              ...envelope.projections.executable.projection_payload,
              unknown_field: true,
            },
          },
        },
      }),
    ).rejects.toThrow("SEMANTIC_RELEASE_ENVELOPE_INVALID");
  });

  it.each([
    ["DUPLICATE_METRIC", "SEMANTIC_RUNTIME_DUPLICATE_IDENTITY"],
    ["MISSING_METRIC_BINDING", "SEMANTIC_RUNTIME_METRIC_BINDING_INVALID"],
    ["MISSING_ALLOWED_DIMENSION", "SEMANTIC_RUNTIME_METRIC_DIMENSION_CLOSURE_INVALID"],
    ["INVALID_DIMENSION_HIERARCHY", "SEMANTIC_RUNTIME_DIMENSION_HIERARCHY_INVALID"],
    ["INVALID_RELATIONSHIP_ENDPOINT", "SEMANTIC_RUNTIME_RELATIONSHIP_CLOSURE_INVALID"],
    ["INVALID_FORMULA_SLOT", "SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID"],
    ["INVALID_TIME_CLOSURE", "SEMANTIC_RUNTIME_TIME_CLOSURE_INVALID"],
    ["DUPLICATE_QUALITY_CONSTRAINT", "SEMANTIC_RUNTIME_DUPLICATE_IDENTITY"],
    ["WRONG_DATASOURCE", "SEMANTIC_RUNTIME_DATASOURCE_CLOSURE_INVALID"],
    ["DANGLING_GRAPH_EDGE", "SEMANTIC_RUNTIME_GRAPH_SOURCE_CLOSURE_INVALID"],
    ["WRONG_GRAPH_SOURCE", "SEMANTIC_RUNTIME_GRAPH_SOURCE_CLOSURE_INVALID"],
  ] as const)("returns a deterministic FAIL receipt for %s", async (variant, expectedReason) => {
    const verified = await verifySemanticReleaseEnvelope(await runtimeEnvelope(variant));
    const receipt = await validateSemanticRuntimeClosure(verified);
    expect(receipt.outcome).toBe("FAIL");
    expect(receipt.reason_codes).toContain(expectedReason);
  });

  it("rejects accessors and proxies without invoking caller-controlled behavior", async () => {
    const withAccessor = await runtimeEnvelope();
    let getterCalls = 0;
    Object.defineProperty(withAccessor, "stage", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return null;
      },
    });
    await expect(verifySemanticReleaseEnvelope(withAccessor)).rejects.toThrow(
      "SEMANTIC_RELEASE_ENVELOPE_INVALID",
    );
    expect(getterCalls).toBe(0);

    const plain = await runtimeEnvelope();
    let proxyTrapCalls = 0;
    const proxy = new Proxy(plain, {
      ownKeys() {
        proxyTrapCalls += 1;
        return [];
      },
    });
    await expect(verifySemanticReleaseEnvelope(proxy)).rejects.toThrow(
      "SEMANTIC_RELEASE_ENVELOPE_INVALID",
    );
    expect(proxyTrapCalls).toBe(0);
  });

  it("does not let a structural clone masquerade as a verified release envelope", async () => {
    const verified = await verifySemanticReleaseEnvelope(await runtimeEnvelope());
    await expect(validateSemanticRuntimeClosure(structuredClone(verified))).rejects.toThrow(
      "SEMANTIC_RELEASE_ENVELOPE_NOT_VERIFIED",
    );
  });
});
