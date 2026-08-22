import {
  type AnalysisContext,
  type AnalysisPlanPayload,
  type AnalysisReasonCode,
  type ArtifactReference,
  analysisPlanPayloadSchema,
  artifactReferenceIdentity,
  canonicalizeJson,
  type ResearchBriefV3Payload,
  verifyAnalysisContext,
} from "@data-agent/contracts";
import { evaluateAnalysisApplicability } from "@data-agent/semantic";
import { computeAnalysisPlanHash } from "./default-plan.js";
import {
  type AnalysisSkillCatalog,
  type AnalysisSkillDescriptor,
  DEFAULT_ANALYSIS_SKILL_CATALOG,
} from "./skill-catalog.js";

export type AnalysisPlanGateFailure =
  | "ANALYSIS_PLAN_SCHEMA_INVALID"
  | "ANALYSIS_PLAN_HASH_MISMATCH"
  | "ANALYSIS_PLAN_SCOPE_MISMATCH"
  | "ANALYSIS_CONTEXT_HASH_MISMATCH"
  | "ANALYSIS_PLAN_BUDGET_EXCEEDED"
  | "ANALYSIS_PLAN_SKILL_NOT_ALLOWED"
  | "ANALYSIS_PLAN_PARAMETER_INVALID"
  | "ANALYSIS_PLAN_METRIC_NOT_PRIMARY"
  | "ANALYSIS_PLAN_DIMENSION_NOT_APPROVED"
  | "ANALYSIS_PLAN_TIME_WINDOW_NOT_APPROVED"
  | "ANALYSIS_PLAN_EXECUTION_MODE_INVALID"
  | "ANALYSIS_PLAN_OUTPUT_CONTRACT_INVALID"
  | "ANALYSIS_PLAN_SKILL_NOT_APPLICABLE";

export type AnalysisPlanGateVerdict =
  | { readonly ok: true; readonly plan: AnalysisPlanPayload }
  | {
      readonly ok: false;
      readonly failure: AnalysisPlanGateFailure;
      readonly reason_codes: readonly AnalysisReasonCode[];
    };

function reject(
  failure: AnalysisPlanGateFailure,
  reasonCodes: readonly AnalysisReasonCode[] = [],
): AnalysisPlanGateVerdict {
  return { ok: false, failure, reason_codes: Object.freeze([...new Set(reasonCodes)].sort()) };
}

function sameWindow(
  left: AnalysisPlanPayload["nodes"][number]["time_window"],
  right: NonNullable<ResearchBriefV3Payload["requested_time_window"]>,
): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function approvedComparisonWindow(
  comparison: NonNullable<AnalysisPlanPayload["nodes"][number]["comparison_window"]>,
  requested: NonNullable<ResearchBriefV3Payload["requested_time_window"]>,
): boolean {
  const requestedDuration = Date.parse(requested.end) - Date.parse(requested.start);
  const comparisonDuration = Date.parse(comparison.end) - Date.parse(comparison.start);
  return (
    comparison.timezone === requested.timezone &&
    comparison.semantics === "HALF_OPEN" &&
    comparisonDuration === requestedDuration &&
    Date.parse(comparison.end) <= Date.parse(requested.start)
  );
}

export async function gateAnalysisPlan(input: {
  readonly plan: unknown;
  readonly plan_ref?: ArtifactReference;
  readonly brief: ResearchBriefV3Payload;
  readonly brief_ref: ArtifactReference;
  readonly context: AnalysisContext;
  readonly catalog?: AnalysisSkillCatalog;
}): Promise<AnalysisPlanGateVerdict> {
  const parsed = analysisPlanPayloadSchema.safeParse(input.plan);
  if (!parsed.success) return reject("ANALYSIS_PLAN_SCHEMA_INVALID", ["ANALYSIS_PLAN_CYCLE"]);
  const plan = parsed.data;
  const catalog = input.catalog ?? DEFAULT_ANALYSIS_SKILL_CATALOG;
  let context: AnalysisContext;
  try {
    context = await verifyAnalysisContext(input.context);
  } catch {
    return reject("ANALYSIS_CONTEXT_HASH_MISMATCH", ["SEMANTIC_FRONTIER_STALE"]);
  }
  const { plan_hash: observedHash, ...material } = plan;
  if ((await computeAnalysisPlanHash(material)) !== observedHash) {
    return reject("ANALYSIS_PLAN_HASH_MISMATCH");
  }
  if (
    artifactReferenceIdentity(plan.brief_ref) !== artifactReferenceIdentity(input.brief_ref) ||
    plan.brief_ref.run_id !== input.brief.question_frame_ref.run_id ||
    (input.plan_ref?.run_id !== undefined && input.plan_ref.run_id !== input.brief_ref.run_id)
  ) {
    return reject("ANALYSIS_PLAN_SCOPE_MISMATCH");
  }
  if (plan.analysis_context_hash !== context.context_hash) {
    return reject("ANALYSIS_CONTEXT_HASH_MISMATCH", ["SEMANTIC_FRONTIER_STALE"]);
  }
  if (
    plan.nodes.length > input.brief.budget.max_steps ||
    plan.budget.max_steps > input.brief.budget.max_steps ||
    plan.budget.max_sql_executions > input.brief.budget.max_sql_executions ||
    plan.budget.max_sandbox_executions > input.brief.budget.max_sandbox_executions ||
    plan.budget.max_elapsed_ms > input.brief.budget.max_elapsed_ms ||
    plan.nodes.length > plan.budget.max_steps
  ) {
    return reject("ANALYSIS_PLAN_BUDGET_EXCEEDED", ["ANALYSIS_BUDGET_EXCEEDED"]);
  }

  const primaryMetricIdentities = new Set(
    input.brief.primary_metric_refs.map(
      ({ container_ref: containerRef, node_id: nodeId }) =>
        `${artifactReferenceIdentity(containerRef)}\0${nodeId}`,
    ),
  );
  const approvedDimensions = new Set(input.brief.approved_dimension_refs);
  for (const node of plan.nodes) {
    let descriptor: AnalysisSkillDescriptor;
    try {
      descriptor = catalog.resolve(node.skill_id);
    } catch {
      return reject("ANALYSIS_PLAN_SKILL_NOT_ALLOWED", ["ANALYSIS_CAPABILITY_NOT_PUBLISHED"]);
    }
    try {
      catalog.parseParameters(node.skill_id, node.parameters);
    } catch {
      return reject("ANALYSIS_PLAN_PARAMETER_INVALID", ["PROGRAM_POLICY_REJECTED"]);
    }
    if (
      node.metric_refs.length > descriptor.hard_limits.max_metrics ||
      node.dimension_refs.length > descriptor.hard_limits.max_dimensions ||
      descriptor.hard_limits.max_sql_executions > plan.budget.max_sql_executions ||
      descriptor.hard_limits.max_sandbox_executions > plan.budget.max_sandbox_executions
    ) {
      return reject("ANALYSIS_PLAN_BUDGET_EXCEEDED", ["ANALYSIS_BUDGET_EXCEEDED"]);
    }
    if (
      node.metric_refs.some(
        ({ container_ref: containerRef, node_id: nodeId }) =>
          !primaryMetricIdentities.has(`${artifactReferenceIdentity(containerRef)}\0${nodeId}`),
      )
    ) {
      return reject("ANALYSIS_PLAN_METRIC_NOT_PRIMARY", ["UNPUBLISHED_SEMANTIC_INPUT"]);
    }
    if (node.dimension_refs.some((dimensionId) => !approvedDimensions.has(dimensionId))) {
      return reject("ANALYSIS_PLAN_DIMENSION_NOT_APPROVED", ["DIMENSION_NOT_ALLOWED"]);
    }
    if (
      input.brief.requested_time_window &&
      (!sameWindow(node.time_window, input.brief.requested_time_window) ||
        (node.comparison_window !== null &&
          !approvedComparisonWindow(node.comparison_window, input.brief.requested_time_window)))
    ) {
      return reject("ANALYSIS_PLAN_TIME_WINDOW_NOT_APPROVED", ["TIMEZONE_MISMATCH"]);
    }
    if (
      (descriptor.program_mode === "FROZEN_TEMPLATE" &&
        node.execution_mode !== "FROZEN_TEMPLATE") ||
      (descriptor.program_mode === "MODEL_GENERATED" && node.execution_mode !== "MODEL_GENERATED")
    ) {
      return reject("ANALYSIS_PLAN_EXECUTION_MODE_INVALID", ["PROGRAM_POLICY_REJECTED"]);
    }
    if (
      node.output_contract === null ||
      canonicalizeJson(node.output_contract) !== canonicalizeJson(descriptor.output_contract)
    ) {
      return reject("ANALYSIS_PLAN_OUTPUT_CONTRACT_INVALID", ["PROGRAM_OUTPUT_CONTRACT_FAILED"]);
    }
    const applicability = await evaluateAnalysisApplicability(context, {
      skill_id: node.skill_id,
      metric_ids: node.metric_refs.map(({ node_id: nodeId }) => nodeId),
      dimension_ids: node.dimension_refs,
      ...(node.skill_id === "root-cause-investigation@1"
        ? {
            requested_level:
              typeof node.parameters === "object" &&
              node.parameters !== null &&
              "level" in node.parameters &&
              node.parameters.level === "L5_CAUSAL"
                ? ("L5_CAUSAL" as const)
                : ("L4_DISCOVERY" as const),
          }
        : {}),
    });
    if (applicability.verdict !== "APPLICABLE") {
      return reject("ANALYSIS_PLAN_SKILL_NOT_APPLICABLE", applicability.reason_codes);
    }
  }
  return { ok: true, plan };
}
