import {
  type ArtifactReference,
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { buildTestQueryEvidenceSemanticBinding } from "./query-evidence-semantic-binding.js";

export const comparisonId = (suffix: number) =>
  `62700000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
export const comparisonHash = (character: string) => `sha256:${character.repeat(64)}` as const;
export const comparisonScope = {
  app_id: comparisonId(1),
  tenant_id: comparisonId(2),
  environment: "test",
} as const;
export function comparisonRef<T extends ArtifactReference["artifact_type"]>(
  artifact_type: T,
  suffix: number,
): ArtifactReference & { artifact_type: T } {
  return {
    artifact_id: comparisonId(suffix),
    artifact_type,
    ...comparisonScope,
    run_id: comparisonId(3),
    revision: 1,
    content_hash: comparisonHash("a"),
  };
}

export async function monthlyComparisonFixture() {
  const raw = await buildTestQueryEvidenceSemanticBinding({
    columns: [
      {
        name: "month",
        logical_type: "DATE",
        nullable: false,
        semantic_role: "DIMENSION",
        semantic_object_id: "dimension.month",
        grain: { grain_id: "month", granularity: "month" },
      },
      {
        name: "current",
        logical_type: "NUMBER",
        nullable: false,
        semantic_role: "METRIC",
        semantic_object_id: "metric.revenue",
      },
      {
        name: "prior",
        logical_type: "NUMBER",
        nullable: true,
        semantic_role: "METRIC",
        semantic_object_id: "metric.revenue",
      },
      {
        name: "rate",
        logical_type: "NUMBER",
        nullable: true,
        semantic_role: "REQUEST_DERIVED",
        semantic_object_id: "request-scoped.yoy",
      },
    ],
    time_window: {
      dimension_id: "dimension.month",
      start: "2024-01-01",
      end: "2025-01-01",
      timezone: "Asia/Shanghai",
      semantics: "HALF_OPEN",
    },
  });
  const release = comparisonRef("SemanticRelease", 10);
  const snapshot = comparisonRef("SchemaSnapshot", 11);
  const semanticContext = {
    package_id: comparisonId(20),
    package_hash: comparisonHash("b"),
    receipt_id: comparisonId(21),
    receipt_hash: comparisonHash("c"),
  };
  const { binding_hash: _hash, ...rawMaterial } = raw;
  const binding = await buildQueryEvidenceSemanticBinding({
    ...rawMaterial,
    semantic_release_ref: {
      ...raw.semantic_release_ref,
      resource_id: release.artifact_id,
      resource_revision: release.revision,
      resource_hash: release.content_hash,
    },
    schema_snapshot_ref: {
      ...raw.schema_snapshot_ref,
      resource_id: snapshot.artifact_id,
      resource_revision: snapshot.revision,
      resource_hash: snapshot.content_hash,
      semantic_release_id: release.artifact_id,
    },
    semantic_context_ref: semanticContext,
  });
  const context = await buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope: comparisonScope,
    semantic_context_binding: semanticContext,
    semantic_release_ref: release,
    schema_snapshot_ref: snapshot,
    policy_receipt_ref: comparisonRef("PolicyReceipt", 12),
    semantic_retrieval_receipt_hash: comparisonHash("d"),
    semantic_inference_receipt_hash: comparisonHash("e"),
    metrics: [
      {
        metric_ref: { container_ref: release, node_id: "metric.revenue" },
        formula_hash: comparisonHash("7"),
        unit: {
          unit_id: "unit.cny",
          dimension: "currency",
          base_unit: "CNY",
          conversion_factor: 1,
        },
        grain: { grain_id: "order", granularity: "atomic" },
        time_domain: {
          time_domain_id: "order-time",
          calendar: "gregorian",
          timezone: "Asia/Shanghai",
          min_time: "2023-01-01T00:00:00Z",
          max_time: "2025-01-01T00:00:00Z",
        },
        time_dimension_ref: "dimension.month",
        additivity: "additive",
        null_policy: "exclude",
        missing_period_policy: "REJECT_GAP",
        seasonality: null,
        priority: 1,
        causal_role: "OUTCOME",
        allowed_dimensions: [
          {
            dimension_id: "dimension.month",
            grain: { grain_id: "month", granularity: "month" },
            data_type: "date",
            sensitivity: "INTERNAL",
            groupable: true,
            pivotable: true,
            causal_role: null,
          },
        ],
        analysis_capabilities: ["CHART_DATASET", "TREND_CHANGE"],
      },
    ],
    relationships: [],
    causal_policy: null,
  });
  const sql = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: comparisonRef("SqlArtifact", 30),
    profile_id: "governed-text2sql-agent",
    task_id: comparisonId(31),
    source_refs: [],
    provenance: {
      kind: "TEXT2SQL_CANDIDATE",
      candidate_hash: comparisonHash("1"),
      parameters_hash: comparisonHash("2"),
      parameter_count: 0,
      datasource_ref: binding.datasource_ref,
      schema_snapshot_ref: {
        resource_id: snapshot.artifact_id,
        resource_hash: snapshot.content_hash,
      },
      semantic_context_ref: {
        package_id: semanticContext.package_id,
        package_hash: semanticContext.package_hash,
      },
      semantic_query_context_ref: null,
      semantic_query_context_hash: null,
      target_binding_hash: binding.target_binding_hash,
    },
    projection: { kind: "SQL", dialect: "postgresql", sql: "select month, current, prior, rate" },
    committed_at: "2026-08-31T00:00:00.000Z",
  });
  const values = [120, 130, 100, 100, 80, 110, 0, 90, 100, 100, 130, 140];
  const rows = values.map((current, index) => ({
    month: `2024-${String(index + 1).padStart(2, "0")}-01`,
    current,
    prior: index < 6 ? null : 100,
    rate: index < 6 ? null : (current - 100) / 100,
  }));
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: comparisonRef("QueryEvidence", 34),
    profile_id: "governed-text2sql-agent",
    task_id: comparisonId(31),
    source_refs: [sql.artifact_ref],
    provenance: {
      kind: "GOVERNED_QUERY_RESULT",
      query_id: comparisonId(35),
      request_hash: comparisonHash("6"),
      result_hash: comparisonHash("7"),
      row_count: 12,
      byte_count: 1024,
      elapsed_ms: 1,
      truncated: false,
      semantic_binding: binding,
    },
    projection: {
      kind: "TABLE",
      columns: [
        { key: "month", label: "月份", data_type: "STRING" },
        { key: "current", label: "本期收入", data_type: "NUMBER" },
        { key: "prior", label: "同期收入", data_type: "NUMBER" },
        { key: "rate", label: "同比", data_type: "NUMBER" },
      ],
      rows,
      total_rows: 12,
    },
    committed_at: "2026-08-31T00:00:00.000Z",
  });
  if (
    document.artifact_ref.artifact_type !== "QueryEvidence" ||
    document.projection.kind !== "TABLE" ||
    document.provenance?.kind !== "GOVERNED_QUERY_RESULT"
  )
    throw new Error("TEST_QUERY_EVIDENCE_REQUIRED");
  return { context, binding, document, reference: document.artifact_ref, rows };
}
