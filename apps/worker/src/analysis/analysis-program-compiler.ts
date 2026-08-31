import {
  type AnalysisProgramPayload,
  type AnalysisResultContract,
  analysisProgramPayloadSchema,
  type ResearchBriefV3Payload,
  researchBriefRefSchema,
  verifyAnalysisResultContract,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import {
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  statisticalOperatorObligationsSchema,
} from "@data-agent/contracts/statistical-operators";
import { z } from "zod";
import { resolveAnalysisEvidenceTimeWindow } from "./analysis-evidence-time-window.js";
import { computeAnalysisProgramHash } from "./analysis-program-hash.js";
import {
  type AcceptedAnalysisQueryEvidence,
  resolveAnalysisResultSourceObjects,
  verifyAcceptedAnalysisQueryEvidence,
} from "./analysis-result-source-authority.js";
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

const analysisProgramCandidateV1Schema = z
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

const candidateNodeV2Schema = z
  .strictObject({
    node_id: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u),
    method_registry_entry_ids: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u))
      .min(1)
      .max(8),
    metric_ids: z
      .array(z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u))
      .min(1)
      .max(3),
    dimension_ids: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u)).max(5),
    time_window: halfOpenTimeWindowSchema.nullable(),
    comparison_window: halfOpenTimeWindowSchema.nullable(),
    parameters: z.record(z.string(), z.json()),
    operator_obligations: statisticalOperatorObligationsSchema,
    dependency_node_ids: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u)).max(16),
    activation_rule: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("ALWAYS") }),
      z.strictObject({
        kind: z.literal("MATERIAL_CHANGE"),
        source_node_id: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u),
        policy_threshold_id: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u),
      }),
      z.strictObject({
        kind: z.literal("HISTORY_SUFFICIENT"),
        source_node_id: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u),
        minimum_points: z.number().int().positive().max(5_000),
      }),
    ]),
    criticality: z.enum(["CRITICAL", "OPTIONAL"]),
  })
  .superRefine((candidate, context) => {
    for (const [path, values] of [
      ["method_registry_entry_ids", candidate.method_registry_entry_ids],
      ["metric_ids", candidate.metric_ids],
      ["dimension_ids", candidate.dimension_ids],
      ["dependency_node_ids", candidate.dependency_node_ids],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path: [path], message: `${path} must be unique.` });
      }
    }
  });

const analysisProgramCandidateV2Schema = z
  .strictObject({
    schema_version: z.enum([
      "analysis-program-candidate@2.0.0",
      "analysis-program-candidate@2.1.0",
    ]),
    objective_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    nodes: z.array(candidateNodeV2Schema).min(1).max(64),
  })
  .superRefine((candidate, context) => {
    if (candidate.schema_version === "analysis-program-candidate@2.0.0") {
      for (const [index, node] of candidate.nodes.entries()) {
        if (node.time_window === null)
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "time_window"],
            message: "All-accepted-input scope requires analysis-program-candidate@2.1.0.",
          });
      }
    }
    const nodeIds = candidate.nodes.map(({ node_id: nodeId }) => nodeId);
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({ code: "custom", path: ["nodes"], message: "Node ids must be unique." });
    }
  });

export const analysisProgramCandidateSchema = z.discriminatedUnion("schema_version", [
  analysisProgramCandidateV1Schema,
  analysisProgramCandidateV2Schema,
]);

export type AnalysisProgramCandidate = z.infer<typeof analysisProgramCandidateSchema>;

export interface AnalysisMethodRegistryEntry {
  readonly method_id: string;
  readonly skill_id: AnalysisProgramPayload["nodes"][number]["skill_id"];
  readonly result_contract: AnalysisResultContract;
  readonly required_operator_obligations: unknown;
  /** Host-owned execution rules, included in the registry hash; never a candidate-supplied field. */
  readonly execution_contract?: unknown;
}

const PROGRAM_COMPILER_VERSION = "analysis-program-host-compiler@2.0.0" as const;
export async function compileAnalysisProgramCandidate(input: {
  readonly candidate: unknown;
  readonly brief: ResearchBriefV3Payload;
  readonly brief_ref: import("@data-agent/contracts/artifacts").ArtifactReference;
  readonly context: AnalysisContext;
  readonly result_contract?: AnalysisResultContract;
  readonly required_operator_obligations?: unknown;
  readonly method_registry?: readonly AnalysisMethodRegistryEntry[];
  readonly query_evidence?: AcceptedAnalysisQueryEvidence;
}): Promise<AnalysisProgramPayload> {
  const candidate = analysisProgramCandidateSchema.parse(input.candidate);
  const context = await verifyAnalysisContext(input.context);
  const briefRef = researchBriefRefSchema.parse(input.brief_ref);
  const objectiveHash = await sha256ContentHash({
    hash_domain: "analysis-program-objective@1.0.0",
    question: input.brief.question,
  });
  if (
    candidate.schema_version !== "analysis-program-candidate@1.0.0" &&
    candidate.objective_hash !== objectiveHash
  ) {
    throw new TypeError("ANALYSIS_PROGRAM_OBJECTIVE_HASH_MISMATCH");
  }
  const methodRegistry = new Map(
    (input.method_registry ?? []).map((entry) => [entry.method_id, entry]),
  );
  const candidateNodes =
    candidate.schema_version === "analysis-program-candidate@1.0.0"
      ? [
          {
            ...candidate,
            method_registry_entry_ids: ["open-python-analysis@1"],
            dependency_node_ids: [] as string[],
            activation_rule: { kind: "ALWAYS" as const },
            criticality: "CRITICAL" as const,
          },
        ]
      : candidate.nodes;
  const allAcceptedInput = candidateNodes.some((node) => node.time_window === null);
  if (allAcceptedInput) {
    try {
      if (!input.query_evidence) throw new TypeError("ACCEPTED_QUERY_REQUIRED");
      const { semantic_binding: binding } = await verifyAcceptedAnalysisQueryEvidence({
        context,
        run_id: input.brief.question_frame_ref.run_id,
        query_evidence: input.query_evidence,
      });
      const acceptedWindow = resolveAnalysisEvidenceTimeWindow(binding, context);
      if (
        candidateNodes.some(
          (node) =>
            canonicalizeJson(node.time_window) !== canonicalizeJson(acceptedWindow) ||
            node.comparison_window !== null,
        )
      )
        throw new TypeError("ACCEPTED_WINDOW_MISMATCH");
    } catch {
      throw new TypeError("ANALYSIS_PROGRAM_INPUT_TIME_SCOPE_INVALID");
    }
  }
  const compiledNodes = await Promise.all(
    candidateNodes.map(async (candidateNode) => {
      const metrics = candidateNode.metric_ids.map((metricId) => {
        const metric = context.metrics.find(
          ({ metric_ref: reference }) => reference.node_id === metricId,
        );
        if (!metric) throw new TypeError("ANALYSIS_PROGRAM_CANDIDATE_METRIC_NOT_PUBLISHED");
        return metric;
      });
      if (
        candidateNode.dimension_ids.some((dimensionId) =>
          metrics.some(
            ({ allowed_dimensions: dimensions }) =>
              !dimensions.some(
                ({ dimension_id: id, groupable }) => id === dimensionId && groupable,
              ),
          ),
        )
      ) {
        throw new TypeError("ANALYSIS_PROGRAM_CANDIDATE_DIMENSION_NOT_PUBLISHED");
      }
      const registeredMethods = candidateNode.method_registry_entry_ids.map((methodId) => {
        const method = methodRegistry.get(methodId);
        if (method) return method;
        if (
          candidate.schema_version === "analysis-program-candidate@1.0.0" &&
          methodId === "open-python-analysis@1" &&
          input.result_contract &&
          input.required_operator_obligations !== undefined
        ) {
          return {
            method_id: methodId,
            skill_id: "open-python-analysis@1" as const,
            result_contract: input.result_contract,
            required_operator_obligations: input.required_operator_obligations,
          };
        }
        throw new TypeError("ANALYSIS_PROGRAM_METHOD_NOT_PUBLISHED");
      });
      const skillIds = new Set(registeredMethods.map(({ skill_id: skillId }) => skillId));
      const contractHashes = new Set(
        registeredMethods.map(({ result_contract: contract }) => contract.contract_hash),
      );
      const skillId = registeredMethods[0]?.skill_id;
      if (!skillId || skillIds.size !== 1 || contractHashes.size !== 1) {
        throw new TypeError("ANALYSIS_PROGRAM_METHOD_COMPOSITION_INVALID");
      }
      const requiredOperatorObligations = statisticalOperatorObligationsSchema.parse(
        registeredMethods.flatMap(({ required_operator_obligations: obligations }) =>
          statisticalOperatorObligationsSchema.parse(obligations),
        ),
      );
      if (
        JSON.stringify(requiredOperatorObligations) !==
        JSON.stringify(candidateNode.operator_obligations)
      ) {
        throw new TypeError("ANALYSIS_PROGRAM_OPERATOR_REQUIREMENT_MISMATCH");
      }
      const resultContract = await verifyAnalysisResultContract(
        registeredMethods[0]?.result_contract,
      );
      const selectedMetricIds = new Set(candidateNode.metric_ids);
      const selectedDimensionIds = new Set(candidateNode.dimension_ids);
      const selectedSemanticObjectIds = new Set([
        ...selectedMetricIds,
        ...selectedDimensionIds,
        ...context.relationships.map(({ relationship_id: relationshipId }) => relationshipId),
      ]);
      const sourceObjectIds = await resolveAnalysisResultSourceObjects({
        result_contract: resultContract,
        context,
        run_id: input.brief.question_frame_ref.run_id,
        selected_object_ids: selectedSemanticObjectIds,
        ...(input.query_evidence ? { query_evidence: input.query_evidence } : {}),
      });
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
          objectIds.some(
            (objectId) =>
              !selectedSemanticObjectIds.has(objectId) && !sourceObjectIds.has(objectId),
          ),
        )
      ) {
        throw new TypeError("ANALYSIS_PROGRAM_RESULT_CONTRACT_AUTHORITY_MISMATCH");
      }
      const requiredMethods = [
        ...new Set(requiredOperatorObligations.map(({ operator_id }) => operator_id)),
      ].sort();
      const parameters = z.json().parse(
        skillId === "open-python-analysis@1"
          ? {
              ...candidateNode.parameters,
              declared_method:
                requiredMethods.length > 0
                  ? "governed-operator-orchestration@1"
                  : "open-python-analysis@1",
              ...(requiredMethods.length > 0 ? { required_methods: requiredMethods } : {}),
              question: input.brief.question,
            }
          : candidateNode.parameters,
      );
      return {
        node_id: candidateNode.node_id,
        skill_id: skillId,
        method_registry_entry_ids: candidateNode.method_registry_entry_ids,
        metric_refs: metrics.map(({ metric_ref: reference }) => reference),
        dimension_refs: candidateNode.dimension_ids,
        time_window: candidateNode.time_window,
        comparison_window: candidateNode.comparison_window,
        parameters,
        execution_mode: "MODEL_GENERATED" as const,
        generated_source_policy:
          candidateNode.operator_obligations.length > 0
            ? ("GOVERNED_OPERATOR_ORCHESTRATION" as const)
            : ("OPEN_ANALYSIS" as const),
        operator_obligations: candidateNode.operator_obligations,
        result_contract: resultContract,
        dependency_node_ids: candidateNode.dependency_node_ids,
        activation_rule: candidateNode.activation_rule,
        criticality: candidateNode.criticality,
      };
    }),
  );
  const material: Omit<AnalysisProgramPayload, "program_hash"> = {
    artifact_type: "AnalysisProgram",
    protocol_version: allAcceptedInput ? "analysis-program@1.1.0" : "analysis-program@1.0.0",
    brief_ref: briefRef,
    analysis_context_hash: context.context_hash,
    semantic_context_package_hash: context.semantic_context_binding.package_hash,
    objective_hash: objectiveHash,
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    nodes: compiledNodes,
    budget: {
      max_steps: compiledNodes.length,
      max_sql_executions: compiledNodes.length,
      max_sandbox_executions: compiledNodes.length,
      max_series_rows: 5_000,
      max_group_rows: 5_000,
      max_elapsed_ms: Math.min(300_000, input.brief.budget.max_elapsed_ms),
    },
    compiler_kind: "MODEL_CANDIDATE_HOST_VERIFIED",
    compiler_version: allAcceptedInput
      ? "analysis-program-host-compiler@2.1.0"
      : PROGRAM_COMPILER_VERSION,
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
