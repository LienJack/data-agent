import {
  type ArtifactReference,
  type ArtifactWorkspaceChartDocumentV2,
  type ArtifactWorkspaceChartProjectionV2,
  buildArtifactWorkspaceChartDocumentV2,
  type ProductTeamArtifactDocument,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts";
import {
  projectQueryEvidenceTablePresentation,
  QUERY_EVIDENCE_CHART_NULLABLE_TRANSFORM_VERSION,
} from "@data-agent/contracts/artifacts";

export type QueryEvidenceVisualizationIntent = "TREND" | "COMPARISON" | "COMPOSITION";

export interface SemanticContextChartIdentity {
  readonly package_id: string;
  readonly package_hash: string;
  readonly receipt_id: string;
  readonly receipt_hash: string;
}

function scalarLabel(value: string | number | boolean | null): string | null {
  if (value === null) return null;
  const label = String(value);
  return label.length > 0 && label.length <= 200 ? label : null;
}

function numeric(value: string | number | boolean | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function chartType(intent: QueryEvidenceVisualizationIntent): "LINE" | "BAR" | "PIE" {
  if (intent === "TREND") return "LINE";
  if (intent === "COMPARISON") return "BAR";
  return "PIE";
}

function title(intent: QueryEvidenceVisualizationIntent): string {
  if (intent === "TREND") return "月度订单趋势";
  if (intent === "COMPARISON") return "分类比较";
  return "构成占比";
}

function compareLabels(left: unknown, right: unknown): number {
  const leftLabel = String(left);
  const rightLabel = String(right);
  return leftLabel < rightLabel ? -1 : leftLabel > rightLabel ? 1 : 0;
}

export async function buildQueryEvidenceChartDocument(input: {
  readonly intent: QueryEvidenceVisualizationIntent;
  readonly document_ref: ArtifactReference;
  readonly evidence: ProductTeamArtifactDocument;
  readonly semantic_context: SemanticContextChartIdentity;
  readonly title?: string;
  readonly description?: string;
  readonly unit?: string | null;
}): Promise<ArtifactWorkspaceChartDocumentV2 | null> {
  const evidence = await verifyProductTeamArtifactDocument(input.evidence);
  if (
    evidence.artifact_ref.artifact_type !== "QueryEvidence" ||
    evidence.projection.kind !== "TABLE" ||
    input.document_ref.artifact_type !== "ArtifactWorkspaceDocument"
  ) {
    return null;
  }
  const table =
    evidence.provenance?.kind === "GOVERNED_QUERY_RESULT"
      ? projectQueryEvidenceTablePresentation(
          evidence.projection,
          evidence.provenance.semantic_binding,
        )
      : evidence.projection;
  const xColumn = table.columns.find(({ data_type: type }) => type === "STRING");
  const yColumns = table.columns
    .filter(({ data_type: type }) => type === "NUMBER")
    .slice(0, input.intent === "COMPOSITION" ? 1 : 4);
  if (!xColumn || yColumns.length === 0) return null;

  const rows = evidence.projection.rows.flatMap((row) => {
    const x = scalarLabel(row[xColumn.key] ?? null);
    const values = yColumns.map(({ key }) => numeric(row[key] ?? null));
    if (!x) return [];
    return [
      Object.fromEntries([
        [xColumn.key, x],
        ...yColumns.map(({ key }, index) => [key, values[index] ?? null] as const),
      ]),
    ];
  });
  if (rows.length < 2) return null;

  const primaryKey = yColumns[0]?.key;
  if (!primaryKey) return null;
  if (rows.filter((row) => yColumns.some(({ key }) => row[key] !== null)).length < 2) return null;
  if (input.intent === "COMPOSITION" && rows.some((row) => row[primaryKey] === null)) return null;
  rows.sort((left, right) => {
    if (input.intent === "TREND") {
      return compareLabels(left[xColumn.key], right[xColumn.key]);
    }
    const leftValue = numeric(left[primaryKey] ?? null);
    const rightValue = numeric(right[primaryKey] ?? null);
    const byValue =
      leftValue === null
        ? rightValue === null
          ? 0
          : 1
        : rightValue === null
          ? -1
          : rightValue - leftValue;
    return byValue || compareLabels(left[xColumn.key], right[xColumn.key]);
  });

  const maximum = input.intent === "TREND" ? 100 : input.intent === "COMPARISON" ? 30 : 12;
  if (rows.length > maximum) return null;
  if (
    input.intent === "COMPOSITION" &&
    (rows.some((row) => Number(row[primaryKey]) < 0) ||
      rows.reduce((sum, row) => sum + Number(row[primaryKey]), 0) <= 0)
  ) {
    return null;
  }

  const projection: ArtifactWorkspaceChartProjectionV2 = {
    kind: "CHART",
    chart_type: chartType(input.intent),
    title: input.title?.trim() || title(input.intent),
    description: input.description?.trim() || "由已提交 QueryEvidence 确定性派生",
    unit: input.unit ?? null,
    x_key: xColumn.key,
    y_keys: yColumns.map(({ key }) => key),
    legend: { visible: yColumns.length > 1 || input.intent === "COMPOSITION" },
    table: {
      kind: "TABLE",
      columns: [xColumn, ...yColumns],
      rows,
      total_rows: rows.length,
    },
  };

  return buildArtifactWorkspaceChartDocumentV2({
    schema_version: "artifact-workspace-chart-document@2.0.0",
    document_ref: input.document_ref,
    source_refs: [evidence.artifact_ref],
    provenance: {
      transform_version: QUERY_EVIDENCE_CHART_NULLABLE_TRANSFORM_VERSION,
      dataset_hash: `sha256:${"0".repeat(64)}`,
      semantic_context: input.semantic_context,
    },
    projection,
  });
}
