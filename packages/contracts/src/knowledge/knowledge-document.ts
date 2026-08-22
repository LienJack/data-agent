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
import { knowledgeBaseReferenceSchema } from "./knowledge-base.js";

const positiveSafeIntegerSchema = z.number().int().positive().safe();
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
const utcMillisecondTimestampSchema = timestampSchema.refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
  "Knowledge Document timestamp must use UTC milliseconds.",
);

export const knowledgeDocumentReferenceSchema = z.strictObject({
  document_id: immutableIdSchema,
  revision: positiveSafeIntegerSchema,
  canonical_markdown_hash: contentHashSchema,
});

export const knowledgeDocumentStatusSchema = z.enum(["PENDING", "PARSING", "READY", "FAILED"]);
export const knowledgeDocumentReasonCodeSchema = z.enum([
  "SOURCE_NOT_READY",
  "SOURCE_NOT_MARKDOWN",
  "SOURCE_INVALID_UTF8",
  "MARKDOWN_PARSE_FAILED",
  "MARKDOWN_TOO_LARGE",
  "POLICY_BLOCKED",
]);
export const knowledgeDocumentBlockKindSchema = z.enum([
  "HEADING",
  "PARAGRAPH",
  "LIST",
  "TABLE",
  "CODE",
]);

const knowledgeDocumentRevisionDraftSchema = z
  .strictObject({
    schema_version: z.literal("knowledge-document-revision@1.0.0"),
    scope: appScopeSchema,
    knowledge_base_ref: knowledgeBaseReferenceSchema,
    document_id: immutableIdSchema,
    revision: positiveSafeIntegerSchema,
    source_file_ref: workspaceFileReferenceSchema,
    parent_document_ref: knowledgeDocumentReferenceSchema.nullable(),
    parser_version: versionIdentifierSchema,
    policy_version: versionIdentifierSchema,
    canonical_markdown_hash: contentHashSchema,
    block_manifest_hash: contentHashSchema,
    block_count: nonNegativeSafeIntegerSchema,
    status: knowledgeDocumentStatusSchema,
    reason_code: knowledgeDocumentReasonCodeSchema.nullable(),
    created_by_principal_id: immutableIdSchema,
    created_at: utcMillisecondTimestampSchema,
  })
  .superRefine((revision, context) => {
    const ready = revision.status === "READY";
    const failed = revision.status === "FAILED";
    if (failed !== (revision.reason_code !== null)) {
      context.addIssue({
        code: "custom",
        message: "Knowledge Document status and reason closure is invalid.",
        path: ["reason_code"],
      });
    }
    if (!ready && revision.block_count !== 0) {
      context.addIssue({
        code: "custom",
        message: "Only a READY Knowledge Document may expose blocks.",
        path: ["block_count"],
      });
    }
    if (ready && revision.block_count === 0) {
      context.addIssue({
        code: "custom",
        message: "A READY Knowledge Document must contain at least one block.",
        path: ["block_count"],
      });
    }
    if (
      revision.parent_document_ref?.document_id === revision.document_id &&
      revision.parent_document_ref.revision >= revision.revision
    ) {
      context.addIssue({
        code: "custom",
        message: "Knowledge Document parent must precede the current revision.",
        path: ["parent_document_ref"],
      });
    }
  });

export const knowledgeDocumentRevisionSchema = z
  .strictObject({
    ...knowledgeDocumentRevisionDraftSchema.shape,
    revision_hash: contentHashSchema,
  })
  .superRefine((revision, context) => {
    const ready = revision.status === "READY";
    const failed = revision.status === "FAILED";
    if (failed !== (revision.reason_code !== null)) {
      context.addIssue({
        code: "custom",
        message: "Knowledge Document status and reason closure is invalid.",
        path: ["reason_code"],
      });
    }
    if (!ready && revision.block_count !== 0) {
      context.addIssue({
        code: "custom",
        message: "Only a READY Knowledge Document may expose blocks.",
        path: ["block_count"],
      });
    }
    if (ready && revision.block_count === 0) {
      context.addIssue({ code: "custom", message: "READY Knowledge Document is empty." });
    }
  });

export async function computeKnowledgeDocumentRevisionHash(input: unknown) {
  return sha256ContentHash(knowledgeDocumentRevisionDraftSchema.parse(input));
}

export async function buildKnowledgeDocumentRevision(input: unknown) {
  const draft = knowledgeDocumentRevisionDraftSchema.parse(input);
  return deepFreeze(
    knowledgeDocumentRevisionSchema.parse({
      ...draft,
      revision_hash: await computeKnowledgeDocumentRevisionHash(draft),
    }),
  );
}

export async function verifyKnowledgeDocumentRevision(input: unknown) {
  const revision = knowledgeDocumentRevisionSchema.parse(input);
  const { revision_hash: _hash, ...draft } = revision;
  if ((await computeKnowledgeDocumentRevisionHash(draft)) !== revision.revision_hash) {
    throw new TypeError("KNOWLEDGE_DOCUMENT_REVISION_HASH_MISMATCH");
  }
  return deepFreeze(revision);
}

const headingAncestrySchema = z
  .array(z.string().trim().min(1).max(240))
  .max(12)
  .superRefine((ancestry, context) => {
    if (ancestry.some((heading) => heading.includes("\n") || heading.includes("\r"))) {
      context.addIssue({ code: "custom", message: "Heading ancestry must be single-line." });
    }
  });

const knowledgeDocumentBlockDraftSchema = z
  .strictObject({
    schema_version: z.literal("knowledge-document-block@1.0.0"),
    scope: appScopeSchema,
    knowledge_base_ref: knowledgeBaseReferenceSchema,
    document_ref: knowledgeDocumentReferenceSchema,
    source_file_ref: workspaceFileReferenceSchema,
    block_id: immutableIdSchema,
    kind: knowledgeDocumentBlockKindSchema,
    ordinal: nonNegativeSafeIntegerSchema,
    start_byte: nonNegativeSafeIntegerSchema,
    end_byte: positiveSafeIntegerSchema,
    start_line: positiveSafeIntegerSchema,
    end_line: positiveSafeIntegerSchema,
    heading_ancestry: headingAncestrySchema,
    canonical_text: z.string().min(1).max(200_000),
    normalized_text_hash: contentHashSchema,
  })
  .superRefine((block, context) => {
    if (block.end_byte <= block.start_byte) {
      context.addIssue({
        code: "custom",
        message: "Knowledge block byte range is invalid.",
        path: ["end_byte"],
      });
    }
    if (block.end_line < block.start_line) {
      context.addIssue({
        code: "custom",
        message: "Knowledge block line range is invalid.",
        path: ["end_line"],
      });
    }
    if (
      block.canonical_text.includes("\r") ||
      block.canonical_text !== block.canonical_text.normalize("NFC")
    ) {
      context.addIssue({
        code: "custom",
        message: "Knowledge block text must be NFC with LF line endings.",
        path: ["canonical_text"],
      });
    }
  });

export const knowledgeDocumentBlockSchema = z
  .strictObject({
    ...knowledgeDocumentBlockDraftSchema.shape,
    block_hash: contentHashSchema,
  })
  .superRefine((block, context) => {
    if (block.end_byte <= block.start_byte || block.end_line < block.start_line) {
      context.addIssue({ code: "custom", message: "Knowledge block range is invalid." });
    }
  });

export async function computeKnowledgeDocumentBlockHash(input: unknown) {
  const block = knowledgeDocumentBlockDraftSchema.parse(input);
  if ((await sha256ContentHash(block.canonical_text)) !== block.normalized_text_hash) {
    throw new TypeError("KNOWLEDGE_DOCUMENT_BLOCK_TEXT_HASH_MISMATCH");
  }
  return sha256ContentHash(block);
}

export async function buildKnowledgeDocumentBlock(input: unknown) {
  const draft = knowledgeDocumentBlockDraftSchema.parse(input);
  return deepFreeze(
    knowledgeDocumentBlockSchema.parse({
      ...draft,
      block_hash: await computeKnowledgeDocumentBlockHash(draft),
    }),
  );
}

export async function verifyKnowledgeDocumentBlock(input: unknown) {
  const block = knowledgeDocumentBlockSchema.parse(input);
  const { block_hash: _hash, ...draft } = block;
  if ((await computeKnowledgeDocumentBlockHash(draft)) !== block.block_hash) {
    throw new TypeError("KNOWLEDGE_DOCUMENT_BLOCK_HASH_MISMATCH");
  }
  return deepFreeze(block);
}

export const knowledgeDocumentBlockReferenceSchema = z.strictObject({
  document_ref: knowledgeDocumentReferenceSchema,
  block_id: immutableIdSchema,
  block_hash: contentHashSchema,
});

function blockReferenceIdentity(
  reference: z.infer<typeof knowledgeDocumentBlockReferenceSchema>,
): string {
  return `${reference.document_ref.document_id}:${String(reference.document_ref.revision).padStart(16, "0")}:${reference.block_id}:${reference.block_hash}`;
}

const knowledgeEvidenceSelectionDraftSchema = z
  .strictObject({
    schema_version: z.literal("knowledge-evidence-selection@1.0.0"),
    selection_id: immutableIdSchema,
    scope: appScopeSchema,
    knowledge_base_ref: knowledgeBaseReferenceSchema,
    intended_semantic_domain: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    block_refs: z.array(knowledgeDocumentBlockReferenceSchema).min(1).max(256),
    selected_by_principal_id: immutableIdSchema,
    selected_at: utcMillisecondTimestampSchema,
  })
  .superRefine((selection, context) => {
    const identities = selection.block_refs.map(blockReferenceIdentity);
    const sorted = [...identities].sort();
    if (
      new Set(identities).size !== identities.length ||
      identities.some((identity, index) => identity !== sorted[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Knowledge Evidence block references must be unique and canonically sorted.",
        path: ["block_refs"],
      });
    }
  });

export const knowledgeEvidenceSelectionSchema = z
  .strictObject({
    ...knowledgeEvidenceSelectionDraftSchema.shape,
    selection_hash: contentHashSchema,
  })
  .superRefine((selection, context) => {
    const identities = selection.block_refs.map(blockReferenceIdentity);
    const sorted = [...identities].sort();
    if (
      new Set(identities).size !== identities.length ||
      identities.some((identity, index) => identity !== sorted[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Knowledge Evidence selection is not canonical.",
      });
    }
  });

export async function computeKnowledgeEvidenceSelectionHash(input: unknown) {
  return sha256ContentHash(knowledgeEvidenceSelectionDraftSchema.parse(input));
}

export async function buildKnowledgeEvidenceSelection(input: unknown) {
  const draft = knowledgeEvidenceSelectionDraftSchema.parse(input);
  return deepFreeze(
    knowledgeEvidenceSelectionSchema.parse({
      ...draft,
      selection_hash: await computeKnowledgeEvidenceSelectionHash(draft),
    }),
  );
}

export async function verifyKnowledgeEvidenceSelection(input: unknown) {
  const selection = knowledgeEvidenceSelectionSchema.parse(input);
  const { selection_hash: _hash, ...draft } = selection;
  if ((await computeKnowledgeEvidenceSelectionHash(draft)) !== selection.selection_hash) {
    throw new TypeError("KNOWLEDGE_EVIDENCE_SELECTION_HASH_MISMATCH");
  }
  return deepFreeze(selection);
}

export const knowledgeDocumentCommitCommandSchema = z.strictObject({
  schema_version: z.literal("knowledge-document-commit@1.0.0"),
  document: knowledgeDocumentRevisionSchema,
  blocks: z.array(knowledgeDocumentBlockSchema).min(1).max(20_000),
});

export async function verifyKnowledgeDocumentCommitCommand(input: unknown) {
  const command = knowledgeDocumentCommitCommandSchema.parse(input);
  const document = await verifyKnowledgeDocumentRevision(command.document);
  const blocks = await Promise.all(command.blocks.map(verifyKnowledgeDocumentBlock));
  if (
    document.status !== "READY" ||
    blocks.length !== document.block_count ||
    (await sha256ContentHash(blocks.map((block) => block.block_hash))) !==
      document.block_manifest_hash
  ) {
    throw new TypeError("KNOWLEDGE_DOCUMENT_COMMIT_MANIFEST_MISMATCH");
  }
  blocks.forEach((block, index) => {
    if (
      block.ordinal !== index ||
      block.scope.app_id !== document.scope.app_id ||
      block.scope.tenant_id !== document.scope.tenant_id ||
      block.scope.environment !== document.scope.environment ||
      block.knowledge_base_ref.knowledge_base_id !==
        document.knowledge_base_ref.knowledge_base_id ||
      block.knowledge_base_ref.revision !== document.knowledge_base_ref.revision ||
      block.knowledge_base_ref.revision_hash !== document.knowledge_base_ref.revision_hash ||
      block.document_ref.document_id !== document.document_id ||
      block.document_ref.revision !== document.revision ||
      block.document_ref.canonical_markdown_hash !== document.canonical_markdown_hash ||
      block.source_file_ref.file_id !== document.source_file_ref.file_id ||
      block.source_file_ref.revision !== document.source_file_ref.revision ||
      block.source_file_ref.revision_hash !== document.source_file_ref.revision_hash
    ) {
      throw new TypeError("KNOWLEDGE_DOCUMENT_COMMIT_AUTHORITY_MISMATCH");
    }
  });
  return deepFreeze({ ...command, document, blocks });
}

const knowledgeCorrectionAnnotationDraftSchema = z.strictObject({
  schema_version: z.literal("knowledge-correction-annotation@1.0.0"),
  annotation_id: immutableIdSchema,
  scope: appScopeSchema,
  knowledge_base_ref: knowledgeBaseReferenceSchema,
  block_ref: knowledgeDocumentBlockReferenceSchema,
  annotation_kind: z.enum(["CORRECTION", "SUPPLEMENT"]),
  correction_text: z.string().trim().min(1).max(20_000),
  reason: z.string().trim().min(1).max(2_000),
  effective_knowledge_base_revision: positiveSafeIntegerSchema,
  created_by_principal_id: immutableIdSchema,
  created_at: utcMillisecondTimestampSchema,
});

export const knowledgeCorrectionAnnotationSchema = knowledgeCorrectionAnnotationDraftSchema.extend({
  annotation_hash: contentHashSchema,
});

export async function buildKnowledgeCorrectionAnnotation(input: unknown) {
  const draft = knowledgeCorrectionAnnotationDraftSchema.parse(input);
  return deepFreeze(
    knowledgeCorrectionAnnotationSchema.parse({
      ...draft,
      annotation_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyKnowledgeCorrectionAnnotation(input: unknown) {
  const annotation = knowledgeCorrectionAnnotationSchema.parse(input);
  const { annotation_hash: _hash, ...draft } = annotation;
  if (
    (await sha256ContentHash(knowledgeCorrectionAnnotationDraftSchema.parse(draft))) !==
    annotation.annotation_hash
  ) {
    throw new TypeError("KNOWLEDGE_CORRECTION_ANNOTATION_HASH_MISMATCH");
  }
  return deepFreeze(annotation);
}

export const knowledgeUsageReferenceSchema = z.strictObject({
  usage_kind: z.enum(["CANDIDATE_REVISION", "PUBLISHED_SEMANTIC_OBJECT"]),
  semantic_domain: z.string().min(1).max(128),
  subject_id: immutableIdSchema,
  subject_revision: positiveSafeIntegerSchema,
  subject_hash: contentHashSchema,
  evidence_ref: knowledgeDocumentBlockReferenceSchema,
});

export const knowledgeDocumentDetailSchema = z.strictObject({
  document: knowledgeDocumentRevisionSchema,
  blocks: z.array(knowledgeDocumentBlockSchema).max(20_000),
  annotations: z.array(knowledgeCorrectionAnnotationSchema).max(10_000),
  usage: z.array(knowledgeUsageReferenceSchema).max(20_000),
});

export const knowledgeEvidenceSelectionDetailSchema = z
  .strictObject({
    selection: knowledgeEvidenceSelectionSchema,
    blocks: z.array(knowledgeDocumentBlockSchema).min(1).max(256),
    annotations: z.array(knowledgeCorrectionAnnotationSchema).max(10_000),
  })
  .superRefine((detail, context) => {
    const selected = new Map(
      detail.selection.block_refs.map((reference) => [
        `${reference.document_ref.document_id}:${reference.document_ref.revision}:${reference.block_id}`,
        reference,
      ]),
    );
    for (const [index, block] of detail.blocks.entries()) {
      const reference = selected.get(
        `${block.document_ref.document_id}:${block.document_ref.revision}:${block.block_id}`,
      );
      if (!reference || reference.block_hash !== block.block_hash) {
        context.addIssue({
          code: "custom",
          message: "Evidence selection detail contains an unselected block.",
          path: ["blocks", index],
        });
      }
    }
    if (selected.size !== detail.blocks.length) {
      context.addIssue({
        code: "custom",
        message: "Evidence selection detail does not close over every selected block.",
        path: ["blocks"],
      });
    }
  });

export async function deriveKnowledgeDocumentUuid(material: unknown): Promise<string> {
  const hash = await sha256ContentHash(material);
  const digits = hash.slice("sha256:".length, "sha256:".length + 32).split("");
  digits[12] = "5";
  const variant = Number.parseInt(digits[16] ?? "0", 16);
  digits[16] = ((variant & 0x3) | 0x8).toString(16);
  return immutableIdSchema.parse(
    `${digits.slice(0, 8).join("")}-${digits.slice(8, 12).join("")}-${digits.slice(12, 16).join("")}-${digits.slice(16, 20).join("")}-${digits.slice(20, 32).join("")}`,
  );
}

export type KnowledgeDocumentReference = z.infer<typeof knowledgeDocumentReferenceSchema>;
export type KnowledgeDocumentRevision = z.infer<typeof knowledgeDocumentRevisionSchema>;
export type KnowledgeDocumentBlockKind = z.infer<typeof knowledgeDocumentBlockKindSchema>;
export type KnowledgeDocumentBlock = z.infer<typeof knowledgeDocumentBlockSchema>;
export type KnowledgeDocumentBlockReference = z.infer<typeof knowledgeDocumentBlockReferenceSchema>;
export type KnowledgeEvidenceSelection = z.infer<typeof knowledgeEvidenceSelectionSchema>;
export type KnowledgeDocumentCommitCommand = z.infer<typeof knowledgeDocumentCommitCommandSchema>;
export type KnowledgeCorrectionAnnotation = z.infer<typeof knowledgeCorrectionAnnotationSchema>;
export type KnowledgeUsageReference = z.infer<typeof knowledgeUsageReferenceSchema>;
export type KnowledgeDocumentDetail = z.infer<typeof knowledgeDocumentDetailSchema>;
export type KnowledgeEvidenceSelectionDetail = z.infer<
  typeof knowledgeEvidenceSelectionDetailSchema
>;
