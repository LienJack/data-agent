import { z } from "zod";
import {
  canonicalizeJson,
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import { workspaceIdempotencyKeySchema } from "../workspaces/identity.js";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "./envelope.js";

export const ARTIFACT_WORKSPACE_RENDERER_VERSION = "artifact-workspace-renderer@1.0.0";
export const ARTIFACT_WORKSPACE_RENDERER_VERSION_V2 = "artifact-workspace-renderer@2.0.0";
export const QUERY_EVIDENCE_CHART_TRANSFORM_VERSION = "query-evidence-chart@1.0.0";
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

const artifactWorkspaceResolvedContextIdentitySchema = z.strictObject({
  package_id: immutableIdSchema,
  package_hash: contentHashSchema,
  receipt_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
});

export const artifactWorkspaceChartProjectionV2Schema = z
  .strictObject({
    kind: z.literal("CHART"),
    chart_type: z.enum(["LINE", "BAR", "PIE"]),
    title: z.string().min(1).max(160),
    description: z.string().max(1_000).nullable(),
    unit: z.string().min(1).max(64).nullable(),
    x_key: columnKeySchema,
    y_keys: z.array(columnKeySchema).min(1).max(4),
    legend: z.strictObject({ visible: z.boolean() }),
    table: artifactWorkspaceTableProjectionSchema,
  })
  .superRefine((projection, ctx) => {
    const keys = new Set(projection.table.columns.map(({ key }) => key));
    if (!keys.has(projection.x_key)) {
      ctx.addIssue({
        code: "custom",
        message: "Chart x_key 必须引用 table column。",
        path: ["x_key"],
      });
    }
    if (new Set(projection.y_keys).size !== projection.y_keys.length) {
      ctx.addIssue({ code: "custom", message: "Chart y_keys 必须唯一。", path: ["y_keys"] });
    }
    for (const [index, key] of projection.y_keys.entries()) {
      const column = projection.table.columns.find((candidate) => candidate.key === key);
      if (column?.data_type !== "NUMBER") {
        ctx.addIssue({
          code: "custom",
          message: "Chart y_key 必须引用 NUMBER column。",
          path: ["y_keys", index],
        });
      }
    }
    const rows = projection.table.rows;
    const maxRows =
      projection.chart_type === "LINE" ? 100 : projection.chart_type === "BAR" ? 30 : 12;
    if (rows.length < 2 || rows.length > maxRows) {
      ctx.addIssue({
        code: "custom",
        message: "CHART_DATA_LIMIT_EXCEEDED",
        path: ["table", "rows"],
      });
    }
    if (projection.table.total_rows !== rows.length) {
      ctx.addIssue({
        code: "custom",
        message: "Chart document 必须携带完整的受限 dataset。",
        path: ["table", "total_rows"],
      });
    }
    if (projection.chart_type === "PIE" && projection.y_keys.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "PIE 只允许一个 numeric series。",
        path: ["y_keys"],
      });
    }
    let pieTotal = 0;
    for (const [rowIndex, row] of rows.entries()) {
      const label = row[projection.x_key];
      if (label === null || String(label).length > 200) {
        ctx.addIssue({
          code: "custom",
          message: "Chart label 必须非空且不超过 200 字。",
          path: ["table", "rows", rowIndex, projection.x_key],
        });
      }
      for (const key of projection.y_keys) {
        const value = row[key];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          ctx.addIssue({
            code: "custom",
            message: "Chart series value 必须是 finite number。",
            path: ["table", "rows", rowIndex, key],
          });
          continue;
        }
        if (projection.chart_type === "PIE") {
          if (value < 0) {
            ctx.addIssue({
              code: "custom",
              message: "PIE value 不能为负数。",
              path: ["table", "rows", rowIndex, key],
            });
          }
          pieTotal += value;
        }
      }
    }
    if (projection.chart_type === "PIE" && pieTotal <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "PIE value 合计必须大于 0。",
        path: ["table", "rows"],
      });
    }
    if (new TextEncoder().encode(canonicalizeJson(projection)).byteLength > 256 * 1024) {
      ctx.addIssue({ code: "custom", message: "CHART_DATA_LIMIT_EXCEEDED" });
    }
  });

const artifactWorkspaceChartProvenanceV2Schema = z.strictObject({
  transform_version: z.literal(QUERY_EVIDENCE_CHART_TRANSFORM_VERSION),
  dataset_hash: contentHashSchema,
  resolved_context: artifactWorkspaceResolvedContextIdentitySchema,
});

const artifactWorkspaceChartDocumentV2ObjectSchema = z
  .strictObject({
    schema_version: z.literal("artifact-workspace-chart-document@2.0.0"),
    document_ref: artifactReferenceFor("ArtifactWorkspaceDocument"),
    source_refs: z.tuple([artifactReferenceFor("QueryEvidence")]),
    provenance: artifactWorkspaceChartProvenanceV2Schema,
    projection: artifactWorkspaceChartProjectionV2Schema,
  })
  .superRefine((document, ctx) => {
    if (!sameScopeAndRun(document.document_ref, document.source_refs[0])) {
      ctx.addIssue({
        code: "custom",
        message: "Chart QueryEvidence source 必须属于 document 的 exact scope/run。",
        path: ["source_refs", 0],
      });
    }
  });

export const artifactWorkspaceChartDocumentV2Schema = artifactWorkspaceChartDocumentV2ObjectSchema;

export async function computeArtifactWorkspaceChartDatasetHash(input: unknown) {
  const projection = artifactWorkspaceChartProjectionV2Schema.parse(input);
  return sha256ContentHash({
    chart_type: projection.chart_type,
    x_key: projection.x_key,
    y_keys: projection.y_keys,
    unit: projection.unit,
    columns: projection.table.columns,
    rows: projection.table.rows,
  });
}

export async function computeArtifactWorkspaceChartDocumentV2Hash(input: unknown) {
  const document = artifactWorkspaceChartDocumentV2Schema.parse(input);
  const { content_hash: _contentHash, ...documentReference } = document.document_ref;
  return sha256ContentHash({
    schema_version: document.schema_version,
    document_ref: documentReference,
    source_refs: document.source_refs,
    provenance: document.provenance,
    projection: document.projection,
  });
}

export async function buildArtifactWorkspaceChartDocumentV2(input: unknown) {
  const document = artifactWorkspaceChartDocumentV2Schema.parse(input);
  const datasetHash = await computeArtifactWorkspaceChartDatasetHash(document.projection);
  const withDatasetHash = artifactWorkspaceChartDocumentV2Schema.parse({
    ...document,
    provenance: { ...document.provenance, dataset_hash: datasetHash },
  });
  return artifactWorkspaceChartDocumentV2Schema.parse({
    ...withDatasetHash,
    document_ref: {
      ...withDatasetHash.document_ref,
      content_hash: await computeArtifactWorkspaceChartDocumentV2Hash(withDatasetHash),
    },
  });
}

export async function verifyArtifactWorkspaceChartDocumentV2(input: unknown) {
  let document: z.infer<typeof artifactWorkspaceChartDocumentV2Schema>;
  try {
    document = artifactWorkspaceChartDocumentV2Schema.parse(input);
  } catch (error) {
    if (
      error instanceof z.ZodError &&
      error.issues.some(({ message }) => message === "CHART_DATA_LIMIT_EXCEEDED")
    ) {
      throw new TypeError("CHART_DATA_LIMIT_EXCEEDED");
    }
    throw error;
  }
  if (
    (await computeArtifactWorkspaceChartDatasetHash(document.projection)) !==
    document.provenance.dataset_hash
  ) {
    throw new TypeError("ARTIFACT_WORKSPACE_CHART_DATASET_HASH_MISMATCH");
  }
  if (
    (await computeArtifactWorkspaceChartDocumentV2Hash(document)) !==
    document.document_ref.content_hash
  ) {
    throw new TypeError("ARTIFACT_WORKSPACE_CHART_DOCUMENT_HASH_MISMATCH");
  }
  return document;
}

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

export const artifactPreviewResultV1Schema = z.strictObject({
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

export const artifactPreviewResultV2Schema = z.strictObject({
  schema_version: z.literal("artifact-preview-result@2.0.0"),
  source_ref: artifactReferenceFor("ArtifactWorkspaceDocument"),
  renderer_version: z.literal(ARTIFACT_WORKSPACE_RENDERER_VERSION_V2),
  source_refs: z.tuple([artifactReferenceFor("QueryEvidence")]),
  provenance: artifactWorkspaceChartProvenanceV2Schema,
  projection: artifactWorkspaceChartProjectionV2Schema,
  viewport: z.strictObject({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1_000),
    total_rows: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
  }),
});

export const artifactPreviewResultSchema = z.discriminatedUnion("schema_version", [
  artifactPreviewResultV1Schema,
  artifactPreviewResultV2Schema,
]);

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
export type ArtifactWorkspaceChartProjectionV2 = z.infer<
  typeof artifactWorkspaceChartProjectionV2Schema
>;
export type ArtifactWorkspaceChartDocumentV2 = z.infer<
  typeof artifactWorkspaceChartDocumentV2Schema
>;
export type ArtifactWorkspaceTableProjection = z.infer<
  typeof artifactWorkspaceTableProjectionSchema
>;
export type ArtifactPreviewResult = z.infer<typeof artifactPreviewResultSchema>;
export type ArtifactPreviewResultV1 = z.infer<typeof artifactPreviewResultV1Schema>;
export type ArtifactPreviewResultV2 = z.infer<typeof artifactPreviewResultV2Schema>;
export type ArtifactExportCommand = z.infer<typeof artifactExportCommandSchema>;
export type ArtifactExportReceipt = z.infer<typeof artifactExportReceiptSchema>;
export type CreateArtifactExportResult = z.infer<typeof createArtifactExportResultSchema>;
export type LoadArtifactExportCommand = z.infer<typeof loadArtifactExportCommandSchema>;
