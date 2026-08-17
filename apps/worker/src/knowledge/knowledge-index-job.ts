import {
  buildKnowledgeChunk,
  type EmbeddingProviderPort,
  type JobOutputReference,
  type JobWorkLease,
  type KnowledgeDataProjectionReceipt,
  type KnowledgeGenerationReadyCommit,
  type KnowledgeGenerationStageCommand,
  type KnowledgeIndexGeneration,
  type KnowledgeIndexTarget,
  type PortResult,
  sha256ContentHash,
} from "@data-agent/contracts";
import { type KnowledgeIndex, projectKnowledgeChunkForEgress } from "@data-agent/platform";
import type { JobHandler } from "../jobs/job-worker-runner.js";

type Registry = Readonly<{
  loadIndexTarget(
    capability: unknown,
    lease: JobWorkLease,
  ): Promise<PortResult<KnowledgeIndexTarget>>;
  stageGeneration(
    capability: unknown,
    lease: JobWorkLease,
    command: KnowledgeGenerationStageCommand,
  ): Promise<PortResult<KnowledgeIndexGeneration>>;
  commitBlockedProjection(
    capability: unknown,
    lease: JobWorkLease,
    receipt: KnowledgeDataProjectionReceipt,
  ): Promise<PortResult<KnowledgeDataProjectionReceipt>>;
  commitReady(
    capability: unknown,
    lease: JobWorkLease,
    command: KnowledgeGenerationReadyCommit,
  ): Promise<PortResult<KnowledgeIndexGeneration>>;
}>;

type ContentReader = Readonly<{
  get(
    capability: unknown,
    key: string,
    expectedHash: string,
    expectedByteSize: number,
  ): Promise<PortResult<Uint8Array | null>>;
}>;

type ParsedChunk = Readonly<{ text: string; start_byte: number; end_byte: number }>;

const CHUNK_BYTE_BUDGET = 4_000;
const CHUNK_OVERLAP_BYTE_BUDGET = 256;

function failure(code: string, message: string, retryable: boolean): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function parseAndChunk(bytes: Uint8Array, mime: string): PortResult<readonly ParsedChunk[]> {
  if (!new Set(["text/plain", "text/markdown", "text/csv", "application/json"]).has(mime)) {
    return failure(
      "KNOWLEDGE_SOURCE_MIME_UNSUPPORTED",
      "Knowledge source MIME is unsupported.",
      false,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure(
      "KNOWLEDGE_SOURCE_ENCODING_INVALID",
      "Knowledge source is not valid UTF-8.",
      false,
    );
  }
  const normalized = text.normalize("NFC").replaceAll("\r\n", "\n").trim();
  if (normalized.length === 0) {
    return failure("KNOWLEDGE_SOURCE_EMPTY", "Knowledge source has no indexable text.", false);
  }
  const encoder = new TextEncoder();
  const characters = Array.from(normalized);
  const sizes = characters.map((character) => encoder.encode(character).byteLength);
  const chunks: ParsedChunk[] = [];
  let startIndex = 0;
  let startByte = 0;
  while (startIndex < characters.length) {
    let endIndex = startIndex;
    let chunkBytes = 0;
    while (
      endIndex < characters.length &&
      chunkBytes + (sizes[endIndex] ?? 0) <= CHUNK_BYTE_BUDGET
    ) {
      chunkBytes += sizes[endIndex] ?? 0;
      endIndex += 1;
    }
    const endByte = startByte + chunkBytes;
    chunks.push({
      text: characters.slice(startIndex, endIndex).join(""),
      start_byte: startByte,
      end_byte: endByte,
    });
    if (endIndex === characters.length) break;

    let nextStartIndex = endIndex;
    let overlapBytes = 0;
    while (
      nextStartIndex > startIndex &&
      overlapBytes + (sizes[nextStartIndex - 1] ?? 0) <= CHUNK_OVERLAP_BYTE_BUDGET
    ) {
      nextStartIndex -= 1;
      overlapBytes += sizes[nextStartIndex] ?? 0;
    }
    startIndex = nextStartIndex;
    startByte = endByte - overlapBytes;
  }
  return { ok: true, value: chunks };
}

function uuidV8FromHash(hash: string): string {
  const hexadecimal = hash.slice("sha256:".length, "sha256:".length + 32).split("");
  hexadecimal[12] = "8";
  hexadecimal[16] = ((Number.parseInt(hexadecimal[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = hexadecimal.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

async function deterministicId(material: unknown): Promise<string> {
  return uuidV8FromHash(await sha256ContentHash(material));
}

export function createKnowledgeIndexJobHandler(
  options: Readonly<{
    capability: unknown;
    registry: Registry;
    content: ContentReader;
    embedding:
      | EmbeddingProviderPort
      | ((profile: KnowledgeIndexTarget["embedding_profile"]) => EmbeddingProviderPort);
    index: KnowledgeIndex;
    create_id: () => string;
    now: () => Date;
  }>,
): JobHandler {
  return Object.freeze({
    binding: {
      kind: "KNOWLEDGE_INDEX",
      handler_revision: "knowledge-index-handler@1.0.0",
    } as const,
    async execute(
      lease: JobWorkLease,
      signal: AbortSignal,
    ): Promise<PortResult<readonly JobOutputReference[]>> {
      if (signal.aborted)
        return failure("KNOWLEDGE_INDEX_CANCELLED", "Knowledge indexing was cancelled.", false);
      const loaded = await options.registry.loadIndexTarget(options.capability, lease);
      if (!loaded.ok) return loaded;
      const target = loaded.value;
      if (target.embedding_profile.status !== "READY") {
        return failure(
          "KNOWLEDGE_EMBEDDING_PROFILE_NOT_READY",
          "Embedding profile is not ready.",
          false,
        );
      }
      const embedding =
        typeof options.embedding === "function"
          ? options.embedding(target.embedding_profile)
          : options.embedding;
      const commits = [];
      let ordinal = 0;
      for (const source of target.sources) {
        const content = await options.content.get(
          options.capability,
          source.storage_key,
          source.blob_hash,
          source.byte_size,
        );
        if (!content.ok) return content;
        if (content.value === null || content.value.byteLength !== source.byte_size) {
          return failure(
            "KNOWLEDGE_SOURCE_NOT_FOUND",
            "Knowledge source bytes are unavailable.",
            false,
          );
        }
        const parsed = parseAndChunk(content.value, source.detected_mime);
        if (!parsed.ok) return parsed;
        for (const chunk of parsed.value) {
          if (signal.aborted) {
            return failure("KNOWLEDGE_INDEX_CANCELLED", "Knowledge indexing was cancelled.", false);
          }
          const textHash = await sha256ContentHash(chunk.text);
          const chunkId = await deterministicId({
            kind: "KNOWLEDGE_CHUNK",
            source_file_ref: source.file_ref,
            start_byte: chunk.start_byte,
            end_byte: chunk.end_byte,
            text_hash: textHash,
          });
          const projection = await projectKnowledgeChunkForEgress({
            receipt_id: await deterministicId({
              kind: "KNOWLEDGE_CHUNK_PROJECTION",
              generation_id: target.generation.generation_id,
              chunk_id: chunkId,
              projection_policy_version: target.embedding_profile.projection_policy_version,
            }),
            scope: target.knowledge_base.scope,
            knowledge_base_ref: target.generation.knowledge_base_ref,
            source_file_ref: source.file_ref,
            chunk_id: chunkId,
            classification: source.classification,
            provider: target.embedding_profile.provider,
            projection_policy_version: target.embedding_profile.projection_policy_version,
            normalized_text: chunk.text,
            projected_at: target.generation.created_at,
          });
          if (!projection.projected_text) {
            const committed = await options.registry.commitBlockedProjection(
              options.capability,
              lease,
              projection.receipt,
            );
            if (!committed.ok) return committed;
            return failure(
              "KNOWLEDGE_PROJECTION_POLICY_BLOCKED",
              "Knowledge projection was blocked.",
              false,
            );
          }
          const embedded = await embedding.embed(
            {
              schema_version: "embedding-request@1.0.0",
              profile_ref: target.knowledge_base.embedding_profile_ref,
              provider: target.embedding_profile.provider,
              model_id: target.embedding_profile.model_id,
              dimensions: target.embedding_profile.dimensions,
              projection_receipt: projection.receipt,
              projected_text: projection.projected_text,
            },
            signal,
          );
          if (!embedded.ok) return embedded;
          const knowledgeChunk = await buildKnowledgeChunk({
            schema_version: "knowledge-chunk@1.0.0",
            scope: target.knowledge_base.scope,
            generation_id: target.generation.generation_id,
            generation_revision: target.generation.generation_revision,
            knowledge_base_ref: target.generation.knowledge_base_ref,
            chunk_id: chunkId,
            source_file_ref: source.file_ref,
            ordinal,
            start_byte: chunk.start_byte,
            end_byte: chunk.end_byte,
            text_hash: textHash,
            projection_receipt_hash: projection.receipt.receipt_hash,
            embedding_hash: await sha256ContentHash(embedded.value.vector),
            dimensions: embedded.value.dimensions,
          });
          commits.push({
            chunk: knowledgeChunk,
            normalized_text: chunk.text,
            vector: embedded.value.vector,
            projection_receipt: projection.receipt,
          });
          ordinal += 1;
        }
      }
      const manifestHash = await sha256ContentHash(commits.map(({ chunk }) => chunk.chunk_hash));
      const staged = await options.registry.stageGeneration(options.capability, lease, {
        schema_version: "knowledge-generation-stage@1.0.0",
        generation_ref: {
          generation_id: target.generation.generation_id,
          generation_revision: target.generation.generation_revision,
          generation_hash: target.generation.generation_hash,
        },
        chunks: commits,
        manifest_hash: manifestHash,
      });
      if (!staged.ok) return staged;
      const stagedGenerationRef = {
        generation_id: staged.value.generation_id,
        generation_revision: staged.value.generation_revision,
        generation_hash: staged.value.generation_hash,
      };
      const buildId = await deterministicId({
        kind: "KNOWLEDGE_INDEX_BUILD",
        generation_ref: stagedGenerationRef,
        manifest_hash: manifestHash,
      });
      try {
        await options.index.stage({
          scope: target.knowledge_base.scope,
          build_id: buildId,
          generation_ref: stagedGenerationRef,
          manifest_hash: manifestHash,
          dimensions: target.embedding_profile.dimensions,
          chunks: commits.map(({ chunk, vector }) => ({ chunk_id: chunk.chunk_id, vector })),
        });
        const sealed = await options.index.verifyAndSeal({
          scope: target.knowledge_base.scope,
          build_id: buildId,
          generation_ref: stagedGenerationRef,
          manifest_hash: manifestHash,
          dimensions: target.embedding_profile.dimensions,
        });
        if (sealed.chunk_count !== commits.length) {
          return failure(
            "KNOWLEDGE_INDEX_DIGEST_MISMATCH",
            "Knowledge index count differs.",
            false,
          );
        }
      } catch {
        return failure(
          "KNOWLEDGE_INDEX_UNAVAILABLE",
          "Knowledge vector index is unavailable.",
          true,
        );
      }
      const committed = await options.registry.commitReady(options.capability, lease, {
        schema_version: "knowledge-generation-ready@1.0.0",
        generation_ref: stagedGenerationRef,
        checkpoint: {
          index_kind: "NEO4J_VECTOR",
          build_id: buildId,
          manifest_hash: manifestHash,
          dimensions: target.embedding_profile.dimensions,
          sealed_at: options.now().toISOString(),
        },
      });
      if (!committed.ok) return committed;
      return {
        ok: true,
        value: [
          {
            schema_version: "job-domain-output-reference@1.0.0",
            resource_kind: "KNOWLEDGE_INDEX_GENERATION",
            app_id: committed.value.scope.app_id,
            tenant_id: committed.value.scope.tenant_id,
            environment: committed.value.scope.environment,
            resource_id: committed.value.generation_id,
            resource_revision: committed.value.generation_revision,
            resource_hash: committed.value.generation_hash,
          },
        ],
      };
    },
  });
}
