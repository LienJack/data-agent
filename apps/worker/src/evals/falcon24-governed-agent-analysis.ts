import {
  type AnalysisContext,
  type ArtifactReference,
  artifactReferenceFor,
  type Falcon24AgentAnalysisCase,
  type ResearchBriefV3Payload,
  researchBriefV3PayloadSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { falcon24AnalysisOutputSchema } from "@data-agent/evals";
import { deterministicAnalysisUuid } from "../analysis/deterministic-id.js";
import type { AnalysisArtifactCommitPort, AnalysisExecutionResult } from "../analysis/executor.js";
import type { GovernedAgentAnalysisPort } from "../teams/direct-qa-analysis-executor.js";
import { compileFalcon24AnalysisContext } from "./falcon24-analysis-context.js";
import {
  createFalcon24AnalysisProgram,
  falcon24AnalysisProgramInternals,
} from "./falcon24-analysis-program.js";

interface Falcon24ProgramExecutor {
  execute(input: {
    readonly lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"];
    readonly principal_id: string;
    readonly brief: ResearchBriefV3Payload;
    readonly brief_ref: ArtifactReference;
    readonly context: AnalysisContext;
    readonly program: Awaited<ReturnType<typeof createFalcon24AnalysisProgram>>;
  }): Promise<AnalysisExecutionResult>;
}

function questionFrameReference(input: {
  readonly lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"];
  readonly content_hash: `sha256:${string}`;
}) {
  return artifactReferenceFor("QuestionFrame").parse({
    artifact_id: deterministicAnalysisUuid(
      `falcon24-question-frame\0${input.lease.run_id}\0${input.content_hash}`,
    ),
    artifact_type: "QuestionFrame",
    ...input.lease.scope,
    run_id: input.lease.run_id,
    revision: 1,
    content_hash: input.content_hash,
  });
}

async function buildBrief(input: {
  readonly lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"];
  readonly test_case: Falcon24AgentAnalysisCase;
  readonly question: string;
  readonly context: AnalysisContext;
  readonly datasource_id: string;
}): Promise<ResearchBriefV3Payload> {
  const window = falcon24AnalysisProgramInternals.windows[input.test_case.case_id];
  const metric = input.context.metrics[0];
  if (!metric) throw new TypeError("FALCON24_ANALYSIS_PRIMARY_METRIC_MISSING");
  const authorizedDimensions = new Set(
    metric.allowed_dimensions
      .filter(({ groupable }) => groupable)
      .map(({ dimension_id }) => dimension_id),
  );
  const approvedDimensions = input.test_case.required_semantic_keys
    .filter((key) => key.startsWith("dimension."))
    .map((key) => key.slice("dimension.".length))
    .filter((dimensionId) => authorizedDimensions.has(dimensionId))
    .sort()
    .slice(0, 5);
  const questionFrameMaterial = {
    artifact_type: "QuestionFrame" as const,
    raw_question: input.question,
    normalized_question: input.question.normalize("NFKC").trim(),
    authorized_datasource_ids: [input.datasource_id],
    expected_output: "Falcon 24 governed structured analysis",
  };
  const questionFrameRef = questionFrameReference({
    lease: input.lease,
    content_hash: await sha256ContentHash(questionFrameMaterial),
  });
  const material = {
    artifact_type: "ResearchBrief" as const,
    protocol_version: "research-brief@3.0.0" as const,
    question_frame_ref: questionFrameRef,
    research_mode: "EXPLORATORY_DETERMINISTIC" as const,
    question: input.question,
    semantic_release_ref: input.context.semantic_release_ref,
    schema_snapshot_ref: input.context.schema_snapshot_ref,
    policy_receipt_ref: input.context.policy_receipt_ref,
    primary_metric_refs: [metric.metric_ref],
    approved_dimension_refs: approvedDimensions,
    requested_time_window: window,
    analysis_mode: "EXPLICIT" as const,
    root_cause_mode: "DISABLED" as const,
    code_generation: "ALLOW_SANDBOXED" as const,
    success_criteria: input.test_case.required_methods.map(
      (method) => `独立 Oracle 必须验收方法 ${method}`,
    ),
    required_disclosures: [...input.test_case.required_disclosures],
    budget: {
      max_steps: 1,
      max_model_calls: 2,
      max_sql_executions: 1,
      max_sandbox_executions: 2,
      max_elapsed_ms: 300_000,
    },
  };
  return researchBriefV3PayloadSchema.parse({
    ...material,
    brief_hash: await sha256ContentHash({
      hash_domain: "falcon24-analysis-brief@1.0.0",
      value: material,
    }),
  });
}

function decodeValidatedOutput(
  result: AnalysisExecutionResult,
  testCase: Falcon24AgentAnalysisCase,
) {
  if (result.completion.terminal !== "READY" || result.validated_outputs.length !== 1) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_REQUIRED");
  }
  const accepted = result.validated_outputs[0];
  if (
    !accepted ||
    accepted.node_id !== testCase.case_id ||
    accepted.output.name !== "result" ||
    accepted.output.type !== "JSON"
  ) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_CORRELATION_INVALID");
  }
  const output = falcon24AnalysisOutputSchema.parse(
    JSON.parse(Buffer.from(accepted.output.content_base64, "base64").toString("utf8")),
  );
  if (output.case_id !== testCase.case_id) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_CASE_INVALID");
  }
  return { output, output_ref: accepted.output.reference };
}

export function createFalcon24GovernedAgentAnalysisPort(input: {
  readonly datasource_id: string;
  readonly artifacts: AnalysisArtifactCommitPort;
  readonly create_executor: (context: {
    readonly analysis_context: AnalysisContext;
    readonly semantic_context: Parameters<
      GovernedAgentAnalysisPort["analyze"]
    >[0]["semantic_context"];
    readonly test_case: Falcon24AgentAnalysisCase;
    readonly provider_dispatch: Parameters<
      GovernedAgentAnalysisPort["analyze"]
    >[0]["provider_dispatch"];
    readonly fence_guard: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["fence_guard"];
  }) => Falcon24ProgramExecutor;
  readonly compile_context?: typeof compileFalcon24AnalysisContext;
}): GovernedAgentAnalysisPort {
  const compileContext = input.compile_context ?? compileFalcon24AnalysisContext;
  return Object.freeze({
    async analyze(command: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]) {
      const { context } = await compileContext({
        lease: command.lease,
        semantic_context: command.semantic_context,
        test_case: command.test_case,
      });
      const brief = await buildBrief({
        lease: command.lease,
        test_case: command.test_case,
        question: command.question,
        context,
        datasource_id: input.datasource_id,
      });
      const briefRef = await input.artifacts.commitL2({
        lease: command.lease,
        principal_id: command.lease.principal_id,
        idempotency_key: `falcon24-analysis-brief:${command.test_case.case_id}`,
        payload: brief,
      });
      if (briefRef.artifact_type !== "ResearchBrief") {
        throw new TypeError("FALCON24_ANALYSIS_BRIEF_COMMIT_INVALID");
      }
      const program = await createFalcon24AnalysisProgram({
        test_case: command.test_case,
        brief_ref: briefRef,
        context,
        metric_ids: context.metrics.map(({ metric_ref }) => metric_ref.node_id),
      });
      const executor = input.create_executor({
        analysis_context: context,
        semantic_context: command.semantic_context,
        test_case: command.test_case,
        provider_dispatch: command.provider_dispatch,
        fence_guard: command.fence_guard,
      });
      const execution = await executor.execute({
        lease: command.lease,
        principal_id: command.lease.principal_id,
        brief,
        brief_ref: briefRef,
        context,
        program,
      });
      const validated = decodeValidatedOutput(execution, command.test_case);
      const acceptedArtifactRefs = [
        briefRef,
        execution.analysis_program_ref,
        ...execution.evidence_refs,
        validated.output_ref,
        execution.completion_ref,
      ];
      const seen = new Set<string>();
      return {
        answer: validated.output.conclusion,
        accepted_artifact_refs: acceptedArtifactRefs.filter((reference) => {
          const identity = `${reference.artifact_id}:${reference.revision}:${reference.content_hash}`;
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        }),
      };
    },
  });
}

export const falcon24GovernedAgentAnalysisInternals = Object.freeze({
  buildBrief,
  decodeValidatedOutput,
});
