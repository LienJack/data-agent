import {
  type AnalysisProgramPayload,
  type AnalysisResultContract,
  analysisProgramPayloadSchema,
  type ResearchBriefV3Payload,
  researchBriefRefSchema,
  verifyAnalysisResultContract,
} from "@data-agent/contracts/artifacts";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import {
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  statisticalOperatorIdSchema,
  statisticalOperatorObligationsSchema,
} from "@data-agent/contracts/statistical-operators";
import { z } from "zod";
import { computeAnalysisProgramHash } from "./analysis-program-hash.js";
import { gateAnalysisProgram } from "./program-gate.js";

const halfOpenTimeWindowSchema = z
  .strictObject({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(64),
    semantics: z.literal("HALF_OPEN"),
  })
  .superRefine((window, context) => {
    if (Date.parse(window.start) >= Date.parse(window.end)) {
      context.addIssue({ code: "custom", path: ["end"], message: "Analysis window is empty." });
    }
  });

export const analysisProgramCandidateSchema = z
  .strictObject({
    schema_version: z.literal("analysis-program-candidate@1.0.0"),
    node_id: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u),
    metric_ids: z
      .array(z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u))
      .min(1)
      .max(3),
    dimension_ids: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u)).max(5),
    time_window: halfOpenTimeWindowSchema,
    comparison_window: halfOpenTimeWindowSchema.nullable(),
    parameters: z.strictObject({
      result_schema_version: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u)
        .optional(),
      claim_strength: z
        .enum(["DESCRIPTIVE", "ASSOCIATION_ONLY", "HOLD_WITH_SENSITIVITY"])
        .optional(),
    }),
    operator_obligations: statisticalOperatorObligationsSchema,
  })
  .superRefine((candidate, context) => {
    if (new Set(candidate.metric_ids).size !== candidate.metric_ids.length) {
      context.addIssue({
        code: "custom",
        path: ["metric_ids"],
        message: "Metrics must be unique.",
      });
    }
    if (new Set(candidate.dimension_ids).size !== candidate.dimension_ids.length) {
      context.addIssue({
        code: "custom",
        path: ["dimension_ids"],
        message: "Dimensions must be unique.",
      });
    }
  });

export type AnalysisProgramCandidate = z.infer<typeof analysisProgramCandidateSchema>;

const PROGRAM_COMPILER_VERSION = "analysis-program-host-compiler@1.0.0" as const;
const requiredOperatorIdsSchema = z
  .array(statisticalOperatorIdSchema)
  .max(32)
  .superRefine((operatorIds, context) => {
    if (new Set(operatorIds).size !== operatorIds.length) {
      context.addIssue({ code: "custom", message: "Required operator ids must be unique." });
    }
  });

export async function compileAnalysisProgramCandidate(input: {
  readonly candidate: unknown;
  readonly brief: ResearchBriefV3Payload;
  readonly brief_ref: import("@data-agent/contracts/artifacts").ArtifactReference;
  readonly context: AnalysisContext;
  readonly result_contract: AnalysisResultContract;
  readonly required_operator_ids: readonly string[];
}): Promise<AnalysisProgramPayload> {
  const candidate = analysisProgramCandidateSchema.parse(input.candidate);
  const context = await verifyAnalysisContext(input.context);
  const briefRef = researchBriefRefSchema.parse(input.brief_ref);
  const requiredOperatorIds = requiredOperatorIdsSchema.parse(input.required_operator_ids).sort();
  const candidateOperatorIds = [
    ...new Set(candidate.operator_obligations.map(({ operator_id: operatorId }) => operatorId)),
  ].sort();
  if (JSON.stringify(requiredOperatorIds) !== JSON.stringify(candidateOperatorIds)) {
    throw new TypeError("ANALYSIS_PROGRAM_OPERATOR_REQUIREMENT_MISMATCH");
  }
  const metrics = candidate.metric_ids.map((metricId) => {
    const metric = context.metrics.find(
      ({ metric_ref: reference }) => reference.node_id === metricId,
    );
    if (!metric) throw new TypeError("ANALYSIS_PROGRAM_CANDIDATE_METRIC_NOT_PUBLISHED");
    return metric;
  });
  if (
    candidate.dimension_ids.some((dimensionId) =>
      metrics.some(
        ({ allowed_dimensions: dimensions }) =>
          !dimensions.some(({ dimension_id: id, groupable }) => id === dimensionId && groupable),
      ),
    )
  ) {
    throw new TypeError("ANALYSIS_PROGRAM_CANDIDATE_DIMENSION_NOT_PUBLISHED");
  }
  const resultContract = await verifyAnalysisResultContract(input.result_contract);
  const selectedMetricIds = new Set(candidate.metric_ids);
  const selectedDimensionIds = new Set(candidate.dimension_ids);
  const selectedSemanticObjectIds = new Set([
    ...selectedMetricIds,
    ...selectedDimensionIds,
    ...context.relationships.map(({ relationship_id: relationshipId }) => relationshipId),
  ]);
  if (
    resultContract.semantic_context_hash !== context.semantic_context_binding.package_hash ||
    resultContract.metric_bindings.some(
      ({ semantic_metric_id: metricId }) => !selectedMetricIds.has(metricId),
    ) ||
    resultContract.dimension_bindings.some(
      ({ semantic_dimension_id: dimensionId }) => !selectedDimensionIds.has(dimensionId),
    ) ||
    resultContract.grain.dimension_ids.some(
      (dimensionId) => !selectedDimensionIds.has(dimensionId),
    ) ||
    (resultContract.grain.time_dimension_id !== null &&
      !selectedDimensionIds.has(resultContract.grain.time_dimension_id)) ||
    resultContract.lineage.some(({ source_semantic_object_ids: objectIds }) =>
      objectIds.some((objectId) => !selectedSemanticObjectIds.has(objectId)),
    )
  ) {
    throw new TypeError("ANALYSIS_PROGRAM_RESULT_CONTRACT_AUTHORITY_MISMATCH");
  }
  const requiredMethods = requiredOperatorIds;
  const parameters = z.json().parse({
    ...candidate.parameters,
    declared_method:
      requiredMethods.length > 0 ? "governed-operator-orchestration@1" : "open-python-analysis@1",
    ...(requiredMethods.length > 0 ? { required_methods: requiredMethods } : {}),
    question: input.brief.question,
  });
  const material: Omit<AnalysisProgramPayload, "program_hash"> = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: briefRef,
    analysis_context_hash: context.context_hash,
    semantic_context_package_hash: context.semantic_context_binding.package_hash,
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    nodes: [
      {
        node_id: candidate.node_id,
        skill_id: "open-python-analysis@1",
        metric_refs: metrics.map(({ metric_ref: reference }) => reference),
        dimension_refs: candidate.dimension_ids,
        time_window: candidate.time_window,
        comparison_window: candidate.comparison_window,
        parameters,
        execution_mode: "MODEL_GENERATED",
        generated_source_policy:
          candidate.operator_obligations.length > 0
            ? "GOVERNED_OPERATOR_ORCHESTRATION"
            : "OPEN_ANALYSIS",
        operator_obligations: candidate.operator_obligations,
        result_contract: resultContract,
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
      max_elapsed_ms: Math.min(300_000, input.brief.budget.max_elapsed_ms),
    },
    compiler_kind: "MODEL_CANDIDATE_HOST_VERIFIED",
    compiler_version: PROGRAM_COMPILER_VERSION,
  };
  const program = analysisProgramPayloadSchema.parse({
    ...material,
    program_hash: await computeAnalysisProgramHash(material),
  });
  const verdict = await gateAnalysisProgram({
    program,
    brief: input.brief,
    brief_ref: briefRef,
    context,
  });
  if (!verdict.ok) throw new TypeError(verdict.failure);
  return verdict.program;
}

export const analysisProgramCompilerInternals = Object.freeze({
  compiler_version: PROGRAM_COMPILER_VERSION,
  halfOpenTimeWindowSchema,
});
