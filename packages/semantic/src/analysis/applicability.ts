import {
  type AnalysisContext,
  type AnalysisReasonCode,
  type AnalysisSkillId,
  verifyAnalysisContext,
} from "@data-agent/contracts";

export type AnalysisApplicabilityVerdict =
  | "APPLICABLE"
  | "NOT_APPLICABLE"
  | "REQUIRES_CLARIFICATION";

export interface AnalysisApplicabilityRequest {
  readonly skill_id: AnalysisSkillId;
  readonly metric_ids: readonly string[];
  readonly dimension_ids: readonly string[];
  readonly requested_level?: "STANDARD" | "L4_DISCOVERY" | "L5_CAUSAL";
}

export interface AnalysisApplicabilityResult {
  readonly verdict: AnalysisApplicabilityVerdict;
  readonly reason_codes: readonly AnalysisReasonCode[];
}

const requiredCapabilityBySkill = {
  "data-profile@1": "DATA_PROFILE",
  "semantic-transform@1": "CHART_DATASET",
  "trend-change@1": "TREND_CHANGE",
  "contribution-concentration@1": "CONTRIBUTION",
  "robust-anomaly@1": "ROBUST_ANOMALY",
  "association-outlier-completeness@1": "ASSOCIATION",
  "baseline-forecast-backtest@1": "FORECAST",
  "open-python-analysis@1": "CHART_DATASET",
  "root-cause-investigation@1": "ROOT_CAUSE_DISCOVERY",
  "visual-insight-story@1": "CHART_DATASET",
} as const;

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

export async function evaluateAnalysisApplicability(
  unverifiedContext: AnalysisContext,
  request: AnalysisApplicabilityRequest,
): Promise<AnalysisApplicabilityResult> {
  const context = await verifyAnalysisContext(unverifiedContext);
  const metricById = new Map(
    context.metrics.map((metric) => [metric.metric_ref.node_id, metric] as const),
  );
  const metrics = uniqueSorted(request.metric_ids)
    .map((metricId) => metricById.get(metricId))
    .filter((metric) => metric !== undefined);
  if (metrics.length !== new Set(request.metric_ids).size || metrics.length === 0) {
    return { verdict: "REQUIRES_CLARIFICATION", reason_codes: ["UNRESOLVED_SEMANTICS"] };
  }

  const reasons: AnalysisReasonCode[] = [];
  const requiredCapability = requiredCapabilityBySkill[request.skill_id];
  if (metrics.some((metric) => !metric.analysis_capabilities.includes(requiredCapability))) {
    reasons.push("ANALYSIS_CAPABILITY_NOT_PUBLISHED");
  }
  const timeRequired = [
    "trend-change@1",
    "robust-anomaly@1",
    "baseline-forecast-backtest@1",
  ].includes(request.skill_id);
  if (
    timeRequired &&
    metrics.some((metric) => metric.time_domain === null || metric.time_dimension_ref === null)
  ) {
    reasons.push("TIME_DOMAIN_NOT_PUBLISHED");
  }
  if (
    request.skill_id === "baseline-forecast-backtest@1" &&
    metrics.some((metric) => metric.seasonality === null)
  ) {
    reasons.push("SEASONALITY_NOT_PUBLISHED");
  }
  if (
    request.skill_id === "contribution-concentration@1" &&
    metrics.some((metric) => metric.additivity !== "additive")
  ) {
    reasons.push("NON_ADDITIVE_CONTRIBUTION_NOT_LOWERABLE");
  }

  const grains = new Set(metrics.map((metric) => JSON.stringify(metric.grain)));
  if (grains.size > 1) reasons.push("GRAIN_MISMATCH");
  const units = new Set(metrics.map((metric) => JSON.stringify(metric.unit)));
  if (units.size > 1) reasons.push("UNIT_MISMATCH");
  const nullPolicies = new Set(metrics.map(({ null_policy }) => null_policy));
  if (nullPolicies.size > 1) reasons.push("NULL_POLICY_CONFLICT");
  const timezones = new Set(metrics.map((metric) => metric.time_domain?.timezone ?? null));
  if (timezones.size > 1) reasons.push("TIMEZONE_MISMATCH");

  for (const dimensionId of uniqueSorted(request.dimension_ids)) {
    const dimensions = metrics.map((metric) =>
      metric.allowed_dimensions.find((dimension) => dimension.dimension_id === dimensionId),
    );
    if (dimensions.some((dimension) => dimension === undefined)) {
      reasons.push("DIMENSION_NOT_ALLOWED");
      continue;
    }
    if (
      dimensions.some(
        (dimension) =>
          dimension?.sensitivity === "RESTRICTED" || dimension?.sensitivity === "SECRET",
      )
    ) {
      reasons.push("SENSITIVE_DIMENSION_BLOCKED");
    }
  }

  if (request.skill_id === "root-cause-investigation@1") {
    const causalRequested = request.requested_level === "L5_CAUSAL";
    if (
      causalRequested &&
      (context.causal_policy === null ||
        metrics.some((metric) => !metric.analysis_capabilities.includes("CAUSAL_IDENTIFICATION")))
    ) {
      reasons.push("CAUSAL_POLICY_NOT_PUBLISHED");
    }
    if (
      causalRequested &&
      (!context.metrics.some(({ causal_role }) => causal_role === "OUTCOME") ||
        !context.metrics.some(({ causal_role }) => causal_role === "TREATMENT") ||
        !context.causal_policy?.directed_edges.length)
    ) {
      reasons.push("CAUSAL_ROLE_INCOMPLETE");
    }
  }

  const reasonCodes = uniqueSorted(reasons);
  if (reasonCodes.length === 0) return { verdict: "APPLICABLE", reason_codes: [] };
  if (
    reasonCodes.every((reason) =>
      ["UNRESOLVED_SEMANTICS", "MISSING_PERIOD_POLICY_UNRESOLVED"].includes(reason),
    )
  ) {
    return { verdict: "REQUIRES_CLARIFICATION", reason_codes: reasonCodes };
  }
  return { verdict: "NOT_APPLICABLE", reason_codes: reasonCodes };
}
