import "server-only";

import {
  buildSemanticCandidateRevisionSaveCommand,
  buildSemanticManualSessionStartCommand,
  type KnowledgeEvidenceSelectionDetail,
  type PortResult,
  type SemanticAuthoringStorePort,
  type SemanticAuthoringValidationReceipt,
  type SemanticCandidateRevisionSaveRequest,
  type SemanticCandidateRevisionSaveResult,
  type SemanticGraphPatchOperation,
  type SemanticGraphSource,
  type SemanticManualEdit,
  type SemanticManualSessionStartRequest,
  sha256ContentHash,
} from "@data-agent/contracts";
import type {
  createPostgresSemanticCandidateRevisionStore,
  PostgresSemanticGraphStore,
} from "@data-agent/platform";
import { createSemanticGraphPatch } from "@data-agent/semantic/authoring";
import {
  compileSemanticGraphV2,
  SEMANTIC_GRAPH_COMPILER_VERSION,
} from "@data-agent/semantic/governance";

interface Dependencies {
  readonly capability: unknown;
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
  };
  readonly principal_id: string;
  readonly create_authoring_store: (semanticDomain: string) => SemanticAuthoringStorePort;
  readonly graph_store: PostgresSemanticGraphStore;
  readonly candidate_revision_store: ReturnType<
    typeof createPostgresSemanticCandidateRevisionStore
  >;
  readonly knowledge_registry: Readonly<{
    getEvidenceSelection(
      capability: unknown,
      selectionId: string,
    ): Promise<PortResult<KnowledgeEvidenceSelectionDetail>>;
  }>;
  readonly new_id: () => string;
  readonly now: () => Date;
}

function failure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

async function materializeOperation(
  edit: SemanticManualEdit,
  graph: SemanticGraphSource,
): Promise<SemanticGraphPatchOperation> {
  switch (edit.operation) {
    case "ADD_EDGE_TYPE":
      return edit;
    case "ADD_NODE":
      return edit;
    case "UPDATE_NODE": {
      const current = graph.nodes.find((node) => node.node_id === edit.node.node_id);
      if (!current) throw new TypeError("SEMANTIC_MANUAL_NODE_NOT_FOUND");
      return { ...edit, expected_entry_digest: await sha256ContentHash(current) };
    }
    case "RETIRE_NODE": {
      const current = graph.nodes.find((node) => node.node_id === edit.node_id);
      if (!current) throw new TypeError("SEMANTIC_MANUAL_NODE_NOT_FOUND");
      return { ...edit, expected_entry_digest: await sha256ContentHash(current) };
    }
    case "ADD_EDGE":
      return edit;
    case "UPDATE_EDGE": {
      const current = graph.edges.find((edge) => edge.edge_id === edit.edge.edge_id);
      if (!current) throw new TypeError("SEMANTIC_MANUAL_EDGE_NOT_FOUND");
      return { ...edit, expected_entry_digest: await sha256ContentHash(current) };
    }
    case "RETIRE_EDGE": {
      const current = graph.edges.find((edge) => edge.edge_id === edit.edge_id);
      if (!current) throw new TypeError("SEMANTIC_MANUAL_EDGE_NOT_FOUND");
      return { ...edit, expected_entry_digest: await sha256ContentHash(current) };
    }
  }
}

export function createSemanticCandidateSaveService(dependencies: Dependencies) {
  return Object.freeze({
    async startManual(request: SemanticManualSessionStartRequest) {
      const active = await dependencies.graph_store.getActive(
        dependencies.capability,
        request.semantic_domain,
      );
      if (!active.ok) return active;
      if (active.value === null) {
        return failure(
          "SEMANTIC_STUDIO_GRAPH_NOT_FOUND_OR_DENIED",
          "当前语义域尚未绑定 Graph v2 release。",
        );
      }
      const command = await buildSemanticManualSessionStartCommand({
        schema_version: "semantic-manual-session-start-command@1.0.0",
        command_id: dependencies.new_id(),
        scope: dependencies.scope,
        semantic_domain: request.semantic_domain,
        principal_id: dependencies.principal_id,
        authoring_run_id: dependencies.new_id(),
        candidate_id: dependencies.new_id(),
        base_release_id: active.value.release_id,
        base_release_generation: active.value.release_generation,
        base_graph: active.value.source_graph,
        base_graph_digest: await sha256ContentHash(active.value.source_graph),
        idempotency_key: request.idempotency_key,
        started_at: dependencies.now().toISOString(),
      });
      return dependencies.candidate_revision_store.startManual(dependencies.capability, command);
    },

    async save(
      request: SemanticCandidateRevisionSaveRequest,
    ): Promise<PortResult<SemanticCandidateRevisionSaveResult>> {
      if (request.authoring_run_id === null) {
        return failure(
          "SEMANTIC_MANUAL_SESSION_REQUIRED",
          "直接编辑前必须先创建 Manual Working ChangeSet。",
        );
      }
      const store = dependencies.create_authoring_store(request.semantic_domain);
      const loaded = await store.load({
        scope: dependencies.scope,
        semantic_domain: request.semantic_domain,
        authoring_run_id: request.authoring_run_id,
      });
      if (!loaded.ok) return loaded;
      if (loaded.value === null) {
        return failure("SEMANTIC_AUTHORING_NOT_FOUND", "语义创作任务不存在或无权访问。");
      }
      const state = loaded.value;
      if (
        state.run.principal_id !== dependencies.principal_id ||
        state.run.status !== "READY_FOR_REVIEW" ||
        state.run.working_revision !== request.expected_working_revision ||
        state.run.graph_digest !== request.expected_graph_digest
      ) {
        return failure(
          "SEMANTIC_CANDIDATE_SAVE_CONFLICT",
          "Agent 必须先完成确定性校验，且保存必须绑定当前 Working Revision。",
          true,
        );
      }
      const active = await dependencies.graph_store.getActive(
        dependencies.capability,
        request.semantic_domain,
      );
      if (!active.ok) return active;
      if (
        active.value === null ||
        active.value.release_id !== state.run.base_release_id ||
        active.value.source_graph.metadata.graph_id !== state.run.graph_id
      ) {
        return failure(
          "SEMANTIC_CANDIDATE_SAVE_STALE_BASE",
          "活动 Semantic Release 已变化，请基于新版本重新编辑。",
        );
      }

      const selectedEvidence: KnowledgeEvidenceSelectionDetail[] = [];
      for (const reference of request.evidence_selection_refs) {
        const selected = await dependencies.knowledge_registry.getEvidenceSelection(
          dependencies.capability,
          reference.selection_id,
        );
        if (!selected.ok) return selected;
        if (
          selected.value.selection.selection_hash !== reference.selection_hash ||
          selected.value.selection.intended_semantic_domain !== request.semantic_domain
        ) {
          return failure(
            "SEMANTIC_CANDIDATE_EVIDENCE_MISMATCH",
            "Evidence Selection hash 或语义域不匹配。",
          );
        }
        selectedEvidence.push(selected.value);
      }

      let finalGraph = state.working_graph;
      let manualPatch = null;
      let compilation: Awaited<ReturnType<typeof compileSemanticGraphV2>>;
      try {
        if (request.manual_edits.length > 0) {
          let graph = state.working_graph;
          const operations: SemanticGraphPatchOperation[] = [];
          for (const edit of request.manual_edits) {
            const operation = await materializeOperation(edit, graph);
            operations.push(operation);
            const next = await createSemanticGraphPatch(graph, {
              patch_id: dependencies.new_id(),
              candidate_id: state.run.candidate_id,
              from_working_revision: state.run.working_revision + operations.length - 1,
              operations: [operation],
              validate_result: false,
            });
            graph = next.next_graph;
          }
          const combined = await createSemanticGraphPatch(state.working_graph, {
            patch_id: dependencies.new_id(),
            candidate_id: state.run.candidate_id,
            from_working_revision: state.run.working_revision,
            operations,
          });
          manualPatch = combined.patch;
          finalGraph = combined.next_graph;
        }
        compilation = await compileSemanticGraphV2(finalGraph);
      } catch (error) {
        return failure(
          "SEMANTIC_CANDIDATE_VALIDATION_FAILED",
          error instanceof Error ? error.message : "语义图未通过确定性校验。",
        );
      }
      const validationMaterial = {
        receipt_version: "semantic-authoring-validation@1.0.0" as const,
        graph_digest: compilation.source_digest,
        compiler_version: SEMANTIC_GRAPH_COMPILER_VERSION,
        valid: true,
        issues: [],
      };
      const validationReceipt: SemanticAuthoringValidationReceipt = {
        ...validationMaterial,
        receipt_digest: await sha256ContentHash(validationMaterial),
      };
      const command = await buildSemanticCandidateRevisionSaveCommand({
        schema_version: "semantic-candidate-revision-save-command@1.0.0",
        command_id: dependencies.new_id(),
        scope: dependencies.scope,
        semantic_domain: request.semantic_domain,
        principal_id: dependencies.principal_id,
        authoring_run_id: state.run.authoring_run_id,
        candidate_id: state.run.candidate_id,
        base_release_id: state.run.base_release_id,
        expected_working_revision: state.run.working_revision,
        expected_graph_digest: state.run.graph_digest,
        final_graph: finalGraph,
        final_graph_digest: compilation.source_digest,
        manual_patch: manualPatch,
        operation_origins: (manualPatch?.operations ?? []).map((_operation, index) => ({
          operation_index: index,
          origin: "MANUAL" as const,
          authoring_run_id: state.run.authoring_run_id,
          evidence_selection_refs: request.evidence_selection_refs,
        })),
        evidence_selection_refs: request.evidence_selection_refs,
        validation_receipt: validationReceipt,
        summary: request.summary,
        idempotency_key: request.idempotency_key,
        saved_at: dependencies.now().toISOString(),
      });
      return dependencies.candidate_revision_store.save(dependencies.capability, command);
    },
  });
}

export type SemanticCandidateSaveService = ReturnType<typeof createSemanticCandidateSaveService>;
