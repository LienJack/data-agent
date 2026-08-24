import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildAnalysisContext,
  type SemanticContextCommitResult,
  verifySemanticContextCommitResult,
} from "@data-agent/contracts/context";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import {
  FALCON24_DIMENSIONS,
  FALCON24_METRICS,
  FALCON24_RELATIONSHIPS,
  falcon24FormulaExpression,
  falcon24RequiredMetricIds,
} from "./falcon24-semantic-catalog.js";

const PRIMARY_METRIC_BY_CASE = Object.freeze({
  "falcon24-business-review-18m": "metric.order_revenue",
  "falcon24-delivery-experience-12m": "metric.delivery_minutes",
  "falcon24-inventory-damage-12m": "metric.damaged_stock",
  "falcon24-marketing-lag-effect": "metric.marketing_spend",
  "falcon24-cohort-retention-m0-m6": "metric.cohort_retention",
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
  const requiredDimensionIds = new Set(
    input.test_case.required_semantic_keys.filter((key) => key.startsWith("dimension.")),
  );
  const primaryMetricId = PRIMARY_METRIC_BY_CASE[input.test_case.case_id];
  const requiredMetricIds = falcon24RequiredMetricIds(input.test_case);
  if (!requiredMetricIds.some((metricId) => `metric.${metricId}` === primaryMetricId)) {
    throw new TypeError(`FALCON24_ANALYSIS_PRIMARY_METRIC_NOT_REQUIRED:${primaryMetricId}`);
  }
  const metrics = await Promise.all(
    requiredMetricIds.map(async (metricId) => {
      const spec = FALCON24_METRICS[metricId];
      const metricRef = {
        container_ref: semanticReleaseRef,
        node_id: `metric.${metricId}`,
      } as const;
      return {
        metric_ref: metricRef,
        formula_hash: await sha256ContentHash({
          semantic_release_hash: packageDocument.semantic_release.resource_hash,
          metric_id: metricRef.node_id,
          formula_id: `formula.${spec.formula_id}`,
          formula_expression: falcon24FormulaExpression(spec.formula_id),
          grain: spec.grain,
          unit: spec.unit,
          allowed_dimension_ids: spec.analysis.allowed_dimension_ids,
        }),
        unit: spec.unit,
        grain: spec.grain,
        time_domain: spec.time_domain,
        time_dimension_ref: spec.time_column_id,
        additivity: spec.additivity,
        null_policy: spec.null_policy,
        missing_period_policy: spec.analysis.missing_period_policy,
        seasonality: spec.analysis.seasonality,
        priority: spec.analysis.priority,
        causal_role: spec.analysis.causal_role,
        allowed_dimensions: spec.analysis.allowed_dimension_ids
          .filter((dimensionId) => requiredDimensionIds.has(dimensionId))
          .map((dimensionId) => {
            const catalogId = dimensionId.slice(
              "dimension.".length,
            ) as keyof typeof FALCON24_DIMENSIONS;
            const dimension = FALCON24_DIMENSIONS[catalogId];
            if (!dimension) throw new TypeError(`FALCON24_DIMENSION_UNKNOWN:${dimensionId}`);
            return {
              dimension_id: dimensionId,
              grain: dimension.grain,
              data_type: dimension.data_type,
              sensitivity: "INTERNAL" as const,
              groupable: true,
              pivotable: true,
              causal_role: "CANDIDATE_CONFOUNDER" as const,
            };
          }),
        analysis_capabilities: spec.analysis.capabilities,
      };
    }),
  );
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
      metrics,
      relationships: input.test_case.required_semantic_keys
        .filter((key) => key.startsWith("relationship."))
        .map((key) => key.slice("relationship.".length))
        .map((relationshipId) => {
          const relationship =
            FALCON24_RELATIONSHIPS[relationshipId as keyof typeof FALCON24_RELATIONSHIPS];
          if (!relationship) throw new TypeError(`FALCON24_RELATIONSHIP_UNKNOWN:${relationshipId}`);
          return {
            relationship_id: `relationship.${relationshipId}`,
            left_table_id: relationship[0],
            right_table_id: relationship[2],
            cardinality: relationship[4],
            fanout_closed: true,
            ontology_path: [`entity.${relationship[0]}`, `entity.${relationship[2]}`].sort(),
          };
        }),
      causal_policy: null,
    }),
    metric_ids: [primaryMetricId] as const,
  };
}

export const falcon24AnalysisContextInternals = Object.freeze({
  primary_metric_by_case: PRIMARY_METRIC_BY_CASE,
  relationships: FALCON24_RELATIONSHIPS,
});
