import "server-only";

import { randomUUID } from "node:crypto";
import type { PortResult, SemanticBaseReleaseIdentity } from "@data-agent/contracts";
import {
  computeSemanticChangeProposalDigest,
  computeSemanticCompileInputDigest,
  type SemanticAgentReceipt,
  type SemanticCandidateOperation,
  type SemanticCompileRequest,
  semanticCandidateOperationSchema,
  semanticCompileRequestSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type {
  PostgresSchemaSnapshotStore,
  PostgresSemanticCandidateCompileStore,
  PostgresSemanticExplorerReader,
  SemanticCompileBundle,
} from "@data-agent/platform";
import {
  buildAgentSemanticCandidateDraft,
  buildSchemaFeaturePacket,
  buildSemanticAgentReceipt,
  runSemanticCandidateAgent,
  validateSemanticChangeProposal,
} from "@data-agent/semantic/authoring";
import type { SemanticAuthorityContext } from "./semantic-authority";
import type { SemanticGovernanceService } from "./semantic-governance-service";
import type {
  CertifiedTestCenterModelRuntime,
  TestCenterModelRuntime,
} from "./test-center-model-runtime";

export interface SemanticCompileSubmitInput {
  readonly semantic_domain: string;
  readonly compile_run_id: string;
  readonly selected_operation_ids: readonly string[];
  readonly idempotency_key: string;
  readonly edited_operations?: readonly SemanticCandidateOperation[];
}

export interface SemanticCandidateModelRuntimeResolver {
  resolve(authority: SemanticAuthorityContext): Promise<TestCenterModelRuntime>;
}

export interface SemanticCandidateServiceDependencies {
  readonly snapshot_store: PostgresSchemaSnapshotStore;
  readonly explorer_reader: PostgresSemanticExplorerReader;
  readonly compile_store: PostgresSemanticCandidateCompileStore;
  readonly governance_service: SemanticGovernanceService;
  readonly model_runtime: SemanticCandidateModelRuntimeResolver;
}

function unavailableReceipt(): Promise<SemanticAgentReceipt> {
  return Promise.all([
    sha256ContentHash({ profile: "unconfigured" }),
    sha256ContentHash({ prompt: "semantic-candidate-prompt@1.0.0" }),
    sha256ContentHash({ tool_allowlist: [], max_tool_calls: 0 }),
    sha256ContentHash({ compiler: "semantic-schema-candidate-compiler@1.0.0" }),
    sha256ContentHash({ policy: "semantic-candidate-policy@1.0.0" }),
  ]).then(
    ([
      model_profile_digest,
      prompt_digest,
      tool_policy_digest,
      compiler_digest,
      candidate_policy_digest,
    ]) => ({
      provider_id: "unconfigured",
      model_id: "unconfigured",
      model_profile_digest,
      prompt_digest,
      tool_policy_digest,
      compiler_digest,
      candidate_policy_digest,
    }),
  );
}

function failure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function baseReleaseFromActive(
  active: Awaited<ReturnType<PostgresSemanticExplorerReader["getActiveSource"]>>,
): PortResult<SemanticBaseReleaseIdentity | null> {
  if (!active.ok) {
    if (active.error.code === "SEMANTIC_EXPLORER_RELEASE_NOT_FOUND") {
      return { ok: true, value: null };
    }
    return active;
  }
  return {
    ok: true,
    value: {
      release_id: active.value.release.release_id,
      generation: active.value.release.release_generation,
      release_digest: active.value.release.release_digest,
    },
  };
}

function modelBudget(runtime: CertifiedTestCenterModelRuntime, inputBytes: number) {
  const context = runtime.profile.operational_constraints.context_window;
  if (context.verification_status !== "VERIFIED") return null;
  const maxOutputTokens = Math.min(8_192, context.max_output_tokens);
  const maxInputTokens = inputBytes + 4_096;
  if (maxInputTokens + maxOutputTokens > context.max_context_tokens) return null;
  return {
    timeout_ms: 120_000,
    max_input_tokens: maxInputTokens,
    max_output_tokens: maxOutputTokens,
  };
}

export function createSemanticCandidateService(dependencies: SemanticCandidateServiceDependencies) {
  return Object.freeze({
    async compile(
      authority: SemanticAuthorityContext,
      requestInput: SemanticCompileRequest,
    ): Promise<PortResult<SemanticCompileBundle>> {
      const request = semanticCompileRequestSchema.parse(requestInput);
      if (request.semantic_domain !== authority.scope.semanticDomain) {
        return failure("SEMANTIC_CANDIDATE_COMPILE_SCOPE_FORBIDDEN", "编译请求不属于当前语义域。");
      }
      const snapshot = await dependencies.snapshot_store.getSnapshot(
        authority.capabilityInput,
        request.snapshot_id,
      );
      if (!snapshot.ok) return snapshot;
      const drift = request.drift_event_id
        ? await dependencies.compile_store.getDriftEvidence(
            authority.capabilityInput,
            request.semantic_domain,
            snapshot.value.content.datasource_id,
            request.drift_event_id,
          )
        : null;
      if (drift && !drift.ok) return drift;
      if (
        drift &&
        (drift.value.event.current_snapshot_content_hash !== snapshot.value.snapshot_content_hash ||
          drift.value.event.datasource_id !== snapshot.value.content.datasource_id)
      ) {
        return failure(
          "SEMANTIC_CANDIDATE_COMPILE_STALE_BASE",
          "漂移事件不属于当前物理快照，请重新生成候选。",
        );
      }
      const base = baseReleaseFromActive(
        await dependencies.explorer_reader.getActiveSource(
          authority.capabilityInput,
          request.semantic_domain,
        ),
      );
      if (!base.ok) return base;

      const modelRuntime = await dependencies.model_runtime.resolve(authority);
      const agentReceipt = modelRuntime.available
        ? await buildSemanticAgentReceipt(modelRuntime.profile)
        : await unavailableReceipt();
      const packet = await buildSchemaFeaturePacket({
        scope: {
          app_id: authority.scope.appId,
          tenant_id: authority.scope.tenantId,
          environment: authority.scope.environment,
          semantic_domain: request.semantic_domain,
        },
        snapshot: snapshot.value,
        drift: drift
          ? {
              event: drift.value.event,
              digest: drift.value.event_storage_digest as `sha256:${string}`,
            }
          : null,
        base_release: base.value,
      });
      const inputDigest = await computeSemanticCompileInputDigest({
        request,
        scope: packet.scope,
        snapshot_digest: packet.snapshot_digest,
        drift_digest: packet.drift_digest,
        base_release: packet.base_release,
        agent_receipt: agentReceipt,
      });
      const proposedCompileRunId = randomUUID();
      const begin = await dependencies.compile_store.begin(authority.capabilityInput, {
        semantic_domain: request.semantic_domain,
        compile_run_id: proposedCompileRunId,
        source_revision_id: randomUUID(),
        idempotency_key: request.idempotency_key,
        input_digest: inputDigest,
        feature_packet: packet,
        agent_receipt: agentReceipt,
      });
      if (!begin.ok) return begin;
      if (!begin.value.created || begin.value.terminal !== "RUNNING") {
        return dependencies.compile_store.get(
          authority.capabilityInput,
          request.semantic_domain,
          begin.value.compile_run_id,
        );
      }

      if (!modelRuntime.available) {
        const finished = await dependencies.compile_store.finish(authority.capabilityInput, {
          semantic_domain: request.semantic_domain,
          compile_run_id: begin.value.compile_run_id,
          terminal: "AGENT_UNAVAILABLE",
          proposal: null,
          failure_code: "MODEL_PROFILE_UNAVAILABLE",
        });
        if (!finished.ok) return finished;
      } else {
        const inputBytes = Buffer.byteLength(JSON.stringify(packet), "utf8");
        const budget = modelBudget(modelRuntime, inputBytes);
        const result = budget
          ? await runSemanticCandidateAgent({
              profile: modelRuntime.profile,
              model_provider: modelRuntime.model_provider,
              packet,
              compile_run_id: begin.value.compile_run_id,
              source_revision_id: begin.value.source_revision_id,
              request_id: randomUUID(),
              attempt_id: randomUUID(),
              budget,
            })
          : {
              terminal: "VALIDATION_FAILED" as const,
              proposal: null,
              failure_code: "FEATURE_PACKET_CONTEXT_LIMIT_EXCEEDED",
            };
        const finished = await dependencies.compile_store.finish(authority.capabilityInput, {
          semantic_domain: request.semantic_domain,
          compile_run_id: begin.value.compile_run_id,
          terminal: result.terminal,
          proposal: result.proposal,
          failure_code: result.failure_code,
        });
        if (!finished.ok) return finished;
      }
      return dependencies.compile_store.get(
        authority.capabilityInput,
        request.semantic_domain,
        begin.value.compile_run_id,
      );
    },

    get(
      authority: SemanticAuthorityContext,
      semanticDomain: string,
      compileRunId: string,
    ): Promise<PortResult<SemanticCompileBundle>> {
      return dependencies.compile_store.get(
        authority.capabilityInput,
        semanticDomain,
        compileRunId,
      );
    },

    async submit(authority: SemanticAuthorityContext, input: SemanticCompileSubmitInput) {
      const bundle = await dependencies.compile_store.get(
        authority.capabilityInput,
        input.semantic_domain,
        input.compile_run_id,
      );
      if (!bundle.ok) return bundle;
      if (bundle.value.terminal !== "COMPILED" || !bundle.value.proposal) {
        return failure(
          "SEMANTIC_CANDIDATE_COMPILE_NOT_REVIEWABLE",
          "只有已编译且尚未发布的提案可以提交人工审核。",
        );
      }
      const originalProposal = bundle.value.proposal;
      const selectedIds = new Set(input.selected_operation_ids);
      const originalById = new Map(
        originalProposal.operations.map(
          (operation) => [operation.operation_id, operation] as const,
        ),
      );
      const editedById = new Map<string, SemanticCandidateOperation>();
      for (const operationInput of input.edited_operations ?? []) {
        const operation = semanticCandidateOperationSchema.parse(operationInput);
        const original = originalById.get(operation.operation_id);
        if (
          !selectedIds.has(operation.operation_id) ||
          !original ||
          original.target_type !== operation.target_type ||
          original.target_id !== operation.target_id ||
          original.action !== operation.action
        ) {
          return failure(
            "SEMANTIC_CANDIDATE_REVIEW_EDIT_INVALID",
            "人工编辑只能修改已选择操作的内容，不能改写 Agent 操作身份。",
          );
        }
        editedById.set(operation.operation_id, operation);
      }
      const reviewedOperations = input.selected_operation_ids.map(
        (operationId) => editedById.get(operationId) ?? originalById.get(operationId),
      );
      if (reviewedOperations.some((operation) => operation === undefined)) {
        return failure("SEMANTIC_CANDIDATE_REVIEW_EDIT_INVALID", "选择集中包含不存在的操作。");
      }
      const reviewedMaterial = {
        ...originalProposal,
        operations: reviewedOperations as SemanticCandidateOperation[],
      };
      const { proposal_digest: _originDigest, ...reviewedWithoutDigest } = reviewedMaterial;
      const reviewedProposal = {
        ...reviewedWithoutDigest,
        proposal_digest: await computeSemanticChangeProposalDigest(reviewedWithoutDigest),
      };
      const reviewedValidation = await validateSemanticChangeProposal(
        reviewedProposal,
        bundle.value.feature_packet,
      );
      if (!reviewedValidation.valid) {
        return failure(
          "SEMANTIC_CANDIDATE_REVIEW_EDIT_INVALID",
          reviewedValidation.issues[0]?.message ?? "人工编辑后的操作未通过确定性校验。",
        );
      }
      const draft = buildAgentSemanticCandidateDraft({
        proposal: reviewedProposal,
        semantic_domain: input.semantic_domain,
        idempotency_key: input.idempotency_key,
        selected_operation_ids: input.selected_operation_ids,
        origin_proposal_digest: originalProposal.proposal_digest,
      });
      const candidate = await dependencies.governance_service.createCandidate(authority, draft);
      const attached = await dependencies.compile_store.attachCandidate(authority.capabilityInput, {
        semantic_domain: input.semantic_domain,
        compile_run_id: input.compile_run_id,
        candidate_id: candidate.candidate_id,
        candidate_revision_id: candidate.revision_id,
      });
      if (!attached.ok) return attached;
      return { ok: true as const, value: candidate };
    },
  });
}

export type SemanticCandidateService = ReturnType<typeof createSemanticCandidateService>;
