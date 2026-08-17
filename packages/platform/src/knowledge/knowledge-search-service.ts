import {
  type EmbeddingProfileRevision,
  type EmbeddingProviderPort,
  type KnowledgeBaseRevision,
  type KnowledgeDebugSearchRequest,
  type KnowledgeDebugSearchResult,
  type KnowledgeIndexGeneration,
  type KnowledgeQueryProjectionReceipt,
  type KnowledgeRetrievalReceipt,
  knowledgeDebugSearchRequestSchema,
  type PortResult,
  sha256ContentHash,
} from "@data-agent/contracts";
import { projectKnowledgeQueryForEgress } from "../agents/model-egress-projection.js";
import { type KnowledgeIndex, KnowledgeIndexError } from "./knowledge-index.js";

type SearchSnapshot = Readonly<{
  knowledge_base: KnowledgeBaseRevision;
  generation: KnowledgeIndexGeneration;
  embedding_profile: EmbeddingProfileRevision;
  principal_id: string;
}>;

type SearchRegistry = Readonly<{
  loadSearchSnapshot(
    capability: unknown,
    request: KnowledgeDebugSearchRequest,
  ): Promise<PortResult<SearchSnapshot>>;
  commitQueryProjection(
    capability: unknown,
    receipt: KnowledgeQueryProjectionReceipt,
  ): Promise<PortResult<KnowledgeQueryProjectionReceipt>>;
  hydrateAndCommitRetrieval(
    capability: unknown,
    input: {
      readonly request: KnowledgeDebugSearchRequest;
      readonly candidates: readonly { readonly chunk_id: string; readonly score: number }[];
      readonly query_hash: string;
      readonly query_projection_receipt_hash: string;
    },
  ): Promise<PortResult<KnowledgeRetrievalReceipt>>;
}>;

function notReady(
  reasonCode:
    | "INDEX_NOT_CONFIGURED"
    | "INDEX_NOT_READY"
    | "INDEX_UNAVAILABLE"
    | "INDEX_DIGEST_MISMATCH",
): PortResult<KnowledgeDebugSearchResult> {
  return {
    ok: true,
    value: {
      schema_version: "knowledge-debug-search-result@1.0.0",
      status: "NOT_READY",
      reason_code: reasonCode,
      receipt: null,
    },
  };
}

export function createKnowledgeSearchService(
  options: Readonly<{
    capability: unknown;
    registry: SearchRegistry;
    embedding:
      | EmbeddingProviderPort
      | ((profile: EmbeddingProfileRevision) => EmbeddingProviderPort);
    index: KnowledgeIndex;
    create_id: () => string;
    now: () => Date;
  }>,
) {
  return Object.freeze({
    async search(
      requestInput: unknown,
      signal: AbortSignal,
    ): Promise<PortResult<KnowledgeDebugSearchResult>> {
      const parsed = knowledgeDebugSearchRequestSchema.safeParse(requestInput);
      if (!parsed.success || signal.aborted) {
        return {
          ok: false,
          error: {
            code: "KNOWLEDGE_SEARCH_REQUEST_INVALID",
            message: "Knowledge search request is invalid.",
            retryable: false,
          },
        };
      }
      const request = parsed.data;
      const snapshot = await options.registry.loadSearchSnapshot(options.capability, request);
      if (!snapshot.ok) return snapshot;
      const profile = snapshot.value.embedding_profile;
      const embedding =
        typeof options.embedding === "function" ? options.embedding(profile) : options.embedding;
      const projected = await projectKnowledgeQueryForEgress({
        receipt_id: options.create_id(),
        scope: snapshot.value.knowledge_base.scope,
        knowledge_base_ref: request.knowledge_base_ref,
        generation_ref: request.generation_ref,
        classification: "INTERNAL",
        provider: profile.provider,
        projection_policy_version: profile.projection_policy_version,
        query: request.query,
        projected_at: options.now().toISOString(),
      });
      if (!projected.projected_text) {
        return {
          ok: false,
          error: {
            code: "KNOWLEDGE_QUERY_POLICY_BLOCKED",
            message: "Knowledge query was blocked by projection policy.",
            retryable: false,
          },
        };
      }
      const committedProjection = await options.registry.commitQueryProjection(
        options.capability,
        projected.receipt,
      );
      if (!committedProjection.ok) return committedProjection;
      const embedded = await embedding.embed(
        {
          schema_version: "embedding-request@1.0.0",
          profile_ref: {
            profile_id: profile.profile_id,
            revision: profile.revision,
            profile_hash: profile.profile_hash,
          },
          provider: profile.provider,
          model_id: profile.model_id,
          dimensions: profile.dimensions,
          projection_receipt: committedProjection.value,
          projected_text: projected.projected_text,
        },
        signal,
      );
      if (!embedded.ok) return embedded;
      let candidates: Awaited<ReturnType<KnowledgeIndex["search"]>>;
      try {
        candidates = await options.index.search({
          scope: snapshot.value.knowledge_base.scope,
          generation_ref: request.generation_ref,
          query_vector: embedded.value.vector,
          limit: request.limit,
        });
      } catch (error) {
        return error instanceof KnowledgeIndexError
          ? notReady(error.reason_code)
          : notReady("INDEX_UNAVAILABLE");
      }
      const receipt = await options.registry.hydrateAndCommitRetrieval(options.capability, {
        request,
        candidates,
        query_hash: await sha256ContentHash(projected.projected_text),
        query_projection_receipt_hash: committedProjection.value.receipt_hash,
      });
      if (!receipt.ok) return receipt;
      return {
        ok: true,
        value: {
          schema_version: "knowledge-debug-search-result@1.0.0",
          status: "READY",
          reason_code: null,
          receipt: receipt.value,
        },
      };
    },
  });
}

export type KnowledgeSearchService = ReturnType<typeof createKnowledgeSearchService>;
