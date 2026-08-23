import {
  appScopeSchema,
  contentHashSchema,
  type KnowledgeGenerationReference,
  knowledgeGenerationReferenceSchema,
  type PortResult,
} from "@data-agent/contracts";
import { z } from "zod";

const stageInputSchema = z.strictObject({
  scope: appScopeSchema,
  build_id: z.uuid(),
  generation_ref: knowledgeGenerationReferenceSchema,
  manifest_hash: contentHashSchema,
  dimensions: z.number().int().min(2).max(16_384),
  chunks: z.array(
    z.strictObject({
      chunk_id: z.uuid(),
      vector: z.array(z.number().finite()).min(2).max(16_384),
    }),
  ),
});
const sealInputSchema = stageInputSchema.omit({ chunks: true });
const searchInputSchema = z.strictObject({
  scope: appScopeSchema,
  generation_ref: knowledgeGenerationReferenceSchema,
  query_vector: z.array(z.number().finite()).min(2).max(16_384),
  limit: z.number().int().min(1).max(50),
});

export type KnowledgeIndexStageInput = z.infer<typeof stageInputSchema>;
export type KnowledgeIndexSealInput = z.infer<typeof sealInputSchema>;
export type KnowledgeIndexSearchInput = z.infer<typeof searchInputSchema>;
export type KnowledgeIndexCandidate = Readonly<{ chunk_id: string; score: number }>;

export interface KnowledgeIndex {
  initialize(): Promise<void>;
  stage(input: KnowledgeIndexStageInput): Promise<void>;
  verifyAndSeal(input: KnowledgeIndexSealInput): Promise<{ readonly chunk_count: number }>;
  search(input: KnowledgeIndexSearchInput): Promise<readonly KnowledgeIndexCandidate[]>;
  cleanup(input: {
    readonly scope: z.infer<typeof appScopeSchema>;
    readonly knowledge_base_id: string;
    readonly keep_generation_ids: readonly string[];
  }): Promise<number>;
  close(): Promise<void>;
}

export class KnowledgeIndexError extends Error {
  readonly reason_code:
    | "INDEX_NOT_CONFIGURED"
    | "INDEX_NOT_READY"
    | "INDEX_UNAVAILABLE"
    | "INDEX_DIGEST_MISMATCH";

  constructor(
    reasonCode:
      | "INDEX_NOT_CONFIGURED"
      | "INDEX_NOT_READY"
      | "INDEX_UNAVAILABLE"
      | "INDEX_DIGEST_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeIndexError";
    this.reason_code = reasonCode;
  }
}

export function createUnavailableKnowledgeIndex(
  reasonCode: "INDEX_NOT_CONFIGURED" | "INDEX_UNAVAILABLE" = "INDEX_NOT_CONFIGURED",
): KnowledgeIndex {
  const unavailable = async (): Promise<never> => {
    throw new KnowledgeIndexError(reasonCode, "Knowledge vector index is unavailable.");
  };
  return Object.freeze({
    initialize: unavailable,
    stage: unavailable,
    verifyAndSeal: unavailable,
    search: unavailable,
    cleanup: async () => 0,
    close: async () => undefined,
  });
}

function generationKey(
  scope: z.infer<typeof appScopeSchema>,
  generation: KnowledgeGenerationReference,
): string {
  return JSON.stringify([
    scope.app_id,
    scope.tenant_id,
    scope.environment,
    generation.generation_id,
    generation.generation_revision,
    generation.generation_hash,
  ]);
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new KnowledgeIndexError("INDEX_DIGEST_MISMATCH", "Knowledge vector dimensions differ.");
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function createInMemoryKnowledgeIndex(): KnowledgeIndex {
  const staged = new Map<string, KnowledgeIndexStageInput>();
  const active = new Map<string, KnowledgeIndexStageInput>();
  return Object.freeze({
    async initialize() {},
    async stage(input: KnowledgeIndexStageInput) {
      const parsed = stageInputSchema.parse(input);
      if (parsed.chunks.some((chunk) => chunk.vector.length !== parsed.dimensions)) {
        throw new KnowledgeIndexError(
          "INDEX_DIGEST_MISMATCH",
          "Knowledge vector dimensions differ.",
        );
      }
      staged.set(generationKey(parsed.scope, parsed.generation_ref), parsed);
    },
    async verifyAndSeal(input: KnowledgeIndexSealInput) {
      const parsed = sealInputSchema.parse(input);
      const key = generationKey(parsed.scope, parsed.generation_ref);
      const candidate = staged.get(key);
      if (!candidate) {
        throw new KnowledgeIndexError("INDEX_NOT_READY", "Knowledge generation is not staged.");
      }
      if (
        candidate.build_id !== parsed.build_id ||
        candidate.manifest_hash !== parsed.manifest_hash ||
        candidate.dimensions !== parsed.dimensions
      ) {
        throw new KnowledgeIndexError(
          "INDEX_DIGEST_MISMATCH",
          "Knowledge generation changed before seal.",
        );
      }
      active.set(key, candidate);
      staged.delete(key);
      return { chunk_count: candidate.chunks.length };
    },
    async search(input: KnowledgeIndexSearchInput) {
      const parsed = searchInputSchema.parse(input);
      const candidate = active.get(generationKey(parsed.scope, parsed.generation_ref));
      if (!candidate) {
        throw new KnowledgeIndexError("INDEX_NOT_READY", "Knowledge generation is not ready.");
      }
      if (parsed.query_vector.length !== candidate.dimensions) {
        throw new KnowledgeIndexError(
          "INDEX_DIGEST_MISMATCH",
          "Knowledge query dimension mismatch.",
        );
      }
      return candidate.chunks
        .map((chunk) => ({
          chunk_id: chunk.chunk_id,
          score: cosine(parsed.query_vector, chunk.vector),
        }))
        .sort(
          (left, right) => right.score - left.score || left.chunk_id.localeCompare(right.chunk_id),
        )
        .slice(0, parsed.limit);
    },
    async cleanup(input: {
      readonly scope: z.infer<typeof appScopeSchema>;
      readonly knowledge_base_id: string;
      readonly keep_generation_ids: readonly string[];
    }) {
      const scope = appScopeSchema.parse(input.scope);
      const keep = new Set(input.keep_generation_ids.map((id) => z.uuid().parse(id)));
      let removed = 0;
      for (const [key, value] of active) {
        if (
          value.scope.app_id === scope.app_id &&
          value.scope.tenant_id === scope.tenant_id &&
          value.scope.environment === scope.environment &&
          !keep.has(value.generation_ref.generation_id)
        ) {
          active.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async close() {
      staged.clear();
      active.clear();
    },
  });
}

export function knowledgeIndexFailure(error: unknown): PortResult<never> {
  if (error instanceof KnowledgeIndexError) {
    return {
      ok: false,
      error: { code: error.reason_code, message: "Knowledge index is not ready.", retryable: true },
    };
  }
  return {
    ok: false,
    error: {
      code: "INDEX_UNAVAILABLE",
      message: "Knowledge index is unavailable.",
      retryable: true,
    },
  };
}
