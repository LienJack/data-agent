import {
  type AnalysisProgramPayload,
  type AnalysisReasonCode,
  type ArtifactReference,
  analysisProgramPayloadSchema,
  artifactReferenceIdentity,
  type ResearchBriefV3Payload,
  verifyAnalysisResultContract,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import { evaluateAnalysisApplicability } from "@data-agent/semantic/runtime-context";
import { computeAnalysisProgramHash } from "./analysis-program-hash.js";
import {
  type AnalysisSkillCatalog,
  type AnalysisSkillDescriptor,
  DEFAULT_ANALYSIS_SKILL_CATALOG,
} from "./skill-catalog.js";

export type AnalysisProgramGateFailure =
  | "ANALYSIS_PROGRAM_SCHEMA_INVALID"
  | "ANALYSIS_PROGRAM_HASH_MISMATCH"
  | "ANALYSIS_PROGRAM_SCOPE_MISMATCH"
  | "ANALYSIS_CONTEXT_HASH_MISMATCH"
  | "ANALYSIS_PROGRAM_BUDGET_EXCEEDED"
  | "ANALYSIS_PROGRAM_SKILL_NOT_ALLOWED"
  | "ANALYSIS_PROGRAM_PARAMETER_INVALID"
  | "ANALYSIS_PROGRAM_METRIC_NOT_PRIMARY"
  | "ANALYSIS_PROGRAM_DIMENSION_NOT_APPROVED"
  | "ANALYSIS_PROGRAM_TIME_WINDOW_NOT_APPROVED"
  | "ANALYSIS_PROGRAM_EXECUTION_MODE_INVALID"
  | "ANALYSIS_PROGRAM_RESULT_CONTRACT_INVALID"
  | "ANALYSIS_PROGRAM_SKILL_NOT_APPLICABLE";

export type AnalysisProgramGateVerdict =
  | { readonly ok: true; readonly program: AnalysisProgramPayload }
  | {
      readonly ok: false;
      readonly failure: AnalysisProgramGateFailure;
      readonly reason_codes: readonly AnalysisReasonCode[];
    };

function reject(
  failure: AnalysisProgramGateFailure,
  reasonCodes: readonly AnalysisReasonCode[] = [],
): AnalysisProgramGateVerdict {
  return { ok: false, failure, reason_codes: Object.freeze([...new Set(reasonCodes)].sort()) };
}

function sameWindow(
  left: AnalysisProgramPayload["nodes"][number]["time_window"],
  right: NonNullable<ResearchBriefV3Payload["requested_time_window"]>,
): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function approvedComparisonWindow(
  comparison: NonNullable<AnalysisProgramPayload["nodes"][number]["comparison_window"]>,
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

export async function gateAnalysisProgram(input: {
  readonly program: unknown;
  readonly program_ref?: ArtifactReference;
  readonly brief: ResearchBriefV3Payload;
  readonly brief_ref: ArtifactReference;
  readonly context: AnalysisContext;
  readonly catalog?: AnalysisSkillCatalog;
}): Promise<AnalysisProgramGateVerdict> {
  const parsed = analysisProgramPayloadSchema.safeParse(input.program);
  if (!parsed.success) return reject("ANALYSIS_PROGRAM_SCHEMA_INVALID", ["ANALYSIS_PROGRAM_CYCLE"]);
  const program = parsed.data;
  const catalog = input.catalog ?? DEFAULT_ANALYSIS_SKILL_CATALOG;
  let context: AnalysisContext;
  try {
    context = await verifyAnalysisContext(input.context);
  } catch {
    return reject("ANALYSIS_CONTEXT_HASH_MISMATCH", ["SEMANTIC_FRONTIER_STALE"]);
  }
  const { program_hash: observedHash, ...material } = program;
  if ((await computeAnalysisProgramHash(material)) !== observedHash) {
    return reject("ANALYSIS_PROGRAM_HASH_MISMATCH");
  }
  if (
    artifactReferenceIdentity(program.brief_ref) !== artifactReferenceIdentity(input.brief_ref) ||
    program.brief_ref.run_id !== input.brief.question_frame_ref.run_id ||
    (input.program_ref?.run_id !== undefined && input.program_ref.run_id !== input.brief_ref.run_id)
  ) {
    return reject("ANALYSIS_PROGRAM_SCOPE_MISMATCH");
  }
  if (
    program.analysis_context_hash !== context.context_hash ||
    program.semantic_context_package_hash !== context.semantic_context_binding.package_hash
  ) {
    return reject("ANALYSIS_CONTEXT_HASH_MISMATCH", ["SEMANTIC_FRONTIER_STALE"]);
  }
  if (
    program.nodes.length > input.brief.budget.max_steps ||
    program.budget.max_steps > input.brief.budget.max_steps ||
    program.budget.max_sql_executions > input.brief.budget.max_sql_executions ||
    program.budget.max_sandbox_executions > input.brief.budget.max_sandbox_executions ||
    program.budget.max_elapsed_ms > input.brief.budget.max_elapsed_ms ||
    program.nodes.length > program.budget.max_steps
  ) {
    return reject("ANALYSIS_PROGRAM_BUDGET_EXCEEDED", ["ANALYSIS_BUDGET_EXCEEDED"]);
  }

  const primaryMetricIdentities = new Set(
    input.brief.primary_metric_refs.map(
      ({ container_ref: containerRef, node_id: nodeId }) =>
        `${artifactReferenceIdentity(containerRef)}\0${nodeId}`,
    ),
  );
  const approvedDimensions = new Set(input.brief.approved_dimension_refs);
  for (const node of program.nodes) {
    let descriptor: AnalysisSkillDescriptor;
    try {
      descriptor = catalog.resolve(node.skill_id);
    } catch {
      return reject("ANALYSIS_PROGRAM_SKILL_NOT_ALLOWED", ["ANALYSIS_CAPABILITY_NOT_PUBLISHED"]);
    }
    try {
      catalog.parseParameters(node.skill_id, node.parameters);
    } catch {
      return reject("ANALYSIS_PROGRAM_PARAMETER_INVALID", ["PROGRAM_POLICY_REJECTED"]);
    }
    if (
      node.metric_refs.length > descriptor.hard_limits.max_metrics ||
      node.dimension_refs.length > descriptor.hard_limits.max_dimensions ||
      descriptor.hard_limits.max_sql_executions > program.budget.max_sql_executions ||
      descriptor.hard_limits.max_sandbox_executions > program.budget.max_sandbox_executions
    ) {
      return reject("ANALYSIS_PROGRAM_BUDGET_EXCEEDED", ["ANALYSIS_BUDGET_EXCEEDED"]);
    }
    if (
      node.metric_refs.some(
        ({ container_ref: containerRef, node_id: nodeId }) =>
          !primaryMetricIdentities.has(`${artifactReferenceIdentity(containerRef)}\0${nodeId}`),
      )
    ) {
      return reject("ANALYSIS_PROGRAM_METRIC_NOT_PRIMARY", ["UNPUBLISHED_SEMANTIC_INPUT"]);
    }
    if (node.dimension_refs.some((dimensionId) => !approvedDimensions.has(dimensionId))) {
      return reject("ANALYSIS_PROGRAM_DIMENSION_NOT_APPROVED", ["DIMENSION_NOT_ALLOWED"]);
    }
    if (
      input.brief.requested_time_window &&
      (!sameWindow(node.time_window, input.brief.requested_time_window) ||
        (node.comparison_window !== null &&
          !approvedComparisonWindow(node.comparison_window, input.brief.requested_time_window)))
    ) {
      return reject("ANALYSIS_PROGRAM_TIME_WINDOW_NOT_APPROVED", ["TIMEZONE_MISMATCH"]);
    }
    if (node.execution_mode !== "MODEL_GENERATED") {
      return reject("ANALYSIS_PROGRAM_EXECUTION_MODE_INVALID", ["PROGRAM_POLICY_REJECTED"]);
    }
    try {
      await verifyAnalysisResultContract(node.result_contract);
    } catch {
      return reject("ANALYSIS_PROGRAM_RESULT_CONTRACT_INVALID", [
        "PROGRAM_OUTPUT_CONTRACT_FAILED",
      ]);
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
      return reject("ANALYSIS_PROGRAM_SKILL_NOT_APPLICABLE", applicability.reason_codes);
    }
  }
  return { ok: true, program };
}
