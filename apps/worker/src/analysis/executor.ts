import { createHash } from "node:crypto";
import {
  type AnalysisCompletionReceiptPayload,
  type AnalysisProgramPayload,
  type AnalysisReasonCode,
  type ArtifactReference,
  analysisCompletionReceiptPayloadSchema,
  analysisProgramRefSchema,
  analysisReasonCodeSchema,
  analysisResultSchema,
  artifactReferenceIdentity,
  type DerivedAnalysisEvidencePayload,
  derivedAnalysisEvidencePayloadSchema,
  derivedAnalysisEvidenceRefSchema,
  L2ResearchWireError,
  type ResearchBriefV3Payload,
  sandboxExecutionReceiptRefSchema,
  sandboxResultRefSchema,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisContext } from "@data-agent/contracts/context";
import {
  type AnalysisSandboxExecutionReceipt,
  type analysisAgentFinalResponseSchema,
  buildAnalysisAuthorityCommit,
} from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import {
  computeAnalysisDerivationHash,
  type DerivationFailure,
  verifyAnalysisDerivation,
  verifyAnalysisResult,
} from "@data-agent/research";
import { z } from "zod";
import {
  AnalysisSandboxRuntimeError,
  type OpenSandboxAnalysisRuntime,
} from "../runs/opensandbox-analysis-runtime.js";
import type { AnalysisAgentContextPort } from "./analysis-agent-prompt.js";
import {
  type AnalysisFenceGuard,
  buildAnalysisSandboxExecutionReceipt,
  executeAnalysisAgentSandbox,
} from "./analysis-agent-sandbox-executor.js";
import type { AnalysisLifecycleAuthorityPort } from "./analysis-lifecycle-authority.js";
import type { AnalysisToolLoopProgressEvent } from "./analysis-tool-loop.js";
import type { AnalysisAgentModelPort } from "./deepseek-analysis-agent.js";
import { deterministicAnalysisUuid } from "./deterministic-id.js";
import type { GovernedAnalysisInput } from "./governed-analysis-input.js";
import type { AnalysisGovernedResultAuthorityPort } from "./governed-result-bridge.js";
import { gateAnalysisProgram } from "./program-gate.js";
import type { AnalysisResultClosureArtifact } from "./result-publisher.js";
import { type AnalysisSkillCatalog, DEFAULT_ANALYSIS_SKILL_CATALOG } from "./skill-catalog.js";

type AnalysisProgramNode = AnalysisProgramPayload["nodes"][number];

const durableOracleReceiptSchema = z.strictObject({
  schema_version: z.literal("analysis-stage-oracle-receipt@1.0.0"),
  result: analysisResultSchema,
  sample_size: z.number().int().nonnegative(),
  coverage_ratio: z.number().min(0).max(1),
  limitation_codes: z.array(analysisReasonCodeSchema).max(32),
  material_change: z.boolean(),
  oracle_receipt: z.unknown().nullable(),
});

const FINAL_NARRATIVE_PROJECTION_MAX_BYTES = 24 * 1024;
const FINAL_NARRATIVE_FIELD_MAX_BYTES = 8 * 1024;
const FINAL_NARRATIVE_PRIORITY_FIELDS = [
  "schema_version",
  "case_id",
  "window",
  "data_quality_precheck",
  "claim_strength",
  "primary_reliable",
  "worst_revenue_decline",
  "shapley_decomposition",
  "adjusted_binomial_glm",
  "conclusion",
] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildAnalysisNarrativeProjection(document: unknown) {
  if (!isRecord(document) || !isRecord(document.data)) {
    throw new TypeError("ANALYSIS_RESULT_PUBLISHED_DOCUMENT_INVALID");
  }
  const data = document.data;
  const collectionCounts = Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, (value as readonly unknown[]).length]),
  );
  const orderedKeys = [
    ...FINAL_NARRATIVE_PRIORITY_FIELDS.filter((key) => Object.hasOwn(data, key)),
    ...Object.keys(data)
      .filter(
        (key) =>
          !FINAL_NARRATIVE_PRIORITY_FIELDS.includes(
            key as (typeof FINAL_NARRATIVE_PRIORITY_FIELDS)[number],
          ),
      )
      .sort(),
  ];
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let bytes = 0;
  for (const key of orderedKeys) {
    if (key === "method_evidence") continue;
    const value = data[key];
    if (Array.isArray(value)) continue;
    const encoded = new TextEncoder().encode(canonicalizeJson({ [key]: value })).byteLength;
    if (
      encoded > FINAL_NARRATIVE_FIELD_MAX_BYTES ||
      bytes + encoded > FINAL_NARRATIVE_PROJECTION_MAX_BYTES
    ) {
      continue;
    }
    fields[key] = value;
    bytes += encoded;
  }
  return Object.freeze({
    schema_version: "analysis-narrative-projection@1.0.0" as const,
    fields: Object.freeze(fields),
    collection_counts: Object.freeze(collectionCounts),
    omitted_authority_fields: Object.freeze(["method_evidence"]),
  });
}

export interface AnalysisArtifactCommitPort {
  commitL2(input: {
    readonly lease: RunWorkLease;
    readonly principal_id: string;
    readonly idempotency_key: string;
    readonly payload:
      | ResearchBriefV3Payload
      | AnalysisProgramPayload
      | DerivedAnalysisEvidencePayload
      | AnalysisCompletionReceiptPayload;
  }): Promise<ArtifactReference>;
  commitSystem(input: {
    readonly lease: RunWorkLease;
    readonly principal_id: string;
    readonly idempotency_key: string;
    readonly reference: ArtifactReference;
    readonly payload: unknown;
    readonly content: Uint8Array | null;
  }): Promise<ArtifactReference>;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
}

export interface GovernedAnalysisQueryPort {
  execute(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
    readonly idempotency_key: string;
    readonly max_rows: number;
    readonly timeout_ms: number;
  }): Promise<readonly GovernedAnalysisInput[]>;
}

export interface ProviderInvocationResourceRef {
  readonly resource_id: string;
  readonly resource_revision: 1;
  readonly resource_hash: `sha256:${string}`;
}

export interface AnalysisCellSourceArtifactPort {
  commit(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node_id: string;
    readonly generation_attempt: number;
    readonly provider_invocation_ref: ProviderInvocationResourceRef;
    readonly source_sha256: `sha256:${string}`;
    readonly source_text: string;
  }): Promise<ArtifactReference>;
  load(input: {
    readonly lease: RunWorkLease;
    readonly node_id: string;
    readonly context_generation: number;
    readonly journal_seq: number;
    readonly source_ref: ArtifactReference;
  }): Promise<{ readonly source: string; readonly source_sha256: `sha256:${string}` }>;
}

export interface AnalysisOracleExpectation {
  readonly result: DerivedAnalysisEvidencePayload["result"];
  readonly sample_size: number;
  readonly coverage_ratio: number;
  readonly limitation_codes: readonly AnalysisReasonCode[];
  readonly material_change: boolean;
  readonly oracle_receipt?: unknown;
}

export interface AnalysisBoundOutput extends AnalysisResultClosureArtifact {
  readonly reference: ArtifactReference;
}

export interface AnalysisOraclePort {
  evaluate(input: {
    readonly node: AnalysisProgramNode;
    readonly governed_inputs: readonly GovernedAnalysisInput[];
    readonly sandbox_outputs: readonly AnalysisBoundOutput[];
    readonly sandbox_receipt: AnalysisSandboxExecutionReceipt;
  }): Promise<AnalysisOracleExpectation>;
}

export interface AnalysisReferenceFactory {
  createSystem(input: {
    readonly artifact_type: "SandboxExecutionReceipt";
    readonly label: string;
    readonly content_hash: `sha256:${string}`;
    readonly lease: RunWorkLease;
  }): ArtifactReference;
  createOutput(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program_ref: ArtifactReference;
    readonly node_id: string;
    readonly artifact_name: string;
    readonly artifact_kind: AnalysisResultClosureArtifact["artifact_kind"];
    readonly content_hash: `sha256:${string}`;
  }): ArtifactReference;
}

export interface AnalysisExecutorDependencies {
  readonly artifacts: AnalysisArtifactCommitPort;
  readonly governed_results: AnalysisGovernedResultAuthorityPort;
  readonly lifecycle: AnalysisLifecycleAuthorityPort;
  readonly queries: GovernedAnalysisQueryPort;
  readonly contexts: AnalysisAgentContextPort;
  readonly model: AnalysisAgentModelPort;
  readonly oracle: AnalysisOraclePort;
  readonly sandbox: OpenSandboxAnalysisRuntime;
  readonly fence_guard: AnalysisFenceGuard;
  readonly references: AnalysisReferenceFactory;
  readonly diagnostics?: (event: {
    readonly event_name: "analysis_oracle_rejected" | "analysis_node_rejected";
    readonly run_id: string;
    readonly node_id: string;
    readonly attempt: 0 | null;
    readonly failure_code: string;
    readonly error_name: string | null;
    readonly validation_issues: readonly { readonly path: string; readonly code: string }[];
  }) => void;
  readonly progress?: (event: AnalysisToolLoopProgressEvent) => void;
  readonly repair_budget_per_category?: 0 | 1;
  readonly allow_stage_recovery?: boolean;
  readonly catalog?: AnalysisSkillCatalog;
  readonly now?: () => Date;
}

export function analysisOracleFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const baseCode = message.split(":", 1)[0] ?? "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(baseCode) ? baseCode : "ANALYSIS_ORACLE_FAILED";
}

export function analysisExecutionFailureCode(error: unknown): string {
  if (error instanceof z.ZodError) return "ANALYSIS_CONTRACT_INVALID";
  if (error instanceof L2ResearchWireError) return error.code;
  if (error instanceof AnalysisSandboxRuntimeError && error.reason_code) {
    return error.reason_code;
  }
  const message = error instanceof Error ? error.message : "";
  const baseCode = message.split(":", 1)[0] ?? "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(baseCode) ? baseCode : "ANALYSIS_EXECUTION_FAILED";
}

function analysisFailureDiagnostic(error: unknown) {
  const errorName = error instanceof Error ? error.name : "";
  return Object.freeze({
    error_name: /^[A-Za-z][A-Za-z0-9_.]{0,127}$/u.test(errorName) ? errorName : null,
    validation_issues: Object.freeze(
      error instanceof z.ZodError
        ? error.issues.slice(0, 16).map((issue) =>
            Object.freeze({
              path: issue.path.length === 0 ? "$" : issue.path.map(String).join("."),
              code: issue.code,
            }),
          )
        : [],
    ),
  });
}

export interface AnalysisExecutionResult {
  readonly analysis_program_ref: ArtifactReference;
  readonly completion_ref: ArtifactReference;
  readonly completion: AnalysisCompletionReceiptPayload;
  readonly evidence_refs: readonly ArtifactReference[];
  readonly query_evidence_refs: readonly ArtifactReference[];
  readonly generated_python_refs: readonly ArtifactReference[];
  readonly sandbox_receipts: readonly AnalysisSandboxExecutionReceipt[];
  readonly sandbox_receipt_refs: readonly ArtifactReference[];
  readonly provider_invocation_refs: readonly ProviderInvocationResourceRef[];
  readonly oracle_receipts: readonly unknown[];
  readonly validated_outputs: readonly {
    readonly node_id: string;
    readonly output: AnalysisBoundOutput;
  }[];
}

class BudgetLedger {
  #steps = 0;
  #model = 0;
  #sql = 0;
  #sandbox = 0;
  #seriesRows = 0;
  #groupRows = 0;

  constructor(
    readonly analysisProgram: AnalysisProgramPayload,
    readonly maxModelCalls: number,
    readonly startedAtMs: number,
    readonly now: () => Date,
  ) {}

  reserveNode(): boolean {
    if (
      this.#steps + 1 > this.analysisProgram.budget.max_steps ||
      this.#sql + 1 > this.analysisProgram.budget.max_sql_executions ||
      this.#sandbox + 1 > this.analysisProgram.budget.max_sandbox_executions ||
      this.now().getTime() - this.startedAtMs >= this.analysisProgram.budget.max_elapsed_ms
    ) {
      return false;
    }
    this.#steps += 1;
    this.#sql += 1;
    this.#sandbox += 1;
    return true;
  }

  observe(expectation: AnalysisOracleExpectation): boolean {
    const result = expectation.result;
    const seriesRows =
      result.result_kind === "TREND_CHANGE"
        ? result.points.length
        : result.result_kind === "ROBUST_ANOMALY"
          ? result.sample_size
          : result.result_kind === "BASELINE_FORECAST_BACKTEST"
            ? expectation.sample_size
            : 0;
    const groupRows =
      result.result_kind === "CONTRIBUTION_CONCENTRATION"
        ? result.groups.length
        : result.result_kind === "ASSOCIATION_OUTLIER_COMPLETENESS"
          ? result.paired_sample_size
          : 0;
    if (
      this.#seriesRows + seriesRows > this.analysisProgram.budget.max_series_rows ||
      this.#groupRows + groupRows > this.analysisProgram.budget.max_group_rows
    ) {
      return false;
    }
    this.#seriesRows += seriesRows;
    this.#groupRows += groupRows;
    return true;
  }

  remainingModelCalls(): number {
    return Math.max(0, this.maxModelCalls - this.#model);
  }

  observeModelCalls(count: number): boolean {
    if (!Number.isInteger(count) || count < 1 || this.#model + count > this.maxModelCalls) {
      return false;
    }
    this.#model += count;
    return true;
  }

  usage() {
    return {
      steps: this.#steps,
      model_calls: this.#model,
      sql_executions: this.#sql,
      sandbox_executions: this.#sandbox,
      series_rows: this.#seriesRows,
      group_rows: this.#groupRows,
      elapsed_ms: Math.max(0, this.now().getTime() - this.startedAtMs),
    };
  }
}

function uniqueReasons(values: readonly AnalysisReasonCode[]): AnalysisReasonCode[] {
  return [...new Set(values)].sort();
}

function failedNode(
  node: AnalysisProgramNode,
  ...reasons: readonly AnalysisReasonCode[]
): AnalysisCompletionReceiptPayload["node_results"][number] {
  return {
    node_id: node.node_id,
    criticality: node.criticality,
    status: "FAILED",
    evidence_ref: null,
    reason_codes: uniqueReasons(reasons),
  };
}

function derivationFailureReasons(
  failures: readonly DerivationFailure[],
): readonly AnalysisReasonCode[] {
  return failures.length > 0 ? failures : ["DERIVATION_REPLAY_MISMATCH"];
}

function activationSatisfied(
  node: AnalysisProgramNode,
  outcomes: ReadonlyMap<string, AnalysisOracleExpectation>,
): boolean {
  if (node.activation_rule.kind === "ALWAYS") return true;
  const source = outcomes.get(node.activation_rule.source_node_id);
  if (!source) return false;
  if (node.activation_rule.kind === "MATERIAL_CHANGE") return source.material_change;
  return source.sample_size >= node.activation_rule.minimum_points;
}

function sourceBundle(cells: readonly { readonly cell_id: string; readonly source: string }[]) {
  return cells.map(({ cell_id, source }) => `# %% [${cell_id}]\n${source}`).join("\n\n");
}

function sourceHash(source: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function assertAnalysisAuthorityStageClosure(input: {
  readonly principal_id: string;
  readonly lease_principal_id: string;
  readonly stage_expires_at: string;
  readonly observed_at: Date;
  readonly staged_operator_receipt_closure_hash: string;
  readonly command_operator_receipt_closure_hash: string;
  readonly receipt_operator_receipt_closure_hash: string;
  readonly staged_contract_hash: string;
  readonly receipt_contract_hash: string;
  readonly staged_manifest_hash: string;
  readonly receipt_manifest_hash: string;
  readonly staged_closure_hash: string;
  readonly receipt_closure_hash: string;
}): void {
  if (input.principal_id !== input.lease_principal_id) {
    throw new TypeError("ANALYSIS_AUTHORITY_STAGE_PRINCIPAL_MISMATCH");
  }
  if (Date.parse(input.stage_expires_at) <= input.observed_at.getTime()) {
    throw new TypeError("ANALYSIS_AUTHORITY_STAGE_EXPIRED");
  }
  if (input.staged_operator_receipt_closure_hash !== input.command_operator_receipt_closure_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_STAGE_OPERATOR_CLOSURE_MISMATCH");
  }
  if (input.receipt_operator_receipt_closure_hash !== input.command_operator_receipt_closure_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_RECEIPT_OPERATOR_CLOSURE_MISMATCH");
  }
  if (input.receipt_contract_hash !== input.staged_contract_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_RECEIPT_CONTRACT_HASH_MISMATCH");
  }
  if (input.receipt_manifest_hash !== input.staged_manifest_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_RECEIPT_MANIFEST_HASH_MISMATCH");
  }
  if (input.receipt_closure_hash !== input.staged_closure_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_RECEIPT_CLOSURE_HASH_MISMATCH");
  }
}

export function createAnalysisProgramExecutor(dependencies: AnalysisExecutorDependencies) {
  const catalog = dependencies.catalog ?? DEFAULT_ANALYSIS_SKILL_CATALOG;
  const now = dependencies.now ?? (() => new Date());

  return Object.freeze({
    async execute(input: {
      readonly lease: RunWorkLease;
      readonly principal_id: string;
      readonly brief: ResearchBriefV3Payload;
      readonly brief_ref: ArtifactReference;
      readonly context: AnalysisContext;
      readonly program: AnalysisProgramPayload;
      readonly signal?: AbortSignal;
    }): Promise<AnalysisExecutionResult> {
      const gate = await gateAnalysisProgram({
        program: input.program,
        brief: input.brief,
        brief_ref: input.brief_ref,
        context: input.context,
        catalog,
      });
      if (!gate.ok) throw new TypeError(gate.failure);
      const analysisProgram = gate.program;
      const committedAnalysisProgramRef = await dependencies.artifacts.commitL2({
        lease: input.lease,
        principal_id: input.principal_id,
        idempotency_key: `analysis-program:${analysisProgram.program_hash}`,
        payload: analysisProgram,
      });
      if (
        committedAnalysisProgramRef.artifact_type !== "AnalysisProgram" ||
        committedAnalysisProgramRef.run_id !== input.lease.run_id ||
        committedAnalysisProgramRef.app_id !== input.lease.scope.app_id ||
        committedAnalysisProgramRef.tenant_id !== input.lease.scope.tenant_id ||
        committedAnalysisProgramRef.environment !== input.lease.scope.environment
      ) {
        throw new TypeError("ANALYSIS_PROGRAM_COMMIT_CORRELATION_INVALID");
      }
      const analysisProgramRef = analysisProgramRefSchema.parse(committedAnalysisProgramRef);
      const ledger = new BudgetLedger(
        analysisProgram,
        input.brief.budget.max_model_calls,
        now().getTime(),
        now,
      );
      const pending = new Map(analysisProgram.nodes.map((node) => [node.node_id, node] as const));
      const results = new Map<string, AnalysisCompletionReceiptPayload["node_results"][number]>();
      const expectations = new Map<string, AnalysisOracleExpectation>();
      const evidenceRefs: ArtifactReference[] = [];
      const queryEvidenceRefs = new Map<string, ArtifactReference>();
      const generatedPythonRefs: ArtifactReference[] = [];
      const sandboxReceipts: AnalysisSandboxExecutionReceipt[] = [];
      const sandboxReceiptRefs: ArtifactReference[] = [];
      const providerInvocationRefs: ProviderInvocationResourceRef[] = [];
      const oracleReceipts: unknown[] = [];
      const validatedOutputs = new Map<string, readonly AnalysisBoundOutput[]>();

      const executeNode = async (node: AnalysisProgramNode) => {
        if (input.signal?.aborted) return failedNode(node, "SANDBOX_EXECUTION_FAILED");
        if (!ledger.reserveNode()) return failedNode(node, "ANALYSIS_BUDGET_EXCEEDED");
        const remainingModelCalls = ledger.remainingModelCalls();
        if (remainingModelCalls < 2) return failedNode(node, "ANALYSIS_BUDGET_EXCEEDED");
        const descriptor = catalog.resolve(node.skill_id);
        const governedInputs = await dependencies.queries.execute({
          lease: input.lease,
          analysis_program_ref: analysisProgramRef,
          node,
          idempotency_key: `analysis-query:${analysisProgram.program_hash}:${node.node_id}`,
          max_rows: Math.min(
            descriptor.hard_limits.max_series_points,
            descriptor.hard_limits.max_groups,
            analysisProgram.budget.max_series_rows,
            analysisProgram.budget.max_group_rows,
          ),
          timeout_ms: Math.min(
            descriptor.hard_limits.wall_time_ms,
            analysisProgram.budget.max_elapsed_ms,
          ),
        });
        const fenceToken = `${input.lease.attempt_id}:${input.lease.worker_fence}`;
        const execution = await executeAnalysisAgentSandbox({
          lease: input.lease,
          analysis_program: analysisProgram,
          analysis_program_ref: analysisProgramRef,
          node,
          governed_inputs: governedInputs,
          governed_results: dependencies.governed_results,
          lifecycle: dependencies.lifecycle,
          contexts: dependencies.contexts,
          model: dependencies.model,
          runtime: dependencies.sandbox,
          runtime_profile: descriptor.python_import_profile,
          fence_guard: dependencies.fence_guard,
          fence_token: fenceToken,
          max_model_calls: remainingModelCalls,
          ...(dependencies.repair_budget_per_category !== undefined
            ? { repair_budget_per_category: dependencies.repair_budget_per_category }
            : {}),
          ...(dependencies.allow_stage_recovery !== undefined
            ? { allow_stage_recovery: dependencies.allow_stage_recovery }
            : {}),
          ...(dependencies.progress ? { on_progress: dependencies.progress } : {}),
          now,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        if (!ledger.observeModelCalls(execution.tool_loop.provider_invocation_refs.length)) {
          return failedNode(node, "ANALYSIS_BUDGET_EXCEEDED");
        }
        const lifecycleIdentity = {
          lease: input.lease,
          node_id: node.node_id,
          context_generation: 1,
          runtime_digest: (await sha256ContentHash({
            provider: "OpenSandbox",
            runtime_profile: execution.runtime_profile,
            agent_image: execution.runtime.agent_image,
            operator_image: execution.runtime.operator_image,
            secure_access: execution.runtime.secure_access,
          })) as `sha256:${string}`,
          policy_version: "analysis-cell-policy@1.1.0",
          operator_registry_digest: analysisProgram.operator_registry_digest as `sha256:${string}`,
        } as const;
        const stagedClosure = await dependencies.lifecycle.load({
          ...lifecycleIdentity,
          stage: execution.stage,
        });
        if (
          canonicalizeJson(stagedClosure.operator_finalization) !==
            canonicalizeJson(execution.tool_loop.operator_finalization) ||
          (execution.recovery_phase === null &&
            canonicalizeJson(stagedClosure.governed_operator_results) !==
              canonicalizeJson(
                execution.tool_loop.operator_observations.map(
                  ({ governed_result: governedResult }) => governedResult,
                ),
              ))
        ) {
          throw new TypeError("ANALYSIS_RESULT_STAGE_EXECUTION_CLOSURE_MISMATCH");
        }
        const boundOutputs = stagedClosure.artifacts.map((output) => ({
          ...output,
          reference: sandboxResultRefSchema.parse(
            dependencies.references.createOutput({
              lease: input.lease,
              analysis_program_ref: analysisProgramRef,
              node_id: node.node_id,
              artifact_name: output.artifact_name,
              artifact_kind: output.artifact_kind,
              content_hash: output.content_sha256,
            }),
          ),
        }));
        const idempotencyKey = `analysis-sandbox:${analysisProgram.program_hash}:${node.node_id}`;
        const receipt = await buildAnalysisSandboxExecutionReceipt({
          lease: input.lease,
          idempotency_key: idempotencyKey,
          fence_token: fenceToken,
          analysis_program_ref: analysisProgramRef,
          node_id: node.node_id,
          generated_source_policy: node.generated_source_policy as
            | "OPEN_ANALYSIS"
            | "GOVERNED_OPERATOR_ORCHESTRATION",
          operator_registry_digest: analysisProgram.operator_registry_digest as `sha256:${string}`,
          operator_obligations: node.operator_obligations,
          execution,
          governed_inputs: governedInputs,
          outputs: boundOutputs.map((output) => ({ output, reference: output.reference })),
        });
        let expectation: AnalysisOracleExpectation;
        let oracleReceiptPayload: z.infer<typeof durableOracleReceiptSchema>;
        let oracleReceiptHash: `sha256:${string}`;
        if (stagedClosure.oracle_record) {
          oracleReceiptPayload = durableOracleReceiptSchema.parse(
            stagedClosure.oracle_record.receipt_payload,
          );
          if (
            (await sha256ContentHash(oracleReceiptPayload)) !==
            stagedClosure.oracle_record.receipt_hash
          ) {
            throw new TypeError("ANALYSIS_STAGE_ORACLE_RECEIPT_HASH_MISMATCH");
          }
          expectation = {
            result: oracleReceiptPayload.result,
            sample_size: oracleReceiptPayload.sample_size,
            coverage_ratio: oracleReceiptPayload.coverage_ratio,
            limitation_codes: oracleReceiptPayload.limitation_codes,
            material_change: oracleReceiptPayload.material_change,
            ...(oracleReceiptPayload.oracle_receipt === null
              ? {}
              : { oracle_receipt: oracleReceiptPayload.oracle_receipt }),
          };
          oracleReceiptHash = stagedClosure.oracle_record.receipt_hash;
        } else {
          try {
            expectation = await dependencies.oracle.evaluate({
              node,
              governed_inputs: governedInputs,
              sandbox_outputs: boundOutputs,
              sandbox_receipt: receipt,
            });
            analysisResultSchema.parse(expectation.result);
            if (verifyAnalysisResult(expectation.result).verdict !== "PASS") {
              throw new TypeError("ANALYSIS_ORACLE_RESULT_INVALID");
            }
          } catch (error) {
            const failureCode = analysisOracleFailureCode(error);
            dependencies.diagnostics?.({
              event_name: "analysis_oracle_rejected",
              run_id: input.lease.run_id,
              node_id: node.node_id,
              attempt: 0,
              failure_code: failureCode,
              ...analysisFailureDiagnostic(error),
            });
            throw new TypeError(failureCode);
          }
          oracleReceiptPayload = durableOracleReceiptSchema.parse({
            schema_version: "analysis-stage-oracle-receipt@1.0.0",
            result: expectation.result,
            sample_size: expectation.sample_size,
            coverage_ratio: expectation.coverage_ratio,
            limitation_codes: expectation.limitation_codes,
            material_change: expectation.material_change,
            oracle_receipt: expectation.oracle_receipt ?? null,
          });
          oracleReceiptHash = await dependencies.lifecycle.recordOracle({
            ...lifecycleIdentity,
            stage: execution.stage,
            oracle_receipt: oracleReceiptPayload,
          });
        }
        if (!ledger.observe(expectation)) return failedNode(node, "ANALYSIS_BUDGET_EXCEEDED");
        const resultArtifact = stagedClosure.artifacts.find(
          ({ artifact_kind: artifactKind }) => artifactKind === "RESULT",
        );
        if (!resultArtifact) throw new TypeError("ANALYSIS_RESULT_PUBLISHED_DOCUMENT_MISSING");
        let explanation: z.infer<typeof analysisAgentFinalResponseSchema>;
        let explanationHash: `sha256:${string}`;
        let explanationProviderInvocationRef: ProviderInvocationResourceRef;
        if (stagedClosure.explanation_record) {
          explanation = stagedClosure.explanation_record.explanation;
          explanationHash = stagedClosure.explanation_record.explanation_hash;
          explanationProviderInvocationRef =
            stagedClosure.explanation_record.provider_invocation_ref;
          if ((await sha256ContentHash(explanation)) !== explanationHash) {
            throw new TypeError("ANALYSIS_STAGE_EXPLANATION_HASH_MISMATCH");
          }
        } else {
          const finalTurn = await dependencies.model.turn({
            run_id: input.lease.run_id,
            analysis_program_id: analysisProgramRef.artifact_id,
            node_id: node.node_id,
            turn_index: execution.tool_loop.provider_invocation_refs.length,
            phase: "FINAL",
            result_contract: node.result_contract,
            allowed_tool_names: [],
            messages: [
              {
                role: "user",
                content: JSON.stringify({
                  kind: "ANALYSIS_STAGE_ORACLE_VERIFIED",
                  stage_id: execution.stage.stage_id,
                  stage_hash: execution.stage.stage_hash,
                  result_summary: buildAnalysisNarrativeProjection(
                    JSON.parse(
                      new TextDecoder("utf-8", { fatal: true }).decode(resultArtifact.content),
                    ),
                  ),
                  artifacts: execution.tool_loop.published_result.observation.artifacts,
                  oracle_result: expectation.result,
                  limitation_codes: expectation.limitation_codes,
                  instruction:
                    "Explain this immutable Oracle-verified summary in Chinese. State that the complete data table and chart are attached authoritative artifacts, include every disclosed limitation, and do not recreate omitted rows or claim causality beyond the accepted analysis.",
                }),
              },
            ],
            max_output_tokens: 8_192,
          });
          if (finalTurn.phase !== "FINAL") {
            throw new TypeError("ANALYSIS_AGENT_TOOL_PROTOCOL_INVALID");
          }
          explanation = finalTurn.response;
          explanationProviderInvocationRef = finalTurn.provider_invocation_ref;
          explanationHash = await dependencies.lifecycle.recordExplanation({
            ...lifecycleIdentity,
            stage: execution.stage,
            explanation,
            provider_invocation_ref: explanationProviderInvocationRef,
          });
        }
        if (!ledger.observeModelCalls(1)) return failedNode(node, "ANALYSIS_BUDGET_EXCEEDED");
        const committedOutputRefs = boundOutputs.map(({ reference }) =>
          sandboxResultRefSchema.parse(reference),
        );
        const receiptHash = await sha256ContentHash(receipt);
        const receiptRef = sandboxExecutionReceiptRefSchema.parse(
          dependencies.references.createSystem({
            artifact_type: "SandboxExecutionReceipt",
            label: `${node.node_id}:${receipt.request_hash}`,
            content_hash: receiptHash,
            lease: input.lease,
          }),
        );
        assertAnalysisAuthorityStageClosure({
          principal_id: input.principal_id,
          lease_principal_id: input.lease.principal_id,
          stage_expires_at: stagedClosure.stage_expires_at,
          observed_at: now(),
          staged_operator_receipt_closure_hash:
            stagedClosure.operator_finalization.operator_receipt_closure_hash,
          command_operator_receipt_closure_hash:
            execution.tool_loop.operator_finalization.operator_receipt_closure_hash,
          receipt_operator_receipt_closure_hash: receipt.operator_receipt_closure_hash,
          staged_contract_hash: stagedClosure.contract_hash,
          receipt_contract_hash: receipt.result_contract_hash,
          staged_manifest_hash: stagedClosure.manifest_hash,
          receipt_manifest_hash: receipt.publish_manifest_hash,
          staged_closure_hash: stagedClosure.closure_hash,
          receipt_closure_hash: receipt.published_closure_hash,
        });
        const authorityCommand = await buildAnalysisAuthorityCommit({
          schema_version: "analysis-authority-commit@1.0.0",
          scope: input.lease.scope,
          run_id: input.lease.run_id,
          principal_id: input.principal_id,
          node_id: node.node_id,
          attempt_id: input.lease.attempt_id,
          worker_fence: input.lease.worker_fence,
          idempotency_key: `analysis-authority:${analysisProgram.program_hash}:${node.node_id}`,
          analysis_program_ref: analysisProgramRef,
          stage_id: execution.stage.stage_id,
          stage_hash: execution.stage.stage_hash,
          closure_hash: execution.stage.closure_hash,
          operator_receipt_closure_hash:
            execution.tool_loop.operator_finalization.operator_receipt_closure_hash,
          oracle_receipt_payload: oracleReceiptPayload,
          oracle_receipt_hash: oracleReceiptHash,
          explanation,
          explanation_hash: explanationHash,
          output_bindings: boundOutputs.map((output) => ({
            stage_artifact: {
              artifact_name: output.artifact_name,
              artifact_kind: output.artifact_kind,
              media_type: output.media_type,
              content_sha256: output.content_sha256,
              bytes: output.bytes,
            },
            reference: output.reference,
          })),
          sandbox_receipt_ref: receiptRef,
          sandbox_receipt_payload: receipt,
          sandbox_receipt_hash: receiptHash,
          public_event_id: deterministicAnalysisUuid(
            `analysis-authority-event\0${input.lease.run_id}\0${node.node_id}\0${execution.stage.stage_hash}`,
          ),
        });
        await dependencies.lifecycle.commit({ ...lifecycleIdentity, command: authorityCommand });
        await dependencies.lifecycle.cleanup({ ...lifecycleIdentity, stage: execution.stage });
        const committedReceiptRef = receiptRef;
        const parameterHash = await sha256ContentHash(node.parameters);
        const inputClosureHash = await sha256ContentHash({
          query_evidence_refs: governedInputs.map(({ query_evidence_ref }) => query_evidence_ref),
          input_refs: governedInputs.map(({ input_ref }) => input_ref),
          input_materialization_receipt_refs: governedInputs.map(
            ({ materialization_receipt_ref }) => materialization_receipt_ref,
          ),
        });
        const evidenceMaterial: Omit<DerivedAnalysisEvidencePayload, "derivation_hash"> = {
          artifact_type: "DerivedAnalysisEvidence",
          protocol_version: "derived-analysis-evidence@2.0.0",
          analysis_program_ref: analysisProgramRef,
          node_id: node.node_id,
          skill_id: node.skill_id,
          algorithm_version: descriptor.algorithm_version,
          query_evidence_refs: governedInputs.map(({ query_evidence_ref }) => query_evidence_ref),
          sandbox_execution_receipt_ref: receiptRef,
          sandbox_result_refs: committedOutputRefs,
          runtime_profile: execution.runtime_profile,
          agent_image: execution.runtime.agent_image,
          operator_image: execution.runtime.operator_image,
          generated_source_policy: node.generated_source_policy,
          operator_registry_digest: analysisProgram.operator_registry_digest,
          operator_obligations: node.operator_obligations,
          operator_receipt_closure_hash:
            execution.tool_loop.operator_finalization.operator_receipt_closure_hash,
          parameter_hash: parameterHash,
          input_closure_hash: inputClosureHash,
          result: expectation.result,
          quality: {
            oracle_verdict: "PASS",
            deterministic_replay: "PASS",
            sample_size: expectation.sample_size,
            coverage_ratio: expectation.coverage_ratio,
          },
          limitation_codes: uniqueReasons(expectation.limitation_codes),
          mandatory_disclosures: [...descriptor.mandatory_disclosures],
        };
        const evidence = derivedAnalysisEvidencePayloadSchema.parse({
          ...evidenceMaterial,
          derivation_hash: await computeAnalysisDerivationHash(evidenceMaterial),
        });
        const verification = await verifyAnalysisDerivation({
          plan: analysisProgram,
          planRef: analysisProgramRef,
          receipt,
          receiptRef,
          evidence,
          materializedResultRefs: committedOutputRefs,
          materializedQueryRefs: governedInputs.map(({ query_evidence_ref }) => query_evidence_ref),
          materializedInputRefs: governedInputs.map(({ input_ref }) => input_ref),
        });
        if (!verification.ok) {
          return failedNode(node, ...derivationFailureReasons(verification.failures));
        }
        const evidenceRef = derivedAnalysisEvidenceRefSchema.parse(
          await dependencies.artifacts.commitL2({
            lease: input.lease,
            principal_id: input.principal_id,
            idempotency_key: `analysis-evidence:${analysisProgram.program_hash}:${node.node_id}`,
            payload: evidence,
          }),
        );
        evidenceRefs.push(evidenceRef);
        for (const governed of governedInputs) {
          queryEvidenceRefs.set(
            artifactReferenceIdentity(governed.query_evidence_ref),
            governed.query_evidence_ref,
          );
        }
        generatedPythonRefs.push(
          ...execution.tool_loop.cells.flatMap(({ source_ref: sourceRef }) =>
            sourceRef ? [sourceRef] : [],
          ),
        );
        sandboxReceiptRefs.push(committedReceiptRef);
        sandboxReceipts.push(receipt);
        providerInvocationRefs.push(
          ...execution.tool_loop.provider_invocation_refs,
          explanationProviderInvocationRef,
        );
        if (expectation.oracle_receipt !== undefined)
          oracleReceipts.push(expectation.oracle_receipt);
        validatedOutputs.set(
          node.node_id,
          boundOutputs.filter(({ artifact_kind: artifactKind }) => artifactKind === "RESULT"),
        );
        expectations.set(node.node_id, expectation);
        return {
          node_id: node.node_id,
          criticality: node.criticality,
          status: "SUCCEEDED" as const,
          evidence_ref: evidenceRef,
          reason_codes: [],
        };
      };

      while (pending.size > 0) {
        const ready = [...pending.values()].filter((node) =>
          node.dependency_node_ids.every((dependency) => results.has(dependency)),
        );
        if (ready.length === 0) throw new TypeError("ANALYSIS_PROGRAM_RUNTIME_CYCLE");
        const runnable: AnalysisProgramNode[] = [];
        for (const node of ready) {
          pending.delete(node.node_id);
          const dependencyFailed = node.dependency_node_ids.some(
            (dependency) => results.get(dependency)?.status !== "SUCCEEDED",
          );
          if (dependencyFailed || !activationSatisfied(node, expectations)) {
            results.set(node.node_id, failedNode(node, "ANALYSIS_NODE_DEPENDENCY_FAILED"));
          } else {
            runnable.push(node);
          }
        }
        const completed = await Promise.all(
          runnable.map(async (node) => {
            try {
              return [node.node_id, await executeNode(node)] as const;
            } catch (error) {
              dependencies.diagnostics?.({
                event_name: "analysis_node_rejected",
                run_id: input.lease.run_id,
                node_id: node.node_id,
                attempt: null,
                failure_code: analysisExecutionFailureCode(error),
                ...analysisFailureDiagnostic(error),
              });
              return [node.node_id, failedNode(node, "SANDBOX_EXECUTION_FAILED")] as const;
            }
          }),
        );
        for (const [nodeId, result] of completed) results.set(nodeId, result);
      }

      const nodeResults = analysisProgram.nodes.map((node) => {
        const result = results.get(node.node_id);
        if (!result) throw new TypeError("ANALYSIS_NODE_RESULT_MISSING");
        return result;
      });
      const limitations = uniqueReasons(nodeResults.flatMap(({ reason_codes }) => reason_codes));
      const criticalFailure = nodeResults.some(
        ({ criticality, status }) => criticality === "CRITICAL" && status !== "SUCCEEDED",
      );
      const optionalFailure = nodeResults.some(
        ({ criticality, status }) => criticality === "OPTIONAL" && status !== "SUCCEEDED",
      );
      const completionMaterial = {
        artifact_type: "AnalysisCompletionReceipt",
        protocol_version: "analysis-completion@1.0.0",
        analysis_program_ref: analysisProgramRef,
        node_results: nodeResults,
        budget_usage: ledger.usage(),
        terminal: criticalFailure ? "HOLD" : optionalFailure ? "PARTIAL" : "READY",
        limitation_codes: limitations,
      } as const;
      const completion = analysisCompletionReceiptPayloadSchema.parse({
        ...completionMaterial,
        completion_hash: await sha256ContentHash({
          hash_domain: "analysis-completion@1.0.0",
          value: completionMaterial,
        }),
      });
      const completionRef = await dependencies.artifacts.commitL2({
        lease: input.lease,
        principal_id: input.principal_id,
        idempotency_key: `analysis-completion:${analysisProgram.program_hash}`,
        payload: completion,
      });
      return Object.freeze({
        analysis_program_ref: analysisProgramRef,
        completion_ref: completionRef,
        completion,
        evidence_refs: Object.freeze(evidenceRefs),
        query_evidence_refs: Object.freeze([...queryEvidenceRefs.values()]),
        generated_python_refs: Object.freeze(generatedPythonRefs),
        sandbox_receipts: Object.freeze(sandboxReceipts),
        sandbox_receipt_refs: Object.freeze(sandboxReceiptRefs),
        provider_invocation_refs: Object.freeze(providerInvocationRefs),
        oracle_receipts: Object.freeze(oracleReceipts),
        validated_outputs: Object.freeze(
          analysisProgram.nodes.flatMap((node) =>
            (validatedOutputs.get(node.node_id) ?? []).map((output) => ({
              node_id: node.node_id,
              output,
            })),
          ),
        ),
      });
    },
  });
}

export const analysisExecutorInternals = Object.freeze({
  assertAnalysisAuthorityStageClosure,
  sourceBundle,
  sourceHash,
});
