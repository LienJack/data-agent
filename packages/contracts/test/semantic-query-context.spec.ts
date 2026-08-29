import { describe, expect, it } from "vitest";
import {
  buildProductTeamArtifactDocument,
  buildSemanticQueryContext,
  semanticQuerySelectionIntentSchema,
  verifySemanticQueryContext,
} from "../src/artifacts/index.js";

const id = (suffix: number) => `71000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const datasource = { resource_id: id(3), resource_revision: 1, resource_hash: hash("3") };
const timeDomain = {
  time_domain_id: "time.order_month",
  calendar: "gregorian" as const,
  timezone: "Asia/Shanghai",
  min_time: "2023-01-01T00:00:00Z",
  max_time: null,
};

function contextInput() {
  return {
    schema_version: "semantic-query-context@1.0.0" as const,
    scope,
    run_id: id(4),
    semantic_domain: "commerce",
    semantic_release: {
      resource_id: id(5),
      resource_revision: 2,
      resource_hash: hash("5"),
      datasource_id: datasource.resource_id,
      semantic_generation: 2,
      publication_status: "PUBLISHED" as const,
    },
    schema_snapshot: {
      resource_id: id(6),
      resource_revision: 7,
      resource_hash: hash("6"),
      datasource_id: datasource.resource_id,
      semantic_release_id: id(5),
      semantic_generation: 2,
    },
    datasource,
    semantic_context_ref: {
      package_id: id(7),
      package_hash: hash("7"),
      receipt_id: id(8),
      receipt_hash: hash("8"),
      retrieval_receipt_hash: hash("9"),
      inference_receipt_hash: hash("a"),
    },
    requested_object_ids: [
      "dimension.order_month",
      "formula.order_revenue",
      "metric.order_revenue",
      "quality.orders_nonnegative",
      "relationship.order_customer",
      "time.order_month",
    ],
    metrics: [
      {
        metric_id: "metric.order_revenue",
        name: "Order revenue",
        aliases: ["revenue"],
        table_id: "table.orders",
        column_id: "orders.amount",
        aggregation: "sum" as const,
        formula: {
          formula_id: "formula.order_revenue",
          expression: "SUM(orders.amount)",
          dialect: "text2sql" as const,
        },
        grain: { grain_id: "grain.order", granularity: "atomic" as const },
        unit: null,
        time_domain: timeDomain,
        time_column_id: "orders.created_at",
        additivity: "additive" as const,
        null_policy: "coalesce-zero" as const,
        fanout_policy: "reject" as const,
        dependency_column_ids: ["orders.amount"],
        tags: [],
        analysis: {
          primary: true,
          priority: 1,
          missing_period_policy: "ZERO_IF_SEMANTICALLY_EMPTY" as const,
          seasonality: null,
          allowed_dimension_ids: ["dimension.order_month"],
          capabilities: ["TREND_CHANGE" as const],
          causal_role: "OUTCOME" as const,
        },
      },
    ],
    dimensions: [
      {
        dimension_id: "dimension.order_month",
        name: "Order month",
        aliases: ["month"],
        table_id: "table.orders",
        column_id: "orders.created_at",
        grain: { grain_id: "grain.month", granularity: "month" as const },
        data_type: "timestamp" as const,
        sensitivity: "PUBLIC" as const,
        hierarchical: false,
        parent_dimension_id: null,
        tags: [],
        analysis: { groupable: true, pivotable: true, causal_role: null },
      },
    ],
    formulas: [
      {
        node_id: "formula.order_revenue",
        node_version: 1,
        node_type: "FORMULA" as const,
        name: "Order revenue formula",
        aliases: [],
        owner_ref: "semantic.owner",
        lifecycle: "ACTIVE" as const,
        evidence_refs: [],
        tags: [],
        formula_type: "additive_aggregate" as const,
        return_type: "numeric" as const,
        language: "semantic-ast" as const,
        language_version: "semantic-formula-ast@1" as const,
        expression: {
          kind: "AGGREGATE" as const,
          function: "SUM" as const,
          input: { kind: "SLOT" as const, slot_id: "orders.amount" },
          distinct: false,
          filter: null,
        },
      },
    ],
    relationships: [
      {
        relationship_id: "relationship.order_customer",
        name: "Order customer",
        kind: "physical" as const,
        left_table_id: "table.orders",
        left_column_ids: ["orders.customer_id"],
        right_table_id: "table.customers",
        right_column_ids: ["customers.id"],
        cardinality: "many-to-one" as const,
        left_row_preservation: "required" as const,
        right_row_preservation: "optional" as const,
        proof_kind: "SNAPSHOT_CERTIFIED" as const,
        proof_detail: "fixed snapshot",
        tags: [],
        analysis: {
          join_allowed: true,
          fanout_closed: true,
          ontology_path: ["table.customers", "table.orders"],
        },
      },
    ],
    physical_bindings: [
      {
        logical_object_id: "metric.order_revenue",
        logical_object_type: "metric" as const,
        datasource_id: datasource.resource_id,
        schema_name: "falcon_db_24",
        table_name: "orders",
        column_name: "amount",
        binding_lifecycle: "active" as const,
        valid_from: null,
        valid_until: null,
      },
    ],
    time_semantics: [timeDomain],
    quality_constraints: [
      {
        constraint_id: "quality.orders_nonnegative",
        expression: "orders.amount >= 0",
        severity: "ERROR" as const,
        sensitivity: "INTERNAL" as const,
      },
    ],
    unresolved_ambiguities: [],
  };
}

describe("SemanticQueryContext", () => {
  it("seals exact metric, formula, dimension, relationship, time, quality and binding closure", async () => {
    const context = await buildSemanticQueryContext(contextInput());
    await expect(verifySemanticQueryContext(context)).resolves.toEqual(context);
    expect(context.context_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("seals request-scoped executable interpretations without publishing a global formula", async () => {
    const selection = semanticQuerySelectionIntentSchema.parse({
      schema_version: "semantic-query-selection-intent@1.0.0",
      selected_metric_ids: ["metric.order_revenue"],
      selected_dimension_ids: ["dimension.order_month"],
      selected_formula_ids: [],
      selected_relationship_ids: [],
      selected_time_domain_ids: ["time.order_month"],
      selected_quality_constraint_ids: [],
      unresolved_ambiguities: [],
      request_scoped_operations: [
        {
          requested_term: "订单收入同比增长",
          operator: {
            kind: "PERIOD_COMPARISON_RATE",
            metric_id: "metric.order_revenue",
            time_dimension_id: "dimension.order_month",
            comparison_offset: { unit: "YEAR", value: 1 },
            formula: "(current_value - comparison_value) / NULLIF(comparison_value, 0)",
          },
        },
      ],
    });
    expect(selection.request_scoped_operations).toHaveLength(1);

    const input = contextInput() as ReturnType<typeof contextInput> & {
      request_scoped_interpretations: unknown[];
    };
    input.request_scoped_interpretations = [
      {
        interpretation_id: "request-scoped.yoy-order-revenue",
        requested_term: "订单收入同比增长",
        scope: "REQUEST_ONLY",
        source_object_ids: ["dimension.order_month", "metric.order_revenue"],
        operator: selection.request_scoped_operations?.[0]?.operator,
        user_explanation:
          "订单收入同比按月汇总后，与上年同月比较：(本期收入-上年同期收入)/上年同期收入；上年同期为0时返回空值。",
        publication_effect: "NONE",
      },
    ];
    const context = await buildSemanticQueryContext(input);
    await expect(verifySemanticQueryContext(context)).resolves.toEqual(context);
    expect(context.request_scoped_interpretations).toEqual(input.request_scoped_interpretations);
    expect(context.formulas).toHaveLength(1);
    expect(context.formulas[0]?.node_id).toBe("formula.order_revenue");
  });

  it("rejects request-scoped interpretations that escape their governed primitive closure", async () => {
    const input = contextInput() as ReturnType<typeof contextInput> & {
      request_scoped_interpretations: unknown[];
    };
    input.request_scoped_interpretations = [
      {
        interpretation_id: "request-scoped.yoy-order-revenue",
        requested_term: "订单收入同比增长",
        scope: "REQUEST_ONLY",
        source_object_ids: ["dimension.unpublished", "metric.order_revenue"],
        operator: {
          kind: "PERIOD_COMPARISON_RATE",
          metric_id: "metric.order_revenue",
          time_dimension_id: "dimension.order_month",
          comparison_offset: { unit: "YEAR", value: 1 },
          formula: "(current_value - comparison_value) / NULLIF(comparison_value, 0)",
        },
        user_explanation: "按上年同期比较。",
        publication_effect: "NONE",
      },
    ];
    await expect(buildSemanticQueryContext(input)).rejects.toThrow();
  });

  it("binds a net ROI correction to governed aggregate inputs without reusing ROAS", () => {
    const selection = semanticQuerySelectionIntentSchema.parse({
      schema_version: "semantic-query-selection-intent@1.0.0",
      selected_metric_ids: ["metric.marketing_revenue", "metric.marketing_spend"],
      selected_dimension_ids: ["dimension.marketing_channel"],
      selected_formula_ids: [],
      selected_relationship_ids: [],
      selected_time_domain_ids: [],
      selected_quality_constraint_ids: [],
      unresolved_ambiguities: [],
      request_scoped_operations: [
        {
          requested_term: "净ROI",
          operator: {
            kind: "AGGREGATE_RATIO",
            numerator_metric_id: "metric.marketing_revenue",
            denominator_metric_id: "metric.marketing_spend",
            numerator_adjustment: "SUBTRACT_DENOMINATOR",
            aggregation: "SUM_BEFORE_RATIO",
            zero_denominator: "NULL",
          },
        },
      ],
    });
    expect(selection.request_scoped_operations?.[0]).toMatchObject({
      requested_term: "净ROI",
      operator: {
        numerator_adjustment: "SUBTRACT_DENOMINATOR",
        aggregation: "SUM_BEFORE_RATIO",
      },
    });
  });

  it("rejects model-authored fields and non-canonical selection intent", () => {
    expect(() =>
      semanticQuerySelectionIntentSchema.parse({
        schema_version: "semantic-query-selection-intent@1.0.0",
        selected_metric_ids: ["metric.z", "metric.a"],
        selected_dimension_ids: [],
        selected_formula_ids: [],
        selected_relationship_ids: [],
        selected_time_domain_ids: [],
        selected_quality_constraint_ids: [],
        unresolved_ambiguities: [],
        formula: "SUM(secret_column)",
      }),
    ).toThrow();
  });

  it("rejects cross-release, cross-schema and cross-datasource authority mixing", async () => {
    const wrongRelease = contextInput();
    wrongRelease.schema_snapshot.semantic_release_id = id(99);
    await expect(buildSemanticQueryContext(wrongRelease)).rejects.toThrow();

    const wrongGeneration = contextInput();
    wrongGeneration.schema_snapshot.semantic_generation = 1;
    await expect(buildSemanticQueryContext(wrongGeneration)).rejects.toThrow();

    const wrongDatasource = contextInput();
    const binding = wrongDatasource.physical_bindings[0];
    if (!binding) throw new TypeError("missing binding fixture");
    binding.datasource_id = id(98);
    await expect(buildSemanticQueryContext(wrongDatasource)).rejects.toThrow();
  });

  it("rejects incomplete formula, time and dimension-parent closure", async () => {
    const missingFormula = contextInput();
    missingFormula.formulas = [];
    await expect(buildSemanticQueryContext(missingFormula)).rejects.toThrow();

    const missingTime = contextInput();
    missingTime.time_semantics = [];
    await expect(buildSemanticQueryContext(missingTime)).rejects.toThrow();

    const parentFixture = contextInput();
    const missingParent = {
      ...parentFixture,
      dimensions: parentFixture.dimensions.map((dimension) => ({
        ...dimension,
        parent_dimension_id: "dimension.order_date",
      })),
    };
    await expect(buildSemanticQueryContext(missingParent)).rejects.toThrow();
  });

  it("rejects an Artifact that rebinds a verified context to another Run", async () => {
    const context = await buildSemanticQueryContext(contextInput());
    await expect(
      buildProductTeamArtifactDocument({
        schema_version: "product-team-artifact@2.0.0",
        artifact_ref: {
          artifact_id: id(10),
          artifact_type: "SemanticQueryContext",
          ...scope,
          run_id: id(11),
          revision: 1,
          content_hash: hash("0"),
        },
        profile_id: "semantic-management-agent",
        task_id: id(12),
        source_refs: [],
        provenance: null,
        projection: { kind: "SEMANTIC_CONTEXT", context },
        committed_at: "2026-08-27T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});
