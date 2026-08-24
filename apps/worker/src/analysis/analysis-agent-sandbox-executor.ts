import type { AnalysisProgramPayload, ArtifactReference } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type AnalysisResultStage,
  analysisResultPublishObservationSchema,
  type AnalysisSandboxExecutionReceipt,
  type AnalysisSandboxRuntimeProfile,
  analysisSandboxExecutionReceiptSchema,
} from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import {
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  type StatisticalOperatorObligation,
} from "@data-agent/contracts/statistical-operators";
import type { OpenSandboxAnalysisRuntime } from "../runs/opensandbox-analysis-runtime.js";
import {
  type AnalysisAgentContextPort,
  buildAnalysisAgentInitialMessages,
} from "./analysis-agent-prompt.js";
import {
  type AnalysisToolLoopProgressEvent,
  type AnalysisToolLoopResult,
  executeAnalysisToolLoop,
} from "./analysis-tool-loop.js";
import type { AnalysisAgentModelPort } from "./deepseek-analysis-agent.js";
import {
  type GovernedAnalysisInput,
  verifyGovernedAnalysisInputs,
} from "./governed-analysis-input.js";
import {
  type AnalysisGovernedResultAuthorityPort,
  createGovernedResultBridge,
} from "./governed-result-bridge.js";
import type { AnalysisLifecycleAuthorityPort } from "./analysis-lifecycle-authority.js";
import { createOpenSandboxOperatorArgumentExtractor } from "./opensandbox-operator-argument-extractor.js";
import type { AnalysisResultClosureArtifact } from "./result-publisher.js";

type AnalysisProgramNode = AnalysisProgramPayload["nodes"][number];

export interface AnalysisFenceGuard {
  isCurrent(input: {
    readonly run_id: string;
    readonly attempt_id: string;
    readonly worker_fence: number;
    readonly fence_token: string;
  }): Promise<boolean>;
}

export interface AnalysisAgentSandboxResult {
  readonly recovery_phase: import("@data-agent/contracts/ports").AnalysisContextJournalEntry["event"]["event_type"] | null;
  readonly request_hash: `sha256:${string}`;
  readonly started_at: string;
  readonly finished_at: string;
  readonly elapsed_ms: number;
  readonly runtime_profile: AnalysisSandboxRuntimeProfile;
  readonly runtime: {
    readonly agent_image: string;
    readonly operator_image: string;
    readonly agent_sandbox_id: string;
    readonly operator_sandbox_id: string;
    readonly secure_access: boolean;
  };
  readonly stage: AnalysisResultStage;
  readonly tool_loop: AnalysisToolLoopResult;
}

function inputPath(input: GovernedAnalysisInput): string {
  return `/workspace/inputs/${input.name}.${input.format.toLowerCase()}`;
}

export async function executeAnalysisAgentSandbox(input: {
  readonly lease: RunWorkLease;
  readonly analysis_program: AnalysisProgramPayload;
  readonly analysis_program_ref: ArtifactReference;
  readonly node: AnalysisProgramNode;
  readonly governed_inputs: readonly GovernedAnalysisInput[];
  readonly governed_results: AnalysisGovernedResultAuthorityPort;
  readonly lifecycle: AnalysisLifecycleAuthorityPort;
  readonly contexts: AnalysisAgentContextPort;
  readonly model: AnalysisAgentModelPort;
  readonly runtime: OpenSandboxAnalysisRuntime;
  readonly runtime_profile: AnalysisSandboxRuntimeProfile;
  readonly fence_guard: AnalysisFenceGuard;
  readonly fence_token: string;
  readonly max_model_calls: number;
  readonly on_progress?: (event: AnalysisToolLoopProgressEvent) => void;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
}): Promise<AnalysisAgentSandboxResult> {
  if (
    input.node.execution_mode !== "MODEL_GENERATED" ||
    input.node.generated_source_policy === "NO_GENERATED_SOURCE"
  ) {
    throw new TypeError("ANALYSIS_AGENT_NODE_UNSUPPORTED");
  }
  if (
    !Number.isInteger(input.max_model_calls) ||
    input.max_model_calls < 2 ||
    input.max_model_calls > 32
  ) {
    throw new TypeError("ANALYSIS_AGENT_MODEL_BUDGET_INVALID");
  }
  const fence = {
    run_id: input.lease.run_id,
    attempt_id: input.lease.attempt_id,
    worker_fence: input.lease.worker_fence,
    fence_token: input.fence_token,
  };
  if (!(await input.fence_guard.isCurrent(fence))) {
    throw new TypeError("SANDBOX_FENCE_STALE");
  }
  await verifyGovernedAnalysisInputs({
    analysis_program_ref: input.analysis_program_ref,
    governed_inputs: input.governed_inputs,
  });
  const context = await input.contexts.load({
    lease: input.lease,
    analysis_program: input.analysis_program,
    analysis_program_ref: input.analysis_program_ref,
    node: input.node,
  });
  const initialMessages = await buildAnalysisAgentInitialMessages({
    analysis_program: input.analysis_program,
    node: input.node,
    context,
  });
  const requestHash = await sha256ContentHash({
    schema_version: "analysis-agent-sandbox-request@1.0.0",
    analysis_program_ref: input.analysis_program_ref,
    node: input.node,
    input_refs: input.governed_inputs.map(({ input_ref }) => input_ref),
    query_evidence_refs: input.governed_inputs.map(({ query_evidence_ref }) => query_evidence_ref),
    initial_messages: initialMessages,
    runtime_profile: input.runtime_profile,
  });
  const now = input.now ?? (() => new Date());
  const started = now();
  const contextGeneration = 1;
  const recoveredStage = await input.lifecycle.recoverStage({
    lease: input.lease,
    node_id: input.node.node_id,
    context_generation: contextGeneration,
  });
  if (recoveredStage) {
    const cleanup = await input.runtime.cleanupSession({
      run_id: input.lease.run_id,
      node_id: input.node.node_id,
    });
    if (cleanup.residual !== 0) {
      throw new TypeError("ANALYSIS_SANDBOX_CLEANUP_FAILED");
    }
    const snapshot = recoveredStage.loaded.execution_snapshot;
    const recoveredRuntimeDigest = await sha256ContentHash({
      provider: "OpenSandbox",
      runtime_profile: snapshot.runtime_profile,
      agent_image: snapshot.runtime.agent_image,
      operator_image: snapshot.runtime.operator_image,
      secure_access: snapshot.runtime.secure_access,
    });
    if (
      snapshot.request_hash !== requestHash ||
      snapshot.runtime_profile !== input.runtime_profile ||
      recoveredRuntimeDigest !== recoveredStage.identity.runtime_digest ||
      recoveredStage.identity.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST
    ) {
      throw new TypeError("ANALYSIS_RESULT_STAGE_RECOVERY_IDENTITY_MISMATCH");
    }
    if (recoveredStage.journal_phase === "PUBLISH_STAGE_CREATED") {
      await input.lifecycle.freeze({
        lease: input.lease,
        node_id: input.node.node_id,
        context_generation: contextGeneration,
        ...recoveredStage.identity,
        stage: recoveredStage.stage,
      });
    }
    const publishedResult = {
      closure: recoveredStage.loaded,
      observation: analysisResultPublishObservationSchema.parse({
        schema_version: "analysis-result-publish-observation@1.0.0",
        publish_id: recoveredStage.loaded.publish_id,
        status: "PUBLISHED",
        contract_hash: recoveredStage.loaded.contract_hash,
        manifest_hash: recoveredStage.loaded.manifest_hash,
        closure_hash: recoveredStage.loaded.closure_hash,
        stage_id: recoveredStage.stage.stage_id,
        artifacts: recoveredStage.loaded.artifacts.map(({ content: _content, ...artifact }) => artifact),
      }),
    };
    return Object.freeze({
      recovery_phase: recoveredStage.journal_phase,
      request_hash: snapshot.request_hash,
      started_at: snapshot.started_at,
      finished_at: snapshot.finished_at,
      elapsed_ms: snapshot.elapsed_ms,
      runtime_profile: snapshot.runtime_profile,
      runtime: snapshot.runtime,
      stage: recoveredStage.stage,
      tool_loop: Object.freeze({
        published_result: publishedResult,
        cells: Object.freeze(
          snapshot.cells.map((cell) => ({
            cell_id: cell.cell_id,
            source: "",
            source_sha256: cell.source_sha256 as `sha256:${string}`,
            source_ref: cell.source_ref,
            observation: {
              schema_version: "analysis-cell-observation@1.0.0" as const,
              cell_id: cell.cell_id,
              status: cell.status,
              execution_id: cell.execution_id,
              execution_count: cell.execution_count,
              elapsed_ms: cell.elapsed_ms,
              stdout: "",
              stderr: "",
              result_text: null,
              error: null,
            },
          })),
        ),
        operator_observations: Object.freeze([]),
        operator_finalization: recoveredStage.loaded.operator_finalization,
        provider_invocation_refs: Object.freeze(
          snapshot.provider_invocation_refs.map((reference) => ({
            ...reference,
            resource_hash: reference.resource_hash as `sha256:${string}`,
          })),
        ),
        state_sequence: Object.freeze(["PUBLISH_STAGED"] as const),
        repair_attempts: Object.freeze({
          MODEL_TOOL_CONTRACT: 0 as const,
          CELL_EXECUTION: 0 as const,
          CELL_POLICY: 0 as const,
          PUBLISH_SYMBOL_CONTRACT: 0 as const,
        }),
      }),
    });
  }
  const session = await input.runtime.createSession({
    run_id: input.lease.run_id,
    node_id: input.node.node_id,
    profile: input.runtime_profile,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const runtimeDigest = (await sha256ContentHash({
    provider: "OpenSandbox",
    runtime_profile: input.runtime_profile,
    agent_image: session.agent_image,
    operator_image: session.operator_image,
    secure_access: session.secure_access,
  })) as `sha256:${string}`;
  const lifecycleIdentity = {
    lease: input.lease,
    node_id: input.node.node_id,
    context_generation: contextGeneration,
    runtime_digest: runtimeDigest,
    policy_version: "analysis-cell-policy@1.0.0",
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  } as const;
  let durableStage: AnalysisResultStage | null = null;
  try {
    for (const governed of input.governed_inputs) {
      await session.uploadAgentFile({
        path: inputPath(governed),
        content: governed.content,
        content_sha256: governed.input_ref.content_hash as `sha256:${string}`,
      });
    }
    const governedResultBridge = createGovernedResultBridge({
      authority: input.governed_results,
      lease: input.lease,
      analysis_program_ref: input.analysis_program_ref,
      analysis_program: input.analysis_program,
      program_hash: input.analysis_program.program_hash as `sha256:${string}`,
      node_id: input.node.node_id,
      context_generation: contextGeneration,
      runtime_digest: runtimeDigest,
      policy_version: "analysis-cell-policy@1.0.0",
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    });
    const recoveredOperatorResults = await governedResultBridge.recover({
      session,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const toolLoop = await executeAnalysisToolLoop({
      run_id: input.lease.run_id,
      analysis_program_id: input.analysis_program_ref.artifact_id,
      node_id: input.node.node_id,
      generated_source_policy: input.node.generated_source_policy,
      runtime_profile: input.runtime_profile,
      result_contract: input.node.result_contract,
      operator_obligations: input.node.operator_obligations,
      operator_argument_extractor: createOpenSandboxOperatorArgumentExtractor(
        session,
        input.signal,
      ),
      governed_result_bridge: governedResultBridge,
      recovered_operator_results: recoveredOperatorResults,
      stage: {
        async stage(stageInput) {
          if (durableStage) throw new TypeError("ANALYSIS_RESULT_PUBLISH_DUPLICATE");
          const stagedAt = now();
          durableStage = await input.lifecycle.stage({
            ...lifecycleIdentity,
            closure: stageInput.closure,
            governed_results: stageInput.governed_results,
            operator_finalization: stageInput.operator_finalization,
            execution_snapshot: {
              schema_version: "analysis-result-stage-execution-snapshot@1.0.0",
              request_hash: requestHash,
              runtime_profile: input.runtime_profile,
              runtime: {
                agent_image: session.agent_image,
                operator_image: session.operator_image,
                agent_sandbox_id: session.agent_sandbox_id,
                operator_sandbox_id: session.operator_sandbox_id,
                secure_access: session.secure_access,
              },
              cells: stageInput.cells.map(({ cell_id, source_sha256, source_ref, observation }) => ({
                cell_id,
                source_sha256,
                source_ref,
                execution_id: observation.execution_id,
                execution_count: observation.execution_count,
                elapsed_ms: observation.elapsed_ms,
                status: observation.status,
              })),
              provider_invocation_refs: [...stageInput.provider_invocation_refs],
              started_at: started.toISOString(),
              finished_at: stagedAt.toISOString(),
              elapsed_ms: Math.max(0, stagedAt.getTime() - started.getTime()),
            },
          });
          return {
            stage_id: durableStage.stage_id,
            closure_hash: durableStage.closure_hash as `sha256:${string}`,
          };
        },
      },
      initial_messages: initialMessages,
      model: input.model,
      session,
      max_tool_turns: input.max_model_calls - 1,
      max_output_tokens: 8_192,
      ...(input.on_progress ? { on_progress: input.on_progress } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!durableStage) throw new TypeError("ANALYSIS_RESULT_STAGE_MISSING");
    await session.freezeAgentContext();
    await input.lifecycle.freeze({ ...lifecycleIdentity, stage: durableStage });
    if (!(await input.fence_guard.isCurrent(fence))) {
      throw new TypeError("SANDBOX_FENCE_STALE");
    }
    const finished = now();
    return Object.freeze({
      recovery_phase: null,
      request_hash: requestHash,
      started_at: started.toISOString(),
      finished_at: finished.toISOString(),
      elapsed_ms: Math.max(0, finished.getTime() - started.getTime()),
      runtime_profile: input.runtime_profile,
      runtime: Object.freeze({
        agent_image: session.agent_image,
        operator_image: session.operator_image,
        agent_sandbox_id: session.agent_sandbox_id,
        operator_sandbox_id: session.operator_sandbox_id,
        secure_access: session.secure_access,
      }),
      stage: durableStage,
      tool_loop: toolLoop,
    });
  } finally {
    await session.close();
  }
}

export async function buildAnalysisSandboxExecutionReceipt(input: {
  readonly lease: RunWorkLease;
  readonly idempotency_key: string;
  readonly fence_token: string;
  readonly analysis_program_ref: ArtifactReference;
  readonly node_id: string;
  readonly generated_source_policy: "OPEN_ANALYSIS" | "GOVERNED_OPERATOR_ORCHESTRATION";
  readonly operator_registry_digest: `sha256:${string}`;
  readonly operator_obligations: readonly StatisticalOperatorObligation[];
  readonly execution: AnalysisAgentSandboxResult;
  readonly governed_inputs: readonly GovernedAnalysisInput[];
  readonly outputs: readonly {
    readonly output: AnalysisResultClosureArtifact;
    readonly reference: ArtifactReference;
  }[];
}): Promise<AnalysisSandboxExecutionReceipt> {
  const material = {
    schema_version: "analysis-sandbox-execution-receipt@1.0.0" as const,
    workspace_id: input.lease.scope.tenant_id,
    run_id: input.lease.run_id,
    attempt_id: input.lease.attempt_id,
    worker_fence: input.lease.worker_fence,
    fence_token: input.fence_token,
    idempotency_key: input.idempotency_key,
    request_hash: input.execution.request_hash,
    analysis_program_ref: input.analysis_program_ref,
    node_id: input.node_id,
    runtime_profile: input.execution.runtime_profile,
    runtime: {
      provider: "OpenSandbox" as const,
      opensandbox_sdk_version: "0.1.11",
      code_interpreter_sdk_version: "0.1.3",
      agent_image: input.execution.runtime.agent_image,
      operator_image: input.execution.runtime.operator_image,
      agent_sandbox_id: input.execution.runtime.agent_sandbox_id,
      operator_sandbox_id: input.execution.runtime.operator_sandbox_id,
    },
    generated_source_policy: input.generated_source_policy,
    operator_registry_digest: input.operator_registry_digest,
    operator_obligations: input.operator_obligations,
    operator_receipts: input.execution.tool_loop.operator_finalization.operator_receipts,
    operator_receipt_closure_hash:
      input.execution.tool_loop.operator_finalization.operator_receipt_closure_hash,
    result_contract_hash: input.execution.tool_loop.published_result.closure.contract_hash,
    publish_manifest_hash: input.execution.tool_loop.published_result.closure.manifest_hash,
    published_closure_hash: input.execution.tool_loop.published_result.closure.closure_hash,
    publish_id: input.execution.tool_loop.published_result.closure.publish_id,
    inputs: input.governed_inputs.map((governed) => ({
      name: governed.name,
      format: governed.format,
      query_evidence_ref: governed.query_evidence_ref,
      input_ref: governed.input_ref,
      materialization_receipt_ref: governed.materialization_receipt_ref,
      content_sha256: governed.input_ref.content_hash,
      bytes: governed.content.byteLength,
    })),
    cells: input.execution.tool_loop.cells.map(({ cell_id, source_sha256, observation }) => ({
      cell_id,
      source_sha256,
      execution_id: observation.execution_id,
      execution_count: observation.execution_count,
      elapsed_ms: observation.elapsed_ms,
      status: observation.status,
    })),
    started_at: input.execution.started_at,
    finished_at: input.execution.finished_at,
    elapsed_ms: input.execution.elapsed_ms,
    hard_controls: {
      network_isolated: true as const,
      scoped_filesystem: true as const,
      separate_operator_sandbox: true as const,
      resource_limits_enforced: true as const,
      secure_access: input.execution.runtime.secure_access,
    },
    status: "SUCCEEDED" as const,
    failure_code: null,
    outputs: input.outputs.map(({ output, reference }) => ({
      artifact_name: output.artifact_name,
      artifact_kind: output.artifact_kind,
      media_type: output.media_type,
      reference,
      content_sha256: output.content_sha256,
      bytes: output.bytes,
    })),
  };
  return analysisSandboxExecutionReceiptSchema.parse({
    ...material,
    execution_hash: await sha256ContentHash({
      hash_domain: "analysis-sandbox-execution-receipt@1.0.0",
      value: material,
    }),
  });
}

export const analysisAgentSandboxExecutorInternals = Object.freeze({ inputPath });
