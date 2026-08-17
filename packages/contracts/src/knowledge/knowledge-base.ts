import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { workspaceFileReferenceSchema } from "../workspaces/files.js";

const positiveSafeIntegerSchema = z.number().int().positive().safe();
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
const utcMillisecondTimestampSchema = timestampSchema.refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
  "Knowledge Authority timestamp must use UTC milliseconds.",
);

function canonicalRefIdentity(reference: z.infer<typeof workspaceFileReferenceSchema>): string {
  return `${reference.file_id}:${reference.revision}:${reference.revision_hash}`;
}

function assertCanonicalFileRefs(
  references: readonly z.infer<typeof workspaceFileReferenceSchema>[],
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const identities = references.map(canonicalRefIdentity);
  const sorted = [...identities].sort();
  if (
    new Set(identities).size !== identities.length ||
    identities.some((identity, index) => identity !== sorted[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "Knowledge source file references must be unique and canonically sorted.",
      path,
    });
  }
}

export const knowledgeClassificationSchema = z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"]);
export const knowledgeBaseStatusSchema = z.enum([
  "PENDING",
  "INDEXING",
  "READY",
  "STALE",
  "FAILED",
  "DELETED",
]);
export const knowledgeGenerationStateSchema = z.enum([
  "PENDING",
  "INDEXING",
  "READY",
  "STALE",
  "FAILED",
]);
export const knowledgeIndexReasonCodeSchema = z.enum([
  "SOURCE_NOT_READY",
  "SOURCE_STALE",
  "SOURCE_DELETED",
  "PROFILE_NOT_READY",
  "PROJECTION_POLICY_BLOCKED",
  "EMBEDDING_FAILED",
  "EMBEDDING_DIMENSION_MISMATCH",
  "INDEX_NOT_CONFIGURED",
  "INDEX_NOT_READY",
  "INDEX_UNAVAILABLE",
  "INDEX_DIGEST_MISMATCH",
  "ACL_CHANGED",
  "AUTHORITY_CHANGED",
  "INDEX_BUILD_FAILED",
]);

export const embeddingProfileReferenceSchema = z.strictObject({
  profile_id: immutableIdSchema,
  revision: positiveSafeIntegerSchema,
  profile_hash: contentHashSchema,
});

const embeddingProfileRevisionDraftSchema = z.strictObject({
  schema_version: z.literal("embedding-profile-revision@1.0.0"),
  scope: appScopeSchema,
  profile_id: immutableIdSchema,
  revision: positiveSafeIntegerSchema,
  provider: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  model_id: z.string().min(1).max(128),
  dimensions: z.number().int().min(2).max(16_384),
  normalization: z.enum(["NONE", "L2"]),
  parser_version: versionIdentifierSchema,
  chunker_version: versionIdentifierSchema,
  projection_policy_version: versionIdentifierSchema,
  status: z.enum(["READY", "NOT_READY", "STALE"]),
  created_at: utcMillisecondTimestampSchema,
});

export const embeddingProfileRevisionSchema = embeddingProfileRevisionDraftSchema.extend({
  profile_hash: contentHashSchema,
});

export async function computeEmbeddingProfileRevisionHash(input: unknown) {
  return sha256ContentHash(embeddingProfileRevisionDraftSchema.parse(input));
}

export async function buildEmbeddingProfileRevision(input: unknown) {
  const draft = embeddingProfileRevisionDraftSchema.parse(input);
  return deepFreeze(
    embeddingProfileRevisionSchema.parse({
      ...draft,
      profile_hash: await computeEmbeddingProfileRevisionHash(draft),
    }),
  );
}

export async function verifyEmbeddingProfileRevision(input: unknown) {
  const revision = embeddingProfileRevisionSchema.parse(input);
  const { profile_hash: _hash, ...draft } = revision;
  if ((await computeEmbeddingProfileRevisionHash(draft)) !== revision.profile_hash) {
    throw new TypeError("EMBEDDING_PROFILE_REVISION_HASH_MISMATCH");
  }
  return deepFreeze(revision);
}

export const knowledgeBaseReferenceSchema = z.strictObject({
  knowledge_base_id: immutableIdSchema,
  revision: positiveSafeIntegerSchema,
  revision_hash: contentHashSchema,
});

export const knowledgeGenerationReferenceSchema = z.strictObject({
  generation_id: immutableIdSchema,
  generation_revision: positiveSafeIntegerSchema,
  generation_hash: contentHashSchema,
});

export const knowledgeAclSchema = z
  .strictObject({
    visibility: z.enum(["WORKSPACE", "PRINCIPALS"]),
    principal_ids: z.array(immutableIdSchema).max(256),
  })
  .superRefine((acl, context) => {
    const sorted = [...acl.principal_ids].sort();
    if (
      new Set(acl.principal_ids).size !== acl.principal_ids.length ||
      acl.principal_ids.some((id, index) => id !== sorted[index]) ||
      (acl.visibility === "WORKSPACE" && acl.principal_ids.length !== 0) ||
      (acl.visibility === "PRINCIPALS" && acl.principal_ids.length === 0)
    ) {
      context.addIssue({ code: "custom", message: "Knowledge ACL closure is invalid." });
    }
  });

const knowledgeBaseRevisionDraftSchema = z
  .strictObject({
    schema_version: z.literal("knowledge-base-revision@1.0.0"),
    scope: appScopeSchema,
    knowledge_base_id: immutableIdSchema,
    revision: positiveSafeIntegerSchema,
    name: z.string().trim().min(1).max(160),
    source_file_refs: z.array(workspaceFileReferenceSchema).min(1).max(128),
    embedding_profile_ref: embeddingProfileReferenceSchema,
    acl: knowledgeAclSchema,
    status: knowledgeBaseStatusSchema,
    active_generation_ref: knowledgeGenerationReferenceSchema.nullable(),
    created_by_principal_id: immutableIdSchema,
    created_at: utcMillisecondTimestampSchema,
  })
  .superRefine((revision, context) => {
    assertCanonicalFileRefs(revision.source_file_refs, context, ["source_file_refs"]);
    if (
      (revision.status === "READY" && revision.active_generation_ref === null) ||
      (revision.status !== "READY" && revision.active_generation_ref !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a READY Knowledge Base may bind an active generation.",
        path: ["active_generation_ref"],
      });
    }
  });

export const knowledgeBaseRevisionSchema = z
  .strictObject({
    ...knowledgeBaseRevisionDraftSchema.shape,
    revision_hash: contentHashSchema,
  })
  .superRefine((revision, context) => {
    assertCanonicalFileRefs(revision.source_file_refs, context, ["source_file_refs"]);
    if (
      (revision.status === "READY" && revision.active_generation_ref === null) ||
      (revision.status !== "READY" && revision.active_generation_ref !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a READY Knowledge Base may bind an active generation.",
        path: ["active_generation_ref"],
      });
    }
  });

export async function computeKnowledgeBaseRevisionHash(input: unknown) {
  return sha256ContentHash(knowledgeBaseRevisionDraftSchema.parse(input));
}

export async function buildKnowledgeBaseRevision(input: unknown) {
  const draft = knowledgeBaseRevisionDraftSchema.parse(input);
  return deepFreeze(
    knowledgeBaseRevisionSchema.parse({
      ...draft,
      revision_hash: await computeKnowledgeBaseRevisionHash(draft),
    }),
  );
}

export async function verifyKnowledgeBaseRevision(input: unknown) {
  const revision = knowledgeBaseRevisionSchema.parse(input);
  const { revision_hash: _hash, ...draft } = revision;
  if ((await computeKnowledgeBaseRevisionHash(draft)) !== revision.revision_hash) {
    throw new TypeError("KNOWLEDGE_BASE_REVISION_HASH_MISMATCH");
  }
  return deepFreeze(revision);
}

const knowledgeDataProjectionReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("knowledge-data-projection-receipt@1.0.0"),
    receipt_id: immutableIdSchema,
    scope: appScopeSchema,
    knowledge_base_ref: knowledgeBaseReferenceSchema,
    source_file_ref: workspaceFileReferenceSchema,
    chunk_id: immutableIdSchema,
    classification: knowledgeClassificationSchema,
    provider: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    projection_policy_version: versionIdentifierSchema,
    redaction_count: nonNegativeSafeIntegerSchema,
    pii_finding_count: nonNegativeSafeIntegerSchema,
    credential_finding_count: nonNegativeSafeIntegerSchema,
    prompt_injection_detected: z.boolean(),
    decision: z.enum(["ALLOW", "POLICY_BLOCKED"]),
    payload_hash: contentHashSchema,
    projected_at: utcMillisecondTimestampSchema,
  })
  .superRefine((receipt, context) => {
    const safe =
      (receipt.classification === "PUBLIC" || receipt.classification === "INTERNAL") &&
      receipt.pii_finding_count === 0 &&
      receipt.credential_finding_count === 0 &&
      !receipt.prompt_injection_detected;
    if ((receipt.decision === "ALLOW") !== safe) {
      context.addIssue({ code: "custom", message: "Knowledge projection decision is invalid." });
    }
  });

export const knowledgeDataProjectionReceiptSchema = z
  .strictObject({
    ...knowledgeDataProjectionReceiptDraftSchema.shape,
    receipt_hash: contentHashSchema,
  })
  .superRefine((receipt, context) => {
    const safe =
      (receipt.classification === "PUBLIC" || receipt.classification === "INTERNAL") &&
      receipt.pii_finding_count === 0 &&
      receipt.credential_finding_count === 0 &&
      !receipt.prompt_injection_detected;
    if ((receipt.decision === "ALLOW") !== safe) {
      context.addIssue({ code: "custom", message: "Knowledge projection decision is invalid." });
    }
  });

export async function computeKnowledgeDataProjectionReceiptHash(input: unknown) {
  return sha256ContentHash(knowledgeDataProjectionReceiptDraftSchema.parse(input));
}

export async function buildKnowledgeDataProjectionReceipt(input: unknown) {
  const draft = knowledgeDataProjectionReceiptDraftSchema.parse(input);
  return deepFreeze(
    knowledgeDataProjectionReceiptSchema.parse({
      ...draft,
      receipt_hash: await computeKnowledgeDataProjectionReceiptHash(draft),
    }),
  );
}

export async function verifyKnowledgeDataProjectionReceipt(input: unknown) {
  const receipt = knowledgeDataProjectionReceiptSchema.parse(input);
  const { receipt_hash: _hash, ...draft } = receipt;
  if ((await computeKnowledgeDataProjectionReceiptHash(draft)) !== receipt.receipt_hash) {
    throw new TypeError("KNOWLEDGE_DATA_PROJECTION_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

const knowledgeQueryProjectionReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("knowledge-query-projection-receipt@1.0.0"),
    receipt_id: immutableIdSchema,
    scope: appScopeSchema,
    knowledge_base_ref: knowledgeBaseReferenceSchema,
    generation_ref: knowledgeGenerationReferenceSchema,
    classification: knowledgeClassificationSchema,
    provider: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    projection_policy_version: versionIdentifierSchema,
    pii_finding_count: nonNegativeSafeIntegerSchema,
    credential_finding_count: nonNegativeSafeIntegerSchema,
    prompt_injection_detected: z.boolean(),
    decision: z.enum(["ALLOW", "POLICY_BLOCKED"]),
    payload_hash: contentHashSchema,
    projected_at: utcMillisecondTimestampSchema,
  })
  .superRefine((receipt, context) => {
    const safe =
      (receipt.classification === "PUBLIC" || receipt.classification === "INTERNAL") &&
      receipt.pii_finding_count === 0 &&
      receipt.credential_finding_count === 0 &&
      !receipt.prompt_injection_detected;
    if ((receipt.decision === "ALLOW") !== safe) {
      context.addIssue({
        code: "custom",
        message: "Knowledge query projection decision is invalid.",
      });
    }
  });

export const knowledgeQueryProjectionReceiptSchema = z.strictObject({
  ...knowledgeQueryProjectionReceiptDraftSchema.shape,
  receipt_hash: contentHashSchema,
});

export async function buildKnowledgeQueryProjectionReceipt(input: unknown) {
  const draft = knowledgeQueryProjectionReceiptDraftSchema.parse(input);
  return deepFreeze(
    knowledgeQueryProjectionReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyKnowledgeQueryProjectionReceipt(input: unknown) {
  const receipt = knowledgeQueryProjectionReceiptSchema.parse(input);
  const { receipt_hash: _hash, ...draft } = receipt;
  if (
    (await sha256ContentHash(knowledgeQueryProjectionReceiptDraftSchema.parse(draft))) !==
    receipt.receipt_hash
  ) {
    throw new TypeError("KNOWLEDGE_QUERY_PROJECTION_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

export const knowledgeIndexCheckpointSchema = z.strictObject({
  index_kind: z.literal("NEO4J_VECTOR"),
  build_id: immutableIdSchema,
  manifest_hash: contentHashSchema,
  dimensions: z.number().int().min(2).max(16_384),
  sealed_at: utcMillisecondTimestampSchema,
});

const knowledgeIndexGenerationDraftSchema = z
  .strictObject({
    schema_version: z.literal("knowledge-index-generation@1.0.0"),
    scope: appScopeSchema,
    generation_id: immutableIdSchema,
    generation_revision: positiveSafeIntegerSchema,
    knowledge_base_ref: knowledgeBaseReferenceSchema,
    source_file_refs: z.array(workspaceFileReferenceSchema).min(1).max(128),
    embedding_profile_ref: embeddingProfileReferenceSchema,
    acl_hash: contentHashSchema,
    state: knowledgeGenerationStateSchema,
    chunk_count: nonNegativeSafeIntegerSchema,
    manifest_hash: contentHashSchema,
    checkpoint: knowledgeIndexCheckpointSchema.nullable(),
    reason_code: knowledgeIndexReasonCodeSchema.nullable(),
    created_at: utcMillisecondTimestampSchema,
    completed_at: utcMillisecondTimestampSchema.nullable(),
  })
  .superRefine((generation, context) => {
    assertCanonicalFileRefs(generation.source_file_refs, context, ["source_file_refs"]);
    const ready = generation.state === "READY";
    if (
      ready !== (generation.checkpoint !== null) ||
      ready !== (generation.completed_at !== null) ||
      ready === (generation.reason_code !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Knowledge generation state closure is invalid.",
      });
    }
    if (generation.checkpoint && generation.checkpoint.manifest_hash !== generation.manifest_hash) {
      context.addIssue({ code: "custom", message: "Knowledge checkpoint manifest mismatch." });
    }
  });

export const knowledgeIndexGenerationSchema = z
  .strictObject({
    ...knowledgeIndexGenerationDraftSchema.shape,
    generation_hash: contentHashSchema,
  })
  .superRefine((generation, context) => {
    assertCanonicalFileRefs(generation.source_file_refs, context, ["source_file_refs"]);
    const ready = generation.state === "READY";
    if (
      ready !== (generation.checkpoint !== null) ||
      ready !== (generation.completed_at !== null) ||
      ready === (generation.reason_code !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Knowledge generation state closure is invalid.",
      });
    }
    if (generation.checkpoint && generation.checkpoint.manifest_hash !== generation.manifest_hash) {
      context.addIssue({ code: "custom", message: "Knowledge checkpoint manifest mismatch." });
    }
  });

export async function computeKnowledgeIndexGenerationHash(input: unknown) {
  return sha256ContentHash(knowledgeIndexGenerationDraftSchema.parse(input));
}

export async function buildKnowledgeIndexGeneration(input: unknown) {
  const draft = knowledgeIndexGenerationDraftSchema.parse(input);
  return deepFreeze(
    knowledgeIndexGenerationSchema.parse({
      ...draft,
      generation_hash: await computeKnowledgeIndexGenerationHash(draft),
    }),
  );
}

export async function verifyKnowledgeIndexGeneration(input: unknown) {
  const generation = knowledgeIndexGenerationSchema.parse(input);
  const { generation_hash: _hash, ...draft } = generation;
  if ((await computeKnowledgeIndexGenerationHash(draft)) !== generation.generation_hash) {
    throw new TypeError("KNOWLEDGE_INDEX_GENERATION_HASH_MISMATCH");
  }
  return deepFreeze(generation);
}

export const knowledgeChunkReferenceSchema = z.strictObject({
  chunk_id: immutableIdSchema,
  chunk_hash: contentHashSchema,
});

const knowledgeChunkDraftSchema = z.strictObject({
  schema_version: z.literal("knowledge-chunk@1.0.0"),
  scope: appScopeSchema,
  generation_id: immutableIdSchema,
  generation_revision: positiveSafeIntegerSchema,
  knowledge_base_ref: knowledgeBaseReferenceSchema,
  chunk_id: immutableIdSchema,
  source_file_ref: workspaceFileReferenceSchema,
  ordinal: nonNegativeSafeIntegerSchema,
  start_byte: nonNegativeSafeIntegerSchema,
  end_byte: positiveSafeIntegerSchema,
  text_hash: contentHashSchema,
  projection_receipt_hash: contentHashSchema,
  embedding_hash: contentHashSchema,
  dimensions: z.number().int().min(2).max(16_384),
});

export const knowledgeChunkSchema = knowledgeChunkDraftSchema.extend({
  chunk_hash: contentHashSchema,
});

export async function buildKnowledgeChunk(input: unknown) {
  const draft = knowledgeChunkDraftSchema.parse(input);
  return deepFreeze(
    knowledgeChunkSchema.parse({ ...draft, chunk_hash: await sha256ContentHash(draft) }),
  );
}

export async function verifyKnowledgeChunk(input: unknown) {
  const chunk = knowledgeChunkSchema.parse(input);
  const { chunk_hash: _hash, ...draft } = chunk;
  if ((await sha256ContentHash(knowledgeChunkDraftSchema.parse(draft))) !== chunk.chunk_hash) {
    throw new TypeError("KNOWLEDGE_CHUNK_HASH_MISMATCH");
  }
  return deepFreeze(chunk);
}

const citationSchema = z
  .strictObject({
    start_byte: nonNegativeSafeIntegerSchema,
    end_byte: positiveSafeIntegerSchema,
    excerpt_hash: contentHashSchema,
  })
  .refine((value) => value.end_byte > value.start_byte, "Knowledge citation range is invalid.");

const knowledgeEvidenceHitDraftSchema = z.strictObject({
  schema_version: z.literal("knowledge-evidence-hit@1.0.0"),
  scope: appScopeSchema,
  knowledge_base_ref: knowledgeBaseReferenceSchema,
  generation_ref: knowledgeGenerationReferenceSchema,
  chunk_ref: knowledgeChunkReferenceSchema,
  source_file_ref: workspaceFileReferenceSchema,
  score: z.number().finite().min(-1).max(1),
  query_projection_receipt_hash: contentHashSchema,
  acl_decision: z.literal("ALLOW"),
  citation: citationSchema,
});

export const knowledgeEvidenceHitSchema = knowledgeEvidenceHitDraftSchema.extend({
  evidence_hash: contentHashSchema,
});

export async function computeKnowledgeEvidenceHitHash(input: unknown) {
  return sha256ContentHash(knowledgeEvidenceHitDraftSchema.parse(input));
}

export async function buildKnowledgeEvidenceHit(input: unknown) {
  const draft = knowledgeEvidenceHitDraftSchema.parse(input);
  return deepFreeze(
    knowledgeEvidenceHitSchema.parse({
      ...draft,
      evidence_hash: await computeKnowledgeEvidenceHitHash(draft),
    }),
  );
}

const knowledgeRetrievalReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("knowledge-retrieval-receipt@1.0.0"),
    receipt_id: immutableIdSchema,
    scope: appScopeSchema,
    knowledge_base_ref: knowledgeBaseReferenceSchema,
    generation_ref: knowledgeGenerationReferenceSchema,
    checkpoint: knowledgeIndexCheckpointSchema,
    query_hash: contentHashSchema,
    query_projection_receipt_hash: contentHashSchema,
    principal_id: immutableIdSchema,
    hits: z.array(knowledgeEvidenceHitSchema).max(50),
    retrieved_at: utcMillisecondTimestampSchema,
  })
  .superRefine((receipt, context) => {
    const identities = receipt.hits.map((hit) => `${hit.chunk_ref.chunk_id}:${hit.evidence_hash}`);
    if (new Set(identities).size !== identities.length) {
      context.addIssue({ code: "custom", message: "Knowledge retrieval hits must be unique." });
    }
    receipt.hits.forEach((hit, index) => {
      if (
        hit.scope.app_id !== receipt.scope.app_id ||
        hit.scope.tenant_id !== receipt.scope.tenant_id ||
        hit.scope.environment !== receipt.scope.environment ||
        hit.knowledge_base_ref.knowledge_base_id !== receipt.knowledge_base_ref.knowledge_base_id ||
        hit.generation_ref.generation_hash !== receipt.generation_ref.generation_hash ||
        hit.query_projection_receipt_hash !== receipt.query_projection_receipt_hash
      ) {
        context.addIssue({
          code: "custom",
          message: "Knowledge retrieval hit authority mismatch.",
          path: ["hits", index],
        });
      }
    });
  });

export const knowledgeRetrievalReceiptSchema = z.strictObject({
  ...knowledgeRetrievalReceiptDraftSchema.shape,
  receipt_hash: contentHashSchema,
});

export async function computeKnowledgeRetrievalReceiptHash(input: unknown) {
  return sha256ContentHash(knowledgeRetrievalReceiptDraftSchema.parse(input));
}

export async function buildKnowledgeRetrievalReceipt(input: unknown) {
  const draft = knowledgeRetrievalReceiptDraftSchema.parse(input);
  return deepFreeze(
    knowledgeRetrievalReceiptSchema.parse({
      ...draft,
      receipt_hash: await computeKnowledgeRetrievalReceiptHash(draft),
    }),
  );
}

export async function verifyKnowledgeRetrievalReceipt(input: unknown) {
  const receipt = knowledgeRetrievalReceiptSchema.parse(input);
  const { receipt_hash: _receiptHash, ...receiptDraft } = receipt;
  const draft = knowledgeRetrievalReceiptDraftSchema.parse(receiptDraft);
  for (const hit of receipt.hits) {
    const { evidence_hash: _hash, ...hitDraft } = hit;
    if ((await computeKnowledgeEvidenceHitHash(hitDraft)) !== hit.evidence_hash) {
      throw new TypeError("KNOWLEDGE_EVIDENCE_HIT_HASH_MISMATCH");
    }
  }
  if ((await computeKnowledgeRetrievalReceiptHash(draft)) !== receipt.receipt_hash) {
    throw new TypeError("KNOWLEDGE_RETRIEVAL_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

export const knowledgeDebugSearchRequestSchema = z.strictObject({
  schema_version: z.literal("knowledge-debug-search-request@1.0.0"),
  knowledge_base_ref: knowledgeBaseReferenceSchema,
  generation_ref: knowledgeGenerationReferenceSchema,
  query: z.string().trim().min(1).max(4_000),
  limit: z.number().int().min(1).max(20),
});

export const knowledgeDebugSearchResultSchema = z.strictObject({
  schema_version: z.literal("knowledge-debug-search-result@1.0.0"),
  status: z.enum(["READY", "NOT_READY", "STALE"]),
  reason_code: knowledgeIndexReasonCodeSchema.nullable(),
  receipt: knowledgeRetrievalReceiptSchema.nullable(),
});

const knowledgeBaseCreateCommandDraftSchema = z.strictObject({
  schema_version: z.literal("knowledge-base-create@1.0.0"),
  operation_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  name: z.string().trim().min(1).max(160),
  source_file_refs: z.array(workspaceFileReferenceSchema).min(1).max(128),
  embedding_profile_ref: embeddingProfileReferenceSchema,
  acl: knowledgeAclSchema,
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
});

export const knowledgeBaseCreateCommandSchema = knowledgeBaseCreateCommandDraftSchema.extend({
  request_hash: contentHashSchema,
});

export async function buildKnowledgeBaseCreateCommand(input: unknown) {
  const draft = knowledgeBaseCreateCommandDraftSchema.parse(input);
  return deepFreeze(
    knowledgeBaseCreateCommandSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyKnowledgeBaseCreateCommand(input: unknown) {
  const command = knowledgeBaseCreateCommandSchema.parse(input);
  const { request_hash: _hash, ...draft } = command;
  if (
    (await sha256ContentHash(knowledgeBaseCreateCommandDraftSchema.parse(draft))) !==
    command.request_hash
  ) {
    throw new TypeError("KNOWLEDGE_BASE_CREATE_REQUEST_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

const knowledgeBaseRebuildCommandDraftSchema = z.strictObject({
  schema_version: z.literal("knowledge-base-rebuild@1.0.0"),
  operation_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  knowledge_base_ref: knowledgeBaseReferenceSchema,
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
});

export const knowledgeBaseRebuildCommandSchema = knowledgeBaseRebuildCommandDraftSchema.extend({
  request_hash: contentHashSchema,
});

export async function buildKnowledgeBaseRebuildCommand(input: unknown) {
  const draft = knowledgeBaseRebuildCommandDraftSchema.parse(input);
  return deepFreeze(
    knowledgeBaseRebuildCommandSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyKnowledgeBaseRebuildCommand(input: unknown) {
  const command = knowledgeBaseRebuildCommandSchema.parse(input);
  const { request_hash: _hash, ...draft } = command;
  if (
    (await sha256ContentHash(knowledgeBaseRebuildCommandDraftSchema.parse(draft))) !==
    command.request_hash
  ) {
    throw new TypeError("KNOWLEDGE_BASE_REBUILD_REQUEST_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

export const knowledgeIndexTargetSchema = z.strictObject({
  schema_version: z.literal("knowledge-index-target@1.0.0"),
  knowledge_base: knowledgeBaseRevisionSchema,
  generation: knowledgeIndexGenerationSchema,
  embedding_profile: embeddingProfileRevisionSchema,
  sources: z.array(
    z.strictObject({
      file_ref: workspaceFileReferenceSchema,
      blob_hash: contentHashSchema,
      byte_size: positiveSafeIntegerSchema,
      detected_mime: z.string().min(3).max(127),
      storage_key: z.string().min(1).max(512),
      classification: knowledgeClassificationSchema,
    }),
  ),
});

function sameScope(
  left: z.infer<typeof appScopeSchema>,
  right: z.infer<typeof appScopeSchema>,
): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

export async function verifyKnowledgeIndexTarget(input: unknown) {
  const target = knowledgeIndexTargetSchema.parse(input);
  const knowledgeBase = await verifyKnowledgeBaseRevision(target.knowledge_base);
  const generation = await verifyKnowledgeIndexGeneration(target.generation);
  const embeddingProfile = await verifyEmbeddingProfileRevision(target.embedding_profile);
  const baseRef = {
    knowledge_base_id: knowledgeBase.knowledge_base_id,
    revision: knowledgeBase.revision,
    revision_hash: knowledgeBase.revision_hash,
  };
  const sourceIdentities = target.sources.map(({ file_ref }) => canonicalRefIdentity(file_ref));
  const expectedSources = knowledgeBase.source_file_refs.map(canonicalRefIdentity);
  if (
    !sameScope(knowledgeBase.scope, generation.scope) ||
    !sameScope(knowledgeBase.scope, embeddingProfile.scope) ||
    JSON.stringify(generation.knowledge_base_ref) !== JSON.stringify(baseRef) ||
    JSON.stringify(generation.source_file_refs) !==
      JSON.stringify(knowledgeBase.source_file_refs) ||
    JSON.stringify(generation.embedding_profile_ref) !==
      JSON.stringify(knowledgeBase.embedding_profile_ref) ||
    embeddingProfile.profile_id !== knowledgeBase.embedding_profile_ref.profile_id ||
    embeddingProfile.revision !== knowledgeBase.embedding_profile_ref.revision ||
    embeddingProfile.profile_hash !== knowledgeBase.embedding_profile_ref.profile_hash ||
    JSON.stringify(sourceIdentities) !== JSON.stringify(expectedSources)
  ) {
    throw new TypeError("KNOWLEDGE_INDEX_TARGET_AUTHORITY_MISMATCH");
  }
  return deepFreeze({
    ...target,
    knowledge_base: knowledgeBase,
    generation,
    embedding_profile: embeddingProfile,
  });
}

export const knowledgeChunkCommitSchema = z.strictObject({
  chunk: knowledgeChunkSchema,
  normalized_text: z.string().min(1).max(32_000),
  vector: z.array(z.number().finite()).min(2).max(16_384),
  projection_receipt: knowledgeDataProjectionReceiptSchema,
});

export const knowledgeGenerationStageCommandSchema = z.strictObject({
  schema_version: z.literal("knowledge-generation-stage@1.0.0"),
  generation_ref: knowledgeGenerationReferenceSchema,
  chunks: z.array(knowledgeChunkCommitSchema).min(1).max(100_000),
  manifest_hash: contentHashSchema,
});

export async function verifyKnowledgeGenerationStageCommand(input: unknown) {
  const command = knowledgeGenerationStageCommandSchema.parse(input);
  for (const [ordinal, commit] of command.chunks.entries()) {
    const chunk = await verifyKnowledgeChunk(commit.chunk);
    const projection = await verifyKnowledgeDataProjectionReceipt(commit.projection_receipt);
    if (
      chunk.generation_id !== command.generation_ref.generation_id ||
      chunk.generation_revision !== command.generation_ref.generation_revision ||
      chunk.ordinal !== ordinal ||
      chunk.dimensions !== commit.vector.length ||
      chunk.text_hash !== (await sha256ContentHash(commit.normalized_text)) ||
      chunk.embedding_hash !== (await sha256ContentHash(commit.vector)) ||
      chunk.projection_receipt_hash !== projection.receipt_hash ||
      projection.decision !== "ALLOW" ||
      projection.chunk_id !== chunk.chunk_id ||
      JSON.stringify(projection.scope) !== JSON.stringify(chunk.scope) ||
      JSON.stringify(projection.knowledge_base_ref) !== JSON.stringify(chunk.knowledge_base_ref) ||
      JSON.stringify(projection.source_file_ref) !== JSON.stringify(chunk.source_file_ref) ||
      projection.payload_hash !== chunk.text_hash
    ) {
      throw new TypeError("KNOWLEDGE_GENERATION_STAGE_AUTHORITY_MISMATCH");
    }
  }
  if (
    command.manifest_hash !==
    (await sha256ContentHash(command.chunks.map(({ chunk }) => chunk.chunk_hash)))
  ) {
    throw new TypeError("KNOWLEDGE_GENERATION_STAGE_MANIFEST_MISMATCH");
  }
  return deepFreeze(command);
}

export const knowledgeGenerationReadyCommitSchema = z.strictObject({
  schema_version: z.literal("knowledge-generation-ready@1.0.0"),
  generation_ref: knowledgeGenerationReferenceSchema,
  checkpoint: knowledgeIndexCheckpointSchema,
});

export const knowledgeBaseMutationResultSchema = z.strictObject({
  knowledge_base: knowledgeBaseRevisionSchema,
  generation: knowledgeIndexGenerationSchema,
});

export type EmbeddingProfileReference = z.infer<typeof embeddingProfileReferenceSchema>;
export type EmbeddingProfileRevision = z.infer<typeof embeddingProfileRevisionSchema>;
export type KnowledgeClassification = z.infer<typeof knowledgeClassificationSchema>;
export type KnowledgeBaseReference = z.infer<typeof knowledgeBaseReferenceSchema>;
export type KnowledgeBaseRevision = z.infer<typeof knowledgeBaseRevisionSchema>;
export type KnowledgeDataProjectionReceipt = z.infer<typeof knowledgeDataProjectionReceiptSchema>;
export type KnowledgeQueryProjectionReceipt = z.infer<typeof knowledgeQueryProjectionReceiptSchema>;
export type KnowledgeIndexCheckpoint = z.infer<typeof knowledgeIndexCheckpointSchema>;
export type KnowledgeGenerationReference = z.infer<typeof knowledgeGenerationReferenceSchema>;
export type KnowledgeIndexGeneration = z.infer<typeof knowledgeIndexGenerationSchema>;
export type KnowledgeChunk = z.infer<typeof knowledgeChunkSchema>;
export type KnowledgeEvidenceHit = z.infer<typeof knowledgeEvidenceHitSchema>;
export type KnowledgeRetrievalReceipt = z.infer<typeof knowledgeRetrievalReceiptSchema>;
export type KnowledgeDebugSearchRequest = z.infer<typeof knowledgeDebugSearchRequestSchema>;
export type KnowledgeDebugSearchResult = z.infer<typeof knowledgeDebugSearchResultSchema>;
export type KnowledgeBaseCreateCommand = z.infer<typeof knowledgeBaseCreateCommandSchema>;
export type KnowledgeBaseRebuildCommand = z.infer<typeof knowledgeBaseRebuildCommandSchema>;
export type KnowledgeIndexTarget = z.infer<typeof knowledgeIndexTargetSchema>;
export type KnowledgeChunkCommit = z.infer<typeof knowledgeChunkCommitSchema>;
export type KnowledgeGenerationStageCommand = z.infer<typeof knowledgeGenerationStageCommandSchema>;
export type KnowledgeGenerationReadyCommit = z.infer<typeof knowledgeGenerationReadyCommitSchema>;
export type KnowledgeBaseMutationResult = z.infer<typeof knowledgeBaseMutationResultSchema>;
