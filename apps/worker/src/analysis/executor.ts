import {
  type AnalysisCompletionReceiptPayload,
  type AnalysisContext,
  type AnalysisProgramPayload,
  type AnalysisReasonCode,
  type ArtifactReference,
  analysisCompletionReceiptPayloadSchema,
  analysisProgramRefSchema,
  analysisResultSchema,
  artifactReferenceIdentity,
  type DerivedAnalysisEvidencePayload,
  derivedAnalysisEvidencePayloadSchema,
  derivedAnalysisEvidenceRefSchema,
  type PythonSandboxTransportOutcomeV2,
  type ResearchBriefV3Payload,
  type RunWorkLease,
  sandboxExecutionReceiptRefSchema,
  sandboxProgramRefSchema,
  sandboxResultRefSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  computeAnalysisDerivationHash,
  verifyAnalysisDerivation,
  verifyAnalysisResult,
} from "@data-agent/research";
import type { PythonSandboxClient } from "../runs/python-sandbox-client.js";
import {
  admitAnalysisSandboxProgram,
  admitAnalysisSandboxProgramRepair,
} from "./program-admission.js";
import { gateAnalysisProgram } from "./program-gate.js";
import {
  type AnalysisFenceGuard,
  type AnalysisOutputSlotFactory,
  type AnalysisSandboxExecution,
  executeAnalysisSandbox,
  type GovernedPythonInput,
} from "./sandbox-executor.js";
import { type AnalysisSkillCatalog, DEFAULT_ANALYSIS_SKILL_CATALOG } from "./skill-catalog.js";

type AnalysisProgramNode = AnalysisProgramPayload["nodes"][number];

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
  }): Promise<readonly GovernedPythonInput[]>;
}

export interface AnalysisProgramSourcePort {
  load(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
    readonly standard_program: string | null;
  }): Promise<{ readonly source_text: string; readonly source_text_ref: ArtifactReference }>;
  repair?(input: {
    readonly lease: RunWorkLease;
    readonly analysis_program: AnalysisProgramPayload;
    readonly analysis_program_ref: ArtifactReference;
    readonly node: AnalysisProgramNode;
    readonly previous_source_text: string;
    readonly failure_code: string;
    readonly attempt: 1;
  }): Promise<{ readonly source_text: string; readonly source_text_ref: ArtifactReference }>;
}

export interface AnalysisOracleExpectation {
  readonly result: DerivedAnalysisEvidencePayload["result"];
  readonly sample_size: number;
  readonly coverage_ratio: number;
  readonly limitation_codes: readonly AnalysisReasonCode[];
  readonly material_change: boolean;
}

export interface AnalysisOraclePort {
  evaluate(input: {
    readonly node: AnalysisProgramNode;
    readonly governed_inputs: readonly GovernedPythonInput[];
    readonly source_text: string;
    readonly sandbox_outputs: PythonSandboxTransportOutcomeV2["outputs"];
  }): Promise<AnalysisOracleExpectation>;
}

export interface AnalysisReferenceFactory extends AnalysisOutputSlotFactory {
  createSystem(input: {
    readonly artifact_type: "SandboxProgram" | "SandboxExecutionReceipt";
    readonly label: string;
    readonly content_hash: `sha256:${string}`;
    readonly lease: RunWorkLease;
  }): ArtifactReference;
}

export interface AnalysisExecutorDependencies {
  readonly artifacts: AnalysisArtifactCommitPort;
  readonly queries: GovernedAnalysisQueryPort;
  readonly programs: AnalysisProgramSourcePort;
  readonly oracle: AnalysisOraclePort;
  readonly sandbox: PythonSandboxClient;
  readonly sandbox_authorization: string;
  readonly fence_guard: AnalysisFenceGuard;
  readonly references: AnalysisReferenceFactory;
  readonly catalog?: AnalysisSkillCatalog;
  readonly now?: () => Date;
}

export interface AnalysisExecutionResult {
  readonly analysis_program_ref: ArtifactReference;
  readonly completion_ref: ArtifactReference;
  readonly completion: AnalysisCompletionReceiptPayload;
  readonly evidence_refs: readonly ArtifactReference[];
  readonly validated_outputs: readonly {
    readonly node_id: string;
    readonly output: PythonSandboxTransportOutcomeV2["outputs"][number];
  }[];
}

export function analysisRepairFailureCode(
  sandbox: AnalysisSandboxExecution,
  expectation: AnalysisOracleExpectation | null,
): string | null {
  if (sandbox.status === "FAILED") return sandbox.reason_code;
  return sandbox.status === "SUCCEEDED" && expectation === null ? "ANALYSIS_ORACLE_FAILED" : null;
}

class BudgetLedger {
  #steps = 0;
  #sql = 0;
  #sandbox = 0;
  #seriesRows = 0;
  #groupRows = 0;

  constructor(
    readonly analysisProgram: AnalysisProgramPayload,
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

  usage() {
    return {
      steps: this.#steps,
      sql_executions: this.#sql,
      sandbox_executions: this.#sandbox,
      series_rows: this.#seriesRows,
      group_rows: this.#groupRows,
      elapsed_ms: Math.max(0, this.now().getTime() - this.startedAtMs),
    };
  }
}

async function contentHash(value: unknown): Promise<`sha256:${string}`> {
  return sha256ContentHash(value);
}

function uniqueReasons(values: readonly AnalysisReasonCode[]): AnalysisReasonCode[] {
  return [...new Set(values)].sort();
}

function failedNode(
  node: AnalysisProgramNode,
  reason: AnalysisReasonCode,
): AnalysisCompletionReceiptPayload["node_results"][number] {
  return {
    node_id: node.node_id,
    criticality: node.criticality,
    status: "FAILED",
    evidence_ref: null,
    reason_codes: [reason],
  };
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

      const ledger = new BudgetLedger(analysisProgram, now().getTime(), now);
      const pending = new Map(analysisProgram.nodes.map((node) => [node.node_id, node] as const));
      const results = new Map<string, AnalysisCompletionReceiptPayload["node_results"][number]>();
      const expectations = new Map<string, AnalysisOracleExpectation>();
      const evidenceRefs: ArtifactReference[] = [];
      const validatedOutputs = new Map<
        string,
        readonly PythonSandboxTransportOutcomeV2["outputs"][number][]
      >();

      const executeNode = async (node: AnalysisProgramNode) => {
        if (input.signal?.aborted) return failedNode(node, "SANDBOX_EXECUTION_FAILED");
        if (!ledger.reserveNode()) return failedNode(node, "ANALYSIS_BUDGET_EXCEEDED");
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
        if (governedInputs.length === 0) {
          return failedNode(node, "SANDBOX_EXECUTION_FAILED");
        }
        let source = await dependencies.programs.load({
          lease: input.lease,
          analysis_program: analysisProgram,
          analysis_program_ref: analysisProgramRef,
          node,
          standard_program: descriptor.standard_program,
        });
        const admission = await admitAnalysisSandboxProgram({
          analysis_program: analysisProgram,
          analysis_program_ref: analysisProgramRef,
          node_id: node.node_id,
          source_text: source.source_text,
          source_text_ref: source.source_text_ref,
          query_evidence_refs: governedInputs.map(({ query_evidence_ref: reference }) => reference),
          input_refs: governedInputs.map(({ input_ref: reference }) => reference),
          input_materialization_receipt_refs: governedInputs.map(
            ({ materialization_receipt_ref: reference }) => reference,
          ),
          catalog,
        });
        if (!admission.ok) return failedNode(node, "PROGRAM_POLICY_REJECTED");
        let program = admission.program;
        let programHash = await contentHash(program);
        let programRef = sandboxProgramRefSchema.parse(
          dependencies.references.createSystem({
            artifact_type: "SandboxProgram",
            label: `${node.node_id}:${program.program_hash}`,
            content_hash: programHash,
            lease: input.lease,
          }),
        );
        let committedProgramRef = await dependencies.artifacts.commitSystem({
          lease: input.lease,
          principal_id: input.principal_id,
          idempotency_key: `analysis-program:${analysisProgram.program_hash}:${node.node_id}`,
          reference: programRef,
          payload: program,
          content: null,
        });
        if (
          artifactReferenceIdentity(committedProgramRef) !== artifactReferenceIdentity(programRef)
        ) {
          throw new TypeError("ANALYSIS_PROGRAM_COMMIT_CORRELATION_INVALID");
        }
        let sandbox = await executeAnalysisSandbox({
          program,
          descriptor,
          source_text: source.source_text,
          governed_inputs: governedInputs,
          client: dependencies.sandbox,
          authorization: dependencies.sandbox_authorization,
          attempt: 0,
          attempt_id: input.lease.attempt_id,
          worker_fence: input.lease.worker_fence,
          fence_token: `${input.lease.attempt_id}:${input.lease.worker_fence}`,
          idempotency_key: `analysis-sandbox:${analysisProgram.program_hash}:${node.node_id}:${program.program_hash}`,
          fence_guard: dependencies.fence_guard,
          output_slots: dependencies.references,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        const evaluateSandbox = async (): Promise<AnalysisOracleExpectation | null> => {
          if (sandbox.status !== "SUCCEEDED") return null;
          try {
            const evaluated = await dependencies.oracle.evaluate({
              node,
              governed_inputs: governedInputs,
              source_text: source.source_text,
              sandbox_outputs: sandbox.outcome.outputs,
            });
            analysisResultSchema.parse(evaluated.result);
            return verifyAnalysisResult(evaluated.result).verdict === "PASS" ? evaluated : null;
          } catch {
            return null;
          }
        };
        let expectation = await evaluateSandbox();
        const repairFailureCode = analysisRepairFailureCode(sandbox, expectation);
        if (
          repairFailureCode !== null &&
          descriptor.program_mode !== "FROZEN_TEMPLATE" &&
          dependencies.programs.repair
        ) {
          const repairedSource = await dependencies.programs.repair({
            lease: input.lease,
            analysis_program: analysisProgram,
            analysis_program_ref: analysisProgramRef,
            node,
            previous_source_text: source.source_text,
            failure_code: repairFailureCode,
            attempt: 1,
          });
          const repairedAdmission = await admitAnalysisSandboxProgramRepair({
            attempt: 1,
            previous_program: program,
            previous_source_text: source.source_text,
            repaired_source_text: repairedSource.source_text,
            repaired_source_text_ref: repairedSource.source_text_ref,
            analysis_program: analysisProgram,
            analysis_program_ref: analysisProgramRef,
            catalog,
          });
          if (!repairedAdmission.ok) return failedNode(node, "PROGRAM_POLICY_REJECTED");
          source = repairedSource;
          program = repairedAdmission.program;
          programHash = await contentHash(program);
          programRef = sandboxProgramRefSchema.parse(
            dependencies.references.createSystem({
              artifact_type: "SandboxProgram",
              label: `${node.node_id}:repair-1:${program.program_hash}`,
              content_hash: programHash,
              lease: input.lease,
            }),
          );
          committedProgramRef = await dependencies.artifacts.commitSystem({
            lease: input.lease,
            principal_id: input.principal_id,
            idempotency_key: `analysis-program:${analysisProgram.program_hash}:${node.node_id}:repair-1`,
            reference: programRef,
            payload: program,
            content: null,
          });
          if (
            artifactReferenceIdentity(committedProgramRef) !== artifactReferenceIdentity(programRef)
          ) {
            throw new TypeError("ANALYSIS_PROGRAM_COMMIT_CORRELATION_INVALID");
          }
          sandbox = await executeAnalysisSandbox({
            program,
            descriptor,
            source_text: source.source_text,
            governed_inputs: governedInputs,
            client: dependencies.sandbox,
            authorization: dependencies.sandbox_authorization,
            attempt: 1,
            attempt_id: input.lease.attempt_id,
            worker_fence: input.lease.worker_fence,
            fence_token: `${input.lease.attempt_id}:${input.lease.worker_fence}`,
            idempotency_key: `analysis-sandbox:${analysisProgram.program_hash}:${node.node_id}:${program.program_hash}`,
            fence_guard: dependencies.fence_guard,
            output_slots: dependencies.references,
            ...(input.signal ? { signal: input.signal } : {}),
          });
          expectation = await evaluateSandbox();
        }
        if (sandbox.status !== "SUCCEEDED") {
          return failedNode(
            node,
            sandbox.status === "STALE_FENCE" ? "SANDBOX_FENCE_STALE" : "SANDBOX_EXECUTION_FAILED",
          );
        }
        if (expectation === null) {
          return failedNode(node, "ANALYSIS_ORACLE_FAILED");
        }
        if (!ledger.observe(expectation)) return failedNode(node, "ANALYSIS_BUDGET_EXCEEDED");
        const committedOutputRefs: DerivedAnalysisEvidencePayload["sandbox_result_refs"] = [];
        for (const outputRef of sandbox.output_refs) {
          const output = sandbox.outcome.outputs.find(
            ({ content_sha256: outputHash }) => outputHash === outputRef.content_hash,
          );
          if (!output) throw new TypeError("ANALYSIS_SANDBOX_OUTPUT_MISSING");
          const committed = await dependencies.artifacts.commitSystem({
            lease: input.lease,
            principal_id: input.principal_id,
            idempotency_key: `analysis-result:${analysisProgram.program_hash}:${node.node_id}:${output.name}`,
            reference: outputRef,
            payload: { name: output.name, type: output.type, bytes: output.bytes },
            content: Buffer.from(output.content_base64, "base64"),
          });
          if (artifactReferenceIdentity(committed) !== artifactReferenceIdentity(outputRef)) {
            throw new TypeError("ANALYSIS_RESULT_COMMIT_CORRELATION_INVALID");
          }
          committedOutputRefs.push(sandboxResultRefSchema.parse(committed));
        }
        const receiptHash = await contentHash(sandbox.outcome.receipt);
        const receiptRef = sandboxExecutionReceiptRefSchema.parse(
          dependencies.references.createSystem({
            artifact_type: "SandboxExecutionReceipt",
            label: `${node.node_id}:${sandbox.outcome.receipt.request_hash}`,
            content_hash: receiptHash,
            lease: input.lease,
          }),
        );
        const committedReceiptRef = await dependencies.artifacts.commitSystem({
          lease: input.lease,
          principal_id: input.principal_id,
          idempotency_key: `analysis-receipt:${analysisProgram.program_hash}:${node.node_id}`,
          reference: receiptRef,
          payload: sandbox.outcome.receipt,
          content: null,
        });
        if (
          artifactReferenceIdentity(committedReceiptRef) !== artifactReferenceIdentity(receiptRef)
        ) {
          throw new TypeError("ANALYSIS_RECEIPT_COMMIT_CORRELATION_INVALID");
        }
        const parameterHash = await sha256ContentHash(node.parameters);
        const inputClosureHash = await sha256ContentHash({
          query_evidence_refs: program.query_evidence_refs,
          input_refs: program.input_refs,
          input_materialization_receipt_refs: program.input_materialization_receipt_refs,
        });
        const evidenceMaterial: Omit<DerivedAnalysisEvidencePayload, "derivation_hash"> = {
          artifact_type: "DerivedAnalysisEvidence",
          protocol_version: "derived-analysis-evidence@1.0.0",
          analysis_program_ref: analysisProgramRef,
          node_id: node.node_id,
          skill_id: node.skill_id,
          algorithm_version: descriptor.algorithm_version,
          query_evidence_refs: program.query_evidence_refs,
          sandbox_program_ref: programRef,
          sandbox_execution_receipt_ref: receiptRef,
          sandbox_result_refs: committedOutputRefs,
          runtime_digest: program.runtime_digest,
          dependency_lock_digest: program.dependency_lock_digest,
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
          program,
          programRef,
          sourceText: source.source_text,
          receipt: sandbox.outcome.receipt,
          receiptRef,
          evidence,
          materializedResultRefs: committedOutputRefs,
          materializedQueryRefs: program.query_evidence_refs,
          materializedInputRefs: program.input_refs,
          allowedProfiles: [descriptor.python_import_profile],
        });
        if (!verification.ok) return failedNode(node, "ANALYSIS_ORACLE_FAILED");
        const evidenceRef = derivedAnalysisEvidenceRefSchema.parse(
          await dependencies.artifacts.commitL2({
            lease: input.lease,
            principal_id: input.principal_id,
            idempotency_key: `analysis-evidence:${analysisProgram.program_hash}:${node.node_id}`,
            payload: evidence,
          }),
        );
        evidenceRefs.push(evidenceRef);
        validatedOutputs.set(node.node_id, sandbox.outcome.outputs);
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
              const reason: AnalysisReasonCode =
                error instanceof Error &&
                error.message === "ANALYSIS_QUERY_EVIDENCE_MATERIALIZATION_INVALID"
                  ? "SANDBOX_EXECUTION_FAILED"
                  : "SANDBOX_EXECUTION_FAILED";
              return [node.node_id, failedNode(node, reason)] as const;
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
      const limitations = uniqueReasons(
        nodeResults.flatMap(({ reason_codes: reasons }) => reasons),
      );
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
