import {
  type AnalysisResultContract,
  type AnalysisResultValueType,
  type ProductTeamArtifactDocument,
  type QueryEvidenceSemanticBinding,
  verifyAnalysisResultContract,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import type { GovernedAnalysisInput } from "./governed-analysis-input.js";
import { verifyProductTeamQueryEvidenceInput } from "./governed-analysis-input.js";

type EvidenceColumn = QueryEvidenceSemanticBinding["columns"][number];
type ResultTable = AnalysisResultContract["tables"][number];
type ResultCollectionTable = ResultTable & {
  readonly projection: Extract<ResultTable["projection"], { readonly mode: "RESULT_COLLECTION" }>;
};

export interface GovernedResultProjection {
  readonly table_id: string;
  readonly collection_field: string;
  readonly result_rows: readonly Readonly<Record<string, unknown>>[];
  readonly table_rows: readonly Readonly<Record<string, unknown>>[];
}

interface VerifiedGovernedInput {
  readonly governed: GovernedAnalysisInput;
  readonly document: ProductTeamArtifactDocument & {
    readonly projection: Extract<ProductTeamArtifactDocument["projection"], { kind: "TABLE" }>;
  };
  readonly binding: QueryEvidenceSemanticBinding;
}

function fail(): never {
  throw new TypeError("ANALYSIS_GOVERNED_RESULT_PROJECTION_INVALID");
}

function calendarDateInTimeZone(value: string, timezone: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) fail();
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
  } catch {
    fail();
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(({ type: candidate }) => candidate === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) fail();
  return `${year}-${month}-${day}`;
}

function temporalValue(input: {
  readonly value: unknown;
  readonly source: EvidenceColumn;
  readonly target_type: AnalysisResultValueType;
  readonly binding: QueryEvidenceSemanticBinding;
}): unknown {
  if (typeof input.value !== "string") fail();
  const window = input.binding.time_window;
  if (
    input.source.logical_type === "DATETIME" &&
    (!window || window.dimension_id !== input.source.semantic_object_id)
  ) {
    fail();
  }
  const calendarDate =
    input.source.logical_type === "DATE"
      ? input.value
      : window?.timezone
        ? calendarDateInTimeZone(input.value, window.timezone)
        : fail();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(calendarDate)) fail();
  if (input.source.grain.granularity === "month" && !/^\d{4}-\d{2}-01$/u.test(calendarDate)) {
    fail();
  }
  if (input.target_type === "STRING" || input.target_type === "DATE") return calendarDate;
  if (input.target_type === "TIMESTAMP" && input.source.logical_type === "DATETIME") {
    const timestamp = new Date(input.value);
    if (Number.isNaN(timestamp.valueOf())) fail();
    return timestamp.toISOString();
  }
  return fail();
}

function projectedValue(input: {
  readonly value: unknown;
  readonly source: EvidenceColumn;
  readonly target_type: AnalysisResultValueType;
  readonly nullable: boolean;
  readonly binding: QueryEvidenceSemanticBinding;
}): unknown {
  if (input.value === null) {
    if (!input.nullable || !input.source.nullable) fail();
    return null;
  }
  if (input.source.logical_type === "DATE" || input.source.logical_type === "DATETIME") {
    return temporalValue(input);
  }
  if (
    input.target_type === "NUMBER" &&
    input.source.logical_type === "NUMBER" &&
    typeof input.value === "number" &&
    Number.isFinite(input.value)
  ) {
    return input.value;
  }
  if (
    input.target_type === "INTEGER" &&
    input.source.logical_type === "NUMBER" &&
    typeof input.value === "number" &&
    Number.isSafeInteger(input.value)
  ) {
    return input.value;
  }
  if (
    input.target_type === "STRING" &&
    input.source.logical_type === "STRING" &&
    typeof input.value === "string"
  ) {
    return input.value;
  }
  if (
    input.target_type === "BOOLEAN" &&
    input.source.logical_type === "BOOLEAN" &&
    typeof input.value === "boolean"
  ) {
    return input.value;
  }
  return fail();
}

function directProjectionTables(
  contract: AnalysisResultContract,
): readonly ResultCollectionTable[] {
  const lineageByField = new Map(contract.lineage.map((lineage) => [lineage.field, lineage]));
  return contract.tables.filter((table): table is ResultCollectionTable => {
    if (table.projection.mode !== "RESULT_COLLECTION") return false;
    return lineageByField.get(table.projection.collection_field)?.transformation === "DIRECT";
  });
}

async function verifyGovernedInput(
  governed: GovernedAnalysisInput,
): Promise<VerifiedGovernedInput> {
  const document = await verifyProductTeamArtifactDocument(governed.query_evidence_document);
  const verified = await verifyProductTeamQueryEvidenceInput({
    query_evidence_ref: governed.query_evidence_ref,
    query_evidence_document: document,
    arrow_content: governed.content,
  });
  if (document.projection.kind !== "TABLE") fail();
  return {
    governed,
    document: document as VerifiedGovernedInput["document"],
    binding: verified.semantic_binding,
  };
}

export async function buildGovernedResultProjections(input: {
  readonly contract: AnalysisResultContract;
  readonly governed_inputs: readonly GovernedAnalysisInput[];
}): Promise<readonly GovernedResultProjection[]> {
  const contract = await verifyAnalysisResultContract(input.contract);
  const tables = directProjectionTables(contract);
  if (tables.length === 0) return Object.freeze([]);
  const governedInputs = await Promise.all(input.governed_inputs.map(verifyGovernedInput));
  const seenCollections = new Set<string>();
  const projections: GovernedResultProjection[] = [];

  for (const table of tables) {
    if (seenCollections.has(table.projection.collection_field)) fail();
    seenCollections.add(table.projection.collection_field);
    const lineage = contract.lineage.find(
      ({ field }) => field === table.projection.collection_field,
    );
    if (lineage?.transformation !== "DIRECT") fail();
    const mappings = new Map(
      table.projection.column_mappings.map((mapping) => [mapping.table_column, mapping]),
    );
    const resolvedColumns = table.columns.map((column) => {
      if (!lineage.source_semantic_object_ids.includes(column.semantic_object_id)) fail();
      const mapping = mappings.get(column.key);
      if (!mapping) fail();
      const explicitSource = mapping.source;
      const candidates = governedInputs.flatMap((governed) =>
        governed.binding.columns
          .filter(
            (source) =>
              source.semantic_object_id === column.semantic_object_id &&
              source.semantic_role === column.semantic_role &&
              (!explicitSource ||
                (governed.governed.name === explicitSource.input_name &&
                  source.output_name === explicitSource.output_name)),
          )
          .map((source) => ({ governed, source })),
      );
      const candidate = candidates[0];
      if (candidates.length !== 1 || !candidate) fail();
      return { column, mapping, ...candidate };
    });
    const sourceInput = resolvedColumns[0]?.governed;
    if (!sourceInput || resolvedColumns.some(({ governed }) => governed !== sourceInput)) fail();
    if (sourceInput.document.projection.rows.length > table.max_rows) fail();

    const rows = sourceInput.document.projection.rows.map((sourceRow) => {
      const resultRow: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      const tableRow: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const { column, mapping, source, governed } of resolvedColumns) {
        if (!Object.hasOwn(sourceRow, source.output_name)) fail();
        const value = projectedValue({
          value: sourceRow[source.output_name],
          source,
          target_type: column.data_type,
          nullable: column.nullable,
          binding: governed.binding,
        });
        resultRow[mapping.result_field] = value;
        tableRow[column.key] = value;
      }
      return { resultRow, tableRow };
    });
    const timeColumn = table.columns.find(
      ({ semantic_object_id: semanticObjectId }) =>
        semanticObjectId === contract.grain.time_dimension_id,
    );
    const timeMapping = timeColumn ? mappings.get(timeColumn.key) : undefined;
    if (timeMapping) {
      rows.sort((left, right) => {
        const leftValue = left.resultRow[timeMapping.result_field];
        const rightValue = right.resultRow[timeMapping.result_field];
        if (typeof leftValue !== "string" || typeof rightValue !== "string") fail();
        return leftValue.localeCompare(rightValue);
      });
      if (
        contract.grain.dimension_ids.length === 1 &&
        new Set(rows.map(({ resultRow }) => resultRow[timeMapping.result_field])).size !==
          rows.length
      ) {
        fail();
      }
    }
    projections.push(
      Object.freeze({
        table_id: table.table_id,
        collection_field: table.projection.collection_field,
        result_rows: Object.freeze(rows.map(({ resultRow }) => Object.freeze(resultRow))),
        table_rows: Object.freeze(rows.map(({ tableRow }) => Object.freeze(tableRow))),
      }),
    );
  }
  return Object.freeze(projections);
}

export const governedResultProjectionInternals = Object.freeze({
  calendarDateInTimeZone,
  directProjectionTables,
  projectedValue,
});
