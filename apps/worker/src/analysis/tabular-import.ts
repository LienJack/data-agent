import { createHash } from "node:crypto";
import {
  type ArtifactReference,
  artifactReferenceIdentity,
  sha256ContentHash,
  type TabularImportFailureCode,
  type TabularImportReceiptPayload,
  tabularImportReceiptPayloadSchema,
} from "@data-agent/contracts";

function rawContentHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export const DEFAULT_TABULAR_IMPORT_POLICY = Object.freeze({
  parser_version: "tabular-parser@1.0.0",
  parser_image_digest: "sha256:1db1158fca5ce84318cf81d992b80ad1c50b654485f9cf5c97ac2d53b08143f9",
  parser_policy_version: "tabular-policy@1.0.0",
  max_file_bytes: 16 * 1024 * 1024,
  max_zip_expansion_ratio: 100,
  max_sheets: 8,
  max_rows_per_sheet: 100_000,
  max_columns_per_sheet: 256,
  max_cell_bytes: 65_536,
  max_parse_ms: 60_000,
  locale: "zh-CN",
  date_policy: "iso-date@1.0.0",
  formula_policy: "REJECT" as const,
});

export type TabularImportPolicy = typeof DEFAULT_TABULAR_IMPORT_POLICY;

export interface TabularSheetInspection {
  readonly sheet_id: string;
  readonly source_name: string;
  readonly normalized_name: string;
  readonly row_count: number;
  readonly column_count: number;
  readonly maximum_cell_bytes: number;
  readonly formula_cell_count: number;
  readonly output_ref: ArtifactReference;
  readonly output_format: "ARROW" | "CSV";
  readonly output_hash: `sha256:${string}`;
}

export interface TabularParserInspection {
  readonly sniffed_format: "CSV" | "XLSX";
  readonly parse_ms: number;
  readonly zip_uncompressed_bytes: number | null;
  readonly macro_detected: boolean;
  readonly external_link_detected: boolean;
  readonly encoding: string | null;
  readonly delimiter: string | null;
  readonly selected_sheet_names: readonly string[];
  readonly sheets: readonly TabularSheetInspection[];
  readonly warnings: readonly string[];
}

export interface ControlledTabularParserPort {
  inspectAndMaterialize(input: {
    readonly raw_bytes: Uint8Array;
    readonly declared_mime_type: string;
    readonly selected_sheet_names: readonly string[];
    readonly limits: TabularImportPolicy;
    readonly signal: AbortSignal;
  }): Promise<TabularParserInspection>;
}

function sniffRawFormat(bytes: Uint8Array): "CSV" | "XLSX" | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return "XLSX";
  }
  if (bytes.length === 0 || bytes.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "CSV";
  } catch {
    return null;
  }
}

function rejectedReceipt(input: {
  raw_artifact_ref: ArtifactReference;
  declared_mime_type: string;
  format: "CSV" | "XLSX";
  failure: TabularImportFailureCode;
  policy: TabularImportPolicy;
  started_at: string;
  completed_at: string;
}): Omit<TabularImportReceiptPayload, "import_hash"> {
  return {
    artifact_type: "TabularImportReceipt",
    protocol_version: "tabular-import@1.0.0",
    raw_artifact_ref: input.raw_artifact_ref,
    raw_content_hash: input.raw_artifact_ref.content_hash,
    declared_mime_type: input.declared_mime_type,
    sniffed_format: input.format,
    parser_version: input.policy.parser_version,
    parser_image_digest: input.policy.parser_image_digest,
    parser_policy_version: input.policy.parser_policy_version,
    parser_limits: {
      max_file_bytes: input.policy.max_file_bytes,
      max_zip_expansion_ratio: input.policy.max_zip_expansion_ratio,
      max_sheets: input.policy.max_sheets,
      max_rows_per_sheet: input.policy.max_rows_per_sheet,
      max_columns_per_sheet: input.policy.max_columns_per_sheet,
      max_cell_bytes: input.policy.max_cell_bytes,
      max_parse_ms: input.policy.max_parse_ms,
    },
    selected_sheet_names: [],
    encoding: null,
    delimiter: null,
    locale: input.policy.locale,
    date_policy: input.policy.date_policy,
    formula_policy: input.policy.formula_policy,
    macro_detected: input.failure === "TABULAR_IMPORT_MACRO_REJECTED",
    external_link_detected: input.failure === "TABULAR_IMPORT_EXTERNAL_LINK_REJECTED",
    sheets: [],
    warnings: [],
    truncation_codes: [],
    status: "REJECTED",
    failure_code: input.failure,
    started_at: input.started_at,
    completed_at: input.completed_at,
  };
}

async function sealReceipt(
  material: Omit<TabularImportReceiptPayload, "import_hash">,
): Promise<TabularImportReceiptPayload> {
  return tabularImportReceiptPayloadSchema.parse({
    ...material,
    import_hash: await sha256ContentHash({ hash_domain: "tabular-import@1.0.0", value: material }),
  });
}

function inspectionFailure(
  inspection: TabularParserInspection,
  rawBytes: number,
  policy: TabularImportPolicy,
): TabularImportFailureCode | null {
  if (inspection.parse_ms > policy.max_parse_ms) return "TABULAR_IMPORT_TIMEOUT";
  if (
    inspection.zip_uncompressed_bytes !== null &&
    inspection.zip_uncompressed_bytes / Math.max(1, rawBytes) > policy.max_zip_expansion_ratio
  ) {
    return "TABULAR_IMPORT_ARCHIVE_LIMIT_EXCEEDED";
  }
  if (inspection.macro_detected) return "TABULAR_IMPORT_MACRO_REJECTED";
  if (inspection.external_link_detected) return "TABULAR_IMPORT_EXTERNAL_LINK_REJECTED";
  if (
    policy.formula_policy === "REJECT" &&
    inspection.sheets.some(({ formula_cell_count: count }) => count > 0)
  ) {
    return "TABULAR_IMPORT_FORMULA_POLICY_REJECTED";
  }
  if (inspection.sheets.length > policy.max_sheets) return "TABULAR_IMPORT_SHEET_LIMIT_EXCEEDED";
  if (inspection.sheets.some(({ row_count: count }) => count > policy.max_rows_per_sheet)) {
    return "TABULAR_IMPORT_ROW_LIMIT_EXCEEDED";
  }
  if (inspection.sheets.some(({ column_count: count }) => count > policy.max_columns_per_sheet)) {
    return "TABULAR_IMPORT_COLUMN_LIMIT_EXCEEDED";
  }
  if (inspection.sheets.some(({ maximum_cell_bytes: count }) => count > policy.max_cell_bytes)) {
    return "TABULAR_IMPORT_CELL_LIMIT_EXCEEDED";
  }
  if (inspection.sniffed_format === "CSV" && inspection.encoding?.toLowerCase() !== "utf-8") {
    return "TABULAR_IMPORT_ENCODING_AMBIGUOUS";
  }
  return null;
}

export async function executeControlledTabularImport(input: {
  readonly raw_artifact_ref: ArtifactReference;
  readonly raw_bytes: Uint8Array;
  readonly declared_mime_type: string;
  readonly selected_sheet_names: readonly string[];
  readonly parser: ControlledTabularParserPort;
  readonly policy?: TabularImportPolicy;
  readonly now?: () => Date;
}): Promise<TabularImportReceiptPayload> {
  const policy = input.policy ?? DEFAULT_TABULAR_IMPORT_POLICY;
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const rawHash = rawContentHash(input.raw_bytes);
  if (input.raw_artifact_ref.content_hash !== rawHash) {
    throw new TypeError("TABULAR_IMPORT_RAW_HASH_MISMATCH");
  }
  const rawFormat = sniffRawFormat(input.raw_bytes);
  const fallbackFormat = input.declared_mime_type.includes("sheet") ? "XLSX" : "CSV";
  if (!rawFormat || input.raw_bytes.byteLength > policy.max_file_bytes) {
    return sealReceipt(
      rejectedReceipt({
        raw_artifact_ref: input.raw_artifact_ref,
        declared_mime_type: input.declared_mime_type,
        format: rawFormat ?? fallbackFormat,
        failure:
          input.raw_bytes.byteLength > policy.max_file_bytes
            ? "TABULAR_IMPORT_ARCHIVE_LIMIT_EXCEEDED"
            : "TABULAR_IMPORT_FORMAT_UNSUPPORTED",
        policy,
        started_at: startedAt,
        completed_at: now().toISOString(),
      }),
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), policy.max_parse_ms);
  timeout.unref();
  let inspection: TabularParserInspection;
  try {
    inspection = await input.parser.inspectAndMaterialize({
      raw_bytes: input.raw_bytes,
      declared_mime_type: input.declared_mime_type,
      selected_sheet_names: Object.freeze([...new Set(input.selected_sheet_names)]),
      limits: policy,
      signal: controller.signal,
    });
  } catch {
    return sealReceipt(
      rejectedReceipt({
        raw_artifact_ref: input.raw_artifact_ref,
        declared_mime_type: input.declared_mime_type,
        format: rawFormat,
        failure: controller.signal.aborted
          ? "TABULAR_IMPORT_TIMEOUT"
          : "TABULAR_IMPORT_FORMAT_UNSUPPORTED",
        policy,
        started_at: startedAt,
        completed_at: now().toISOString(),
      }),
    );
  } finally {
    clearTimeout(timeout);
  }
  const selected = new Set(input.selected_sheet_names);
  const selectionInvalid =
    inspection.sniffed_format !== rawFormat ||
    inspection.sheets.some(({ source_name: sourceName }) => !selected.has(sourceName)) ||
    new Set(inspection.selected_sheet_names).size !== inspection.selected_sheet_names.length ||
    inspection.selected_sheet_names.some((name) => !selected.has(name));
  const scopeInvalid = inspection.sheets.some(
    ({ output_ref: reference, output_hash: outputHash }) =>
      reference.content_hash !== outputHash ||
      reference.app_id !== input.raw_artifact_ref.app_id ||
      reference.tenant_id !== input.raw_artifact_ref.tenant_id ||
      reference.environment !== input.raw_artifact_ref.environment ||
      reference.run_id !== input.raw_artifact_ref.run_id,
  );
  const duplicateOutputs =
    new Set(
      inspection.sheets.map(({ output_ref: reference }) => artifactReferenceIdentity(reference)),
    ).size !== inspection.sheets.length;
  const failure =
    inspectionFailure(inspection, input.raw_bytes.byteLength, policy) ??
    (selectionInvalid || scopeInvalid || duplicateOutputs
      ? "TABULAR_IMPORT_FORMAT_UNSUPPORTED"
      : null);
  if (failure) {
    return sealReceipt(
      rejectedReceipt({
        raw_artifact_ref: input.raw_artifact_ref,
        declared_mime_type: input.declared_mime_type,
        format: rawFormat,
        failure,
        policy,
        started_at: startedAt,
        completed_at: now().toISOString(),
      }),
    );
  }
  const material: Omit<TabularImportReceiptPayload, "import_hash"> = {
    artifact_type: "TabularImportReceipt",
    protocol_version: "tabular-import@1.0.0",
    raw_artifact_ref: input.raw_artifact_ref,
    raw_content_hash: rawHash,
    declared_mime_type: input.declared_mime_type,
    sniffed_format: inspection.sniffed_format,
    parser_version: policy.parser_version,
    parser_image_digest: policy.parser_image_digest,
    parser_policy_version: policy.parser_policy_version,
    parser_limits: {
      max_file_bytes: policy.max_file_bytes,
      max_zip_expansion_ratio: policy.max_zip_expansion_ratio,
      max_sheets: policy.max_sheets,
      max_rows_per_sheet: policy.max_rows_per_sheet,
      max_columns_per_sheet: policy.max_columns_per_sheet,
      max_cell_bytes: policy.max_cell_bytes,
      max_parse_ms: policy.max_parse_ms,
    },
    selected_sheet_names: [...inspection.selected_sheet_names],
    encoding: inspection.encoding,
    delimiter: inspection.delimiter,
    locale: policy.locale,
    date_policy: policy.date_policy,
    formula_policy: policy.formula_policy,
    macro_detected: false,
    external_link_detected: false,
    sheets: inspection.sheets.map(({ maximum_cell_bytes: _maximumCellBytes, ...sheet }) => sheet),
    warnings: [...inspection.warnings],
    truncation_codes: [],
    status: "ACCEPTED",
    failure_code: null,
    started_at: startedAt,
    completed_at: now().toISOString(),
  };
  return sealReceipt(material);
}
