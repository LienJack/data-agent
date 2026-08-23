import {
  type AnalysisProgramPayload,
  type AnalysisSkillId,
  type ArtifactReference,
  analysisProgramPayloadSchema,
  artifactReferenceIdentity,
  type ResearchBriefV3Payload,
  researchBriefRefSchema,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type AnalysisContext,
  verifyAnalysisContext,
} from "@data-agent/contracts/context";
import { evaluateAnalysisApplicability } from "@data-agent/semantic/runtime-context";
import {
  type AnalysisSkillCatalog,
  type AnalysisSkillDescriptor,
  DEFAULT_ANALYSIS_SKILL_CATALOG,
} from "./skill-catalog.js";

type TimeWindow = AnalysisProgramPayload["nodes"][number]["time_window"];

export interface DefaultAnalysisProgramInput {
  readonly brief: ResearchBriefV3Payload;
  readonly brief_ref: ArtifactReference;
  readonly context: AnalysisContext;
  readonly time_window: TimeWindow;
  readonly comparison_window?: TimeWindow | null;
  readonly catalog?: AnalysisSkillCatalog;
}

const DEFAULT_SKILL_ORDER: readonly AnalysisSkillId[] = Object.freeze([
  "data-profile@1",
  "trend-change@1",
  "contribution-concentration@1",
  "robust-anomaly@1",
  "association-outlier-completeness@1",
  "baseline-forecast-backtest@1",
]);

function nodeParameters(skill: AnalysisSkillId): Record<string, string | number | boolean | null> {
  switch (skill) {
    case "robust-anomaly@1":
      return { minimum_samples: 5, threshold: 3.5 };
    case "baseline-forecast-backtest@1":
      return { horizon: 1, minimum_train: 6 };
    case "contribution-concentration@1":
      return { closure_tolerance: 1e-9 };
    default:
      return {};
  }
}

function boundedBudget(brief: ResearchBriefV3Payload, nodeCount: number) {
  return {
    max_steps: Math.min(brief.budget.max_steps, Math.max(1, nodeCount)),
    max_sql_executions: Math.min(brief.budget.max_sql_executions, 16),
    max_sandbox_executions: Math.min(brief.budget.max_sandbox_executions, 16),
    max_series_rows: 5_000,
    max_group_rows: 5_000,
    max_elapsed_ms: brief.budget.max_elapsed_ms,
  } as const;
}

export async function computeAnalysisProgramHash(
  program: Omit<AnalysisProgramPayload, "program_hash">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({ hash_domain: "analysis-program@1.0.0", value: program });
}

function executionMode(descriptor: AnalysisSkillDescriptor): "FROZEN_TEMPLATE" | "MODEL_GENERATED" {
  return descriptor.program_mode === "MODEL_GENERATED" ? "MODEL_GENERATED" : "FROZEN_TEMPLATE";
}

export async function createDefaultAnalysisProgram(
  input: DefaultAnalysisProgramInput,
): Promise<AnalysisProgramPayload> {
  const context = await verifyAnalysisContext(input.context);
  const catalog = input.catalog ?? DEFAULT_ANALYSIS_SKILL_CATALOG;
  if (
    input.brief.artifact_type !== "ResearchBrief" ||
    input.brief.protocol_version !== "research-brief@3.0.0" ||
    input.brief_ref.artifact_type !== "ResearchBrief" ||
    input.brief_ref.run_id !== input.brief.question_frame_ref.run_id ||
    artifactReferenceIdentity(input.brief.semantic_release_ref) !==
      artifactReferenceIdentity(context.semantic_release_ref)
  ) {
    throw new TypeError("ANALYSIS_DEFAULT_PROGRAM_CONTEXT_MISMATCH");
  }
  const briefRef = researchBriefRefSchema.parse(input.brief_ref);
  const approvedDimensions = new Set(input.brief.approved_dimension_refs);
  const primaryMetrics = input.brief.primary_metric_refs.filter((reference) =>
    context.metrics.some(
      ({ metric_ref: metricRef }) =>
        metricRef.node_id === reference.node_id &&
        artifactReferenceIdentity(metricRef.container_ref) ===
          artifactReferenceIdentity(reference.container_ref),
    ),
  );
  if (primaryMetrics.length !== input.brief.primary_metric_refs.length) {
    throw new TypeError("ANALYSIS_DEFAULT_PROGRAM_PRIMARY_METRIC_INVALID");
  }

  const nodes: AnalysisProgramPayload["nodes"] = [];
  for (const skillId of DEFAULT_SKILL_ORDER) {
    const descriptor = catalog.resolve(skillId);
    if (skillId === "association-outlier-completeness@1" && primaryMetrics.length < 2) continue;
    for (const [metricIndex, metricRef] of primaryMetrics.entries()) {
      if (skillId === "association-outlier-completeness@1" && metricIndex > 0) break;
      const metricIds =
        skillId === "association-outlier-completeness@1"
          ? primaryMetrics.slice(0, 2).map(({ node_id: nodeId }) => nodeId)
          : [metricRef.node_id];
      const metrics = context.metrics.filter(({ metric_ref: item }) =>
        metricIds.includes(item.node_id),
      );
      const allowedDimensions = [...approvedDimensions]
        .filter((dimensionId) =>
          metrics.every((metric) =>
            metric.allowed_dimensions.some(
              (dimension) => dimension.dimension_id === dimensionId && dimension.groupable,
            ),
          ),
        )
        .sort()
        .slice(0, descriptor.hard_limits.max_dimensions);
      const applicability = await evaluateAnalysisApplicability(context, {
        skill_id: skillId,
        metric_ids: metricIds,
        dimension_ids: allowedDimensions,
      });
      if (applicability.verdict !== "APPLICABLE") continue;
      if (skillId === "contribution-concentration@1" && !input.comparison_window) continue;
      const parameterInput = nodeParameters(skillId);
      catalog.parseParameters(skillId, parameterInput);
      const nodeId = `${skillId.split("@")[0]}-${metricIds.join("-")}`;
      nodes.push({
        node_id: nodeId,
        skill_id: skillId,
        metric_refs:
          skillId === "association-outlier-completeness@1"
            ? primaryMetrics.slice(0, 2)
            : [metricRef],
        dimension_refs: allowedDimensions,
        time_window: input.time_window,
        comparison_window:
          skillId === "contribution-concentration@1" ? (input.comparison_window ?? null) : null,
        parameters: parameterInput,
        execution_mode: executionMode(descriptor),
        output_contract: descriptor.output_contract,
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: skillId === "data-profile@1" ? "CRITICAL" : "OPTIONAL",
      });
    }
  }

  const budget = boundedBudget(input.brief, nodes.length);
  const boundedNodes = nodes.slice(0, budget.max_steps);
  if (boundedNodes.length === 0) throw new TypeError("ANALYSIS_DEFAULT_PROGRAM_EMPTY");
  const material = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: briefRef,
    analysis_context_hash: context.context_hash,
    semantic_context_package_hash: context.semantic_context_binding.package_hash,
    nodes: boundedNodes,
    budget: boundedBudget(input.brief, boundedNodes.length),
    compiler_kind: "DETERMINISTIC_DEFAULT",
    compiler_version: "analysis-program-compiler@1.0.0",
  } as const;
  return analysisProgramPayloadSchema.parse({
    ...material,
    program_hash: await computeAnalysisProgramHash(material),
  });
}
