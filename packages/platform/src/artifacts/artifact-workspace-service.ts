import { createHash, randomUUID } from "node:crypto";
import type { PortResult } from "@data-agent/contracts";
import {
  ARTIFACT_WORKSPACE_EXPORTER_VERSION,
  ARTIFACT_WORKSPACE_RENDERER_VERSION,
  type ArtifactExportCommand,
  type ArtifactExportReceipt,
  type ArtifactPreviewResult,
  type ArtifactReference,
  type ArtifactWorkspaceProjection,
  type ArtifactWorkspaceTableProjection,
  artifactExportCommandSchema,
  artifactPreviewResultSchema,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  artifactWorkspaceProjectionSchema,
  buildArtifactExportReceipt,
  canonicalizeJson,
  computeArtifactExportRequestHash,
  computeL2ArtifactContentHash,
  computeSandboxResultHash,
  l2ArtifactDocumentSchema,
  SPREADSHEET_FORMULA_POLICY_VERSION,
  sandboxResultSchema,
  verifyArtifactWorkspaceDocument,
} from "@data-agent/contracts";

const textEncoder = new TextEncoder();

export class ArtifactWorkspaceError extends Error {
  override readonly name = "ArtifactWorkspaceError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

function requireSourceIdentity(expected: ArtifactReference, actual: ArtifactReference): void {
  if (artifactReferenceIdentity(expected) !== artifactReferenceIdentity(actual)) {
    throw new ArtifactWorkspaceError(
      "ARTIFACT_SOURCE_IDENTITY_MISMATCH",
      "Artifact document 与请求的完整 Source Reference 不一致。",
    );
  }
}

function tableDataType(type: string): "STRING" | "NUMBER" | "BOOLEAN" | "NULL" | "MIXED" {
  switch (type) {
    case "BOOLEAN":
      return "BOOLEAN";
    case "INTEGER":
    case "NUMBER":
      return "NUMBER";
    case "STRING":
      return "STRING";
    default:
      return "MIXED";
  }
}

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return canonicalizeJson(value);
}

function sliceProjection(
  projection: ArtifactWorkspaceProjection,
  offset: number,
  limit: number,
): { projection: ArtifactWorkspaceProjection; totalRows: number | null; truncated: boolean } {
  if (projection.kind !== "TABLE") {
    return { projection, totalRows: null, truncated: false };
  }
  const rows = projection.rows.slice(offset, offset + limit);
  return {
    projection: artifactWorkspaceProjectionSchema.parse({ ...projection, rows }),
    totalRows: projection.total_rows,
    truncated: offset > 0 || offset + rows.length < projection.total_rows,
  };
}

export async function projectArtifactDocument(
  documentInput: unknown,
  sourceReference: ArtifactReference,
  viewport: Readonly<{ offset: number; limit: number }>,
): Promise<ArtifactPreviewResult> {
  let projection: ArtifactWorkspaceProjection;

  const workspaceDocument = await verifyArtifactWorkspaceDocument(documentInput).catch(() => null);
  if (workspaceDocument) {
    requireSourceIdentity(sourceReference, workspaceDocument.document_ref);
    projection = workspaceDocument.projection;
  } else {
    const sandbox = sandboxResultSchema.safeParse(documentInput);
    if (sandbox.success) {
      requireSourceIdentity(sourceReference, sandbox.data.result_ref);
      if ((await computeSandboxResultHash(sandbox.data)) !== sourceReference.content_hash) {
        throw new ArtifactWorkspaceError(
          "ARTIFACT_SOURCE_HASH_MISMATCH",
          "Sandbox Result canonical hash 与 Source Reference 不一致。",
        );
      }
      projection = artifactWorkspaceProjectionSchema.parse({
        kind: "TABLE",
        columns: sandbox.data.columns.map((column) => ({
          key: column.name,
          label: column.name,
          data_type: tableDataType(column.type),
        })),
        rows: sandbox.data.rows.map((row) =>
          Object.fromEntries(
            sandbox.data.columns.map((column, index) => [column.name, scalar(row[index])]),
          ),
        ),
        total_rows: sandbox.data.row_count,
      });
    } else {
      const l2 = l2ArtifactDocumentSchema.safeParse(documentInput);
      if (!l2.success || l2.data.envelope.status !== "COMMITTED") {
        throw new ArtifactWorkspaceError(
          "ARTIFACT_PREVIEW_UNSUPPORTED",
          "Artifact document 没有已注册的安全 preview adapter。",
        );
      }
      const envelopeReference = {
        artifact_id: l2.data.envelope.artifact_id,
        artifact_type: l2.data.envelope.artifact_type,
        app_id: l2.data.envelope.app_id,
        tenant_id: l2.data.envelope.tenant_id,
        environment: l2.data.envelope.environment,
        run_id: l2.data.envelope.run_id,
        revision: l2.data.envelope.revision,
        content_hash: l2.data.envelope.content_hash,
      } as ArtifactReference;
      requireSourceIdentity(sourceReference, envelopeReference);
      if ((await computeL2ArtifactContentHash(l2.data)) !== sourceReference.content_hash) {
        throw new ArtifactWorkspaceError(
          "ARTIFACT_SOURCE_HASH_MISMATCH",
          "L2 Artifact canonical hash 与 Source Reference 不一致。",
        );
      }
      switch (l2.data.payload.artifact_type) {
        case "SqlArtifact":
          projection = {
            kind: "SQL",
            dialect: "postgresql",
            sql: l2.data.payload.sql,
          };
          break;
        case "AnalysisReport":
          projection = {
            kind: "REPORT",
            title: l2.data.payload.title,
            sections: [
              {
                heading: "Evidence-backed claims",
                body_text: l2.data.payload.limitations.join("\n"),
                source_refs: l2.data.payload.claim_refs,
              },
            ],
          };
          break;
        default:
          throw new ArtifactWorkspaceError(
            "ARTIFACT_PREVIEW_UNSUPPORTED",
            "该 L2 Artifact 类型没有 U7 安全 preview adapter。",
          );
      }
    }
  }

  const parsedViewport = {
    offset: Math.max(0, Math.trunc(viewport.offset)),
    limit: Math.min(1_000, Math.max(1, Math.trunc(viewport.limit))),
  };
  const sliced = sliceProjection(projection, parsedViewport.offset, parsedViewport.limit);
  return artifactPreviewResultSchema.parse({
    schema_version: "artifact-preview-result@1.0.0",
    source_ref: sourceReference,
    renderer_version: ARTIFACT_WORKSPACE_RENDERER_VERSION,
    projection: sliced.projection,
    viewport: {
      ...parsedViewport,
      total_rows: sliced.totalRows,
      truncated: sliced.truncated,
    },
  });
}

export function neutralizeSpreadsheetFormula(value: string): string {
  let index = 0;
  while (index < value.length && (value.charCodeAt(index) || 0) <= 0x20) index += 1;
  return "=+-@".includes(value[index] ?? "") ? `'${value}` : value;
}

function exportScalar(value: string | number | boolean | null): string | number | boolean | null {
  return typeof value === "string" ? neutralizeSpreadsheetFormula(value) : value;
}

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(exportScalar(value));
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderCsv(table: ArtifactWorkspaceTableProjection): Uint8Array {
  const lines = [
    table.columns.map(({ label }) => csvCell(label)).join(","),
    ...table.rows.map((row) => table.columns.map(({ key }) => csvCell(row[key] ?? null)).join(",")),
  ];
  return textEncoder.encode(`${lines.join("\r\n")}\r\n`);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function xlsxCell(value: string | number | boolean | null, row: number, column: number): string {
  const ref = `${columnName(column)}${row}`;
  const safe = exportScalar(value);
  if (safe === null) return `<c r="${ref}"/>`;
  if (typeof safe === "number") return `<c r="${ref}"><v>${safe}</v></c>`;
  if (typeof safe === "boolean") return `<c r="${ref}" t="b"><v>${safe ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(safe)}</t></is></c>`;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  return current >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function storedZip(
  entries: readonly { readonly name: string; readonly text: string }[],
): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = textEncoder.encode(entry.name);
    const data = textEncoder.encode(entry.text);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(data.byteLength),
      u32(data.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      data,
    ]);
    localChunks.push(local);
    centralChunks.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0x21),
        u32(crc),
        u32(data.byteLength),
        u32(data.byteLength),
        u16(name.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.byteLength;
  }
  const central = concat(centralChunks);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ]);
  return concat([...localChunks, central, end]);
}

function renderXlsx(table: ArtifactWorkspaceTableProjection): Uint8Array {
  const matrix: Array<Array<string | number | boolean | null>> = [
    table.columns.map(({ label }) => label),
    ...table.rows.map((row) => table.columns.map(({ key }) => row[key] ?? null)),
  ];
  const sheetRows = matrix
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => xlsxCell(value, rowIndex + 1, columnIndex))
          .join("")}</row>`,
    )
    .join("");
  const entries = [
    {
      name: "[Content_Types].xml",
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    },
    {
      name: "xl/styles.xml",
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>',
    },
    {
      name: "xl/workbook.xml",
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Artifact" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/worksheets/sheet1.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ] as const;
  return storedZip(entries);
}

export async function renderArtifactExport(
  tableInput: unknown,
  format: "CSV" | "XLSX",
  filenameStem: string,
) {
  const parsedFormat = artifactExportCommandSchema.shape.format.parse(format);
  const parsedFilenameStem = artifactExportCommandSchema.shape.filename_stem.parse(filenameStem);
  const parsed = artifactWorkspaceProjectionSchema.parse(tableInput);
  if (parsed.kind !== "TABLE") {
    throw new ArtifactWorkspaceError(
      "ARTIFACT_EXPORT_UNSUPPORTED",
      "U7 仅允许对 TABLE projection 导出 CSV/XLSX。",
    );
  }
  const bytes = parsedFormat === "CSV" ? renderCsv(parsed) : renderXlsx(parsed);
  const outputHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  return {
    bytes,
    output_hash: outputHash,
    mime_type:
      parsedFormat === "CSV"
        ? ("text/csv; charset=utf-8" as const)
        : ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const),
    attachment_filename: `${parsedFilenameStem}.${parsedFormat.toLowerCase()}`,
    row_count: parsed.rows.length,
    column_count: parsed.columns.length,
    renderer_version: ARTIFACT_WORKSPACE_RENDERER_VERSION,
    exporter_version: ARTIFACT_WORKSPACE_EXPORTER_VERSION,
    formula_policy_version: SPREADSHEET_FORMULA_POLICY_VERSION,
  };
}

export interface ArtifactWorkspaceDownload {
  readonly receipt: ArtifactExportReceipt;
  readonly bytes: Uint8Array;
}

interface ArtifactSourceRepository {
  resolveArtifact(
    capability: unknown,
    reference: ArtifactReference,
  ): Promise<PortResult<unknown | null>>;
}

interface ArtifactExportStore {
  create(
    capability: unknown,
    command: ArtifactExportCommand,
    receipt: ArtifactExportReceipt,
  ): Promise<
    PortResult<{
      readonly disposition: "CREATED" | "REPLAYED";
      readonly receipt: ArtifactExportReceipt;
    }>
  >;
  load(capability: unknown, command: unknown): Promise<PortResult<ArtifactExportReceipt | null>>;
}

export interface ArtifactWorkspaceServiceOptions {
  readonly repository: ArtifactSourceRepository;
  readonly exportStore: ArtifactExportStore;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new ArtifactWorkspaceError(result.error.code, result.error.message);
  return result.value;
}

async function resolveProjection(
  repository: ArtifactSourceRepository,
  capability: unknown,
  reference: ArtifactReference,
): Promise<ArtifactPreviewResult> {
  const document = portValue(await repository.resolveArtifact(capability, reference));
  if (!document) {
    throw new ArtifactWorkspaceError(
      "ARTIFACT_SOURCE_NOT_COMMITTED",
      "Artifact source revision 不存在或无权读取。",
    );
  }
  return projectArtifactDocument(document, reference, { offset: 0, limit: 10_000 });
}

export function createArtifactWorkspaceService(options: ArtifactWorkspaceServiceOptions) {
  return {
    async preview(
      capability: unknown,
      referenceInput: unknown,
      viewport: Readonly<{ offset: number; limit: number }>,
    ) {
      const reference = artifactReferenceSchema.parse(referenceInput);
      const document = portValue(await options.repository.resolveArtifact(capability, reference));
      if (!document) {
        throw new ArtifactWorkspaceError(
          "ARTIFACT_SOURCE_NOT_COMMITTED",
          "Artifact source revision 不存在或无权读取。",
        );
      }
      return projectArtifactDocument(document, reference, viewport);
    },

    async createExport(capability: unknown, commandInput: unknown) {
      const command = artifactExportCommandSchema.parse(commandInput);
      const preview = await resolveProjection(options.repository, capability, command.source_ref);
      if (preview.projection.kind !== "TABLE" || preview.viewport.truncated) {
        throw new ArtifactWorkspaceError(
          "ARTIFACT_EXPORT_UNSUPPORTED",
          "只有未截断的 TABLE Artifact 可以导出。",
        );
      }
      const rendered = await renderArtifactExport(
        preview.projection,
        command.format,
        command.filename_stem,
      );
      const receipt = await buildArtifactExportReceipt({
        schema_version: "artifact-export-receipt@1.0.0",
        receipt_ref: {
          ...command.source_ref,
          artifact_id: options.createId?.() ?? randomUUID(),
          artifact_type: "ArtifactExportReceipt",
          revision: 1,
          content_hash: `sha256:${"0".repeat(64)}`,
        },
        source_ref: command.source_ref,
        format: command.format,
        renderer_version: rendered.renderer_version,
        exporter_version: rendered.exporter_version,
        formula_policy_version: rendered.formula_policy_version,
        mime_type: rendered.mime_type,
        attachment_filename: rendered.attachment_filename,
        row_count: rendered.row_count,
        column_count: rendered.column_count,
        request_hash: await computeArtifactExportRequestHash(command),
        output_hash: rendered.output_hash,
        created_at: (options.now?.() ?? new Date()).toISOString(),
      });
      return portValue(await options.exportStore.create(capability, command, receipt));
    },

    async download(
      capability: unknown,
      loadCommandInput: unknown,
    ): Promise<ArtifactWorkspaceDownload> {
      const receipt = portValue(await options.exportStore.load(capability, loadCommandInput));
      if (!receipt) {
        throw new ArtifactWorkspaceError(
          "ARTIFACT_EXPORT_NOT_FOUND",
          "Artifact Export Receipt 不存在或无权读取。",
        );
      }
      const preview = await resolveProjection(options.repository, capability, receipt.source_ref);
      if (preview.projection.kind !== "TABLE" || preview.viewport.truncated) {
        throw new ArtifactWorkspaceError(
          "ARTIFACT_EXPORT_SOURCE_DRIFT",
          "Export source 无法按原 receipt 完整重建。",
        );
      }
      const suffix = receipt.format === "CSV" ? ".csv" : ".xlsx";
      const filenameStem = receipt.attachment_filename.slice(0, -suffix.length);
      const rendered = await renderArtifactExport(preview.projection, receipt.format, filenameStem);
      if (
        rendered.output_hash !== receipt.output_hash ||
        rendered.mime_type !== receipt.mime_type ||
        rendered.attachment_filename !== receipt.attachment_filename ||
        rendered.row_count !== receipt.row_count ||
        rendered.column_count !== receipt.column_count
      ) {
        throw new ArtifactWorkspaceError(
          "ARTIFACT_EXPORT_OUTPUT_HASH_MISMATCH",
          "重新派生的 Export bytes 与 immutable receipt 不一致。",
        );
      }
      return { receipt, bytes: rendered.bytes };
    },
  };
}
