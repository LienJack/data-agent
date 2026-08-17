import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../src/common/index.js";
import {
  buildEmbeddingProfileRevision,
  buildKnowledgeBaseRevision,
  buildKnowledgeChunk,
  buildKnowledgeDataProjectionReceipt,
  buildKnowledgeEvidenceHit,
  buildKnowledgeIndexGeneration,
  buildKnowledgeRetrievalReceipt,
  knowledgeDataProjectionReceiptSchema,
  knowledgeIndexGenerationSchema,
  verifyKnowledgeBaseRevision,
  verifyKnowledgeGenerationStageCommand,
  verifyKnowledgeIndexTarget,
  verifyKnowledgeRetrievalReceipt,
} from "../src/knowledge/knowledge-base.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000a001",
  tenant_id: "00000000-0000-4000-8000-00000000b001",
  environment: "local",
};
const fileRef = {
  file_id: "00000000-0000-4000-8000-00000000f001",
  revision: 1,
  revision_hash: `sha256:${"1".repeat(64)}`,
};

describe("knowledge base authority contracts", () => {
  it("builds exact profile, projection, generation and evidence authority", async () => {
    const profile = await buildEmbeddingProfileRevision({
      schema_version: "embedding-profile-revision@1.0.0",
      scope,
      profile_id: "00000000-0000-4000-8000-00000000e001",
      revision: 1,
      provider: "deepseek",
      model_id: "deepseek-embedding-v1",
      dimensions: 4,
      normalization: "L2",
      parser_version: "knowledge-parser@1.0.0",
      chunker_version: "knowledge-chunker@1.0.0",
      projection_policy_version: "knowledge-projection@1.0.0",
      status: "READY",
      created_at: "2026-08-17T00:00:00.000Z",
    });
    const base = await buildKnowledgeBaseRevision({
      schema_version: "knowledge-base-revision@1.0.0",
      scope,
      knowledge_base_id: "00000000-0000-4000-8000-00000000c001",
      revision: 1,
      name: "Runbooks",
      source_file_refs: [fileRef],
      embedding_profile_ref: {
        profile_id: profile.profile_id,
        revision: profile.revision,
        profile_hash: profile.profile_hash,
      },
      acl: { visibility: "WORKSPACE", principal_ids: [] },
      status: "INDEXING",
      active_generation_ref: null,
      created_by_principal_id: "00000000-0000-4000-8000-00000000d001",
      created_at: "2026-08-17T00:00:01.000Z",
    });
    await expect(verifyKnowledgeBaseRevision(base)).resolves.toEqual(base);

    const projection = await buildKnowledgeDataProjectionReceipt({
      schema_version: "knowledge-data-projection-receipt@1.0.0",
      receipt_id: "00000000-0000-4000-8000-00000000d101",
      scope,
      knowledge_base_ref: {
        knowledge_base_id: base.knowledge_base_id,
        revision: base.revision,
        revision_hash: base.revision_hash,
      },
      source_file_ref: fileRef,
      chunk_id: "00000000-0000-4000-8000-00000000d201",
      classification: "INTERNAL",
      provider: profile.provider,
      projection_policy_version: profile.projection_policy_version,
      redaction_count: 0,
      pii_finding_count: 0,
      credential_finding_count: 0,
      prompt_injection_detected: false,
      decision: "ALLOW",
      payload_hash: await sha256ContentHash("governed text"),
      projected_at: "2026-08-17T00:00:02.000Z",
    });
    expect(knowledgeDataProjectionReceiptSchema.parse(projection).decision).toBe("ALLOW");

    const generation = await buildKnowledgeIndexGeneration({
      schema_version: "knowledge-index-generation@1.0.0",
      scope,
      generation_id: "00000000-0000-4000-8000-00000000a101",
      generation_revision: 1,
      knowledge_base_ref: {
        knowledge_base_id: base.knowledge_base_id,
        revision: base.revision,
        revision_hash: base.revision_hash,
      },
      source_file_refs: [fileRef],
      embedding_profile_ref: base.embedding_profile_ref,
      acl_hash: `sha256:${"3".repeat(64)}`,
      state: "READY",
      chunk_count: 1,
      manifest_hash: `sha256:${"4".repeat(64)}`,
      checkpoint: {
        index_kind: "NEO4J_VECTOR",
        build_id: "00000000-0000-4000-8000-00000000a201",
        manifest_hash: `sha256:${"4".repeat(64)}`,
        dimensions: 4,
        sealed_at: "2026-08-17T00:00:04.000Z",
      },
      reason_code: null,
      created_at: "2026-08-17T00:00:03.000Z",
      completed_at: "2026-08-17T00:00:04.000Z",
    });
    expect(knowledgeIndexGenerationSchema.parse(generation).state).toBe("READY");

    await expect(
      verifyKnowledgeIndexTarget({
        schema_version: "knowledge-index-target@1.0.0",
        knowledge_base: base,
        generation,
        embedding_profile: profile,
        sources: [
          {
            file_ref: fileRef,
            blob_hash: `sha256:${"8".repeat(64)}`,
            byte_size: 13,
            detected_mime: "text/plain",
            storage_key: "workspace-content/v1/fixture",
            classification: "INTERNAL",
          },
        ],
      }),
    ).resolves.toMatchObject({ generation: { generation_hash: generation.generation_hash } });

    const vector = [1, 0, 0, 0];
    const chunk = await buildKnowledgeChunk({
      schema_version: "knowledge-chunk@1.0.0",
      scope,
      generation_id: generation.generation_id,
      generation_revision: generation.generation_revision,
      knowledge_base_ref: generation.knowledge_base_ref,
      chunk_id: projection.chunk_id,
      source_file_ref: fileRef,
      ordinal: 0,
      start_byte: 0,
      end_byte: 13,
      text_hash: projection.payload_hash,
      projection_receipt_hash: projection.receipt_hash,
      embedding_hash: await sha256ContentHash(vector),
      dimensions: 4,
    });
    const stage = {
      schema_version: "knowledge-generation-stage@1.0.0" as const,
      generation_ref: {
        generation_id: generation.generation_id,
        generation_revision: generation.generation_revision,
        generation_hash: generation.generation_hash,
      },
      chunks: [{ chunk, normalized_text: "governed text", vector, projection_receipt: projection }],
      manifest_hash: await sha256ContentHash([chunk.chunk_hash]),
    };
    await expect(verifyKnowledgeGenerationStageCommand(stage)).resolves.toEqual(stage);
    await expect(
      verifyKnowledgeGenerationStageCommand({
        ...stage,
        chunks: [{ ...stage.chunks[0], vector: [0, 1, 0, 0] }],
      }),
    ).rejects.toThrow("KNOWLEDGE_GENERATION_STAGE_AUTHORITY_MISMATCH");

    const hit = await buildKnowledgeEvidenceHit({
      schema_version: "knowledge-evidence-hit@1.0.0",
      scope,
      knowledge_base_ref: generation.knowledge_base_ref,
      generation_ref: {
        generation_id: generation.generation_id,
        generation_revision: generation.generation_revision,
        generation_hash: generation.generation_hash,
      },
      chunk_ref: {
        chunk_id: projection.chunk_id,
        chunk_hash: `sha256:${"5".repeat(64)}`,
      },
      source_file_ref: fileRef,
      score: 0.91,
      query_projection_receipt_hash: projection.receipt_hash,
      acl_decision: "ALLOW",
      citation: { start_byte: 0, end_byte: 12, excerpt_hash: `sha256:${"6".repeat(64)}` },
    });
    const receipt = await buildKnowledgeRetrievalReceipt({
      schema_version: "knowledge-retrieval-receipt@1.0.0",
      receipt_id: "00000000-0000-4000-8000-00000000a301",
      scope,
      knowledge_base_ref: generation.knowledge_base_ref,
      generation_ref: hit.generation_ref,
      checkpoint: generation.checkpoint,
      query_hash: `sha256:${"7".repeat(64)}`,
      query_projection_receipt_hash: projection.receipt_hash,
      principal_id: "00000000-0000-4000-8000-00000000d001",
      hits: [hit],
      retrieved_at: "2026-08-17T00:00:05.000Z",
    });
    await expect(verifyKnowledgeRetrievalReceipt(receipt)).resolves.toEqual(receipt);
  });

  it("rejects a READY generation without a sealed checkpoint", () => {
    expect(() =>
      knowledgeIndexGenerationSchema.parse({
        schema_version: "knowledge-index-generation@1.0.0",
        scope,
        generation_id: "00000000-0000-4000-8000-00000000a101",
        generation_revision: 1,
        knowledge_base_ref: {
          knowledge_base_id: "00000000-0000-4000-8000-00000000c001",
          revision: 1,
          revision_hash: `sha256:${"1".repeat(64)}`,
        },
        source_file_refs: [fileRef],
        embedding_profile_ref: {
          profile_id: "00000000-0000-4000-8000-00000000e001",
          revision: 1,
          profile_hash: `sha256:${"2".repeat(64)}`,
        },
        acl_hash: `sha256:${"3".repeat(64)}`,
        state: "READY",
        chunk_count: 0,
        manifest_hash: `sha256:${"4".repeat(64)}`,
        checkpoint: null,
        reason_code: null,
        created_at: "2026-08-17T00:00:03.000Z",
        completed_at: "2026-08-17T00:00:04.000Z",
        generation_hash: `sha256:${"5".repeat(64)}`,
      }),
    ).toThrow();
  });

  it("rejects a restricted projection that claims ALLOW", () => {
    const candidate = {
      schema_version: "knowledge-data-projection-receipt@1.0.0",
      receipt_id: "00000000-0000-4000-8000-00000000d101",
      scope,
      knowledge_base_ref: {
        knowledge_base_id: "00000000-0000-4000-8000-00000000c001",
        revision: 1,
        revision_hash: `sha256:${"1".repeat(64)}`,
      },
      source_file_ref: fileRef,
      chunk_id: "00000000-0000-4000-8000-00000000d201",
      classification: "RESTRICTED",
      provider: "deepseek",
      projection_policy_version: "knowledge-projection@1.0.0",
      redaction_count: 0,
      pii_finding_count: 0,
      credential_finding_count: 0,
      prompt_injection_detected: false,
      decision: "ALLOW",
      payload_hash: `sha256:${"2".repeat(64)}`,
      projected_at: "2026-08-17T00:00:02.000Z",
      receipt_hash: `sha256:${"3".repeat(64)}`,
    };
    expect(knowledgeDataProjectionReceiptSchema.safeParse(candidate).success).toBe(false);
  });

  it("detects retrieval receipt tampering", async () => {
    const invalid = { schema_version: "knowledge-retrieval-receipt@1.0.0" };
    await expect(verifyKnowledgeRetrievalReceipt(invalid)).rejects.toThrow();
  });
});
