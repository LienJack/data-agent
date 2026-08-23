import {
  type AnalysisContext,
  type AnalysisProgramPayload,
  type ArtifactReference,
  analysisProgramPayloadSchema,
  type Falcon24AgentAnalysisCase,
  researchBriefRefSchema,
  verifyAnalysisContext,
} from "@data-agent/contracts";
import { computeAnalysisProgramHash } from "../analysis/default-program.js";
import { DEFAULT_ANALYSIS_SKILL_CATALOG } from "../analysis/skill-catalog.js";

const FALCON24_WINDOWS = Object.freeze({
  "falcon24-business-review-18m": {
    start: "2023-05-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  "falcon24-delivery-experience-12m": {
    start: "2023-11-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  "falcon24-inventory-damage-12m": {
    start: "2023-11-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  "falcon24-marketing-lag-effect": {
    start: "2023-05-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  "falcon24-cohort-retention-m0-m6": {
    start: "2023-05-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
} as const);

export async function createFalcon24AnalysisProgram(input: {
  readonly test_case: Falcon24AgentAnalysisCase;
  readonly brief_ref: ArtifactReference;
  readonly context: AnalysisContext;
  readonly metric_ids: readonly string[];
}): Promise<AnalysisProgramPayload> {
  const context = await verifyAnalysisContext(input.context);
  const briefRef = researchBriefRefSchema.parse(input.brief_ref);
  const metrics = input.metric_ids.map((metricId) => {
    const metric = context.metrics.find(
      ({ metric_ref: metricRef }) => metricRef.node_id === metricId,
    );
    if (!metric) throw new TypeError(`FALCON24_ANALYSIS_METRIC_MISSING:${metricId}`);
    return metric;
  });
  if (metrics.length === 0) throw new TypeError("FALCON24_ANALYSIS_METRICS_EMPTY");
  const requiredDimensions = input.test_case.required_semantic_keys
    .filter((key) => key.startsWith("dimension."))
    .map((key) => key.slice("dimension.".length));
  const dimensionRefs = requiredDimensions.filter((dimensionId) =>
    metrics.every((metric) =>
      metric.allowed_dimensions.some(
        (dimension) => dimension.dimension_id === dimensionId && dimension.groupable,
      ),
    ),
  );
  const descriptor = DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("open-python-analysis@1");
  const material: Omit<AnalysisProgramPayload, "program_hash"> = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: briefRef,
    analysis_context_hash: context.context_hash,
    semantic_context_package_hash: context.semantic_context_binding.package_hash,
    nodes: [
      {
        node_id: input.test_case.case_id,
        skill_id: "open-python-analysis@1",
        metric_refs: metrics.map(({ metric_ref: metricRef }) => metricRef),
        dimension_refs: dimensionRefs,
        time_window: FALCON24_WINDOWS[input.test_case.case_id],
        comparison_window: null,
        parameters: { declared_method: input.test_case.required_methods.join("+") },
        execution_mode: "MODEL_GENERATED",
        output_contract: descriptor.output_contract,
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: "CRITICAL",
      },
    ],
    budget: {
      max_steps: 1,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_series_rows: 5_000,
      max_group_rows: 5_000,
      max_elapsed_ms: 120_000,
    },
    compiler_kind: "MODEL_CANDIDATE_HOST_VERIFIED",
    compiler_version: "falcon24-agent-analysis-compiler@1.0.0",
  };
  return analysisProgramPayloadSchema.parse({
    ...material,
    program_hash: await computeAnalysisProgramHash(material),
  });
}

export const falcon24AnalysisProgramInternals = Object.freeze({ windows: FALCON24_WINDOWS });
