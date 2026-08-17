import { z } from "zod";
import { contentHashSchema, sha256ContentHash, timestampSchema } from "../common/index.js";
import { workspaceIdempotencyKeySchema } from "../workspaces/identity.js";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "./envelope.js";

export const ARTIFACT_WORKSPACE_RENDERER_VERSION = "artifact-workspace-renderer@1.0.0";
export const ARTIFACT_WORKSPACE_EXPORTER_VERSION = "artifact-workspace-exporter@1.0.0";
export const SPREADSHEET_FORMULA_POLICY_VERSION = "spreadsheet-formula-neutralization@1.0.0";

const projectionScalarSchema = z.union([
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const columnKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/);

export const artifactWorkspaceTableProjectionSchema = z
  .strictObject({
    kind: z.literal("TABLE"),
    columns: z
      .array(
        z.strictObject({
          key: columnKeySchema,
          label: z.string().min(1).max(500),
          data_type: z.enum(["STRING", "NUMBER", "BOOLEAN", "NULL", "MIXED"]),
        }),
      )
      .min(1)
      .max(256),
    rows: z.array(z.record(columnKeySchema, projectionScalarSchema)).max(10_000),
    total_rows: z.number().int().nonnegative(),
  })
  .superRefine((projection, ctx) => {
    const keys = projection.columns.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", message: "Table column key 必须唯一。", path: ["columns"] });
    }
    if (projection.total_rows < projection.rows.length) {
      ctx.addIssue({
        code: "custom",
        message: "total_rows 不能小于当前投影行数。",
        path: ["total_rows"],
      });
    }
    const expected = [...keys].sort();
    for (const [rowIndex, row] of projection.rows.entries()) {
      const actual = Object.keys(row).sort();
      if (
        actual.length !== expected.length ||
        actual.some((key, index) => key !== expected[index])
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Table row 必须且只能包含声明的 columns。",
          path: ["rows", rowIndex],
        });
      }
    }
  });

const safeLinkSchema = z.strictObject({
  label: z.string().min(1).max(2_000),
  href: z
    .string()
    .url()
    .max(4_096)
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "https:" || protocol === "mailto:";
    }, "只允许 https/mailto 链接。"),
});

export const artifactWorkspaceProjectionSchema = z
  .discriminatedUnion("kind", [
    artifactWorkspaceTableProjectionSchema,
    z.strictObject({
      kind: z.literal("MARKDOWN"),
      plain_text: z.string().max(200_000),
      links: z.array(safeLinkSchema).max(200),
    }),
    z.strictObject({
      kind: z.literal("SQL"),
      dialect: z.literal("postgresql"),
      sql: z.string().min(1).max(100_000),
    }),
    z.strictObject({
      kind: z.literal("CHART"),
      mark: z.enum(["BAR", "LINE", "POINT"]),
      title: z.string().min(1).max(500),
      x_key: columnKeySchema,
      y_key: columnKeySchema,
      table: artifactWorkspaceTableProjectionSchema,
    }),
    z.strictObject({
      kind: z.literal("REPORT"),
      title: z.string().min(1).max(500),
      sections: z
        .array(
          z.strictObject({
            heading: z.string().min(1).max(500),
            body_text: z.string().max(20_000),
            source_refs: z.array(artifactReferenceSchema).max(100),
          }),
        )
        .max(100),
    }),
  ])
  .superRefine((projection, ctx) => {
    if (projection.kind !== "CHART") return;
    const keys = new Set(projection.table.columns.map(({ key }) => key));
    if (!keys.has(projection.x_key)) {
      ctx.addIssue({
        code: "custom",
        message: "Chart x_key 必须引用 table column。",
        path: ["x_key"],
      });
    }
    if (!keys.has(projection.y_key)) {
      ctx.addIssue({
        code: "custom",
        message: "Chart y_key 必须引用 table column。",
        path: ["y_key"],
      });
    }
  });

function sameScopeAndRun(left: ArtifactReference, right: ArtifactReference): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

const artifactWorkspaceDocumentObjectSchema = z
  .strictObject({
    schema_version: z.literal("artifact-workspace-document@1.0.0"),
    document_ref: artifactReferenceFor("ArtifactWorkspaceDocument"),
    projection: artifactWorkspaceProjectionSchema,
  })
  .superRefine((document, ctx) => {
    if (document.projection.kind !== "REPORT") return;
    for (const [sectionIndex, section] of document.projection.sections.entries()) {
      for (const [referenceIndex, reference] of section.source_refs.entries()) {
        if (!sameScopeAndRun(document.document_ref, reference)) {
          ctx.addIssue({
            code: "custom",
            message: "Report evidence ref 必须属于 document 的 exact scope/run。",
            path: ["projection", "sections", sectionIndex, "source_refs", referenceIndex],
          });
        }
      }
    }
  });

export const artifactWorkspaceDocumentSchema = artifactWorkspaceDocumentObjectSchema;

export async function computeArtifactWorkspaceDocumentHash(input: unknown) {
  const document = artifactWorkspaceDocumentSchema.parse(input);
  const { content_hash: _contentHash, ...documentReference } = document.document_ref;
  return sha256ContentHash({
    schema_version: document.schema_version,
    document_ref: documentReference,
    projection: document.projection,
  });
}

export async function buildArtifactWorkspaceDocument(input: unknown) {
  const document = artifactWorkspaceDocumentSchema.parse(input);
  return artifactWorkspaceDocumentSchema.parse({
    ...document,
    document_ref: {
      ...document.document_ref,
      content_hash: await computeArtifactWorkspaceDocumentHash(document),
    },
  });
}

export async function verifyArtifactWorkspaceDocument(input: unknown) {
  const document = artifactWorkspaceDocumentSchema.parse(input);
  if (
    (await computeArtifactWorkspaceDocumentHash(document)) !== document.document_ref.content_hash
  ) {
    throw new Error("ARTIFACT_WORKSPACE_DOCUMENT_HASH_MISMATCH");
  }
  return document;
}

export const artifactPreviewResultSchema = z.strictObject({
  schema_version: z.literal("artifact-preview-result@1.0.0"),
  source_ref: artifactReferenceSchema,
  renderer_version: z.literal(ARTIFACT_WORKSPACE_RENDERER_VERSION),
  projection: artifactWorkspaceProjectionSchema,
  viewport: z.strictObject({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1_000),
    total_rows: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
  }),
});

export const artifactExportFormatSchema = z.enum(["CSV", "XLSX"]);
const filenameStemSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine((value) => !value.includes(".."), "Filename stem 不能包含路径穿越片段。");

export const artifactExportCommandSchema = z.strictObject({
  schema_version: z.literal("artifact-export-command@1.0.0"),
  source_ref: artifactReferenceSchema,
  format: artifactExportFormatSchema,
  filename_stem: filenameStemSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
});

const artifactExportReceiptObjectSchema = z.strictObject({
  schema_version: z.literal("artifact-export-receipt@1.0.0"),
  receipt_ref: artifactReferenceFor("ArtifactExportReceipt"),
  source_ref: artifactReferenceSchema,
  format: artifactExportFormatSchema,
  renderer_version: z.literal(ARTIFACT_WORKSPACE_RENDERER_VERSION),
  exporter_version: z.literal(ARTIFACT_WORKSPACE_EXPORTER_VERSION),
  formula_policy_version: z.literal(SPREADSHEET_FORMULA_POLICY_VERSION),
  mime_type: z.enum([
    "text/csv; charset=utf-8",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  attachment_filename: z
    .string()
    .min(5)
    .max(130)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.(csv|xlsx)$/),
  row_count: z.number().int().nonnegative().max(10_000),
  column_count: z.number().int().positive().max(256),
  request_hash: contentHashSchema,
  output_hash: contentHashSchema,
  created_at: timestampSchema,
});

export const artifactExportReceiptSchema = artifactExportReceiptObjectSchema.superRefine(
  (receipt, ctx) => {
    if (
      receipt.receipt_ref.revision !== 1 ||
      !sameScopeAndRun(receipt.receipt_ref, receipt.source_ref)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Export Receipt 必须是与 source 同 scope/run 的首个 immutable revision。",
        path: ["receipt_ref"],
      });
    }
    const expectedMime =
      receipt.format === "CSV"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const expectedSuffix = receipt.format === "CSV" ? ".csv" : ".xlsx";
    if (
      receipt.mime_type !== expectedMime ||
      !receipt.attachment_filename.endsWith(expectedSuffix)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Export format、MIME 与 attachment filename 必须一致。",
        path: ["format"],
      });
    }
  },
);

const receiptHashMaterialSchema = artifactExportReceiptObjectSchema.extend({
  receipt_ref: artifactReferenceFor("ArtifactExportReceipt").omit({ content_hash: true }),
});

export async function computeArtifactExportRequestHash(input: unknown) {
  return sha256ContentHash(artifactExportCommandSchema.parse(input));
}

export async function computeArtifactExportReceiptHash(input: unknown) {
  const receipt = artifactExportReceiptSchema.parse(input);
  return sha256ContentHash(
    receiptHashMaterialSchema.parse({
      ...receipt,
      receipt_ref: {
        artifact_id: receipt.receipt_ref.artifact_id,
        artifact_type: receipt.receipt_ref.artifact_type,
        app_id: receipt.receipt_ref.app_id,
        tenant_id: receipt.receipt_ref.tenant_id,
        environment: receipt.receipt_ref.environment,
        run_id: receipt.receipt_ref.run_id,
        revision: receipt.receipt_ref.revision,
      },
    }),
  );
}

export async function buildArtifactExportReceipt(input: unknown): Promise<ArtifactExportReceipt> {
  const receipt = artifactExportReceiptSchema.parse(input);
  const contentHash = await computeArtifactExportReceiptHash(receipt);
  return artifactExportReceiptSchema.parse({
    ...receipt,
    receipt_ref: { ...receipt.receipt_ref, content_hash: contentHash },
  });
}

export async function verifyArtifactExportReceipt(
  input: unknown,
  commandInput?: unknown,
): Promise<ArtifactExportReceipt> {
  const receipt = artifactExportReceiptSchema.parse(input);
  const computed = await computeArtifactExportReceiptHash(receipt);
  if (computed !== receipt.receipt_ref.content_hash) {
    throw new Error("ARTIFACT_EXPORT_RECEIPT_HASH_MISMATCH");
  }
  if (commandInput !== undefined) {
    const command = artifactExportCommandSchema.parse(commandInput);
    if (
      artifactReferenceIdentity(command.source_ref) !==
        artifactReferenceIdentity(receipt.source_ref) ||
      command.format !== receipt.format ||
      (await computeArtifactExportRequestHash(command)) !== receipt.request_hash ||
      `${command.filename_stem}.${command.format.toLowerCase()}` !== receipt.attachment_filename
    ) {
      throw new Error("ARTIFACT_EXPORT_REQUEST_MISMATCH");
    }
  }
  return receipt;
}

export const createArtifactExportResultSchema = z.strictObject({
  schema_version: z.literal("artifact-export-create-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED"]),
  receipt: artifactExportReceiptSchema,
});

export const loadArtifactExportCommandSchema = z.strictObject({
  schema_version: z.literal("artifact-export-load@1.0.0"),
  receipt_ref: artifactReferenceFor("ArtifactExportReceipt"),
  source_ref: artifactReferenceSchema,
  output_hash: contentHashSchema,
});

export const loadArtifactExportResultSchema = z.strictObject({
  schema_version: z.literal("artifact-export-load-result@1.0.0"),
  receipt: artifactExportReceiptSchema.nullable(),
});

export type ArtifactWorkspaceProjection = z.infer<typeof artifactWorkspaceProjectionSchema>;
export type ArtifactWorkspaceTableProjection = z.infer<
  typeof artifactWorkspaceTableProjectionSchema
>;
export type ArtifactPreviewResult = z.infer<typeof artifactPreviewResultSchema>;
export type ArtifactExportCommand = z.infer<typeof artifactExportCommandSchema>;
export type ArtifactExportReceipt = z.infer<typeof artifactExportReceiptSchema>;
export type CreateArtifactExportResult = z.infer<typeof createArtifactExportResultSchema>;
export type LoadArtifactExportCommand = z.infer<typeof loadArtifactExportCommandSchema>;
