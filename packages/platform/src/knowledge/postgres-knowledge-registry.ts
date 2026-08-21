import {
  embeddingProfileRevisionSchema,
  type JobWorkLease,
  jobWorkLeaseSchema,
  type KnowledgeBaseCreateCommand,
  type KnowledgeBaseRebuildCommand,
  type KnowledgeCorrectionAnnotation,
  type KnowledgeDataProjectionReceipt,
  type KnowledgeDebugSearchRequest,
  type KnowledgeDocumentCommitCommand,
  type KnowledgeEvidenceSelection,
  type KnowledgeGenerationReadyCommit,
  type KnowledgeGenerationStageCommand,
  type KnowledgeIndexTarget,
  type KnowledgeRetrievalReceipt,
  knowledgeBaseMutationResultSchema,
  knowledgeBaseRevisionSchema,
  knowledgeDocumentDetailSchema,
  knowledgeDocumentRevisionSchema,
  knowledgeEvidenceSelectionDetailSchema,
  knowledgeGenerationReadyCommitSchema,
  knowledgeQueryProjectionReceiptSchema,
  knowledgeRetrievalReceiptSchema,
  sha256ContentHash,
  verifyEmbeddingProfileRevision,
  verifyKnowledgeBaseCreateCommand,
  verifyKnowledgeBaseRebuildCommand,
  verifyKnowledgeBaseRevision,
  verifyKnowledgeCorrectionAnnotation,
  verifyKnowledgeDataProjectionReceipt,
  verifyKnowledgeDocumentBlock,
  verifyKnowledgeDocumentCommitCommand,
  verifyKnowledgeDocumentRevision,
  verifyKnowledgeEvidenceSelection,
  verifyKnowledgeGenerationStageCommand,
  verifyKnowledgeIndexGeneration,
  verifyKnowledgeIndexTarget,
  verifyKnowledgeQueryProjectionReceipt,
  verifyKnowledgeRetrievalReceipt,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const searchSnapshotSchema = z.strictObject({
  knowledge_base: knowledgeBaseRevisionSchema,
  generation: z.unknown(),
  embedding_profile: z.unknown(),
  principal_id: z.uuid(),
});

function failure(code: string, message: string, retryable = false) {
  return { ok: false as const, error: { code, message, retryable } };
}

function mapKnowledgeDatabaseFailure(error: unknown) {
  const marker =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";
  if (/^KNOWLEDGE_[A-Z0-9_]+$/.test(marker)) {
    return failure(
      marker,
      "Knowledge Authority rejected the request.",
      /(?:STALE|UNAVAILABLE)$/.test(marker),
    );
  }
  return null;
}

function contractInvalid(message: string): never {
  throw new PersistenceBoundaryError("KNOWLEDGE_DATABASE_CONTRACT_INVALID", message);
}

function sameScope(
  value: { readonly app_id: string; readonly tenant_id: string; readonly environment: string },
  expected: { readonly app_id: string; readonly tenant_id: string; readonly environment: string },
) {
  return (
    value.app_id === expected.app_id &&
    value.tenant_id === expected.tenant_id &&
    value.environment === expected.environment
  );
}

async function verifyMutationResult(
  value: unknown,
  expectedScope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
  },
) {
  const parsed = knowledgeBaseMutationResultSchema.safeParse(value);
  if (!parsed.success) contractInvalid("Knowledge mutation result is invalid.");
  try {
    const knowledgeBase = await verifyKnowledgeBaseRevision(parsed.data.knowledge_base);
    const generation = await verifyKnowledgeIndexGeneration(parsed.data.generation);
    if (
      !sameScope(knowledgeBase.scope, expectedScope) ||
      !sameScope(generation.scope, expectedScope) ||
      generation.knowledge_base_ref.knowledge_base_id !== knowledgeBase.knowledge_base_id ||
      generation.knowledge_base_ref.revision !== knowledgeBase.revision ||
      generation.knowledge_base_ref.revision_hash !== knowledgeBase.revision_hash ||
      JSON.stringify(generation.source_file_refs) !==
        JSON.stringify(knowledgeBase.source_file_refs) ||
      JSON.stringify(generation.embedding_profile_ref) !==
        JSON.stringify(knowledgeBase.embedding_profile_ref)
    ) {
      return contractInvalid("Knowledge mutation result authority was substituted.");
    }
    return { knowledge_base: knowledgeBase, generation };
  } catch {
    return contractInvalid("Knowledge mutation hashes are invalid.");
  }
}

export function createPostgresKnowledgeRegistry(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
) {
  const transaction = <T>(
    capability: unknown,
    access: "READ" | "WRITE",
    operationName: string,
    work: Parameters<typeof withAppTransaction<T>>[4],
  ) =>
    withAppTransaction(
      options.pool,
      options.authorizer,
      capability,
      { access, operation_name: operationName, map_database_error: mapKnowledgeDatabaseFailure },
      work,
    );

  return Object.freeze({
    async create(capability: unknown, commandInput: KnowledgeBaseCreateCommand) {
      let command: KnowledgeBaseCreateCommand;
      try {
        command = await verifyKnowledgeBaseCreateCommand(commandInput);
      } catch {
        return failure(
          "KNOWLEDGE_BASE_CREATE_COMMAND_INVALID",
          "Knowledge create command is invalid.",
        );
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.create",
        async ({ capability: current, client }) => {
          if (command.workspace_id !== current.scope.tenant_id) {
            return contractInvalid("Knowledge workspace scope was substituted.");
          }
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.create_knowledge_base($1::jsonb) as value",
            [command],
          );
          return verifyMutationResult(result.rows[0]?.value, current.scope);
        },
      );
    },

    async rebuild(capability: unknown, commandInput: KnowledgeBaseRebuildCommand) {
      let command: KnowledgeBaseRebuildCommand;
      try {
        command = await verifyKnowledgeBaseRebuildCommand(commandInput);
      } catch {
        return failure(
          "KNOWLEDGE_BASE_REBUILD_COMMAND_INVALID",
          "Knowledge rebuild command is invalid.",
        );
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.rebuild",
        async ({ capability: current, client }) => {
          if (command.workspace_id !== current.scope.tenant_id) {
            return contractInvalid("Knowledge workspace scope was substituted.");
          }
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.rebuild_knowledge_base($1::jsonb) as value",
            [command],
          );
          return verifyMutationResult(result.rows[0]?.value, current.scope);
        },
      );
    },

    async list(capability: unknown, limitInput = 100) {
      const limit = z.number().int().min(1).max(200).safeParse(limitInput);
      if (!limit.success)
        return failure("KNOWLEDGE_LIST_INPUT_INVALID", "Knowledge list input is invalid.");
      return transaction(
        capability,
        "READ",
        "knowledge.list",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.list_knowledge_bases($1::integer) as value",
            [limit.data],
          );
          const rows = z.array(knowledgeBaseRevisionSchema).safeParse(result.rows[0]?.value);
          if (!rows.success) return contractInvalid("Knowledge list result is invalid.");
          const verified = await Promise.all(rows.data.map(verifyKnowledgeBaseRevision));
          if (verified.some((row) => !sameScope(row.scope, current.scope))) {
            return contractInvalid("Knowledge list scope was substituted.");
          }
          return verified;
        },
      );
    },

    async listDocuments(capability: unknown, knowledgeBaseIdInput: string, limitInput = 100) {
      const knowledgeBaseId = z.uuid().safeParse(knowledgeBaseIdInput);
      const limit = z.number().int().min(1).max(200).safeParse(limitInput);
      if (!knowledgeBaseId.success || !limit.success) {
        return failure(
          "KNOWLEDGE_DOCUMENT_LIST_INVALID",
          "Knowledge document list input is invalid.",
        );
      }
      return transaction(
        capability,
        "READ",
        "knowledge.list_documents",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.list_knowledge_documents($1::uuid,$2::integer) as value",
            [knowledgeBaseId.data, limit.data],
          );
          const rows = z.array(knowledgeDocumentRevisionSchema).safeParse(result.rows[0]?.value);
          if (!rows.success) return contractInvalid("Knowledge document list result is invalid.");
          const verified = await Promise.all(rows.data.map(verifyKnowledgeDocumentRevision));
          if (
            verified.some(
              (document) =>
                !sameScope(document.scope, current.scope) ||
                document.knowledge_base_ref.knowledge_base_id !== knowledgeBaseId.data,
            )
          ) {
            return contractInvalid("Knowledge document list authority was substituted.");
          }
          return verified;
        },
      );
    },

    async getDocument(capability: unknown, documentIdInput: string, revisionInput: number) {
      const documentId = z.uuid().safeParse(documentIdInput);
      const revision = z.number().int().positive().safe().safeParse(revisionInput);
      if (!documentId.success || !revision.success) {
        return failure("KNOWLEDGE_DOCUMENT_GET_INVALID", "Knowledge document input is invalid.");
      }
      return transaction(
        capability,
        "READ",
        "knowledge.get_document",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.get_knowledge_document($1::uuid,$2::bigint) as value",
            [documentId.data, revision.data],
          );
          const detail = knowledgeDocumentDetailSchema.safeParse(result.rows[0]?.value);
          if (!detail.success) return contractInvalid("Knowledge document detail is invalid.");
          const document = await verifyKnowledgeDocumentRevision(detail.data.document);
          const blocks = await Promise.all(detail.data.blocks.map(verifyKnowledgeDocumentBlock));
          if (
            !sameScope(document.scope, current.scope) ||
            document.document_id !== documentId.data ||
            document.revision !== revision.data ||
            blocks.length !== document.block_count ||
            (await sha256ContentHash(blocks.map((block) => block.block_hash))) !==
              document.block_manifest_hash
          ) {
            return contractInvalid("Knowledge document detail authority was substituted.");
          }
          return { ...detail.data, document, blocks };
        },
      );
    },

    async createEvidenceSelection(capability: unknown, selectionInput: KnowledgeEvidenceSelection) {
      let selection: KnowledgeEvidenceSelection;
      try {
        selection = await verifyKnowledgeEvidenceSelection(selectionInput);
      } catch {
        return failure(
          "KNOWLEDGE_EVIDENCE_SELECTION_INVALID",
          "Knowledge evidence selection is invalid.",
        );
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.create_evidence_selection",
        async ({ capability: current, client }) => {
          if (
            !sameScope(selection.scope, current.scope) ||
            selection.selected_by_principal_id !== current.principal
          ) {
            return contractInvalid("Knowledge evidence selection authority was substituted.");
          }
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.create_knowledge_evidence_selection($1::jsonb) as value",
            [selection],
          );
          const committed = await verifyKnowledgeEvidenceSelection(result.rows[0]?.value);
          if (
            committed.selection_id !== selection.selection_id ||
            committed.selection_hash !== selection.selection_hash ||
            !sameScope(committed.scope, current.scope)
          ) {
            return contractInvalid("Knowledge evidence selection result was substituted.");
          }
          return committed;
        },
      );
    },

    async getEvidenceSelection(capability: unknown, selectionIdInput: string) {
      const selectionId = z.uuid().safeParse(selectionIdInput);
      if (!selectionId.success) {
        return failure(
          "KNOWLEDGE_EVIDENCE_SELECTION_INVALID",
          "Knowledge evidence selection input is invalid.",
        );
      }
      return transaction(
        capability,
        "READ",
        "knowledge.get_evidence_selection",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.get_knowledge_evidence_selection($1::uuid) as value",
            [selectionId.data],
          );
          const detail = knowledgeEvidenceSelectionDetailSchema.safeParse(result.rows[0]?.value);
          if (!detail.success) {
            return contractInvalid("Knowledge evidence selection detail is invalid.");
          }
          const selection = await verifyKnowledgeEvidenceSelection(detail.data.selection);
          const blocks = await Promise.all(detail.data.blocks.map(verifyKnowledgeDocumentBlock));
          const annotations = await Promise.all(
            detail.data.annotations.map(verifyKnowledgeCorrectionAnnotation),
          );
          if (
            !sameScope(selection.scope, current.scope) ||
            selection.selection_id !== selectionId.data
          ) {
            return contractInvalid("Knowledge evidence selection authority was substituted.");
          }
          return { selection, blocks, annotations };
        },
      );
    },

    async createCorrectionAnnotation(
      capability: unknown,
      annotationInput: KnowledgeCorrectionAnnotation,
    ) {
      let annotation: KnowledgeCorrectionAnnotation;
      try {
        annotation = await verifyKnowledgeCorrectionAnnotation(annotationInput);
      } catch {
        return failure(
          "KNOWLEDGE_CORRECTION_ANNOTATION_INVALID",
          "Knowledge correction annotation is invalid.",
        );
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.create_correction_annotation",
        async ({ capability: current, client }) => {
          if (
            !sameScope(annotation.scope, current.scope) ||
            annotation.created_by_principal_id !== current.principal
          ) {
            return contractInvalid("Knowledge correction annotation authority was substituted.");
          }
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.create_knowledge_correction_annotation($1::jsonb) as value",
            [annotation],
          );
          const committed = await verifyKnowledgeCorrectionAnnotation(result.rows[0]?.value);
          if (
            committed.annotation_id !== annotation.annotation_id ||
            committed.annotation_hash !== annotation.annotation_hash ||
            !sameScope(committed.scope, current.scope)
          ) {
            return contractInvalid("Knowledge correction annotation result was substituted.");
          }
          return committed;
        },
      );
    },

    async listProfiles(capability: unknown, limitInput = 100) {
      const limit = z.number().int().min(1).max(100).safeParse(limitInput);
      if (!limit.success) {
        return failure(
          "KNOWLEDGE_PROFILE_LIST_INPUT_INVALID",
          "Knowledge profile list input is invalid.",
        );
      }
      return transaction(
        capability,
        "READ",
        "knowledge.list_profiles",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.list_knowledge_embedding_profiles($1::integer) as value",
            [limit.data],
          );
          const rows = z.array(embeddingProfileRevisionSchema).safeParse(result.rows[0]?.value);
          if (!rows.success) return contractInvalid("Knowledge profile list result is invalid.");
          const verified = await Promise.all(rows.data.map(verifyEmbeddingProfileRevision));
          if (verified.some((row) => !sameScope(row.scope, current.scope))) {
            return contractInvalid("Knowledge profile list scope was substituted.");
          }
          return verified;
        },
      );
    },

    async loadIndexTarget(capability: unknown, leaseInput: JobWorkLease) {
      const lease = jobWorkLeaseSchema.safeParse(leaseInput);
      if (!lease.success || lease.data.kind !== "KNOWLEDGE_INDEX") {
        return failure("KNOWLEDGE_INDEX_LEASE_INVALID", "Knowledge index lease is invalid.");
      }
      return transaction(
        capability,
        "READ",
        "knowledge.load_index_target",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.load_knowledge_index_target($1::jsonb) as value",
            [lease.data],
          );
          try {
            const target = await verifyKnowledgeIndexTarget(result.rows[0]?.value);
            if (
              !sameScope(target.knowledge_base.scope, current.scope) ||
              !sameScope(lease.data.scope, current.scope)
            ) {
              return contractInvalid("Knowledge index target scope was substituted.");
            }
            return target as KnowledgeIndexTarget;
          } catch {
            return contractInvalid("Knowledge index target is invalid.");
          }
        },
      );
    },

    async stageGeneration(
      capability: unknown,
      leaseInput: JobWorkLease,
      commandInput: KnowledgeGenerationStageCommand,
    ) {
      const lease = jobWorkLeaseSchema.safeParse(leaseInput);
      let command: KnowledgeGenerationStageCommand;
      try {
        command = await verifyKnowledgeGenerationStageCommand(commandInput);
      } catch {
        return failure("KNOWLEDGE_GENERATION_STAGE_INVALID", "Knowledge stage command is invalid.");
      }
      if (!lease.success || lease.data.kind !== "KNOWLEDGE_INDEX") {
        return failure("KNOWLEDGE_GENERATION_STAGE_INVALID", "Knowledge stage command is invalid.");
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.stage_generation",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.stage_knowledge_generation($1::jsonb,$2::jsonb) as value",
            [lease.data, command],
          );
          const generation = await verifyKnowledgeIndexGeneration(result.rows[0]?.value);
          if (
            !sameScope(generation.scope, current.scope) ||
            generation.generation_id !== command.generation_ref.generation_id ||
            generation.generation_revision !== command.generation_ref.generation_revision
          ) {
            return contractInvalid("Knowledge stage result authority was substituted.");
          }
          return generation;
        },
      );
    },

    async commitDocument(
      capability: unknown,
      leaseInput: JobWorkLease,
      commandInput: KnowledgeDocumentCommitCommand,
    ) {
      const lease = jobWorkLeaseSchema.safeParse(leaseInput);
      let command: KnowledgeDocumentCommitCommand;
      try {
        command = await verifyKnowledgeDocumentCommitCommand(commandInput);
      } catch {
        return failure("KNOWLEDGE_DOCUMENT_COMMIT_INVALID", "Knowledge document is invalid.");
      }
      if (!lease.success || lease.data.kind !== "KNOWLEDGE_INDEX") {
        return failure("KNOWLEDGE_DOCUMENT_COMMIT_INVALID", "Knowledge document is invalid.");
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.commit_document",
        async ({ capability: current, client }) => {
          if (
            !sameScope(command.document.scope, current.scope) ||
            !sameScope(lease.data.scope, current.scope)
          ) {
            return contractInvalid("Knowledge document scope was substituted.");
          }
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_knowledge_document($1::jsonb,$2::jsonb) as value",
            [lease.data, command],
          );
          const committed = await verifyKnowledgeDocumentRevision(result.rows[0]?.value);
          if (
            !sameScope(committed.scope, current.scope) ||
            committed.document_id !== command.document.document_id ||
            committed.revision !== command.document.revision ||
            committed.revision_hash !== command.document.revision_hash
          ) {
            return contractInvalid("Knowledge document authority was substituted.");
          }
          return committed;
        },
      );
    },

    async commitBlockedProjection(
      capability: unknown,
      leaseInput: JobWorkLease,
      receiptInput: KnowledgeDataProjectionReceipt,
    ) {
      const lease = jobWorkLeaseSchema.safeParse(leaseInput);
      let receipt: KnowledgeDataProjectionReceipt;
      try {
        receipt = await verifyKnowledgeDataProjectionReceipt(receiptInput);
      } catch {
        return failure(
          "KNOWLEDGE_PROJECTION_RECEIPT_INVALID",
          "Knowledge projection receipt is invalid.",
        );
      }
      if (
        !lease.success ||
        lease.data.kind !== "KNOWLEDGE_INDEX" ||
        receipt.decision !== "POLICY_BLOCKED"
      ) {
        return failure(
          "KNOWLEDGE_PROJECTION_RECEIPT_INVALID",
          "Knowledge projection receipt is invalid.",
        );
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.commit_blocked_projection",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_knowledge_blocked_projection($1::jsonb,$2::jsonb) as value",
            [lease.data, receipt],
          );
          const committed = await verifyKnowledgeDataProjectionReceipt(result.rows[0]?.value);
          if (
            !sameScope(committed.scope, current.scope) ||
            committed.receipt_id !== receipt.receipt_id ||
            committed.receipt_hash !== receipt.receipt_hash
          ) {
            return contractInvalid("Knowledge blocked projection authority was substituted.");
          }
          return committed;
        },
      );
    },

    async commitReady(
      capability: unknown,
      leaseInput: JobWorkLease,
      commandInput: KnowledgeGenerationReadyCommit,
    ) {
      const lease = jobWorkLeaseSchema.safeParse(leaseInput);
      const command = knowledgeGenerationReadyCommitSchema.safeParse(commandInput);
      if (!lease.success || lease.data.kind !== "KNOWLEDGE_INDEX" || !command.success) {
        return failure("KNOWLEDGE_GENERATION_READY_INVALID", "Knowledge ready command is invalid.");
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.commit_ready",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_knowledge_generation_ready($1::jsonb,$2::jsonb) as value",
            [lease.data, command.data],
          );
          const generation = await verifyKnowledgeIndexGeneration(result.rows[0]?.value);
          if (
            !sameScope(generation.scope, current.scope) ||
            generation.generation_id !== command.data.generation_ref.generation_id ||
            generation.generation_revision !== command.data.generation_ref.generation_revision ||
            generation.state !== "READY" ||
            JSON.stringify(generation.checkpoint) !== JSON.stringify(command.data.checkpoint)
          ) {
            return contractInvalid("Knowledge ready result authority was substituted.");
          }
          return generation;
        },
      );
    },

    async loadSearchSnapshot(capability: unknown, requestInput: KnowledgeDebugSearchRequest) {
      return transaction(
        capability,
        "READ",
        "knowledge.load_search_snapshot",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.load_knowledge_search_snapshot($1::jsonb) as value",
            [requestInput],
          );
          const parsed = searchSnapshotSchema.safeParse(result.rows[0]?.value);
          if (!parsed.success) return contractInvalid("Knowledge search snapshot is invalid.");
          const generation = await verifyKnowledgeIndexGeneration(parsed.data.generation);
          const embeddingProfile = await verifyEmbeddingProfileRevision(
            parsed.data.embedding_profile,
          );
          if (
            !sameScope(parsed.data.knowledge_base.scope, current.scope) ||
            !sameScope(generation.scope, current.scope) ||
            !sameScope(embeddingProfile.scope, current.scope) ||
            parsed.data.principal_id !== current.principal ||
            parsed.data.knowledge_base.knowledge_base_id !==
              requestInput.knowledge_base_ref.knowledge_base_id ||
            parsed.data.knowledge_base.revision !== requestInput.knowledge_base_ref.revision ||
            parsed.data.knowledge_base.revision_hash !==
              requestInput.knowledge_base_ref.revision_hash ||
            generation.generation_id !== requestInput.generation_ref.generation_id ||
            generation.generation_revision !== requestInput.generation_ref.generation_revision ||
            generation.generation_hash !== requestInput.generation_ref.generation_hash ||
            parsed.data.knowledge_base.status !== "READY" ||
            generation.state !== "READY" ||
            generation.checkpoint === null
          ) {
            return contractInvalid("Knowledge search snapshot authority was substituted.");
          }
          return { ...parsed.data, generation, embedding_profile: embeddingProfile };
        },
      );
    },

    async commitQueryProjection(capability: unknown, receiptInput: unknown) {
      let receipt: Awaited<ReturnType<typeof verifyKnowledgeQueryProjectionReceipt>>;
      try {
        receipt = await verifyKnowledgeQueryProjectionReceipt(receiptInput);
      } catch {
        return failure(
          "KNOWLEDGE_QUERY_PROJECTION_INVALID",
          "Knowledge query projection is invalid.",
        );
      }
      return transaction(
        capability,
        "WRITE",
        "knowledge.commit_query_projection",
        async ({ capability: current, client }) => {
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_knowledge_query_projection($1::jsonb) as value",
            [receipt],
          );
          const parsed = knowledgeQueryProjectionReceiptSchema.safeParse(result.rows[0]?.value);
          if (!parsed.success)
            return contractInvalid("Knowledge query projection result is invalid.");
          const verified = await verifyKnowledgeQueryProjectionReceipt(parsed.data);
          if (
            !sameScope(verified.scope, current.scope) ||
            verified.receipt_id !== receipt.receipt_id ||
            verified.receipt_hash !== receipt.receipt_hash
          ) {
            return contractInvalid("Knowledge query projection authority was substituted.");
          }
          return verified;
        },
      );
    },

    async hydrateAndCommitRetrieval(
      capability: unknown,
      input: {
        readonly request: KnowledgeDebugSearchRequest;
        readonly candidates: readonly { readonly chunk_id: string; readonly score: number }[];
        readonly query_hash: string;
        readonly query_projection_receipt_hash: string;
      },
    ) {
      return transaction(
        capability,
        "WRITE",
        "knowledge.commit_retrieval",
        async ({ capability: current, client }) => {
          const candidates = z
            .array(
              z.strictObject({ chunk_id: z.uuid(), score: z.number().finite().min(-1).max(1) }),
            )
            .max(50)
            .parse(input.candidates);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_knowledge_retrieval($1::jsonb,$2::jsonb,$3::text,$4::text) as value",
            [input.request, candidates, input.query_hash, input.query_projection_receipt_hash],
          );
          const parsed = knowledgeRetrievalReceiptSchema.safeParse(result.rows[0]?.value);
          if (!parsed.success) return contractInvalid("Knowledge retrieval result is invalid.");
          const receipt = await verifyKnowledgeRetrievalReceipt(parsed.data);
          if (
            !sameScope(receipt.scope, current.scope) ||
            receipt.principal_id !== current.principal ||
            JSON.stringify(receipt.knowledge_base_ref) !==
              JSON.stringify(input.request.knowledge_base_ref) ||
            JSON.stringify(receipt.generation_ref) !==
              JSON.stringify(input.request.generation_ref) ||
            receipt.query_hash !== input.query_hash ||
            receipt.query_projection_receipt_hash !== input.query_projection_receipt_hash
          ) {
            return contractInvalid("Knowledge retrieval authority was substituted.");
          }
          return receipt as KnowledgeRetrievalReceipt;
        },
      );
    },
  });
}

export type PostgresKnowledgeRegistry = ReturnType<typeof createPostgresKnowledgeRegistry>;
