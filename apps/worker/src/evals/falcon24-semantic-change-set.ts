import { createHash } from "node:crypto";
import {
  buildSemanticAssertionCandidate,
  type SemanticAssertionCandidate,
  type SemanticAssertionTargetKind,
  type SemanticChangeSet,
  type SemanticFormulaExpression,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  buildFalcon24AgentAnalysisAcceptanceSuite,
  FALCON24_SEMANTIC_RELEASE_BLUEPRINT,
} from "@data-agent/evals";
import {
  compileSemanticChangeSet,
  freezeSemanticChangeSetForReview,
} from "@data-agent/semantic/production";

type Falcon24Scope = SemanticAssertionCandidate["scope"];

const dimensionBindings = Object.freeze({
  customer_segment: ["blinkit_customers", "customer_segment"],
  delivery_status: ["blinkit_delivery_performance", "delivery_status"],
  marketing_channel: ["blinkit_marketing_performance", "channel"],
  order_month: ["blinkit_orders", "order_date"],
  payment_method: ["blinkit_orders", "payment_method"],
  product_category: ["blinkit_products", "category"],
  registration_cohort: ["blinkit_customers", "registration_date"],
  target_audience: ["blinkit_marketing_performance", "target_audience"],
} as const);

const metricBindings = Object.freeze({
  active_buyers: ["blinkit_orders", "customer_id", "COUNT_DISTINCT"],
  cohort_retention: ["blinkit_customers", "customer_id", "COUNT_DISTINCT"],
  damaged_stock: ["blinkit_inventory", "damaged_stock", "SUM"],
  delivery_minutes: ["blinkit_delivery_performance", "delivery_time_minutes", "AVG"],
  low_rating_rate: ["blinkit_customer_feedback", "rating", "AVG"],
  marketing_spend: ["blinkit_marketing_performance", "spend", "SUM"],
  new_customers: ["blinkit_customers", "customer_id", "COUNT_DISTINCT"],
  on_time_rate: ["blinkit_delivery_performance", "delivery_status", "COUNT"],
  order_count: ["blinkit_orders", "order_id", "COUNT_DISTINCT"],
  order_revenue: ["blinkit_orders", "order_total", "SUM"],
  repeat_purchase_rate: ["blinkit_orders", "customer_id", "COUNT_DISTINCT"],
  sales_quantity: ["blinkit_order_items", "quantity", "SUM"],
  stock_received: ["blinkit_inventory", "stock_received", "SUM"],
} as const);

const relationshipSpecs = Object.freeze({
  feedback_customer: [
    "blinkit_customer_feedback",
    "customer_id",
    "blinkit_customers",
    "customer_id",
    "many-to-one",
  ],
  feedback_order: [
    "blinkit_customer_feedback",
    "order_id",
    "blinkit_orders",
    "order_id",
    "one-to-one",
  ],
  delivery_order: [
    "blinkit_delivery_performance",
    "order_id",
    "blinkit_orders",
    "order_id",
    "one-to-one",
  ],
  inventory_new_product: [
    "blinkit_inventoryNew",
    "product_id",
    "blinkit_products",
    "product_id",
    "many-to-one",
  ],
  inventory_product: [
    "blinkit_inventory",
    "product_id",
    "blinkit_products",
    "product_id",
    "many-to-one",
  ],
  order_customer: [
    "blinkit_orders",
    "customer_id",
    "blinkit_customers",
    "customer_id",
    "many-to-one",
  ],
  order_item_order: [
    "blinkit_order_items",
    "order_id",
    "blinkit_orders",
    "order_id",
    "many-to-one",
  ],
  order_item_product: [
    "blinkit_order_items",
    "product_id",
    "blinkit_products",
    "product_id",
    "many-to-one",
  ],
} as const);

const qualityConstraints = Object.freeze({
  "quality.first_order_before_registration": ["first_order_date >= registration_date", "WARN"],
  "quality.inventory_new_sensitivity_only": [
    "blinkit_inventoryNew must not be unioned into primary inventory analysis",
    "ERROR",
  ],
  "quality.order_before_registration": ["order_date >= registration_date", "WARN"],
  "quality.order_total_item_mismatch": [
    "abs(order_total-sum(quantity*unit_price)) <= 0.01",
    "WARN",
  ],
  "quality.stored_customer_kpi_untrusted": [
    "customer total_orders and avg_order_value must be recomputed",
    "ERROR",
  ],
} as const);

const commonNode = {
  node_version: 1,
  aliases: [],
  owner_ref: "falcon24-semantic-owner",
  lifecycle: "ACTIVE" as const,
  evidence_refs: [],
  tags: ["falcon24"],
};

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function formulaExpression(formulaId: string): SemanticFormulaExpression {
  const slot = (slot_id: string) => ({ kind: "SLOT" as const, slot_id });
  const aggregate = (fn: "COUNT_DISTINCT" | "SUM", slotId: string) => ({
    kind: "AGGREGATE" as const,
    function: fn,
    input: slot(slotId),
    distinct: fn === "COUNT_DISTINCT",
    filter: null,
  });
  const divide = (left: SemanticFormulaExpression, right: SemanticFormulaExpression) => ({
    kind: "BINARY" as const,
    operator: "DIVIDE" as const,
    left,
    right,
  });
  if (formulaId === "average_order_value") {
    return divide(aggregate("SUM", "order_total"), aggregate("COUNT_DISTINCT", "order_id"));
  }
  if (formulaId === "buyer_frequency_aov") {
    return {
      kind: "BINARY" as const,
      operator: "MULTIPLY" as const,
      left: {
        kind: "BINARY" as const,
        operator: "MULTIPLY" as const,
        left: slot("active_buyers"),
        right: slot("orders_per_buyer"),
      },
      right: slot("average_order_value"),
    };
  }
  if (formulaId === "inventory_damage_rate") {
    return divide(slot("damaged_stock"), {
      kind: "BINARY" as const,
      operator: "ADD" as const,
      left: slot("damaged_stock"),
      right: slot("stock_received"),
    });
  }
  if (formulaId === "click_through_rate") return divide(slot("clicks"), slot("impressions"));
  if (formulaId === "conversion_rate") return divide(slot("conversions"), slot("clicks"));
  if (formulaId === "marketing_roas") return divide(slot("revenue_generated"), slot("spend"));
  return { kind: "LITERAL" as const, value: "month_diff(order_date,registration_date)" };
}

function targetKindFor(key: string): SemanticAssertionTargetKind {
  if (key.startsWith("dimension.")) return "DIMENSION";
  if (key.startsWith("formula.")) return "FORMULA";
  if (key.startsWith("metric.")) return "METRIC";
  if (key.startsWith("relationship.")) return "RELATIONSHIP";
  throw new TypeError(`FALCON24_SEMANTIC_KEY_UNKNOWN:${key}`);
}

export async function buildFalcon24SemanticChangeSet(input: {
  readonly scope: Falcon24Scope;
  readonly base_release: SemanticChangeSet["base_release"];
  readonly revision?: number;
}) {
  if (input.scope.semantic_domain !== "falcon24") {
    throw new TypeError("FALCON24_SEMANTIC_DOMAIN_INVALID");
  }
  const blueprintHash = await sha256ContentHash(FALCON24_SEMANTIC_RELEASE_BLUEPRINT);
  const datasourceId = stableUuid("falcon24:datasource");
  const assertions: SemanticAssertionCandidate[] = [];
  const add = async (
    targetKind: SemanticAssertionTargetKind,
    canonicalKey: string,
    assertionPayload: Record<string, unknown>,
    sourceKind: "CURRENT_SEMANTIC_FACT" | "SCHEMA_FACT" = "CURRENT_SEMANTIC_FACT",
  ) => {
    assertions.push(
      await buildSemanticAssertionCandidate({
        schema_version: "semantic-assertion-candidate@1.0.0",
        assertion_id: stableUuid(`falcon24:assertion:${canonicalKey}`),
        scope: input.scope,
        target_kind: targetKind,
        canonical_key: canonicalKey,
        applicability_scope: { datasource: "falcon_db_24" },
        assertion_payload: assertionPayload,
        source_kind: sourceKind,
        evidence: [
          {
            evidence_id: `falcon24-blueprint:${canonicalKey}`,
            source_kind: sourceKind,
            source_ref: {
              resource_id: "falcon24-semantic-blueprint",
              resource_revision: 1,
              resource_hash: blueprintHash,
            },
            locator: {
              locator_kind: sourceKind === "SCHEMA_FACT" ? "SCHEMA_OBJECT" : "SEMANTIC_OBJECT",
              locator_value: canonicalKey,
            },
            observation: "Verified Falcon24 schema and semantic acceptance requirement.",
          },
        ],
        premise_assertion_ids: [],
        inference_rule_id: null,
        confidence: 1,
      }),
    );
  };

  for (const table of FALCON24_SEMANTIC_RELEASE_BLUEPRINT.tables) {
    await add(
      "PHYSICAL_BINDING",
      `binding.table.${table.table_id}`,
      {
        binding: {
          logical_object_id: `table.${table.table_id}`,
          logical_object_type: "table",
          datasource_id: datasourceId,
          schema_name: "falcon_db_24",
          table_name: table.table_id,
          column_name: null,
          binding_lifecycle: "active",
          valid_from: "2023-05-01",
          valid_until: null,
        },
      },
      "SCHEMA_FACT",
    );
    for (const column of table.columns) {
      await add(
        "PHYSICAL_BINDING",
        `binding.column.${table.table_id}.${column}`,
        {
          binding: {
            logical_object_id: `column.${table.table_id}.${column}`,
            logical_object_type: "column",
            datasource_id: datasourceId,
            schema_name: "falcon_db_24",
            table_name: table.table_id,
            column_name: column,
            binding_lifecycle: "active",
            valid_from: "2023-05-01",
            valid_until: null,
          },
        },
        "SCHEMA_FACT",
      );
    }
  }

  for (const [dimensionId, [tableId, columnId]] of Object.entries(dimensionBindings)) {
    await add("DIMENSION", `dimension.${dimensionId}`, {
      dimension: {
        dimension_id: `dimension.${dimensionId}`,
        name: dimensionId,
        aliases: [dimensionId.replaceAll("_", " ")],
        table_id: tableId,
        column_id: `${tableId}.${columnId}`,
        grain: { grain_id: `grain.${tableId}`, granularity: "atomic" },
        data_type:
          dimensionId.includes("month") || dimensionId.includes("cohort") ? "date" : "text",
        sensitivity: "INTERNAL",
        hierarchical: false,
        parent_dimension_id: null,
        tags: ["falcon24"],
        analysis: { groupable: true, pivotable: true, causal_role: "CANDIDATE_CONFOUNDER" },
      },
    });
  }

  const allowedDimensionIds = Object.keys(dimensionBindings)
    .map((dimensionId) => `dimension.${dimensionId}`)
    .sort();
  for (const [metricId, [tableId, columnId, aggregation]] of Object.entries(metricBindings)) {
    await add("METRIC", `metric.${metricId}`, {
      metric: {
        metric_id: `metric.${metricId}`,
        name: metricId,
        aliases: [metricId.replaceAll("_", " ")],
        table_id: tableId,
        column_id: `${tableId}.${columnId}`,
        aggregation: aggregation.toLowerCase(),
        formula: null,
        grain: { grain_id: `grain.${tableId}`, granularity: "atomic" },
        unit: null,
        time_domain: null,
        time_column_id: tableId === "blinkit_orders" ? "blinkit_orders.order_date" : null,
        additivity: aggregation === "SUM" ? "additive" : "non-additive",
        null_policy: "exclude",
        fanout_policy: "preaggregate",
        dependency_column_ids: [`${tableId}.${columnId}`],
        tags: ["falcon24"],
        analysis: {
          primary: ["order_revenue", "order_count"].includes(metricId),
          priority: ["order_revenue", "order_count"].includes(metricId) ? 10_000 : 1_000,
          missing_period_policy: "REJECT_GAP",
          seasonality: null,
          allowed_dimension_ids: allowedDimensionIds,
          capabilities: ["ASSOCIATION", "CHART_DATASET", "CONTRIBUTION", "TREND_CHANGE"],
          causal_role: "OUTCOME",
        },
      },
    });
  }

  for (const formulaId of Object.keys(FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas)) {
    await add("FORMULA", `formula.${formulaId}`, {
      formula: {
        ...commonNode,
        node_id: `formula.${formulaId}`,
        node_type: "FORMULA",
        name: formulaId,
        formula_type:
          formulaId.includes("rate") || formulaId.includes("value") || formulaId.includes("roas")
            ? "ratio"
            : "compound",
        return_type: "numeric",
        language: "semantic-ast",
        language_version: "semantic-formula-ast@1",
        expression: formulaExpression(formulaId),
      },
    });
  }
  await add("FORMULA", "formula.buyer_frequency_aov", {
    formula: {
      ...commonNode,
      node_id: "formula.buyer_frequency_aov",
      node_type: "FORMULA",
      name: "buyer frequency AOV identity",
      formula_type: "compound",
      return_type: "numeric",
      language: "semantic-ast",
      language_version: "semantic-formula-ast@1",
      expression: formulaExpression("buyer_frequency_aov"),
    },
  });
  await add("FORMULA", "formula.cohort_month_index", {
    formula: {
      ...commonNode,
      node_id: "formula.cohort_month_index",
      node_type: "FORMULA",
      name: "cohort month index",
      formula_type: "other",
      return_type: "integer",
      language: "semantic-ast",
      language_version: "semantic-formula-ast@1",
      expression: formulaExpression("cohort_month_index"),
    },
  });

  for (const [relationshipId, spec] of Object.entries(relationshipSpecs)) {
    const [leftTable, leftColumn, rightTable, rightColumn, cardinality] = spec;
    await add(
      "RELATIONSHIP",
      `relationship.${relationshipId}`,
      {
        relationship: {
          relationship_id: `relationship.${relationshipId}`,
          name: relationshipId,
          kind: "physical",
          left_table_id: leftTable,
          left_column_ids: [`${leftTable}.${leftColumn}`],
          right_table_id: rightTable,
          right_column_ids: [`${rightTable}.${rightColumn}`],
          cardinality,
          left_row_preservation: "required",
          right_row_preservation: "optional",
          proof_kind: "SNAPSHOT_CERTIFIED",
          proof_detail: "Falcon24 fixed-snapshot join audit.",
          tags: ["falcon24"],
          analysis: {
            join_allowed: true,
            fanout_closed: true,
            ontology_path: [`entity.${leftTable}`, `entity.${rightTable}`].sort(),
          },
        },
      },
      "SCHEMA_FACT",
    );
  }

  await add("TIME_SEMANTICS", "time.complete_month_frontier", {
    time_domain: {
      time_domain_id: "time.complete_month_frontier",
      calendar: "gregorian",
      timezone: "Asia/Shanghai",
      min_time: "2023-05-01",
      max_time: "2024-10-31",
      description: "Last complete month is 2024-10; all windows are half-open.",
    },
  });
  for (const [constraintId, [expression, severity]] of Object.entries(qualityConstraints)) {
    await add(
      "QUALITY_CONSTRAINT",
      constraintId,
      { constraint_id: constraintId, expression, severity, sensitivity: "INTERNAL" },
      "SCHEMA_FACT",
    );
  }

  const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
  const byKey = new Map(assertions.map((assertion) => [assertion.canonical_key, assertion]));
  const competencyCases = suite.cases.map((testCase) => ({
    schema_version: "semantic-competency-case@1.0.0" as const,
    case_id: testCase.case_id,
    question: testCase.question,
    required_assertion_keys: [...testCase.required_semantic_keys],
    required_target_kinds: [...new Set(testCase.required_semantic_keys.map(targetKindFor))],
    required_relationship_paths: testCase.required_semantic_keys
      .filter((key) => key.startsWith("relationship."))
      .map((key) => [key]),
    expected_analysis_capabilities: ["open-python-analysis@1"],
  }));
  for (const testCase of competencyCases) {
    if (testCase.required_assertion_keys.some((key) => !byKey.has(key))) {
      throw new TypeError(`FALCON24_SEMANTIC_COMPETENCY_ASSET_MISSING:${testCase.case_id}`);
    }
  }
  const compiled = await compileSemanticChangeSet({
    change_set_id: stableUuid("falcon24:semantic-change-set"),
    scope: input.scope,
    base_release: input.base_release,
    revision: input.revision ?? 1,
    assertions,
    competency_cases: competencyCases,
  });
  const changeSet = await freezeSemanticChangeSetForReview(compiled);
  return Object.freeze({
    blueprint_hash: blueprintHash,
    datasource_id: datasourceId,
    assertion_count: assertions.length,
    competency_case_count: competencyCases.length,
    change_set: changeSet,
  });
}
