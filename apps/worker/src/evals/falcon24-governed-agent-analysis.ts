import {
  type AnalysisContext,
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV3,
  artifactReferenceFor,
  artifactReferenceIdentity,
  buildArtifactWorkspaceChartDocumentV3,
  type Falcon24AgentAnalysisCase,
  type PortResult,
  type ResearchBriefV3Payload,
  researchBriefV3PayloadSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  buildFalcon24AnalysisChartProjection,
  FALCON24_ANALYSIS_CHART_VERSION,
  falcon24AnalysisOutputSchema,
} from "@data-agent/evals";
import { deterministicAnalysisUuid } from "../analysis/deterministic-id.js";
import type { AnalysisArtifactCommitPort, AnalysisExecutionResult } from "../analysis/executor.js";
import type { GovernedAgentAnalysisPort } from "../teams/direct-qa-analysis-executor.js";
import type { Falcon24AnalysisAcceptanceRecorder } from "./falcon24-analysis-acceptance-recorder.js";
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

export interface Falcon24PublicArtifactPort {
  commitDerivedAnalysisChart(
    capability: unknown,
    lease: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]["lease"],
    document: ArtifactWorkspaceChartDocumentV3,
  ): Promise<PortResult<ArtifactReference>>;
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function exactlyOne<T>(values: readonly T[], code: string): T {
  if (values.length !== 1 || values[0] === undefined) throw new TypeError(code);
  return values[0];
}

function artifactMarkdownHref(reference: ArtifactReference): string {
  const parameters = new URLSearchParams({
    revision: String(reference.revision),
    hash: reference.content_hash,
  });
  return `artifact://${reference.artifact_id}?${parameters.toString()}`;
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
  readonly primary_metric_id: string;
}): Promise<ResearchBriefV3Payload> {
  const window = falcon24AnalysisProgramInternals.windows[input.test_case.case_id];
  const metric = input.context.metrics.find(
    ({ metric_ref: metricRef }) => metricRef.node_id === input.primary_metric_id,
  );
  if (!metric) throw new TypeError("FALCON24_ANALYSIS_PRIMARY_METRIC_MISSING");
  const authorizedDimensions = new Set(
    input.context.metrics
      .flatMap(({ allowed_dimensions: allowedDimensions }) => allowedDimensions)
      .filter(({ groupable }) => groupable)
      .map(({ dimension_id }) => dimension_id),
  );
  const approvedDimensions = input.test_case.required_semantic_keys
    .filter((key) => key.startsWith("dimension."))
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
      max_model_calls: 24,
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
    accepted.output.artifact_name !== "result" ||
    accepted.output.artifact_kind !== "RESULT" ||
    accepted.output.media_type !== "application/json"
  ) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_CORRELATION_INVALID");
  }
  const published = JSON.parse(Buffer.from(accepted.output.content).toString("utf8")) as unknown;
  if (typeof published !== "object" || published === null || !("data" in published)) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_DOCUMENT_INVALID");
  }
  const output = falcon24AnalysisOutputSchema.parse(published.data);
  if (output.case_id !== testCase.case_id) {
    throw new TypeError("FALCON24_ANALYSIS_VALIDATED_OUTPUT_CASE_INVALID");
  }
  return { output, output_ref: accepted.output.reference };
}

export function createFalcon24GovernedAgentAnalysisPort(input: {
  readonly artifacts: AnalysisArtifactCommitPort;
  readonly public_artifacts: Falcon24PublicArtifactPort;
  readonly public_artifact_capability: unknown;
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
  readonly acceptance_recorder?: Falcon24AnalysisAcceptanceRecorder | null;
}): GovernedAgentAnalysisPort {
  const compileContext = input.compile_context ?? compileFalcon24AnalysisContext;
  return Object.freeze({
    async analyze(command: Parameters<GovernedAgentAnalysisPort["analyze"]>[0]) {
      const { context, metric_ids: metricIds } = await compileContext({
        lease: command.lease,
        semantic_context: command.semantic_context,
        test_case: command.test_case,
      });
      const brief = await buildBrief({
        lease: command.lease,
        test_case: command.test_case,
        question: command.question,
        context,
        datasource_id: command.semantic_context.package.semantic_release.datasource_id,
        primary_metric_id: metricIds[0],
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
        metric_ids: metricIds,
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
      const evidenceRef = exactlyOne(
        execution.evidence_refs,
        "FALCON24_ANALYSIS_DERIVED_EVIDENCE_REF_REQUIRED",
      );
      if (evidenceRef.artifact_type !== "DerivedAnalysisEvidence") {
        throw new TypeError("FALCON24_ANALYSIS_DERIVED_EVIDENCE_REF_INVALID");
      }
      if (execution.query_evidence_refs.length === 0) {
        throw new TypeError("FALCON24_ANALYSIS_QUERY_EVIDENCE_REFS_REQUIRED");
      }
      const oracleReceipt = exactlyOne(
        execution.oracle_receipts,
        "FALCON24_ANALYSIS_ORACLE_RECEIPT_REQUIRED",
      ) as { readonly chart_dataset_hash?: string; readonly output_hash?: string };
      const outputHash = await sha256ContentHash(validated.output);
      if (oracleReceipt.output_hash !== outputHash || !oracleReceipt.chart_dataset_hash) {
        throw new TypeError("FALCON24_ANALYSIS_ORACLE_OUTPUT_BINDING_INVALID");
      }
      const sandboxReceipt = exactlyOne(
        execution.sandbox_receipts,
        "FALCON24_ANALYSIS_SANDBOX_RECEIPT_REQUIRED",
      );
      const chartDocument = await buildArtifactWorkspaceChartDocumentV3({
        schema_version: "artifact-workspace-chart-document@3.0.0",
        document_ref: {
          artifact_id: deterministicAnalysisUuid(
            `falcon24-analysis-chart\0${command.lease.run_id}\0${command.test_case.case_id}`,
          ),
          artifact_type: "ArtifactWorkspaceDocument",
          ...command.lease.scope,
          run_id: command.lease.run_id,
          revision: 1,
          content_hash: `sha256:${"0".repeat(64)}`,
        },
        source_refs: {
          query_evidence_refs: execution.query_evidence_refs,
          derived_evidence_ref: evidenceRef,
        },
        provenance: {
          transform_version: "derived-analysis-chart@1.0.0",
          dataset_hash: `sha256:${"0".repeat(64)}`,
          semantic_context: {
            package_id: command.semantic_context.package.package_id,
            package_hash: command.semantic_context.package.package_hash,
            receipt_id: command.semantic_context.receipt.receipt_id,
            receipt_hash: command.semantic_context.receipt.receipt_hash,
          },
          algorithm_version: FALCON24_ANALYSIS_CHART_VERSION,
          parameter_hash: await sha256ContentHash({
            case_id: command.test_case.case_id,
            chart_version: FALCON24_ANALYSIS_CHART_VERSION,
          }),
          input_closure_hash: await sha256ContentHash({
            output_ref: validated.output_ref,
            output_hash: outputHash,
            query_evidence_refs: execution.query_evidence_refs,
            derived_evidence_ref: evidenceRef,
          }),
          runtime_profile: sandboxReceipt.runtime_profile,
          agent_image: sandboxReceipt.runtime.agent_image,
          operator_image: sandboxReceipt.runtime.operator_image,
        },
        projection: buildFalcon24AnalysisChartProjection(validated.output),
      });
      if (chartDocument.provenance.dataset_hash !== oracleReceipt.chart_dataset_hash) {
        throw new TypeError("FALCON24_ANALYSIS_CHART_ORACLE_BINDING_INVALID");
      }
      const chartRef = portValue(
        await input.public_artifacts.commitDerivedAnalysisChart(
          input.public_artifact_capability,
          command.lease,
          chartDocument,
        ),
      );
      if (
        artifactReferenceIdentity(chartRef) !==
        artifactReferenceIdentity(chartDocument.document_ref)
      ) {
        throw new TypeError("FALCON24_ANALYSIS_CHART_COMMIT_CORRELATION_INVALID");
      }
      await input.acceptance_recorder?.record({
        test_case: command.test_case,
        semantic_context_ref: {
          package_id: command.semantic_context.package.package_id,
          package_revision: 1,
          package_hash: command.semantic_context.package.package_hash as `sha256:${string}`,
        },
        execution,
        chart_ref: chartRef,
        completed_at: new Date().toISOString(),
      });
      const acceptedArtifactRefs = [
        briefRef,
        execution.analysis_program_ref,
        ...execution.evidence_refs,
        validated.output_ref,
        chartRef,
        execution.completion_ref,
      ];
      const seen = new Set<string>();
      return {
        answer: `${validated.output.conclusion}\n\n[查看对应图表](${artifactMarkdownHref(chartRef)})`,
        public_artifact_refs: [chartRef],
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
  artifactMarkdownHref,
  buildBrief,
  decodeValidatedOutput,
});
