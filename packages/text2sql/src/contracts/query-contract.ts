import {
  deepFreeze,
  type L2ArtifactAuthorityContext,
  type L2ArtifactDocument,
  type QueryContractPayload,
  queryContractSchema,
  verifyL2ArtifactDocument,
} from "@data-agent/contracts";
import { z } from "zod";

const queryContractResolutionSchema = z.strictObject({
  metric_candidates: z.array(z.string().min(1).max(128)),
  dimensions: queryContractSchema.shape.dimensions,
  grain: queryContractSchema.shape.grain,
  time_range: queryContractSchema.shape.time_range.nullable(),
  unit: queryContractSchema.shape.unit,
  filters: queryContractSchema.shape.filters,
  datasource_id: queryContractSchema.shape.datasource_id,
  result_contract: queryContractSchema.shape.result_contract,
});

const queryContractCompilerInputSchema = z.strictObject({
  evidence_plan_ref: queryContractSchema.shape.evidence_plan_ref,
  question_frame: z.unknown(),
  resolution: queryContractResolutionSchema,
});

export type QueryContractResolution = Readonly<{
  metric_candidates: readonly string[];
  dimensions: readonly string[];
  grain: string;
  time_range: QueryContractPayload["time_range"] | null;
  unit: string;
  filters: readonly QueryContractPayload["filters"][number][];
  datasource_id: string;
  result_contract: Readonly<{
    columns: readonly string[];
    invariant_ids: readonly string[];
  }>;
}>;

export type QueryContractCompilerInput = Readonly<{
  evidence_plan_ref: QueryContractPayload["evidence_plan_ref"];
  question_frame: L2ArtifactDocument;
  resolution: QueryContractResolution;
}>;

export type QueryContractCompilation =
  | Readonly<{
      state: "READY";
      query_contract: QueryContractPayload;
    }>
  | Readonly<{
      state: "CLARIFY";
      reason_code:
        | "QUERY_CONTRACT_METRIC_UNRESOLVED"
        | "QUERY_CONTRACT_METRIC_AMBIGUOUS"
        | "QUERY_CONTRACT_TIME_UNRESOLVED";
      conflict_set: readonly string[];
    }>
  | Readonly<{
      state: "DENIED";
      reason_code:
        | "QUERY_CONTRACT_QUESTION_FRAME_AUTHORITY_DENIED"
        | "QUERY_CONTRACT_DATASOURCE_DENIED";
    }>;

function validHalfOpenRange(
  range: z.infer<typeof queryContractSchema.shape.time_range> | null,
): range is z.infer<typeof queryContractSchema.shape.time_range> {
  return range !== null && Date.parse(range.start) < Date.parse(range.end);
}

function belongsToEvidencePlanScope(
  questionFrame: L2ArtifactDocument,
  evidencePlanReference: QueryContractPayload["evidence_plan_ref"],
): boolean {
  const { envelope } = questionFrame;
  return (
    envelope.app_id === evidencePlanReference.app_id &&
    envelope.tenant_id === evidencePlanReference.tenant_id &&
    envelope.environment === evidencePlanReference.environment &&
    envelope.run_id === evidencePlanReference.run_id
  );
}

export async function compileQueryContract(
  input: QueryContractCompilerInput,
  authority: L2ArtifactAuthorityContext,
): Promise<QueryContractCompilation> {
  const parsed = queryContractCompilerInputSchema.parse(input);
  let verifiedQuestionFrame: L2ArtifactDocument;
  try {
    verifiedQuestionFrame = await verifyL2ArtifactDocument(parsed.question_frame, authority);
  } catch {
    return deepFreeze({
      state: "DENIED",
      reason_code: "QUERY_CONTRACT_QUESTION_FRAME_AUTHORITY_DENIED",
    });
  }
  if (
    verifiedQuestionFrame.payload.artifact_type !== "QuestionFrame" ||
    !belongsToEvidencePlanScope(verifiedQuestionFrame, parsed.evidence_plan_ref)
  ) {
    return deepFreeze({
      state: "DENIED",
      reason_code: "QUERY_CONTRACT_QUESTION_FRAME_AUTHORITY_DENIED",
    });
  }
  const questionFrame = verifiedQuestionFrame.payload;
  const metricCandidates = [...new Set(parsed.resolution.metric_candidates)].sort();
  if (metricCandidates.length === 0) {
    return deepFreeze({
      state: "CLARIFY",
      reason_code: "QUERY_CONTRACT_METRIC_UNRESOLVED",
      conflict_set: [],
    });
  }
  if (metricCandidates.length > 1) {
    return deepFreeze({
      state: "CLARIFY",
      reason_code: "QUERY_CONTRACT_METRIC_AMBIGUOUS",
      conflict_set: metricCandidates,
    });
  }
  if (!validHalfOpenRange(parsed.resolution.time_range)) {
    return deepFreeze({
      state: "CLARIFY",
      reason_code: "QUERY_CONTRACT_TIME_UNRESOLVED",
      conflict_set: [],
    });
  }
  if (!questionFrame.authorized_datasource_ids.includes(parsed.resolution.datasource_id)) {
    return deepFreeze({
      state: "DENIED",
      reason_code: "QUERY_CONTRACT_DATASOURCE_DENIED",
    });
  }
  return deepFreeze({
    state: "READY",
    query_contract: queryContractSchema.parse({
      artifact_type: "QueryContract",
      evidence_plan_ref: parsed.evidence_plan_ref,
      metric: metricCandidates[0],
      dimensions: parsed.resolution.dimensions,
      grain: parsed.resolution.grain,
      time_range: parsed.resolution.time_range,
      unit: parsed.resolution.unit,
      filters: parsed.resolution.filters,
      datasource_id: parsed.resolution.datasource_id,
      result_contract: parsed.resolution.result_contract,
    }),
  });
}
