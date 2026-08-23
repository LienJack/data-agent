import { z } from "zod";
import { sha256ContentHash } from "../common/canonical-json.js";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/primitives.js";

export const SEMANTIC_WORKSPACE_EXPORT_FORMAT = "semantic-workspace-export@1.0.0" as const;
export const SEMANTIC_IMPORT_MAX_BYTES = 1024 * 1024;

const logicalReferenceSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const operationFields = {
  operation_id: immutableIdSchema,
  idempotency_key: immutableIdSchema,
} as const;

export const semanticDatasourceReferenceSchema = z.strictObject({
  logical_ref: logicalReferenceSchema,
  display_name: z.string().min(1).max(128),
  dialect: z.enum(["postgresql", "mysql", "clickhouse", "sqlite", "trino"]),
  schema_fingerprint: contentHashSchema,
});

export const portableSemanticDomainSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  datasource_logical_ref: logicalReferenceSchema,
  source_release: z.strictObject({
    generation: z.string().regex(/^[1-9][0-9]{0,15}$/),
    digest: contentHashSchema,
  }),
  semantic: z.record(z.string(), z.json()),
});

export const semanticWorkspaceExportHashMaterialSchema = z.strictObject({
  format: z.literal(SEMANTIC_WORKSPACE_EXPORT_FORMAT),
  compatibility: z.strictObject({
    semantic_protocol_version: versionIdentifierSchema,
    minimum_importer_version: versionIdentifierSchema,
  }),
  datasource_refs: z.array(semanticDatasourceReferenceSchema).min(1).max(64),
  domains: z.array(portableSemanticDomainSchema).min(1).max(64),
});

export const semanticWorkspaceExportSchema = semanticWorkspaceExportHashMaterialSchema.extend({
  exported_at: timestampSchema,
  content_hash: contentHashSchema,
});

export type SemanticWorkspaceExportHashMaterial = z.infer<
  typeof semanticWorkspaceExportHashMaterialSchema
>;
export type SemanticWorkspaceExport = z.infer<typeof semanticWorkspaceExportSchema>;

export function semanticWorkspaceExportHashMaterial(
  document: SemanticWorkspaceExport,
): SemanticWorkspaceExportHashMaterial {
  return semanticWorkspaceExportHashMaterialSchema.parse({
    format: document.format,
    compatibility: document.compatibility,
    datasource_refs: document.datasource_refs,
    domains: document.domains,
  });
}

export async function verifySemanticWorkspaceExport(
  input: unknown,
): Promise<SemanticWorkspaceExport> {
  const document = semanticWorkspaceExportSchema.parse(input);
  const actualHash = await sha256ContentHash(semanticWorkspaceExportHashMaterial(document));
  if (actualHash !== document.content_hash) {
    throw new Error("SEMANTIC_IMPORT_CONTENT_HASH_MISMATCH");
  }
  const refs = new Set(document.datasource_refs.map((reference) => reference.logical_ref));
  if (refs.size !== document.datasource_refs.length) {
    throw new Error("SEMANTIC_IMPORT_DUPLICATE_DATASOURCE_REF");
  }
  const domains = new Set<string>();
  for (const domain of document.domains) {
    if (!refs.has(domain.datasource_logical_ref)) {
      throw new Error("SEMANTIC_IMPORT_DATASOURCE_REF_MISSING");
    }
    if (domains.has(domain.semantic_domain)) {
      throw new Error("SEMANTIC_IMPORT_DUPLICATE_DOMAIN");
    }
    domains.add(domain.semantic_domain);
  }
  return document;
}

export const semanticImportStateSchema = z.enum([
  "UPLOADED",
  "VALIDATED",
  "AWAITING_DATASOURCE_MAPPING",
  "READY",
  "DRAFT_CREATED",
  "FAILED",
  "CANCELLED",
]);

export const semanticDatasourceMappingSchema = z.strictObject({
  logical_ref: logicalReferenceSchema,
  target_datasource_id: immutableIdSchema,
  target_semantic_domain: semanticDomainSchema,
});

export const semanticImportTargetSchema = z.strictObject({
  datasource_id: immutableIdSchema,
  display_name: z.string().min(1).max(255),
  dialect: z.enum(["postgresql", "mysql", "clickhouse", "sqlite", "trino"]),
  semantic_domains: z.array(semanticDomainSchema).min(1).max(64),
});

export const semanticImportCandidateRefSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
});

export const semanticImportPreviewSchema = z.strictObject({
  schema_version: z.literal("semantic-import-preview@1.0.0"),
  compatible: z.boolean(),
  missing_logical_refs: z.array(logicalReferenceSchema).max(64),
  conflicts: z
    .array(
      z.strictObject({
        code: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Z][A-Z0-9_]*$/),
        logical_ref: logicalReferenceSchema.nullable(),
        message: z.string().min(1).max(500),
      }),
    )
    .max(128),
  domains: z
    .array(
      z.strictObject({
        source_semantic_domain: semanticDomainSchema,
        target_semantic_domain: semanticDomainSchema.nullable(),
        target_datasource_id: immutableIdSchema.nullable(),
        change_kind: z.enum(["CREATE_DRAFT", "MAPPING_REQUIRED", "CONFLICT"]),
      }),
    )
    .max(64),
});

const semanticImportBaseSchema = z.strictObject({
  schema_version: z.literal("semantic-import-job@1.0.0"),
  import_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  file_name: z.string().min(1).max(255),
  byte_size: z.number().int().min(1).max(SEMANTIC_IMPORT_MAX_BYTES),
  upload_hash: contentHashSchema,
  document_content_hash: contentHashSchema,
  format: z.literal(SEMANTIC_WORKSPACE_EXPORT_FORMAT),
  datasource_refs: z.array(semanticDatasourceReferenceSchema).min(1).max(64),
  mappings: z.array(semanticDatasourceMappingSchema).max(64),
  preview: semanticImportPreviewSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const semanticImportJobSchema = z.discriminatedUnion("state", [
  semanticImportBaseSchema.extend({
    state: z.enum(["UPLOADED", "VALIDATED", "AWAITING_DATASOURCE_MAPPING"]),
    reason_code: z.null(),
    candidates: z.array(semanticImportCandidateRefSchema).length(0),
    receipt_id: z.null(),
  }),
  semanticImportBaseSchema.extend({
    state: z.literal("READY"),
    mappings: z.array(semanticDatasourceMappingSchema).min(1).max(64),
    preview: semanticImportPreviewSchema.extend({ compatible: z.literal(true) }),
    reason_code: z.null(),
    candidates: z.array(semanticImportCandidateRefSchema).length(0),
    receipt_id: z.null(),
  }),
  semanticImportBaseSchema.extend({
    state: z.literal("DRAFT_CREATED"),
    mappings: z.array(semanticDatasourceMappingSchema).min(1).max(64),
    preview: semanticImportPreviewSchema.extend({ compatible: z.literal(true) }),
    reason_code: z.null(),
    candidates: z.array(semanticImportCandidateRefSchema).min(1).max(64),
    receipt_id: immutableIdSchema,
  }),
  semanticImportBaseSchema.extend({
    state: z.enum(["FAILED", "CANCELLED"]),
    reason_code: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Z][A-Z0-9_]*$/),
    candidates: z.array(semanticImportCandidateRefSchema).length(0),
    receipt_id: z.null(),
  }),
]);

export const semanticImportReceiptSchema = z.strictObject({
  schema_version: z.literal("semantic-import-receipt@1.0.0"),
  receipt_id: immutableIdSchema,
  import_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  upload_hash: contentHashSchema,
  document_content_hash: contentHashSchema,
  mapping_hash: contentHashSchema,
  candidates: z.array(semanticImportCandidateRefSchema).min(1).max(64),
  created_at: timestampSchema,
});

export const semanticImportUploadInputSchema = z.strictObject({
  schema_version: z.literal("semantic-import-upload@1.0.0"),
  ...operationFields,
  file_name: z.string().trim().min(1).max(255),
  byte_size: z.number().int().min(1).max(SEMANTIC_IMPORT_MAX_BYTES),
  document: semanticWorkspaceExportSchema,
});

export const semanticImportMappingInputSchema = z.strictObject({
  schema_version: z.literal("semantic-import-mapping@1.0.0"),
  ...operationFields,
  import_id: immutableIdSchema,
  mappings: z.array(semanticDatasourceMappingSchema).min(1).max(64),
});

export const semanticImportCommandInputSchema = z.strictObject({
  schema_version: z.literal("semantic-import-command@1.0.0"),
  ...operationFields,
  import_id: immutableIdSchema,
});

export type SemanticDatasourceMapping = z.infer<typeof semanticDatasourceMappingSchema>;
export type SemanticImportTarget = z.infer<typeof semanticImportTargetSchema>;
export type SemanticImportState = z.infer<typeof semanticImportStateSchema>;
export type SemanticImportJob = z.infer<typeof semanticImportJobSchema>;
export type SemanticImportPreview = z.infer<typeof semanticImportPreviewSchema>;
export type SemanticImportReceipt = z.infer<typeof semanticImportReceiptSchema>;
export type SemanticImportUploadInput = z.infer<typeof semanticImportUploadInputSchema>;
export type SemanticImportMappingInput = z.infer<typeof semanticImportMappingInputSchema>;
export type SemanticImportCommandInput = z.infer<typeof semanticImportCommandInputSchema>;
