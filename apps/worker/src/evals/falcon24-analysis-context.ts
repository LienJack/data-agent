import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import {
  buildAnalysisContext,
  type SemanticContextCommitResult,
  verifySemanticContextCommitResult,
} from "@data-agent/contracts/context";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import type { RunWorkLease } from "@data-agent/contracts/runs";

const PRIMARY_METRIC_BY_CASE = Object.freeze({
  "falcon24-business-review-18m": "metric.order_revenue",
  "falcon24-delivery-experience-12m": "metric.delivery_minutes",
  "falcon24-inventory-damage-12m": "metric.damaged_stock",
  "falcon24-marketing-lag-effect": "metric.marketing_spend",
  "falcon24-cohort-retention-m0-m6": "metric.cohort_retention",
} as const);

const RELATIONSHIPS = Object.freeze({
  delivery_order: ["blinkit_delivery_performance", "blinkit_orders", "one-to-one"],
  feedback_customer: ["blinkit_customer_feedback", "blinkit_customers", "many-to-one"],
  feedback_order: ["blinkit_customer_feedback", "blinkit_orders", "one-to-one"],
  inventory_product: ["blinkit_inventory", "blinkit_products", "many-to-one"],
  order_customer: ["blinkit_orders", "blinkit_customers", "many-to-one"],
  order_item_product: ["blinkit_order_items", "blinkit_products", "many-to-one"],
} as const);

function resourceReference(
  artifactType: "SemanticRelease" | "SchemaSnapshot" | "PolicyReceipt",
  resource: {
    readonly resource_id: string;
    readonly resource_revision: number;
    readonly resource_hash: string;
  },
  lease: RunWorkLease,
): ArtifactReference {
  return {
    artifact_id: resource.resource_id,
    artifact_type: artifactType,
    ...lease.scope,
    run_id: lease.run_id,
    revision: resource.resource_revision,
    content_hash: resource.resource_hash as `sha256:${string}`,
  };
}

function requiredClosure(testCase: Falcon24AgentAnalysisCase): string[] {
  return [...testCase.required_semantic_keys].sort();
}

export async function compileFalcon24AnalysisContext(input: {
  readonly lease: RunWorkLease;
  readonly semantic_context: SemanticContextCommitResult;
  readonly test_case: Falcon24AgentAnalysisCase;
}) {
  const committed = await verifySemanticContextCommitResult(input.semantic_context);
  const packageDocument = committed.package;
  if (
    committed.receipt.consumer !== "RUN" ||
    committed.receipt.run_id !== input.lease.run_id ||
    packageDocument.semantic_domain !== "falcon24" ||
    packageDocument.route_decision.state !== "READY" ||
    packageDocument.provider !== "deepseek"
  ) {
    throw new TypeError("FALCON24_ANALYSIS_CONTEXT_AUTHORITY_INVALID");
  }
  const available = new Set([
    ...packageDocument.mandatory_closure.object_ids,
    ...packageDocument.mandatory_closure.relationship_ids,
    ...packageDocument.evidence.map(({ evidence_id: evidenceId }) => evidenceId),
  ]);
  const missing = requiredClosure(input.test_case).filter((key) => !available.has(key));
  if (missing.length > 0) {
    throw new TypeError(`FALCON24_ANALYSIS_CONTEXT_CLOSURE_MISSING:${missing.join(",")}`);
  }
  const semanticReleaseRef = resourceReference(
    "SemanticRelease",
    packageDocument.semantic_release,
    input.lease,
  );
  const dimensionIds = input.test_case.required_semantic_keys
    .filter((key) => key.startsWith("dimension."))
    .map((key) => key.slice("dimension.".length));
  const primaryMetricId = PRIMARY_METRIC_BY_CASE[input.test_case.case_id];
  const grain = { grain_id: "falcon24-analysis", granularity: "atomic" } as const;
  const metricRef = { container_ref: semanticReleaseRef, node_id: primaryMetricId } as const;
  return {
    context: await buildAnalysisContext({
      schema_version: "analysis-context@2.0.0",
      scope: input.lease.scope,
      semantic_context_binding: {
        package_id: packageDocument.package_id,
        package_hash: packageDocument.package_hash,
        receipt_id: committed.receipt.receipt_id,
        receipt_hash: committed.receipt.receipt_hash,
      },
      semantic_release_ref: semanticReleaseRef,
      schema_snapshot_ref: resourceReference(
        "SchemaSnapshot",
        packageDocument.schema_snapshot,
        input.lease,
      ),
      policy_receipt_ref: resourceReference(
        "PolicyReceipt",
        packageDocument.context_policy,
        input.lease,
      ),
      semantic_retrieval_receipt_hash: packageDocument.retrieval_receipt.receipt_hash,
      semantic_inference_receipt_hash: packageDocument.inference_receipt.receipt_hash,
      metrics: [
        {
          metric_ref: metricRef,
          formula_hash:
            packageDocument.evidence.find(
              ({ evidence_id: evidenceId }) => evidenceId === primaryMetricId,
            )?.evidence_hash ?? packageDocument.mandatory_closure.closure_hash,
          unit: null,
          grain,
          time_domain: {
            time_domain_id: "falcon24-complete-month-frontier",
            calendar: "gregorian",
            timezone: "Asia/Shanghai",
            min_time: "2023-05-01T00:00:00.000Z",
            max_time: "2024-11-01T00:00:00.000Z",
          },
          time_dimension_ref: "order_date",
          additivity: primaryMetricId === "metric.order_revenue" ? "additive" : "non-additive",
          null_policy: "exclude",
          missing_period_policy: "REJECT_GAP",
          seasonality: null,
          priority: 10_000,
          causal_role: "OUTCOME",
          allowed_dimensions: dimensionIds.map((dimensionId) => ({
            dimension_id: dimensionId,
            grain,
            data_type:
              dimensionId.includes("month") || dimensionId.includes("cohort") ? "date" : "text",
            sensitivity: "INTERNAL",
            groupable: true,
            pivotable: true,
            causal_role: "CANDIDATE_CONFOUNDER",
          })),
          analysis_capabilities: ["ASSOCIATION", "CHART_DATASET", "CONTRIBUTION", "TREND_CHANGE"],
        },
      ],
      relationships: input.test_case.required_semantic_keys
        .filter((key) => key.startsWith("relationship."))
        .map((key) => key.slice("relationship.".length))
        .map((relationshipId) => {
          const relationship = RELATIONSHIPS[relationshipId as keyof typeof RELATIONSHIPS];
          if (!relationship) throw new TypeError(`FALCON24_RELATIONSHIP_UNKNOWN:${relationshipId}`);
          return {
            relationship_id: relationshipId,
            left_table_id: relationship[0],
            right_table_id: relationship[1],
            cardinality: relationship[2],
            fanout_closed: true,
            ontology_path: [`entity.${relationship[0]}`, `entity.${relationship[1]}`].sort(),
          };
        }),
      causal_policy: null,
    }),
    metric_ids: [metricRef.node_id] as const,
  };
}

export const falcon24AnalysisContextInternals = Object.freeze({
  primary_metric_by_case: PRIMARY_METRIC_BY_CASE,
  relationships: RELATIONSHIPS,
});
