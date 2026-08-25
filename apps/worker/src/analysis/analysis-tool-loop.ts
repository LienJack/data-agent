import { createHash } from "node:crypto";
import type { AnalysisResultContract, ArtifactReference } from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import {
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_RESULT_PUBLISH_TOOL_NAME,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  type AnalysisCellObservation,
  type AnalysisOperatorFinalizationResult,
  type AnalysisStatisticalOperatorObservation,
  type AnalysisToolCallCandidate,
  analysisCellObservationSchema,
  analysisOperatorFinalizationResultSchema,
  analysisStatisticalOperatorObservationSchema,
  type ModelProviderRequest,
  statisticalOperatorExecutionEvidenceSchema,
} from "@data-agent/contracts/ports";
import {
  type GeneratedAnalysisSourcePolicy,
  STATISTICAL_OPERATOR_MANIFEST,
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  type StatisticalOperatorObligation,
  statisticalOperatorObligationSchema,
} from "@data-agent/contracts/statistical-operators";
import { z } from "zod";
import {
  type AnalysisSandboxProfile,
  AnalysisSandboxRuntimeError,
  type OpenSandboxAnalysisSession,
} from "../runs/opensandbox-analysis-runtime.js";
import type {
  AnalysisAgentModelPort,
  AnalysisAgentModelTurnResult,
  AnalysisToolValidationIssue,
} from "./deepseek-analysis-agent.js";
import type { ProviderInvocationResourceRef } from "./executor.js";
import type {
  GovernedResultBridge,
  RecoveredGovernedOperatorResult,
} from "./governed-result-bridge.js";
import { createOpenSandboxAnalysisResultSymbolExtractor } from "./opensandbox-result-symbol-extractor.js";
import {
  type AnalysisResultAtomicStagePort,
  type PublishedAnalysisResult,
  prepareAnalysisResult,
  stagePreparedAnalysisResult,
} from "./result-publisher.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const operatorToolResultSchema = z.strictObject({
  schema_version: z.literal("statistical-operator-tool-result@1.0.0"),
  call_id: z.string().min(1).max(128),
  operator_id: z.string().min(1).max(128),
  operator_registry_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  output: z.json(),
  execution_evidence: statisticalOperatorExecutionEvidenceSchema,
});
const statisticalOperatorRequestDocumentSchema = z.strictObject({
  schema_version: z.literal("statistical-operator-tool-call@1.0.0"),
  call_id: z.string().min(1).max(128),
  operator_id: z.string().min(1).max(128),
  operator_registry_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  runtime_profile: z.enum(["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]),
  obligation: statisticalOperatorObligationSchema,
  inputs: z.record(z.string(), z.json()),
  parameters: z.record(z.string(), z.json()),
});
const governedOperatorReceiptPayloadSchema = z.strictObject({
  schema_version: z.literal("governed-operator-result-receipt@1.0.0"),
  call_id: z.string().min(1).max(128),
  operator_id: z.string().min(1).max(128),
  request_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  result_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  execution_evidence: statisticalOperatorExecutionEvidenceSchema,
});

export type AnalysisToolLoopState =
  | "ANALYZE"
  | "OPERATOR_INTENT"
  | "OPERATOR_RESULT_COMMITTED"
  | "RESULT_BOUND"
  | "OPERATORS_CLOSED"
  | "PUBLISH_REQUIRED"
  | "PUBLISH_STAGED";

export type AnalysisToolRepairCategory =
  | "MODEL_TOOL_CONTRACT"
  | "CELL_EXECUTION"
  | "CELL_POLICY"
  | "PUBLISH_SYMBOL_CONTRACT";

type AnalysisToolName = AnalysisToolCallCandidate["tool_name"];

export interface AnalysisExecutedCell {
  readonly cell_id: string;
  readonly source: string;
  readonly source_sha256: `sha256:${string}`;
  readonly source_ref: ArtifactReference | null;
  readonly observation: AnalysisCellObservation;
}

/** Extracts server-declared operator argument symbols outside model tokens. */
export interface AnalysisOperatorArgumentExtractorPort {
  extract(input: { readonly inputs_symbol: string; readonly parameters_symbol: string }): Promise<{
    readonly inputs: Readonly<Record<string, unknown>>;
    readonly parameters: Readonly<Record<string, unknown>>;
  }>;
}

export interface AnalysisToolLoopResult {
  readonly published_result: PublishedAnalysisResult;
  readonly cells: readonly AnalysisExecutedCell[];
  readonly operator_observations: readonly AnalysisStatisticalOperatorObservation[];
  readonly operator_finalization: AnalysisOperatorFinalizationResult;
  readonly provider_invocation_refs: readonly ProviderInvocationResourceRef[];
  readonly state_sequence: readonly AnalysisToolLoopState[];
  readonly repair_attempts: Readonly<Record<AnalysisToolRepairCategory, 0 | 1>>;
}

export interface AnalysisToolLoopProgressEvent {
  readonly event_name: "analysis_tool_progress";
  readonly run_id: string;
  readonly node_id: string;
  readonly turn_index: number;
  readonly state: AnalysisToolLoopState;
  readonly state_sequence: readonly AnalysisToolLoopState[];
  readonly tool_name: AnalysisToolName | "model_tool_call" | "state_machine";
  readonly outcome:
    | "STATE_TRANSITION"
    | "CELL_SUCCEEDED"
    | "CELL_FAILED"
    | "CELL_POLICY_REJECTED"
    | "CELL_DUPLICATE_REJECTED"
    | "OPERATOR_SUCCEEDED"
    | "OPERATOR_RESULT_COMMITTED"
    | "RESULT_BOUND"
    | "OPERATOR_NOT_AUTHORIZED"
    | "PUBLISH_REJECTED"
    | "PUBLISH_STAGED"
    | "MODEL_TOOL_CALL_REJECTED"
    | "TOOL_STATE_REJECTED"
    | "REPEATED_TOOL_REJECTED"
    | "EXPLANATION_ACCEPTED";
  readonly completed_operator_calls: number;
  readonly total_operator_calls: number;
  readonly successful_python_cells: number;
  readonly repair_category: AnalysisToolRepairCategory | null;
  readonly repair_attempts: Readonly<Record<AnalysisToolRepairCategory, 0 | 1>>;
  readonly failure_code: string | null;
  readonly tool_validation_issues: readonly AnalysisToolValidationIssue[];
  readonly cell_error_name: string | null;
  readonly cell_error_identifier: string | null;
  readonly policy_violation_codes: readonly string[];
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function failedCellObservation(input: {
  readonly cell_id: string;
  readonly code: string;
  readonly value: string;
}): AnalysisCellObservation {
  return analysisCellObservationSchema.parse({
    schema_version: "analysis-cell-observation@1.0.0",
    cell_id: input.cell_id,
    status: "FAILED",
    execution_id: null,
    execution_count: null,
    elapsed_ms: 0,
    stdout: "",
    stderr: "",
    result_text: null,
    error: { name: input.code, value: input.value },
  });
}

function runtimeCellObservation(
  observation: Awaited<ReturnType<OpenSandboxAnalysisSession["runAgentCell"]>>,
): AnalysisCellObservation {
  return analysisCellObservationSchema.parse({
    schema_version: "analysis-cell-observation@1.0.0",
    ...observation,
  });
}

function safeCellFailureCode(observation: AnalysisCellObservation): string {
  const name = observation.error?.name ?? "";
  if (name === "SyntaxError" || name === "IndentationError") return "ANALYSIS_CELL_SYNTAX_ERROR";
  if (name === "ImportError" || name === "ModuleNotFoundError") {
    return "ANALYSIS_CELL_IMPORT_ERROR";
  }
  if (name === "MemoryError") return "ANALYSIS_CELL_MEMORY_ERROR";
  if (name === "ANALYSIS_SANDBOX_CELL_TIMEOUT") return "ANALYSIS_CELL_TIMEOUT";
  if (name.startsWith("ANALYSIS_")) return "ANALYSIS_CELL_CONTRACT_ERROR";
  return "ANALYSIS_CELL_RUNTIME_ERROR";
}

function safeCellErrorName(observation: AnalysisCellObservation): string | null {
  const name = observation.error?.name ?? "";
  return /^[A-Za-z][A-Za-z0-9_.]{0,127}$/u.test(name) ? name : null;
}

function safeCellErrorIdentifier(observation: AnalysisCellObservation): string | null {
  const value = observation.error?.value.trim() ?? "";
  const boundedCode = value.match(/^([A-Z][A-Z0-9_]{2,127})$/u)?.[1];
  if (boundedCode) return boundedCode;
  const direct = value.match(/^['"]([A-Za-z_][A-Za-z0-9_.-]{0,127})['"]$/u)?.[1];
  if (direct) return direct;
  const missingAttribute = value.match(
    /^['"][A-Za-z_][A-Za-z0-9_.-]{0,127}['"] object has no attribute ['"]([A-Za-z_][A-Za-z0-9_.-]{0,127})['"]$/u,
  )?.[1];
  if (missingAttribute) return missingAttribute;
  const undefinedName = value.match(
    /^name ['"]([A-Za-z_][A-Za-z0-9_]{0,127})['"] is not defined$/u,
  )?.[1];
  return undefinedName ?? null;
}

const policyIdentifierCodes = new Set([
  "IMPORT_DENIED",
  "NAME_DENIED",
  "CALL_DENIED",
  "PRIVATE_ATTRIBUTE_DENIED",
  "ATTRIBUTE_ROOT_DENIED",
]);

function safePolicyViolationIdentifier(input: {
  readonly code: string;
  readonly detail: string;
}): string | null {
  if (!policyIdentifierCodes.has(input.code) || input.detail.length > 256) return null;
  return /^[A-Za-z_][A-Za-z0-9_.]*(?:,[A-Za-z_][A-Za-z0-9_.]*)*$/u.test(input.detail)
    ? input.detail
    : null;
}

function cellRepairInstruction(observation: AnalysisCellObservation): string {
  if (observation.error?.name === "KeyError") {
    return "Submit changed source. Use only exact field names from inputs[].fields in the initial governed context. Do not inspect runtime state with reflection, denied imports, or file reads. The server will assign a fresh Cell identity.";
  }
  if (observation.error?.name === "ZeroDivisionError") {
    return "Submit changed source. Guard every denominator explicitly; preserve undefined ratios as null/NaN and never invent a numeric value. The server will assign a fresh Cell identity.";
  }
  if (observation.error?.name === "AssertionError") {
    return "Submit changed source that corrects the invariant named by error_identifier without weakening or deleting the governed assertion. Use only the initial schemas and governed analysis contract. The server will assign a fresh Cell identity.";
  }
  return "Submit changed source that repairs this failure against the initial governed input schemas without reflection, denied imports, file reads, or authority expansion. The server will assign a fresh Cell identity.";
}

function serverToolMessage(input: {
  readonly call: AnalysisAgentModelTurnResult & { readonly phase: "TOOL" };
  readonly result: unknown;
  readonly is_error: boolean;
}): ModelProviderRequest["messages"][number][] {
  return [
    {
      role: "assistant",
      content: JSON.stringify({
        kind: "TOOL_CALL_CANDIDATE",
        tool_call_id: input.call.tool_call.tool_call_id,
        tool_name: input.call.tool_call.tool_name,
        arguments: input.call.tool_call.arguments,
      }),
    },
    {
      role: "user",
      content: JSON.stringify({
        kind: "SERVER_TOOL_RESULT",
        tool_call_id: input.call.tool_call.tool_call_id,
        tool_name: input.call.tool_call.tool_name,
        result: input.result,
        is_error: input.is_error,
      }),
    },
  ];
}

function safeCellProjection(
  observation: AnalysisCellObservation,
): Readonly<Record<string, unknown>> {
  return {
    schema_version: observation.schema_version,
    cell_id: observation.cell_id,
    status: observation.status,
    execution_id: observation.execution_id,
    execution_count: observation.execution_count,
    elapsed_ms: observation.elapsed_ms,
    error_code: observation.error ? safeCellFailureCode(observation) : null,
    error_name: safeCellErrorName(observation),
    error_identifier: safeCellErrorIdentifier(observation),
  };
}

function candidateSignature(candidate: AnalysisToolCallCandidate): `sha256:${string}` {
  const material =
    candidate.tool_name === ANALYSIS_PYTHON_CELL_TOOL_NAME
      ? {
          tool_name: candidate.tool_name,
          source: candidate.arguments.source,
          timeout_ms: candidate.arguments.timeout_ms,
        }
      : { tool_name: candidate.tool_name, arguments: candidate.arguments };
  return sha256(encoder.encode(JSON.stringify(material)));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultDocument(published: {
  readonly closure: PublishedAnalysisResult["closure"];
}): Readonly<Record<string, unknown>> {
  const artifact = published.closure.artifacts.find(
    ({ artifact_kind }) => artifact_kind === "RESULT",
  );
  if (!artifact) throw new TypeError("ANALYSIS_RESULT_PUBLISHED_DOCUMENT_MISSING");
  const document = JSON.parse(decoder.decode(artifact.content)) as unknown;
  if (!isRecord(document) || !isRecord(document.data)) {
    throw new TypeError("ANALYSIS_RESULT_PUBLISHED_DOCUMENT_INVALID");
  }
  return document.data;
}

function governedResultModelProjection(
  observation: AnalysisStatisticalOperatorObservation,
  obligation: StatisticalOperatorObligation,
) {
  if (
    observation.call_id !== obligation.call_id ||
    observation.operator_id !== obligation.operator_id
  ) {
    throw new TypeError("ANALYSIS_OPERATOR_PROJECTION_IDENTITY_MISMATCH");
  }
  const operator = STATISTICAL_OPERATOR_MANIFEST.operators.find(
    ({ operator_id: operatorId }) => operatorId === obligation.operator_id,
  );
  if (!operator) throw new TypeError("ANALYSIS_OPERATOR_PROJECTION_MANIFEST_MISSING");
  const collection = operator.outputs.collection;
  return Object.freeze({
    schema_version: observation.schema_version,
    status: "BOUND" as const,
    call_id: observation.call_id,
    operator_id: observation.operator_id,
    result_symbol: observation.binding.result_symbol,
    result_sha256: observation.binding.result_sha256,
    shape: observation.governed_result.shape,
    receipt_ref: observation.governed_result.receipt_ref,
    journal_seq: observation.binding.journal_seq,
    consumption_contract: Object.freeze({
      protected_symbol: observation.binding.result_symbol,
      collection,
      collection_expression: `${observation.binding.result_symbol}[${JSON.stringify(collection)}]`,
      row_required_fields: Object.freeze([
        ...operator.outputs.label_fields,
        ...operator.outputs.value_fields,
        ...operator.outputs.evidence_fields,
      ]),
      result_binding: obligation.result_binding,
      instruction:
        "Read this exact protected symbol and collection expression in the next Python Cell. Do not invent, copy, overwrite, print, or probe another result variable.",
    }),
  });
}

function recoverOperatorState(input: {
  readonly recovered: readonly RecoveredGovernedOperatorResult[];
  readonly obligations: readonly StatisticalOperatorObligation[];
  readonly runtime_profile: AnalysisSandboxProfile;
}): {
  readonly requests: readonly z.infer<typeof statisticalOperatorRequestDocumentSchema>[];
  readonly observations: readonly AnalysisStatisticalOperatorObservation[];
} {
  if (input.recovered.length > input.obligations.length) {
    throw new TypeError("ANALYSIS_OPERATOR_RECOVERY_CARDINALITY_INVALID");
  }
  const requests = [];
  const observations = [];
  for (const [index, recovered] of input.recovered.entries()) {
    let request: z.infer<typeof statisticalOperatorRequestDocumentSchema>;
    try {
      request = statisticalOperatorRequestDocumentSchema.parse(
        JSON.parse(decoder.decode(recovered.request_content)),
      );
    } catch {
      throw new TypeError("ANALYSIS_OPERATOR_RECOVERY_REQUEST_INVALID");
    }
    const obligation = input.obligations[index];
    const receipt = governedOperatorReceiptPayloadSchema.safeParse(recovered.receipt_payload);
    if (
      !obligation ||
      request.call_id !== obligation.call_id ||
      request.operator_id !== obligation.operator_id ||
      canonicalizeJson(request.obligation) !== canonicalizeJson(obligation) ||
      request.runtime_profile !== input.runtime_profile ||
      request.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
      sha256(recovered.request_content) !== recovered.result.request_sha256 ||
      recovered.result.call_id !== request.call_id ||
      recovered.result.operator_id !== request.operator_id ||
      recovered.binding.result_sha256 !== recovered.result.result_sha256 ||
      !receipt.success ||
      receipt.data.call_id !== request.call_id ||
      receipt.data.operator_id !== request.operator_id ||
      receipt.data.request_sha256 !== recovered.result.request_sha256 ||
      receipt.data.result_sha256 !== recovered.result.result_sha256 ||
      receipt.data.execution_evidence.operator_registry_digest !==
        STATISTICAL_OPERATOR_REGISTRY_DIGEST
    ) {
      throw new TypeError("ANALYSIS_OPERATOR_RECOVERY_IDENTITY_MISMATCH");
    }
    requests.push(request);
    observations.push(
      analysisStatisticalOperatorObservationSchema.parse({
        schema_version: "analysis-statistical-operator-observation@1.0.0",
        call_id: request.call_id,
        operator_id: request.operator_id,
        operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
        status: "SUCCEEDED",
        execution_evidence: receipt.data.execution_evidence,
        governed_result: recovered.result,
        binding: recovered.binding,
      }),
    );
  }
  return Object.freeze({
    requests: Object.freeze(requests),
    observations: Object.freeze(observations),
  });
}

const repairablePublishCodes = new Set([
  "ANALYSIS_RESULT_INTEGER_UNSAFE",
  "ANALYSIS_RESULT_OBJECT_KEY_DUPLICATE",
  "ANALYSIS_RESULT_NULLABILITY_MISMATCH",
  "ANALYSIS_RESULT_VALUE_TYPE_MISMATCH",
  "ANALYSIS_RESULT_TEXT_POLICY_MISMATCH",
  "ANALYSIS_RESULT_COLLECTION_SHAPE_MISMATCH",
  "ANALYSIS_RESULT_COLLECTION_PREDICATE_VALUE_INVALID",
  "ANALYSIS_RESULT_COLLECTION_PREDICATE_MISMATCH",
  "ANALYSIS_RESULT_PUBLISH_CONTRACT_CLOSURE_MISMATCH",
  "ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_MISMATCH",
  "ANALYSIS_RESULT_PUBLISH_CHART_BINDING_MISMATCH",
  "ANALYSIS_RESULT_SYMBOL_EXTRACTION_SIZE_EXCEEDED",
  "ANALYSIS_RESULT_SYMBOL_EXTRACTION_MISMATCH",
  "ANALYSIS_RESULT_DOCUMENT_SYMBOL_INVALID",
  "ANALYSIS_RESULT_DOCUMENT_INVALID",
  "ANALYSIS_RESULT_FIELD_SET_MISMATCH",
  "ANALYSIS_RESULT_DOCUMENT_SIZE_EXCEEDED",
  "ANALYSIS_RESULT_PUBLISH_OPERATOR_VALUE_MISMATCH",
  "ANALYSIS_RESULT_TABLE_BOUNDS_OR_SCHEMA_INVALID",
  "ANALYSIS_RESULT_TABLE_COLUMNS_MISMATCH",
  "ANALYSIS_RESULT_TABLE_SCHEMA_INVALID",
  "ANALYSIS_RESULT_TABLE_BINDING_INVALID",
  "ANALYSIS_RESULT_TABLE_PROJECTION_SOURCE_INVALID",
  "ANALYSIS_RESULT_TABLE_PROJECTION_MISMATCH",
  "ANALYSIS_RESULT_CHART_SOURCE_INVALID",
  "ANALYSIS_RESULT_CHART_FIELD_BINDING_INVALID",
  "ANALYSIS_RESULT_CLOSURE_SIZE_EXCEEDED",
]);

type PublishRepairContract = Readonly<{
  result_fields: readonly Readonly<{
    field: string;
    text_constraints?:
      | Readonly<{
          required_substrings: readonly string[];
          forbidden_substrings: readonly string[];
          required_suffix: string | null;
        }>
      | undefined;
  }>[];
}>;

function publishRepairInstruction(code: string, contract: PublishRepairContract): string {
  if (code !== "ANALYSIS_RESULT_TEXT_POLICY_MISMATCH") {
    return "Repair only the referenced Python symbols or publish bindings.";
  }
  const constrained = contract.result_fields.flatMap((field) =>
    field.text_constraints ? [{ field: field.field, ...field.text_constraints }] : [],
  );
  if (constrained.length === 0) {
    return "Rewrite only the constrained result text and preserve all analytical values.";
  }
  return [
    "Rewrite only the constrained result text; preserve all analytical values.",
    `Exact text constraints: ${JSON.stringify(constrained)}.`,
    "Forbidden substrings are forbidden even inside negations.",
  ].join(" ");
}

function repairablePublishFailureCode(error: unknown): string | null {
  if (
    error instanceof AnalysisSandboxRuntimeError &&
    error.code === "ANALYSIS_SANDBOX_SYMBOL_EXTRACTION_REJECTED"
  ) {
    return error.reason_code;
  }
  if (
    error instanceof AnalysisSandboxRuntimeError &&
    error.code === "ANALYSIS_SANDBOX_CELL_FAILED"
  ) {
    return "ANALYSIS_RESULT_SYMBOL_CONTRACT_INVALID";
  }
  if (error instanceof TypeError && repairablePublishCodes.has(error.message)) {
    return error.message;
  }
  return null;
}

function allowedTools(input: {
  readonly state: AnalysisToolLoopState;
  readonly next_obligation: StatisticalOperatorObligation | undefined;
  readonly successful_python_cells: number;
}): readonly AnalysisToolName[] {
  if (input.state === "ANALYZE") {
    return input.next_obligation
      ? [ANALYSIS_PYTHON_CELL_TOOL_NAME, ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME]
      : [ANALYSIS_PYTHON_CELL_TOOL_NAME];
  }
  if (input.state === "PUBLISH_REQUIRED") {
    return input.successful_python_cells > 0
      ? [ANALYSIS_PYTHON_CELL_TOOL_NAME, ANALYSIS_RESULT_PUBLISH_TOOL_NAME]
      : [ANALYSIS_PYTHON_CELL_TOOL_NAME];
  }
  return [];
}

function modelToolArgumentContracts(
  allowedToolNames: readonly AnalysisToolName[],
  nextObligation: StatisticalOperatorObligation | undefined,
) {
  return allowedToolNames.map((toolName) => {
    if (toolName === ANALYSIS_PYTHON_CELL_TOOL_NAME) {
      return {
        tool_name: toolName,
        allowed_fields_exact: ["source", "timeout_ms"],
        forbidden_server_fields: ["schema_version", "cell_id"],
      };
    }
    if (toolName === ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME) {
      return {
        tool_name: toolName,
        allowed_fields_exact: ["call_id", "operator_id"],
        arguments_exact: nextObligation
          ? {
              call_id: nextObligation.call_id,
              operator_id: nextObligation.operator_id,
            }
          : null,
        forbidden_server_fields: ["schema_version", "inputs_symbol", "parameters_symbol"],
      };
    }
    return {
      tool_name: toolName,
      allowed_fields_exact: [
        "publish_id",
        "result_symbol",
        "table_bindings",
        "chart_bindings",
        "operator_bindings",
      ],
      forbidden_server_fields: [
        "schema_version",
        "chart_bindings[].intent",
        "chart_bindings[].template_id",
        "chart_bindings[].data_symbol",
      ],
    };
  });
}

export async function executeAnalysisToolLoop(input: {
  readonly run_id: string;
  readonly analysis_program_id: string;
  readonly node_id: string;
  readonly generated_source_policy: Exclude<GeneratedAnalysisSourcePolicy, "NO_GENERATED_SOURCE">;
  readonly runtime_profile: AnalysisSandboxProfile;
  readonly result_contract: AnalysisResultContract;
  readonly operator_obligations: readonly StatisticalOperatorObligation[];
  readonly operator_argument_extractor: AnalysisOperatorArgumentExtractorPort;
  readonly governed_result_bridge: GovernedResultBridge;
  readonly recovered_operator_results?: readonly RecoveredGovernedOperatorResult[];
  readonly stage: AnalysisResultAtomicStagePort;
  readonly initial_messages: ModelProviderRequest["messages"];
  readonly model: AnalysisAgentModelPort;
  readonly session: OpenSandboxAnalysisSession;
  readonly max_tool_turns: number;
  readonly max_output_tokens: number;
  readonly on_progress?: (event: AnalysisToolLoopProgressEvent) => void;
  readonly signal?: AbortSignal;
}): Promise<AnalysisToolLoopResult> {
  if (
    input.max_tool_turns < 1 ||
    input.max_tool_turns > 32 ||
    (input.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION") !==
      input.operator_obligations.length > 0
  ) {
    throw new TypeError("ANALYSIS_AGENT_LOOP_CONFIGURATION_INVALID");
  }

  const recoveredState = recoverOperatorState({
    recovered: input.recovered_operator_results ?? [],
    obligations: input.operator_obligations,
    runtime_profile: input.runtime_profile,
  });
  const cells: AnalysisExecutedCell[] = [];
  const operatorObservations: AnalysisStatisticalOperatorObservation[] = [
    ...recoveredState.observations,
  ];
  const operatorRequests: unknown[] = [...recoveredState.requests];
  const providerInvocationRefs: ProviderInvocationResourceRef[] = [];
  const seenCellIds = new Set<string>();
  const signatureProgress = new Map<string, number>();
  const successfulSignatures = new Set<string>();
  const messages = [...input.initial_messages];
  const repairs: Record<AnalysisToolRepairCategory, 0 | 1> = {
    MODEL_TOOL_CONTRACT: 0,
    CELL_EXECUTION: 0,
    CELL_POLICY: 0,
    PUBLISH_SYMBOL_CONTRACT: 0,
  };
  const stateSequence: AnalysisToolLoopState[] = ["ANALYZE"];
  let state: AnalysisToolLoopState = "ANALYZE";
  let successfulPythonCells = 0;
  let progressEpoch = 0;
  let publishedResult: PublishedAnalysisResult | null = null;
  let operatorFinalization: AnalysisOperatorFinalizationResult | null = null;
  const currentState = (): AnalysisToolLoopState => state;

  if (operatorObservations.length > 0) {
    messages.push({
      role: "user",
      content: JSON.stringify({
        kind: "SERVER_RECOVERED_GOVERNED_RESULTS",
        results: operatorObservations.map((observation, index) => {
          const obligation = input.operator_obligations[index];
          if (!obligation) throw new TypeError("ANALYSIS_OPERATOR_RECOVERY_CARDINALITY_INVALID");
          return governedResultModelProjection(observation, obligation);
        }),
        instruction:
          "These governed results were verified and rebound by the server. Reuse the listed symbols; do not invoke their operators again.",
      }),
    });
  }

  const snapshotRepairs = () => Object.freeze({ ...repairs });
  const progress = (
    turnIndex: number,
    toolName: AnalysisToolLoopProgressEvent["tool_name"],
    outcome: AnalysisToolLoopProgressEvent["outcome"],
    options: {
      readonly repair_category?: AnalysisToolRepairCategory;
      readonly failure_code?: string;
      readonly tool_validation_issues?: readonly AnalysisToolValidationIssue[];
      readonly cell_error_name?: string | null;
      readonly cell_error_identifier?: string | null;
      readonly policy_violation_codes?: readonly string[];
    } = {},
  ) => {
    input.on_progress?.(
      Object.freeze({
        event_name: "analysis_tool_progress" as const,
        run_id: input.run_id,
        node_id: input.node_id,
        turn_index: turnIndex,
        state,
        state_sequence: Object.freeze([...stateSequence]),
        tool_name: toolName,
        outcome,
        completed_operator_calls: operatorRequests.length,
        total_operator_calls: input.operator_obligations.length,
        successful_python_cells: successfulPythonCells,
        repair_category: options.repair_category ?? null,
        repair_attempts: snapshotRepairs(),
        failure_code: options.failure_code ?? null,
        tool_validation_issues: Object.freeze([...(options.tool_validation_issues ?? [])]),
        cell_error_name: options.cell_error_name ?? null,
        cell_error_identifier: options.cell_error_identifier ?? null,
        policy_violation_codes: Object.freeze([...(options.policy_violation_codes ?? [])]),
      }),
    );
  };
  const transition = (next: AnalysisToolLoopState, turnIndex: number) => {
    state = next;
    stateSequence.push(next);
    progress(turnIndex, "state_machine", "STATE_TRANSITION");
  };
  const closeOperators = (turnIndex: number) => {
    if (state === "ANALYZE" && operatorRequests.length === input.operator_obligations.length) {
      transition("OPERATORS_CLOSED", turnIndex);
      transition("PUBLISH_REQUIRED", turnIndex);
    }
  };
  const repair = (
    category: AnalysisToolRepairCategory,
    code: string,
    turnIndex: number,
    toolName: AnalysisToolLoopProgressEvent["tool_name"],
    outcome: AnalysisToolLoopProgressEvent["outcome"],
    diagnostics: {
      readonly tool_validation_issues?: readonly AnalysisToolValidationIssue[];
      readonly cell_error_name?: string | null;
      readonly cell_error_identifier?: string | null;
      readonly policy_violation_codes?: readonly string[];
    } = {},
  ) => {
    if (repairs[category] === 1) {
      progress(turnIndex, toolName, outcome, {
        repair_category: category,
        failure_code: code,
        ...diagnostics,
      });
      throw new TypeError(`ANALYSIS_AGENT_REPAIR_BUDGET_EXHAUSTED_${category}`);
    }
    repairs[category] = 1;
    progress(turnIndex, toolName, outcome, {
      repair_category: category,
      failure_code: code,
      ...diagnostics,
    });
  };

  closeOperators(0);
  for (let turnIndex = 0; turnIndex < input.max_tool_turns; turnIndex += 1) {
    if (input.signal?.aborted) throw new TypeError("ANALYSIS_SANDBOX_CELL_CANCELLED");
    if (currentState() === "PUBLISH_STAGED") {
      break;
    }

    const nextObligation = input.operator_obligations[operatorRequests.length];
    const allowedToolNames = allowedTools({
      state: currentState(),
      next_obligation: nextObligation,
      successful_python_cells: successfulPythonCells,
    });
    messages.push({
      role: "user",
      content: JSON.stringify({
        kind: "SERVER_ANALYSIS_STATE",
        state: currentState(),
        turn_index: turnIndex,
        allowed_tool_names: allowedToolNames,
        tool_argument_contracts: modelToolArgumentContracts(allowedToolNames, nextObligation),
        next_operator_obligation: nextObligation
          ? { call_id: nextObligation.call_id, operator_id: nextObligation.operator_id }
          : null,
        successful_python_cells: successfulPythonCells,
        instruction:
          currentState() === "ANALYZE"
            ? "Run a material Python transformation or invoke exactly the next governed operator. Keep final data in named Python symbols."
            : successfulPythonCells === 0
              ? "Run a material Python Cell that creates the result and table symbols. Final serialization and paths are server-owned."
              : "Run any required final Python transformation, then call publish_analysis_result exactly once with symbol and chart bindings.",
      }),
    });
    const turn = await input.model.turn({
      run_id: input.run_id,
      analysis_program_id: input.analysis_program_id,
      node_id: input.node_id,
      turn_index: turnIndex,
      phase: "TOOL",
      result_contract: input.result_contract,
      allowed_tool_names: allowedToolNames,
      messages,
      max_output_tokens: input.max_output_tokens,
    });
    providerInvocationRefs.push(turn.provider_invocation_ref);

    if (turn.phase === "INVALID_TOOL") {
      messages.push(
        { role: "assistant", content: JSON.stringify({ kind: "TOOL_CALL_REJECTED" }) },
        {
          role: "user",
          content: JSON.stringify({
            kind: "SERVER_TOOL_RESULT",
            is_error: true,
            code: turn.error_code,
            validation_issues: turn.validation_issues,
            instruction:
              "Repair exactly once using one currently allowed strict tool. Remove every unrecognized identifier and supply only the declared tool arguments.",
          }),
        },
      );
      repair(
        "MODEL_TOOL_CONTRACT",
        turn.error_code,
        turnIndex,
        "model_tool_call",
        "MODEL_TOOL_CALL_REJECTED",
        { tool_validation_issues: turn.validation_issues },
      );
      continue;
    }
    if (turn.phase !== "TOOL") throw new TypeError("ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID");
    const candidate = turn.tool_call;
    const signature = candidateSignature(candidate);
    if (successfulSignatures.has(signature) || signatureProgress.get(signature) === progressEpoch) {
      messages.push(
        ...serverToolMessage({
          call: turn,
          result: {
            code: "ANALYSIS_AGENT_REPEATED_TOOL_CALL",
            instruction:
              "Do not repeat the same source or tool arguments. Use the declared schemas and symbol contracts directly; submit materially changed source or the allowed completion tool.",
          },
          is_error: true,
        }),
      );
      repair(
        "MODEL_TOOL_CONTRACT",
        "ANALYSIS_AGENT_REPEATED_TOOL_CALL",
        turnIndex,
        candidate.tool_name,
        "REPEATED_TOOL_REJECTED",
      );
      continue;
    }
    signatureProgress.set(signature, progressEpoch);

    if (!allowedToolNames.includes(candidate.tool_name)) {
      const code =
        candidate.tool_name === ANALYSIS_RESULT_PUBLISH_TOOL_NAME
          ? "ANALYSIS_AGENT_PUBLISH_NOT_READY"
          : "ANALYSIS_AGENT_TOOL_INVALID_FOR_STATE";
      messages.push(
        ...serverToolMessage({
          call: turn,
          result: { code, state: currentState(), allowed_tool_names: allowedToolNames },
          is_error: true,
        }),
      );
      repair("MODEL_TOOL_CONTRACT", code, turnIndex, candidate.tool_name, "TOOL_STATE_REJECTED");
      continue;
    }

    if (candidate.tool_name === ANALYSIS_PYTHON_CELL_TOOL_NAME) {
      const args = candidate.arguments;
      if (seenCellIds.has(args.cell_id)) {
        const observation = failedCellObservation({
          cell_id: args.cell_id,
          code: "ANALYSIS_CELL_ID_DUPLICATE",
          value: "Use a new cell id.",
        });
        messages.push(
          ...serverToolMessage({
            call: turn,
            result: safeCellProjection(observation),
            is_error: true,
          }),
        );
        repair(
          "MODEL_TOOL_CONTRACT",
          "ANALYSIS_CELL_ID_DUPLICATE",
          turnIndex,
          candidate.tool_name,
          "CELL_DUPLICATE_REJECTED",
        );
        continue;
      }
      seenCellIds.add(args.cell_id);
      const policy = await input.session.admitAgentCell({
        cell_id: args.cell_id,
        source: args.source,
        generated_source_policy: input.generated_source_policy,
        timeout_ms: Math.min(args.timeout_ms, 30_000),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (policy.status !== "ADMITTED") {
        const observation = failedCellObservation({
          cell_id: args.cell_id,
          code: "ANALYSIS_SANDBOX_CELL_POLICY_REJECTED",
          value: "The Cell violates the fixed sandbox policy.",
        });
        cells.push({
          cell_id: args.cell_id,
          source: args.source,
          source_sha256: sha256(encoder.encode(args.source)),
          source_ref: null,
          observation,
        });
        messages.push(
          ...serverToolMessage({
            call: turn,
            result: {
              ...safeCellProjection(observation),
              violation_codes: policy.violations.map(({ code }) => code),
              violations: policy.violations.map(({ code, line, detail }) => ({
                code,
                line,
                identifier: safePolicyViolationIdentifier({ code, detail }),
              })),
              instruction:
                "Remove the identified construct. Use the initial governed input symbols and declared fields directly; do not use reflection, denied imports, dynamic file access, or protected-binding mutation.",
            },
            is_error: true,
          }),
        );
        repair(
          "CELL_POLICY",
          "ANALYSIS_CELL_POLICY_REJECTED",
          turnIndex,
          candidate.tool_name,
          "CELL_POLICY_REJECTED",
          { policy_violation_codes: policy.violations.map(({ code }) => code) },
        );
        continue;
      }

      let observation: AnalysisCellObservation;
      try {
        observation = runtimeCellObservation(
          await input.session.runAgentCell({
            cell_id: args.cell_id,
            source: args.source,
            timeout_ms: args.timeout_ms,
            ...(input.signal ? { signal: input.signal } : {}),
          }),
        );
      } catch (error) {
        if (
          !(error instanceof AnalysisSandboxRuntimeError) ||
          error.code !== "ANALYSIS_SANDBOX_CELL_TIMEOUT"
        ) {
          throw error;
        }
        await input.governed_result_bridge.recover({
          session: input.session,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        observation = failedCellObservation({
          cell_id: args.cell_id,
          code: "ANALYSIS_SANDBOX_CELL_TIMEOUT",
          value: "The Context was rebuilt from previously successful Cells.",
        });
      }
      messages.push(
        ...serverToolMessage({
          call: turn,
          result:
            observation.status === "SUCCEEDED"
              ? safeCellProjection(observation)
              : {
                  ...safeCellProjection(observation),
                  instruction: cellRepairInstruction(observation),
                },
          is_error: observation.status !== "SUCCEEDED",
        }),
      );
      if (observation.status !== "SUCCEEDED") {
        cells.push({
          cell_id: args.cell_id,
          source: args.source,
          source_sha256: sha256(encoder.encode(args.source)),
          source_ref: null,
          observation,
        });
        repair(
          "CELL_EXECUTION",
          safeCellFailureCode(observation),
          turnIndex,
          candidate.tool_name,
          "CELL_FAILED",
          {
            cell_error_name: safeCellErrorName(observation),
            cell_error_identifier: safeCellErrorIdentifier(observation),
          },
        );
        continue;
      }
      const committedCell = await input.governed_result_bridge.recordModelCell({
        cell_id: args.cell_id,
        source: args.source,
        source_sha256: sha256(encoder.encode(args.source)),
        timeout_ms: Math.min(args.timeout_ms, 30_000),
        provider_invocation_ref: turn.provider_invocation_ref,
      });
      cells.push({
        cell_id: args.cell_id,
        source: args.source,
        source_sha256: sha256(encoder.encode(args.source)),
        source_ref: committedCell.source_ref,
        observation,
      });
      successfulPythonCells += 1;
      progressEpoch += 1;
      successfulSignatures.add(signature);
      progress(turnIndex, candidate.tool_name, "CELL_SUCCEEDED");
      continue;
    }

    if (candidate.tool_name === ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME) {
      const args = candidate.arguments;
      const obligation = input.operator_obligations[operatorRequests.length];
      if (
        !obligation ||
        obligation.call_id !== args.call_id ||
        obligation.operator_id !== args.operator_id
      ) {
        messages.push(
          ...serverToolMessage({
            call: turn,
            result: {
              schema_version: "analysis-statistical-operator-error@1.0.0",
              code: "ANALYSIS_OPERATOR_NOT_AUTHORIZED",
              expected: obligation
                ? { call_id: obligation.call_id, operator_id: obligation.operator_id }
                : null,
            },
            is_error: true,
          }),
        );
        repair(
          "MODEL_TOOL_CONTRACT",
          "ANALYSIS_OPERATOR_NOT_AUTHORIZED",
          turnIndex,
          candidate.tool_name,
          "OPERATOR_NOT_AUTHORIZED",
        );
        continue;
      }

      let extractedArguments: Awaited<ReturnType<AnalysisOperatorArgumentExtractorPort["extract"]>>;
      try {
        extractedArguments = await input.operator_argument_extractor.extract({
          inputs_symbol: args.inputs_symbol,
          parameters_symbol: args.parameters_symbol,
        });
      } catch (error) {
        if (
          !(error instanceof TypeError) ||
          !error.message.startsWith("ANALYSIS_OPERATOR_ARGUMENT_")
        ) {
          throw error;
        }
        messages.push(
          ...serverToolMessage({
            call: turn,
            result: { code: error.message },
            is_error: true,
          }),
        );
        repair("CELL_EXECUTION", error.message, turnIndex, candidate.tool_name, "CELL_FAILED");
        continue;
      }
      const requestDocument = {
        schema_version: "statistical-operator-tool-call@1.0.0",
        call_id: args.call_id,
        operator_id: args.operator_id,
        operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
        runtime_profile: input.runtime_profile,
        obligation,
        inputs: extractedArguments.inputs,
        parameters: extractedArguments.parameters,
      } as const;
      const request = encoder.encode(JSON.stringify(requestDocument));
      await input.governed_result_bridge.recordOperatorIntent({
        call_id: args.call_id,
        operator_id: args.operator_id,
        request_sha256: sha256(request),
      });
      transition("OPERATOR_INTENT", turnIndex);
      const runtimeResult = await input.session.runOperator({
        call_id: args.call_id,
        request,
        request_sha256: sha256(request),
        timeout_ms: 60_000,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (runtimeResult.status !== "SUCCEEDED" || runtimeResult.output === null) {
        throw new TypeError("ANALYSIS_SANDBOX_OPERATOR_FAILED");
      }
      let parsed: z.infer<typeof operatorToolResultSchema>;
      try {
        parsed = operatorToolResultSchema.parse(JSON.parse(decoder.decode(runtimeResult.output)));
      } catch {
        throw new TypeError("ANALYSIS_SANDBOX_OPERATOR_FAILED");
      }
      if (
        parsed.call_id !== args.call_id ||
        parsed.operator_id !== args.operator_id ||
        parsed.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST
      ) {
        throw new TypeError("ANALYSIS_SANDBOX_OPERATOR_CORRELATION_INVALID");
      }
      const governedResult = await input.governed_result_bridge.persist({
        call_id: args.call_id,
        operator_id: args.operator_id,
        request_sha256: sha256(request),
        operator_registry_digest: parsed.operator_registry_digest,
        request_content: request,
        output: parsed.output,
        execution_evidence: parsed.execution_evidence,
      });
      transition("OPERATOR_RESULT_COMMITTED", turnIndex);
      const binding = await input.governed_result_bridge.bind({
        session: input.session,
        result: governedResult,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      transition("RESULT_BOUND", turnIndex);
      const observation = analysisStatisticalOperatorObservationSchema.parse({
        schema_version: "analysis-statistical-operator-observation@1.0.0",
        call_id: args.call_id,
        operator_id: args.operator_id,
        operator_registry_digest: parsed.operator_registry_digest,
        status: "SUCCEEDED",
        execution_evidence: parsed.execution_evidence,
        governed_result: governedResult,
        binding,
      });
      operatorRequests.push(requestDocument);
      operatorObservations.push(observation);
      progressEpoch += 1;
      successfulSignatures.add(signature);
      messages.push(
        ...serverToolMessage({
          call: turn,
          result: governedResultModelProjection(observation, obligation),
          is_error: false,
        }),
      );
      progress(turnIndex, candidate.tool_name, "OPERATOR_SUCCEEDED");
      transition("ANALYZE", turnIndex);
      closeOperators(turnIndex);
      continue;
    }

    if (candidate.tool_name !== ANALYSIS_RESULT_PUBLISH_TOOL_NAME) {
      throw new TypeError("ANALYSIS_AGENT_TOOL_CALL_INVALID");
    }
    try {
      const preparedResult = await prepareAnalysisResult({
        contract: input.result_contract,
        manifest: candidate.arguments,
        governed_operator_outputs: operatorObservations.map(
          ({ call_id, operator_id, governed_result }) => ({
            call_id,
            operator_id,
            result_sha256: governed_result.result_sha256 as `sha256:${string}`,
            governed_result,
          }),
        ),
        extractor: createOpenSandboxAnalysisResultSymbolExtractor(input.session),
      });
      if (operatorRequests.length === 0) {
        operatorFinalization = analysisOperatorFinalizationResultSchema.parse({
          schema_version: "statistical-operator-finalization-result@1.0.0",
          operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
          operator_receipts: [],
          operator_receipt_closure_hash: sha256(encoder.encode("[]")),
        });
      } else {
        const data = resultDocument(preparedResult);
        const finalizationRequest = encoder.encode(
          JSON.stringify({
            schema_version: "statistical-operator-finalization@1.0.0",
            operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
            runtime_profile: input.runtime_profile,
            calls: operatorRequests,
            json_outputs: Object.fromEntries(
              [
                ...new Set(
                  input.operator_obligations.map(
                    ({ result_binding }) => result_binding.result_output_name,
                  ),
                ),
              ].map((name) => [name, data]),
            ),
          }),
        );
        const finalized = await input.session.finalizeOperators({
          finalization_id: "final-receipts",
          request: finalizationRequest,
          request_sha256: sha256(finalizationRequest),
          timeout_ms: 120_000,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        try {
          operatorFinalization = analysisOperatorFinalizationResultSchema.parse(
            JSON.parse(decoder.decode(finalized.output)),
          );
        } catch {
          throw new TypeError("ANALYSIS_SANDBOX_OPERATOR_FAILED");
        }
      }
      const receiptIdentities = operatorFinalization.operator_receipts.map(
        ({ call_id, operator_id }) => ({ call_id, operator_id }),
      );
      const obligationIdentities = input.operator_obligations.map(({ call_id, operator_id }) => ({
        call_id,
        operator_id,
      }));
      if (
        operatorFinalization.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
        JSON.stringify(receiptIdentities) !== JSON.stringify(obligationIdentities)
      ) {
        throw new TypeError("ANALYSIS_OPERATOR_RECEIPT_CLOSURE_MISMATCH");
      }
      publishedResult = await stagePreparedAnalysisResult({
        prepared: preparedResult,
        operator_finalization: operatorFinalization,
        cells,
        provider_invocation_refs: providerInvocationRefs,
        stage: input.stage,
      });
    } catch (error) {
      const code = repairablePublishFailureCode(error);
      if (!code) throw error;
      messages.push(
        ...serverToolMessage({
          call: turn,
          result: {
            schema_version: "analysis-result-publish-error@1.0.0",
            code,
            instruction: publishRepairInstruction(code, input.result_contract),
          },
          is_error: true,
        }),
      );
      repair("PUBLISH_SYMBOL_CONTRACT", code, turnIndex, candidate.tool_name, "PUBLISH_REJECTED");
      continue;
    }
    progressEpoch += 1;
    successfulSignatures.add(signature);
    transition("PUBLISH_STAGED", turnIndex);
    progress(turnIndex, candidate.tool_name, "PUBLISH_STAGED");
  }

  if (!publishedResult || currentState() !== "PUBLISH_STAGED") {
    throw new TypeError("ANALYSIS_AGENT_TOOL_BUDGET_EXHAUSTED");
  }

  if (!operatorFinalization) throw new TypeError("ANALYSIS_OPERATOR_FINALIZATION_MISSING");
  return Object.freeze({
    published_result: publishedResult,
    cells: Object.freeze(cells),
    operator_observations: Object.freeze(operatorObservations),
    operator_finalization: operatorFinalization,
    provider_invocation_refs: Object.freeze(providerInvocationRefs),
    state_sequence: Object.freeze(stateSequence),
    repair_attempts: snapshotRepairs(),
  });
}

export const analysisToolLoopInternals = Object.freeze({
  allowedTools,
  candidateSignature,
  publishRepairInstruction,
  repairablePublishFailureCode,
  resultDocument,
  governedResultModelProjection,
  recoverOperatorState,
  safeCellFailureCode,
  safeCellErrorIdentifier,
  safePolicyViolationIdentifier,
});
