import { createHash } from "node:crypto";
import {
  type ArtifactReference,
  buildProductTeamArtifactDocument,
  type PortResult,
  type ProductTeamArtifactDocument,
  verifyResolvedContextCommitResult,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  hasRunExecutionContextProvenance,
  hasRunProviderDispatchCapability,
  hasRunResolvedContextCapability,
} from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";
import type { FrozenSemanticRelationshipReadPort } from "../semantic/semantic-relationship-read-port.js";

interface DirectQaRunReader {
  getRun(
    capability: unknown,
    input: { readonly run_id: string },
  ): Promise<PortResult<{ readonly question: string } | null>>;
}

interface DirectQaArtifactPort {
  commit(
    capability: unknown,
    lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"],
    document: ProductTeamArtifactDocument,
  ): Promise<PortResult<ArtifactReference>>;
}

class DirectQaAnalysisError extends Error {
  override readonly name = "DirectQaAnalysisError";
  constructor(readonly code: string) {
    super(code);
  }
}

function value<T>(result: PortResult<T>): T {
  if (!result.ok) throw new DirectQaAnalysisError(result.error.code);
  return result.value;
}

function identity(runId: string, purpose: string): string {
  const bytes = createHash("sha256")
    .update(`data-agent/direct-qa@2\0${runId}\0${purpose}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function asksForRelationships(question: string): boolean {
  return /(?:关联|关系|如何连接|怎么连接|join)/iu.test(question);
}

export function createDirectQaAnalysisExecutor(dependencies: {
  readonly capability: unknown;
  readonly runs: DirectQaRunReader;
  readonly artifacts: DirectQaArtifactPort;
  readonly semantic_relationships: FrozenSemanticRelationshipReadPort;
  readonly now?: () => Date;
}): RunWorkflowExecutorPort {
  const now = dependencies.now ?? (() => new Date());
  return Object.freeze({
    async execute(
      execution: Parameters<RunWorkflowExecutorPort["execute"]>[0],
    ): Promise<import("../runs/run-worker-runner.js").RunExecutorResult> {
      try {
        if (!hasRunExecutionContextProvenance(execution.context)) {
          throw new DirectQaAnalysisError("RUN_EXECUTION_CONTEXT_NOT_TRUSTED");
        }
        const run = value(
          await dependencies.runs.getRun(dependencies.capability, {
            run_id: execution.lease.run_id,
          }),
        );
        if (!run) throw new DirectQaAnalysisError("RUN_NOT_FOUND");
        const blockId = `direct-qa-${execution.lease.attempt_id}`;
        const emitDisplayEvent = execution.context.emitDisplayEvent;
        if (!emitDisplayEvent) throw new DirectQaAnalysisError("RUN_DISPLAY_EVENT_PORT_REQUIRED");
        value(
          await emitDisplayEvent({
            kind: "reasoning_started",
            key: "direct.qa.started",
            block_id: blockId,
            title: "直接分析问题",
          }),
        );

        let answer: string;
        if (asksForRelationships(run.question)) {
          const contextCapability = execution.context.getResolvedContextCapability?.();
          if (!hasRunResolvedContextCapability(contextCapability)) {
            throw new DirectQaAnalysisError("RESOLVED_CONTEXT_REQUIRED");
          }
          const resolved = await verifyResolvedContextCommitResult(
            value(await contextCapability.resolve()),
          );
          const relationships = value(
            await dependencies.semantic_relationships.read({
              capability: dependencies.capability,
              scope: execution.lease.scope,
              semantic_domain: resolved.package.semantic_domain,
              release_id: resolved.package.semantic_release.resource_id,
              release_hash: resolved.package.semantic_release.resource_hash,
            }),
          );
          const names = new Map(
            relationships.nodes.map((node) => [node.node_key, node.name] as const),
          );
          const relationshipLines = relationships.edges.map(
            (edge) =>
              `${names.get(edge.source_node_key) ?? edge.source_node_key} → ${names.get(edge.target_node_key) ?? edge.target_node_key}（${edge.category}: ${edge.label}）`,
          );
          answer = [
            `冻结 Semantic Release ${relationships.release_identity.release_id} 的关系如下：`,
            ...(relationshipLines.slice(0, 20).length > 0
              ? relationshipLines.slice(0, 20)
              : ["当前 Release 没有可公开的关系边。"]),
          ].join("\n");
          const document = await buildProductTeamArtifactDocument({
            schema_version: "product-team-artifact@1.0.0",
            artifact_ref: {
              artifact_id: identity(execution.lease.run_id, "relationships:AnalysisReport"),
              artifact_type: "AnalysisReport",
              ...execution.lease.scope,
              run_id: execution.lease.run_id,
              revision: 1,
              content_hash: `sha256:${"0".repeat(64)}`,
            },
            profile_id: "semantic-management-agent",
            task_id: identity(execution.lease.run_id, "task:relationships"),
            source_refs: [],
            projection: {
              kind: "REPORT",
              title: "语义关系分析",
              sections: [{ heading: "冻结关系", body_text: answer, source_refs: [] }],
            },
            committed_at: now().toISOString(),
          });
          value(
            await dependencies.artifacts.commit(dependencies.capability, execution.lease, document),
          );
        } else {
          const provider = execution.context.getProviderDispatchCapability();
          if (!hasRunProviderDispatchCapability(provider)) {
            throw new DirectQaAnalysisError("DIRECT_MODEL_PROVIDER_REQUIRED");
          }
          const response = value(
            await provider.invoke({
              logical_call_id: identity(execution.lease.run_id, "direct-model"),
            }),
          );
          answer = z
            .strictObject({ answer: z.string().min(1) })
            .parse(JSON.parse(response.output_text)).answer;
        }

        value(
          await emitDisplayEvent({
            kind: "reasoning_completed",
            key: "direct.qa.completed",
            block_id: blockId,
            summary: "直接分析与证据提交已完成。",
            duration_ms: 0,
          }),
        );
        value(
          await emitDisplayEvent({ kind: "answer_delta", key: "direct.qa.answer", delta: answer }),
        );
        return { kind: "COMPLETED" };
      } catch (error) {
        const code =
          error instanceof DirectQaAnalysisError
            ? error.code
            : error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)
              ? error.message
              : "DIRECT_QA_ANALYSIS_FAILED";
        return { kind: "FAILED", error_code: code };
      }
    },
  });
}

export const directQaAnalysisInternals = Object.freeze({ asksForRelationships });
