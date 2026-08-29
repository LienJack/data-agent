import { createHash } from "node:crypto";
import {
  type AnalysisResultContract,
  type AnalysisResultValueType,
  verifyAnalysisResultContract,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, deepFreeze, sha256ContentHash } from "@data-agent/contracts/common";
import type { GovernedOperatorResultRef } from "@data-agent/contracts/ports";
import {
  type AnalysisOperatorFinalizationResult,
  type AnalysisResultPublishObservation,
  type AnalysisResultPublishToolArguments,
  analysisResultPublishObservationSchema,
  analysisResultPublishToolArgumentsSchema,
} from "@data-agent/contracts/ports";
import type { StatisticalOperatorObligation } from "@data-agent/contracts/statistical-operators";
import { z } from "zod";

const encoder = new TextEncoder();
const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const pythonSymbolSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u);
const decimalSchema = z.string().regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestampSchema = z.string().datetime({ offset: true });

type WireValue =
  | { readonly kind: "NULL" }
  | { readonly kind: "BOOLEAN"; readonly value: boolean }
  | { readonly kind: "STRING"; readonly value: string }
  | { readonly kind: "INTEGER"; readonly value: string }
  | { readonly kind: "NUMBER"; readonly value: number }
  | { readonly kind: "DECIMAL"; readonly value: string }
  | { readonly kind: "DATE"; readonly value: string }
  | { readonly kind: "TIMESTAMP"; readonly value: string }
  | { readonly kind: "ARRAY"; readonly items: readonly WireValue[] }
  | {
      readonly kind: "OBJECT";
      readonly entries: readonly { readonly key: string; readonly value: WireValue }[];
    };

const wireValueSchema: z.ZodType<WireValue> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("NULL") }),
    z.strictObject({ kind: z.literal("BOOLEAN"), value: z.boolean() }),
    z.strictObject({ kind: z.literal("STRING"), value: z.string().max(1_000_000) }),
    z.strictObject({
      kind: z.literal("INTEGER"),
      value: z.string().regex(/^-?(?:0|[1-9][0-9]*)$/u),
    }),
    z.strictObject({ kind: z.literal("NUMBER"), value: z.number().finite() }),
    z.strictObject({ kind: z.literal("DECIMAL"), value: decimalSchema }),
    z.strictObject({ kind: z.literal("DATE"), value: dateSchema }),
    z.strictObject({ kind: z.literal("TIMESTAMP"), value: timestampSchema }),
    z.strictObject({ kind: z.literal("ARRAY"), items: z.array(wireValueSchema).max(100_000) }),
    z.strictObject({
      kind: z.literal("OBJECT"),
      entries: z
        .array(z.strictObject({ key: z.string().min(1).max(256), value: wireValueSchema }))
        .max(10_000),
    }),
  ]),
);

const extractedMappingSchema = z.strictObject({
  symbol_name: pythonSymbolSchema,
  symbol_kind: z.literal("MAPPING"),
  value: wireValueSchema,
});

const extractedTableSchema = z.strictObject({
  symbol_name: pythonSymbolSchema,
  symbol_kind: z.literal("TABLE"),
  columns: z.array(z.string().min(1).max(256)).min(1).max(128),
  rows: z.array(z.array(wireValueSchema).max(128)).max(5_000),
});

export const analysisExtractedSymbolsSchema = z
  .strictObject({
    schema_version: z.literal("analysis-extracted-symbols@1.0.0"),
    symbols: z
      .array(z.union([extractedMappingSchema, extractedTableSchema]))
      .min(1)
      .max(65),
  })
  .superRefine((extraction, context) => {
    const names = extraction.symbols.map(({ symbol_name }) => symbol_name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["symbols"],
        message: "Extracted symbols must be unique.",
      });
    }
    for (const [symbolIndex, symbol] of extraction.symbols.entries()) {
      if (symbol.symbol_kind !== "TABLE") continue;
      if (new Set(symbol.columns).size !== symbol.columns.length) {
        context.addIssue({
          code: "custom",
          path: ["symbols", symbolIndex, "columns"],
          message: "Extracted table columns must be unique.",
        });
      }
      for (const [rowIndex, row] of symbol.rows.entries()) {
        if (row.length !== symbol.columns.length) {
          context.addIssue({
            code: "custom",
            path: ["symbols", symbolIndex, "rows", rowIndex],
            message: "Extracted table rows must match the column count.",
          });
        }
      }
    }
  });

export type AnalysisExtractedSymbols = z.infer<typeof analysisExtractedSymbolsSchema>;

export interface AnalysisResultSymbolExtractorPort {
  extract(input: {
    readonly symbols: readonly {
      readonly symbol_name: string;
      readonly expected_kind: "MAPPING" | "TABLE";
    }[];
    readonly limits: {
      readonly max_rows: number;
      readonly max_columns: number;
      readonly max_bytes: number;
    };
  }): Promise<unknown>;
}

export interface AnalysisResultClosureArtifact {
  readonly artifact_name: string;
  readonly artifact_kind: "RESULT" | "TABLE" | "CHART";
  readonly media_type: "application/json";
  readonly content: Uint8Array;
  readonly content_sha256: `sha256:${string}`;
  readonly bytes: number;
}

export interface AnalysisResultStagedClosure {
  readonly schema_version: "analysis-result-staged-closure@1.0.0";
  readonly publish_id: string;
  readonly contract_hash: `sha256:${string}`;
  readonly manifest_hash: `sha256:${string}`;
  readonly closure_hash: `sha256:${string}`;
  readonly analytical_value_hashes: readonly {
    readonly symbol_name: string;
    readonly value_hash: `sha256:${string}`;
  }[];
  readonly artifacts: readonly AnalysisResultClosureArtifact[];
}

export interface AnalysisResultAtomicStagePort {
  stage(input: {
    readonly closure: AnalysisResultStagedClosure;
    readonly governed_results: readonly GovernedOperatorResultRef[];
    readonly operator_finalization: AnalysisOperatorFinalizationResult;
    readonly cells: readonly {
      readonly cell_id: string;
      readonly source_sha256: `sha256:${string}`;
      readonly source_ref: import("@data-agent/contracts/artifacts").ArtifactReference | null;
      readonly observation: {
        readonly execution_id: string | null;
        readonly execution_count: number | null;
        readonly elapsed_ms: number;
        readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
      };
    }[];
    readonly provider_invocation_refs: readonly {
      readonly resource_id: string;
      readonly resource_revision: 1;
      readonly resource_hash: `sha256:${string}`;
    }[];
  }): Promise<{
    readonly stage_id: string;
    readonly closure_hash: `sha256:${string}`;
  }>;
}

export interface GovernedOperatorPublishedValue {
  readonly call_id: string;
  readonly operator_id: string;
  readonly result_sha256: `sha256:${string}`;
  readonly governed_result: GovernedOperatorResultRef;
  readonly result_binding?: StatisticalOperatorObligation["result_binding"];
}

export interface PublishedAnalysisResult {
  readonly observation: AnalysisResultPublishObservation;
  readonly closure: AnalysisResultStagedClosure;
}

export interface PreparedAnalysisResult {
  readonly closure: AnalysisResultStagedClosure;
  readonly governed_results: readonly GovernedOperatorResultRef[];
}

function decodeWireValue(value: WireValue): unknown {
  switch (value.kind) {
    case "NULL":
      return null;
    case "BOOLEAN":
    case "STRING":
    case "NUMBER":
    case "DECIMAL":
    case "DATE":
    case "TIMESTAMP":
      return value.value;
    case "INTEGER": {
      const integer = Number(value.value);
      if (!Number.isSafeInteger(integer) || String(integer) !== value.value) {
        throw new TypeError("ANALYSIS_RESULT_INTEGER_UNSAFE");
      }
      return integer;
    }
    case "ARRAY":
      return value.items.map(decodeWireValue);
    case "OBJECT": {
      const decoded: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const entry of value.entries) {
        if (Object.hasOwn(decoded, entry.key)) {
          throw new TypeError("ANALYSIS_RESULT_OBJECT_KEY_DUPLICATE");
        }
        decoded[entry.key] = decodeWireValue(entry.value);
      }
      return decoded;
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonPointerTokens(pointer: string): readonly string[] {
  if (!pointer.startsWith("/") || pointer === "/") {
    throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_INVALID");
  }
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function readJsonPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const token of jsonPointerTokens(pointer)) {
    if (isRecord(current) && Object.hasOwn(current, token)) {
      current = current[token];
      continue;
    }
    if (Array.isArray(current) && /^(?:0|[1-9][0-9]*)$/u.test(token)) {
      const index = Number(token);
      if (index < current.length) {
        current = current[index];
        continue;
      }
    }
    throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_INVALID");
  }
  return current;
}

function canonicalClone(value: unknown): unknown {
  return JSON.parse(canonicalizeJson(value)) as unknown;
}

function materializeOperatorBoundResult(input: {
  readonly model_result: Readonly<Record<string, unknown>>;
  readonly bindings: readonly {
    readonly result_binding: StatisticalOperatorObligation["result_binding"];
    readonly authoritative_output: Readonly<Record<string, unknown>>;
  }[];
}): Readonly<Record<string, unknown>> {
  const authoritativeRoots = new Map<string, unknown>();
  for (const { result_binding: binding, authoritative_output: output } of input.bindings) {
    const resultTokens = jsonPointerTokens(binding.result_collection_path);
    const rootName = resultTokens[0];
    if (!rootName) {
      throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_INVALID");
    }
    const authoritativeCollection = readJsonPointer(output, binding.operator_collection_path);
    if (!Array.isArray(authoritativeCollection)) {
      throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_INVALID");
    }
    const tail = resultTokens.slice(1);
    if (tail.length === 0) {
      if (authoritativeRoots.has(rootName)) {
        throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_CONFLICT");
      }
      authoritativeRoots.set(rootName, canonicalClone(authoritativeCollection));
      continue;
    }
    let root = authoritativeRoots.get(rootName);
    if (root === undefined) {
      root = Object.create(null) as Record<string, unknown>;
      authoritativeRoots.set(rootName, root);
    }
    if (!isRecord(root)) {
      throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_CONFLICT");
    }
    let parent = root as Record<string, unknown>;
    for (const [index, token] of tail.entries()) {
      if (/^(?:0|[1-9][0-9]*)$/u.test(token)) {
        throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_INVALID");
      }
      const isLeaf = index === tail.length - 1;
      if (isLeaf) {
        if (Object.hasOwn(parent, token)) {
          throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_CONFLICT");
        }
        parent[token] = canonicalClone(authoritativeCollection);
        continue;
      }
      const existing = parent[token];
      if (existing === undefined) {
        const child = Object.create(null) as Record<string, unknown>;
        parent[token] = child;
        parent = child;
      } else if (isRecord(existing)) {
        parent = existing as Record<string, unknown>;
      } else {
        throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_PATH_CONFLICT");
      }
    }
  }
  return Object.freeze({ ...input.model_result, ...Object.fromEntries(authoritativeRoots) });
}

export function decodeAnalysisExtractedMappingSymbol(
  input: unknown,
): Readonly<{ symbol_name: string; value: Readonly<Record<string, unknown>> }> {
  const symbol = extractedMappingSchema.parse(input);
  const decoded = decodeWireValue(symbol.value);
  if (!isRecord(decoded)) throw new TypeError("ANALYSIS_RESULT_MAPPING_INVALID");
  return Object.freeze({ symbol_name: symbol.symbol_name, value: deepFreeze(decoded) });
}

function assertValueType(value: unknown, type: AnalysisResultValueType, nullable: boolean): void {
  if (value === null) {
    if (!nullable) throw new TypeError("ANALYSIS_RESULT_NULLABILITY_MISMATCH");
    return;
  }
  const valid =
    (type === "BOOLEAN" && typeof value === "boolean") ||
    (type === "DATE" && typeof value === "string" && dateSchema.safeParse(value).success) ||
    (type === "DECIMAL" && typeof value === "string" && decimalSchema.safeParse(value).success) ||
    (type === "INTEGER" && typeof value === "number" && Number.isSafeInteger(value)) ||
    (type === "NUMBER" && typeof value === "number" && Number.isFinite(value)) ||
    (type === "STRING" && typeof value === "string") ||
    (type === "TIMESTAMP" &&
      typeof value === "string" &&
      timestampSchema.safeParse(value).success) ||
    type === "JSON";
  if (!valid) throw new TypeError("ANALYSIS_RESULT_VALUE_TYPE_MISMATCH");
}

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function requiredSubset(
  actual: readonly string[],
  declared: readonly { readonly id: string; readonly required: boolean }[],
): boolean {
  const actualSet = new Set(actual);
  const declaredSet = new Set(declared.map(({ id }) => id));
  return (
    actual.every((id) => declaredSet.has(id)) &&
    declared.filter(({ required }) => required).every(({ id }) => actualSet.has(id))
  );
}

async function sealArtifact(input: {
  readonly artifact_name: string;
  readonly artifact_kind: AnalysisResultClosureArtifact["artifact_kind"];
  readonly document: unknown;
}): Promise<AnalysisResultClosureArtifact> {
  const content = encoder.encode(canonicalizeJson(input.document));
  return {
    artifact_name: input.artifact_name,
    artifact_kind: input.artifact_kind,
    media_type: "application/json",
    content,
    content_sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    bytes: content.byteLength,
  };
}

function validateManifestAgainstContract(
  manifest: AnalysisResultPublishToolArguments,
  contract: AnalysisResultContract,
  governedOperators: readonly GovernedOperatorPublishedValue[],
): void {
  if (
    !requiredSubset(
      manifest.table_bindings.map(({ table_id }) => table_id),
      contract.tables.map(({ table_id: id, required }) => ({ id, required })),
    ) ||
    !requiredSubset(
      manifest.chart_bindings.map(({ chart_id }) => chart_id),
      contract.charts.map(({ chart_id: id, required }) => ({ id, required })),
    )
  ) {
    throw new TypeError("ANALYSIS_RESULT_PUBLISH_CONTRACT_CLOSURE_MISMATCH");
  }
  const expectedOperators = governedOperators.map(
    ({ call_id, operator_id }) => `${call_id}\0${operator_id}`,
  );
  const actualOperators = manifest.operator_bindings.map(
    ({ call_id, operator_id }) => `${call_id}\0${operator_id}`,
  );
  if (!exactSet(expectedOperators, actualOperators)) {
    throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_MISMATCH");
  }
  const tableBindings = new Map(
    manifest.table_bindings.map((binding) => [binding.table_id, binding]),
  );
  for (const binding of manifest.chart_bindings) {
    const chart = contract.charts.find(({ chart_id }) => chart_id === binding.chart_id);
    if (
      !chart ||
      chart.intent !== binding.intent ||
      !chart.allowed_template_ids.includes(binding.template_id) ||
      tableBindings.get(chart.table_id)?.data_symbol !== binding.data_symbol
    ) {
      throw new TypeError("ANALYSIS_RESULT_PUBLISH_CHART_BINDING_MISMATCH");
    }
  }
}

function validateResultDocument(
  value: unknown,
  contract: AnalysisResultContract,
): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("ANALYSIS_RESULT_DOCUMENT_INVALID");
  const fieldNames = contract.result_fields.map(({ field }) => field);
  if (!exactSet(Object.keys(value), fieldNames)) {
    throw new TypeError("ANALYSIS_RESULT_FIELD_SET_MISMATCH");
  }
  for (const field of contract.result_fields) {
    const fieldValue = value[field.field];
    assertValueType(fieldValue, field.data_type, field.nullable);
    if (
      fieldValue !== null &&
      field.text_constraints !== undefined &&
      (typeof fieldValue !== "string" ||
        field.text_constraints.required_substrings.some(
          (required) => !fieldValue.includes(required),
        ) ||
        field.text_constraints.forbidden_substrings.some((forbidden) =>
          fieldValue.includes(forbidden),
        ) ||
        (field.text_constraints.required_suffix !== null &&
          !fieldValue.endsWith(field.text_constraints.required_suffix)))
    ) {
      throw new TypeError("ANALYSIS_RESULT_TEXT_POLICY_MISMATCH");
    }
  }
  for (const constraint of contract.collection_constraints) {
    const collection = value[constraint.collection_field];
    if (
      !Array.isArray(collection) ||
      collection.length < constraint.min_items ||
      collection.length > constraint.max_items ||
      collection.some((item) => !isRecord(item))
    ) {
      throw new TypeError("ANALYSIS_RESULT_COLLECTION_SHAPE_MISMATCH");
    }
    for (const item of collection as readonly Readonly<Record<string, unknown>>[]) {
      for (const predicate of constraint.all_items) {
        const left = item[predicate.left_field];
        const right =
          predicate.right.kind === "FIELD" ? item[predicate.right.field] : predicate.right.value;
        if (typeof left !== "number" || !Number.isFinite(left)) {
          throw new TypeError("ANALYSIS_RESULT_COLLECTION_PREDICATE_VALUE_INVALID");
        }
        if (typeof right !== "number" || !Number.isFinite(right)) {
          throw new TypeError("ANALYSIS_RESULT_COLLECTION_PREDICATE_VALUE_INVALID");
        }
        const matches =
          (predicate.operator === "GT" && left > right) ||
          (predicate.operator === "GTE" && left >= right) ||
          (predicate.operator === "LT" && left < right) ||
          (predicate.operator === "LTE" && left <= right);
        if (!matches) {
          throw new TypeError("ANALYSIS_RESULT_COLLECTION_PREDICATE_MISMATCH");
        }
      }
    }
  }
  return { ...value };
}

function validateTableProjection(
  rows: readonly Readonly<Record<string, unknown>>[],
  table: AnalysisResultContract["tables"][number],
  result: Readonly<Record<string, unknown>>,
): void {
  if (table.projection.mode === "MODEL_DERIVED") return;
  const projection = table.projection;
  const collection = result[projection.collection_field];
  if (!Array.isArray(collection) || collection.some((item) => !isRecord(item))) {
    throw new TypeError("ANALYSIS_RESULT_TABLE_PROJECTION_SOURCE_INVALID");
  }
  const projectedRows = (collection as readonly Readonly<Record<string, unknown>>[]).map((item) => {
    const projected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const mapping of projection.column_mappings) {
      if (!Object.hasOwn(item, mapping.result_field)) {
        throw new TypeError("ANALYSIS_RESULT_TABLE_PROJECTION_SOURCE_INVALID");
      }
      projected[mapping.table_column] = item[mapping.result_field];
    }
    return projected;
  });
  const canonicalRows = (values: readonly Readonly<Record<string, unknown>>[]) =>
    values.map((value) => canonicalizeJson(value)).sort();
  const actual = canonicalRows(rows);
  const expected = canonicalRows(projectedRows);
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new TypeError("ANALYSIS_RESULT_TABLE_PROJECTION_MISMATCH");
  }
}

function validateTable(
  symbol: z.infer<typeof extractedTableSchema>,
  table: AnalysisResultContract["tables"][number],
  contract: AnalysisResultContract,
): readonly Readonly<Record<string, unknown>>[] {
  const expectedColumns = table.columns.map(({ key }) => key);
  if (!exactSet(symbol.columns, expectedColumns)) {
    throw new TypeError("ANALYSIS_RESULT_TABLE_COLUMNS_MISMATCH");
  }
  if (
    symbol.columns.length > contract.limits.max_table_columns ||
    symbol.rows.length > Math.min(table.max_rows, contract.limits.max_table_rows)
  ) {
    throw new TypeError("ANALYSIS_RESULT_TABLE_BOUNDS_OR_SCHEMA_INVALID");
  }
  const columnByKey = new Map(table.columns.map((column) => [column.key, column]));
  return symbol.rows.map((wireRow) => {
    const row: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [index, wireValue] of wireRow.entries()) {
      const key = symbol.columns[index];
      const column = key ? columnByKey.get(key) : undefined;
      if (!key || !column) throw new TypeError("ANALYSIS_RESULT_TABLE_SCHEMA_INVALID");
      const value = decodeWireValue(wireValue);
      assertValueType(value, column.data_type, column.nullable);
      row[key] = value;
    }
    return row;
  });
}

export async function prepareAnalysisResult(input: {
  readonly contract: unknown;
  readonly manifest: unknown;
  readonly governed_operator_outputs: readonly GovernedOperatorPublishedValue[];
  readonly extractor: AnalysisResultSymbolExtractorPort;
}): Promise<PreparedAnalysisResult> {
  const contract = await verifyAnalysisResultContract(input.contract);
  const contractHash = contract.contract_hash as `sha256:${string}`;
  const manifest = analysisResultPublishToolArgumentsSchema.parse(input.manifest);
  validateManifestAgainstContract(manifest, contract, input.governed_operator_outputs);

  const expectedSymbols = new Map<string, "MAPPING" | "TABLE">([
    [manifest.result_symbol, "MAPPING"],
  ]);
  for (const binding of manifest.table_bindings) expectedSymbols.set(binding.data_symbol, "TABLE");
  for (const binding of manifest.chart_bindings) expectedSymbols.set(binding.data_symbol, "TABLE");
  for (const binding of manifest.operator_bindings)
    expectedSymbols.set(binding.result_symbol, "MAPPING");

  const extracted = analysisExtractedSymbolsSchema.parse(
    await input.extractor.extract({
      symbols: [...expectedSymbols].map(([symbol_name, expected_kind]) => ({
        symbol_name,
        expected_kind,
      })),
      limits: {
        max_rows: contract.limits.max_table_rows,
        max_columns: contract.limits.max_table_columns,
        max_bytes: contract.limits.max_closure_bytes,
      },
    }),
  );
  if (encoder.encode(canonicalizeJson(extracted)).byteLength > contract.limits.max_closure_bytes) {
    throw new TypeError("ANALYSIS_RESULT_SYMBOL_EXTRACTION_SIZE_EXCEEDED");
  }
  if (
    !exactSet(
      extracted.symbols.map(({ symbol_name }) => symbol_name),
      [...expectedSymbols.keys()],
    ) ||
    extracted.symbols.some(
      (symbol) => expectedSymbols.get(symbol.symbol_name) !== symbol.symbol_kind,
    )
  ) {
    throw new TypeError("ANALYSIS_RESULT_SYMBOL_EXTRACTION_MISMATCH");
  }
  const symbols = new Map(extracted.symbols.map((symbol) => [symbol.symbol_name, symbol]));
  const resultSymbol = symbols.get(manifest.result_symbol);
  if (resultSymbol?.symbol_kind !== "MAPPING") {
    throw new TypeError("ANALYSIS_RESULT_DOCUMENT_SYMBOL_INVALID");
  }
  const decodedResultValue = decodeWireValue(resultSymbol.value);
  if (!isRecord(decodedResultValue)) {
    throw new TypeError("ANALYSIS_RESULT_DOCUMENT_INVALID");
  }
  const authoritativeBindings: {
    result_binding: StatisticalOperatorObligation["result_binding"];
    authoritative_output: Readonly<Record<string, unknown>>;
  }[] = [];
  for (const binding of manifest.operator_bindings) {
    const symbol = symbols.get(binding.result_symbol);
    const governed = input.governed_operator_outputs.find(
      ({ call_id, operator_id }) =>
        call_id === binding.call_id && operator_id === binding.operator_id,
    );
    if (symbol?.symbol_kind !== "MAPPING" || !governed) {
      throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_VALUE_MISMATCH");
    }
    const authoritativeOutput = decodeWireValue(symbol.value);
    if (
      !isRecord(authoritativeOutput) ||
      (await sha256ContentHash(authoritativeOutput)) !== governed.result_sha256
    ) {
      throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_VALUE_MISMATCH");
    }
    if (governed.result_binding) {
      authoritativeBindings.push({
        result_binding: governed.result_binding,
        authoritative_output: authoritativeOutput,
      });
    }
  }
  const resultValue = validateResultDocument(
    materializeOperatorBoundResult({
      model_result: decodedResultValue,
      bindings: authoritativeBindings,
    }),
    contract,
  );
  const resultBytes = encoder.encode(canonicalizeJson(resultValue)).byteLength;
  if (resultBytes > contract.limits.max_result_bytes) {
    throw new TypeError("ANALYSIS_RESULT_DOCUMENT_SIZE_EXCEEDED");
  }

  const tableRows = new Map<string, readonly Readonly<Record<string, unknown>>[]>();
  const artifacts: AnalysisResultClosureArtifact[] = [];
  const resultArtifact = await sealArtifact({
    artifact_name: "result",
    artifact_kind: "RESULT",
    document: {
      schema_version: "analysis-published-result@1.0.0",
      contract_id: contract.contract_id,
      contract_hash: contractHash,
      semantic_context_hash: contract.semantic_context_hash,
      metrics: contract.metric_bindings,
      dimensions: contract.dimension_bindings,
      grain: contract.grain,
      lineage: contract.lineage,
      data: resultValue,
    },
  });
  if (resultArtifact.bytes > contract.limits.max_result_bytes) {
    throw new TypeError("ANALYSIS_RESULT_DOCUMENT_SIZE_EXCEEDED");
  }
  artifacts.push(resultArtifact);
  const tableBindingById = new Map(
    manifest.table_bindings.map((binding) => [binding.table_id, binding]),
  );
  for (const table of contract.tables) {
    const binding = tableBindingById.get(table.table_id);
    if (!binding) continue;
    const symbol = symbols.get(binding.data_symbol);
    if (symbol?.symbol_kind !== "TABLE") {
      throw new TypeError("ANALYSIS_RESULT_TABLE_BINDING_INVALID");
    }
    const rows = validateTable(symbol, table, contract);
    validateTableProjection(rows, table, resultValue);
    tableRows.set(table.table_id, rows);
    artifacts.push(
      await sealArtifact({
        artifact_name: `table:${table.table_id}`,
        artifact_kind: "TABLE",
        document: {
          schema_version: "analysis-published-table@1.0.0",
          table_id: table.table_id,
          title_zh: table.title_zh,
          columns: table.columns,
          rows,
          total_rows: rows.length,
        },
      }),
    );
  }
  const chartBindingById = new Map(
    manifest.chart_bindings.map((binding) => [binding.chart_id, binding]),
  );
  for (const chart of contract.charts) {
    const binding = chartBindingById.get(chart.chart_id);
    if (!binding) continue;
    const table = contract.tables.find(({ table_id }) => table_id === chart.table_id);
    const rows = tableRows.get(chart.table_id);
    if (!table || !rows) throw new TypeError("ANALYSIS_RESULT_CHART_SOURCE_INVALID");
    const columns = new Map(table.columns.map((column) => [column.key, column]));
    const numeric = (field: string) =>
      ["INTEGER", "NUMBER"].includes(columns.get(field)?.data_type ?? "");
    if (
      !columns.has(binding.x_field) ||
      binding.y_fields.some((field) => !numeric(field)) ||
      (binding.series_field !== "" && !columns.has(binding.series_field)) ||
      (binding.lower_bound_field !== "" && !numeric(binding.lower_bound_field)) ||
      (binding.upper_bound_field !== "" && !numeric(binding.upper_bound_field))
    ) {
      throw new TypeError("ANALYSIS_RESULT_CHART_FIELD_BINDING_INVALID");
    }
    artifacts.push(
      await sealArtifact({
        artifact_name: `chart:${chart.chart_id}`,
        artifact_kind: "CHART",
        document: {
          schema_version: "analysis-published-chart@1.0.0",
          chart_id: chart.chart_id,
          title_zh: chart.title_zh,
          intent: binding.intent,
          template_id: binding.template_id,
          bindings: {
            x_field: binding.x_field,
            y_fields: binding.y_fields,
            series_field: binding.series_field || null,
            lower_bound_field: binding.lower_bound_field || null,
            upper_bound_field: binding.upper_bound_field || null,
          },
          dataset: {
            table_id: table.table_id,
            columns: table.columns,
            rows,
            total_rows: rows.length,
          },
        },
      }),
    );
  }
  const closureBytes = artifacts.reduce((total, artifact) => total + artifact.bytes, 0);
  if (closureBytes > contract.limits.max_closure_bytes) {
    throw new TypeError("ANALYSIS_RESULT_CLOSURE_SIZE_EXCEEDED");
  }
  const analyticalValueHashes = await Promise.all(
    [...extracted.symbols]
      .sort((left, right) =>
        left.symbol_name < right.symbol_name ? -1 : left.symbol_name > right.symbol_name ? 1 : 0,
      )
      .map(async (symbol) => ({
        symbol_name: symbol.symbol_name,
        value_hash: await sha256ContentHash(
          symbol.symbol_name === manifest.result_symbol
            ? resultValue
            : symbol.symbol_kind === "MAPPING"
              ? decodeWireValue(symbol.value)
              : {
                  columns: symbol.columns,
                  rows: symbol.rows.map((row) => row.map(decodeWireValue)),
                },
        ),
      })),
  );
  const normalizedManifest = {
    ...manifest,
    table_bindings: contract.tables.flatMap((table) => {
      const binding = tableBindingById.get(table.table_id);
      return binding ? [binding] : [];
    }),
    chart_bindings: contract.charts.flatMap((chart) => {
      const binding = chartBindingById.get(chart.chart_id);
      return binding ? [binding] : [];
    }),
    operator_bindings: input.governed_operator_outputs.map((operator) => {
      const binding = manifest.operator_bindings.find(
        ({ call_id, operator_id }) =>
          call_id === operator.call_id && operator_id === operator.operator_id,
      );
      if (!binding) throw new TypeError("ANALYSIS_RESULT_PUBLISH_OPERATOR_BINDING_MISMATCH");
      return binding;
    }),
  };
  const manifestHash = await sha256ContentHash(normalizedManifest);
  const closureHash = await sha256ContentHash({
    hash_domain: "analysis-result-staged-closure@1.0.0",
    publish_id: manifest.publish_id,
    contract_hash: contractHash,
    manifest_hash: manifestHash,
    analytical_value_hashes: analyticalValueHashes,
    artifacts: artifacts.map(({ artifact_name, artifact_kind, content_sha256, bytes }) => ({
      artifact_name,
      artifact_kind,
      content_sha256,
      bytes,
    })),
  });
  const closure = Object.freeze({
    schema_version: "analysis-result-staged-closure@1.0.0" as const,
    publish_id: manifest.publish_id,
    contract_hash: contractHash,
    manifest_hash: manifestHash,
    closure_hash: closureHash,
    analytical_value_hashes: analyticalValueHashes,
    artifacts: Object.freeze(
      artifacts.map((artifact) =>
        Object.freeze({ ...artifact, content: artifact.content.slice() }),
      ),
    ),
  });
  return Object.freeze({
    closure,
    governed_results: Object.freeze(
      input.governed_operator_outputs.map(({ governed_result }) => governed_result),
    ),
  });
}

export async function stagePreparedAnalysisResult(input: {
  readonly prepared: PreparedAnalysisResult;
  readonly operator_finalization: AnalysisOperatorFinalizationResult;
  readonly stage: AnalysisResultAtomicStagePort;
  readonly cells: Parameters<AnalysisResultAtomicStagePort["stage"]>[0]["cells"];
  readonly provider_invocation_refs: Parameters<
    AnalysisResultAtomicStagePort["stage"]
  >[0]["provider_invocation_refs"];
}): Promise<PublishedAnalysisResult> {
  const { closure } = input.prepared;
  const staged = await input.stage.stage({
    closure,
    governed_results: input.prepared.governed_results,
    operator_finalization: input.operator_finalization,
    cells: input.cells,
    provider_invocation_refs: input.provider_invocation_refs,
  });
  if (staged.closure_hash !== closure.closure_hash) {
    throw new TypeError("ANALYSIS_RESULT_STAGE_CORRELATION_INVALID");
  }
  const observation = analysisResultPublishObservationSchema.parse({
    schema_version: "analysis-result-publish-observation@1.0.0",
    publish_id: closure.publish_id,
    status: "STAGED",
    contract_hash: closure.contract_hash,
    manifest_hash: closure.manifest_hash,
    closure_hash: closure.closure_hash,
    stage_id: identifierSchema.parse(staged.stage_id),
    artifacts: closure.artifacts.map(({ content: _content, ...artifact }) => artifact),
  });
  return Object.freeze({ observation: deepFreeze(observation), closure });
}

export const resultPublisherInternals = Object.freeze({
  assertValueType,
  decodeWireValue,
  validateManifestAgainstContract,
  validateResultDocument,
  validateTable,
  validateTableProjection,
  materializeOperatorBoundResult,
});
