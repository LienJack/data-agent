import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/primitives.js";

export const semanticDatasourceReferenceSchema = z.strictObject({
  logical_ref: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  display_name: z.string().min(1).max(128),
  dialect: z.string().min(1).max(64),
  schema_fingerprint: contentHashSchema,
});

export const semanticWorkspaceExportSchema = z.strictObject({
  format: z.literal("semantic-workspace-export@1.0.0"),
  exported_at: timestampSchema,
  source_release_version: versionIdentifierSchema,
  content_hash: contentHashSchema,
  datasource_refs: z.array(semanticDatasourceReferenceSchema).min(1).max(64),
  compatibility: z.strictObject({
    semantic_protocol_version: versionIdentifierSchema,
    minimum_importer_version: versionIdentifierSchema,
  }),
  published_semantic: z.record(z.string(), z.json()),
});

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
  logical_ref: semanticDatasourceReferenceSchema.shape.logical_ref,
  target_datasource_id: immutableIdSchema,
});

const semanticImportBaseSchema = z.strictObject({
  schema_version: z.literal("semantic-import-job@1.0.0"),
  import_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  upload_hash: contentHashSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const semanticImportJobSchema = z.discriminatedUnion("state", [
  semanticImportBaseSchema.extend({
    state: z.enum(["UPLOADED", "VALIDATED", "AWAITING_DATASOURCE_MAPPING"]),
    mappings: z.array(semanticDatasourceMappingSchema).max(64),
  }),
  semanticImportBaseSchema.extend({
    state: z.literal("READY"),
    mappings: z.array(semanticDatasourceMappingSchema).min(1).max(64),
  }),
  semanticImportBaseSchema.extend({
    state: z.literal("DRAFT_CREATED"),
    mappings: z.array(semanticDatasourceMappingSchema).min(1).max(64),
    draft_id: immutableIdSchema,
    receipt_id: immutableIdSchema,
  }),
  semanticImportBaseSchema.extend({
    state: z.enum(["FAILED", "CANCELLED"]),
    mappings: z.array(semanticDatasourceMappingSchema).max(64),
    reason_code: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Z][A-Z0-9_]*$/),
  }),
]);

export type SemanticWorkspaceExport = z.infer<typeof semanticWorkspaceExportSchema>;
export type SemanticImportState = z.infer<typeof semanticImportStateSchema>;
export type SemanticImportJob = z.infer<typeof semanticImportJobSchema>;
