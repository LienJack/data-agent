import { z } from "zod";
import { contentHashSchema, timestampSchema, versionIdentifierSchema } from "../common/index.js";
import {
  type ArtifactReference,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "./envelope.js";

export const TABULAR_IMPORT_LIMITS = Object.freeze({
  max_sheets: 64,
  max_columns_per_sheet: 256,
  max_warnings: 64,
  max_output_artifacts: 64,
} as const);

export const tabularImportTruncationCodeSchema = z.enum([
  "TABULAR_IMPORT_ROWS_TRUNCATED",
  "TABULAR_IMPORT_CELL_CONTENT_TRUNCATED",
  "TABULAR_IMPORT_SHEETS_SKIPPED",
]);

export const tabularImportFailureCodeSchema = z.enum([
  "TABULAR_IMPORT_FORMAT_UNSUPPORTED",
  "TABULAR_IMPORT_ARCHIVE_LIMIT_EXCEEDED",
  "TABULAR_IMPORT_MACRO_REJECTED",
  "TABULAR_IMPORT_EXTERNAL_LINK_REJECTED",
  "TABULAR_IMPORT_FORMULA_POLICY_REJECTED",
  "TABULAR_IMPORT_SHEET_LIMIT_EXCEEDED",
  "TABULAR_IMPORT_ROW_LIMIT_EXCEEDED",
  "TABULAR_IMPORT_COLUMN_LIMIT_EXCEEDED",
  "TABULAR_IMPORT_CELL_LIMIT_EXCEEDED",
  "TABULAR_IMPORT_ENCODING_AMBIGUOUS",
  "TABULAR_IMPORT_DATE_POLICY_AMBIGUOUS",
  "TABULAR_IMPORT_TIMEOUT",
]);

const importedSheetSchema = z.strictObject({
  sheet_id: z.string().min(1).max(128),
  source_name: z.string().min(1).max(256),
  normalized_name: z.string().min(1).max(128),
  row_count: z.number().int().nonnegative().safe(),
  column_count: z.number().int().nonnegative().max(TABULAR_IMPORT_LIMITS.max_columns_per_sheet),
  formula_cell_count: z.number().int().nonnegative().safe(),
  output_ref: artifactReferenceSchema,
  output_format: z.enum(["ARROW", "CSV"]),
  output_hash: contentHashSchema,
});

function uniqueReferences(references: readonly ArtifactReference[]): boolean {
  return new Set(references.map(artifactReferenceIdentity)).size === references.length;
}

export const tabularImportReceiptPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("TabularImportReceipt"),
    protocol_version: z.literal("tabular-import@1.0.0"),
    raw_artifact_ref: artifactReferenceSchema,
    raw_content_hash: contentHashSchema,
    declared_mime_type: z.string().min(1).max(256),
    sniffed_format: z.enum(["CSV", "XLSX"]),
    parser_version: versionIdentifierSchema,
    parser_image_digest: contentHashSchema,
    parser_policy_version: versionIdentifierSchema,
    parser_limits: z.strictObject({
      max_file_bytes: z.number().int().positive().safe(),
      max_zip_expansion_ratio: z.number().positive().finite().max(1_000),
      max_sheets: z.number().int().positive().max(TABULAR_IMPORT_LIMITS.max_sheets),
      max_rows_per_sheet: z.number().int().positive().safe(),
      max_columns_per_sheet: z
        .number()
        .int()
        .positive()
        .max(TABULAR_IMPORT_LIMITS.max_columns_per_sheet),
      max_cell_bytes: z.number().int().positive().safe(),
      max_parse_ms: z.number().int().positive().max(600_000),
    }),
    selected_sheet_names: z.array(z.string().min(1).max(256)).max(TABULAR_IMPORT_LIMITS.max_sheets),
    encoding: z.string().min(1).max(64).nullable(),
    delimiter: z.string().min(1).max(8).nullable(),
    locale: z.string().min(1).max(64),
    date_policy: versionIdentifierSchema,
    formula_policy: z.enum(["STATIC_CACHED_VALUE", "TEXT_ONLY", "REJECT"]),
    macro_detected: z.boolean(),
    external_link_detected: z.boolean(),
    sheets: z.array(importedSheetSchema).max(TABULAR_IMPORT_LIMITS.max_sheets),
    warnings: z.array(z.string().min(1).max(512)).max(TABULAR_IMPORT_LIMITS.max_warnings),
    truncation_codes: z.array(tabularImportTruncationCodeSchema).max(3),
    status: z.enum(["ACCEPTED", "PARTIAL", "REJECTED"]),
    failure_code: tabularImportFailureCodeSchema.nullable(),
    started_at: timestampSchema,
    completed_at: timestampSchema,
    import_hash: contentHashSchema,
  })
  .superRefine((receipt, ctx) => {
    if (receipt.raw_artifact_ref.content_hash !== receipt.raw_content_hash) {
      ctx.addIssue({
        code: "custom",
        message: "raw_content_hash 必须绑定 raw_artifact_ref。",
        path: ["raw_content_hash"],
      });
    }
    if (Date.parse(receipt.started_at) > Date.parse(receipt.completed_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Tabular Import 完成时间不能早于开始时间。",
        path: ["completed_at"],
      });
    }
    const sheetIds = receipt.sheets.map(({ sheet_id }) => sheet_id);
    const normalizedNames = receipt.sheets.map(({ normalized_name }) => normalized_name);
    if (new Set(receipt.selected_sheet_names).size !== receipt.selected_sheet_names.length) {
      ctx.addIssue({
        code: "custom",
        message: "selected_sheet_names 必须唯一。",
        path: ["selected_sheet_names"],
      });
    }
    if (new Set(sheetIds).size !== sheetIds.length) {
      ctx.addIssue({ code: "custom", message: "sheet_id 必须唯一。", path: ["sheets"] });
    }
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      ctx.addIssue({
        code: "custom",
        message: "normalized_name 必须唯一。",
        path: ["sheets"],
      });
    }
    if (!uniqueReferences(receipt.sheets.map(({ output_ref }) => output_ref))) {
      ctx.addIssue({ code: "custom", message: "Sheet output_ref 必须唯一。", path: ["sheets"] });
    }
    for (const [index, sheet] of receipt.sheets.entries()) {
      if (!receipt.selected_sheet_names.includes(sheet.source_name)) {
        ctx.addIssue({
          code: "custom",
          message: "Sheet 输出必须来自显式 selected_sheet_names allowlist。",
          path: ["sheets", index, "source_name"],
        });
      }
      if (sheet.output_ref.content_hash !== sheet.output_hash) {
        ctx.addIssue({
          code: "custom",
          message: "Sheet output_hash 必须绑定 output_ref。",
          path: ["sheets", index, "output_hash"],
        });
      }
    }
    if (receipt.status === "REJECTED") {
      if (
        receipt.failure_code === null ||
        receipt.sheets.length !== 0 ||
        receipt.truncation_codes.length !== 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: "REJECTED Import 必须携带 failure_code 且不能提交 Sheet 输出。",
          path: ["status"],
        });
      }
    } else if (
      receipt.failure_code !== null ||
      receipt.sheets.length === 0 ||
      (receipt.status === "ACCEPTED" && receipt.truncation_codes.length !== 0) ||
      (receipt.status === "PARTIAL" && receipt.truncation_codes.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ACCEPTED/PARTIAL Import 必须有输出且不能携带 failure_code。",
        path: ["status"],
      });
    }
    if (receipt.sniffed_format === "CSV" && receipt.sheets.length > 1) {
      ctx.addIssue({
        code: "custom",
        message: "CSV Import 最多产生一个 Sheet。",
        path: ["sheets"],
      });
    }
  });

export type TabularImportFailureCode = z.infer<typeof tabularImportFailureCodeSchema>;
export type TabularImportTruncationCode = z.infer<typeof tabularImportTruncationCodeSchema>;
export type TabularImportReceiptPayload = z.infer<typeof tabularImportReceiptPayloadSchema>;
