import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { monthlyComparisonFixture } from "./monthly-comparison-fixture.js";
import { buildTestQueryEvidenceSemanticBinding } from "./query-evidence-semantic-binding.js";

export async function categoryComparisonFixture(twoDimensions = false, derived = false) {
  const base = await monthlyComparisonFixture();
  if (
    base.document.projection.kind !== "TABLE" ||
    base.document.provenance?.kind !== "GOVERNED_QUERY_RESULT"
  )
    throw new Error("TEST_QUERY_REQUIRED");
  const raw = await buildTestQueryEvidenceSemanticBinding({
    columns: [
      {
        name: "channel",
        logical_type: "STRING",
        nullable: true,
        semantic_role: "DIMENSION",
        semantic_object_id: "dimension.channel",
      },
      ...(twoDimensions
        ? [
            {
              name: "audience",
              logical_type: "STRING" as const,
              nullable: true,
              semantic_role: "DIMENSION" as const,
              semantic_object_id: "dimension.audience",
            },
          ]
        : []),
      {
        name: "spend",
        logical_type: "NUMBER",
        nullable: true,
        semantic_role: "METRIC",
        semantic_object_id: "metric.spend",
      },
      {
        name: "revenue",
        logical_type: "NUMBER",
        nullable: true,
        semantic_role: "METRIC",
        semantic_object_id: "metric.revenue",
      },
      {
        name: "return_rate",
        logical_type: "NUMBER",
        nullable: true,
        semantic_role: "FORMULA",
        semantic_object_id: "formula.roas",
      },
    ],
  });
  const { binding_hash: _bindingHash, ...bindingMaterial } = base.binding;
  const columns = raw.columns.map((column) =>
    derived && column.output_name === "return_rate"
      ? {
          ...column,
          semantic_role: "REQUEST_DERIVED" as const,
          semantic_object_id: "request-scoped.net-roi",
          request_derivation: {
            semantic_query_context_hash: base.binding.semantic_context_ref.package_hash,
            interpretation: {
              interpretation_id: "request-scoped.net-roi",
              requested_term: "净ROI",
              scope: "REQUEST_ONLY" as const,
              source_object_ids: ["metric.revenue", "metric.spend"],
              operator: {
                kind: "AGGREGATE_RATIO" as const,
                numerator_metric_id: "metric.revenue",
                denominator_metric_id: "metric.spend",
                numerator_adjustment: "SUBTRACT_DENOMINATOR" as const,
                aggregation: "SUM_BEFORE_RATIO" as const,
                zero_denominator: "NULL" as const,
              },
              user_explanation: "收入减投入后除以投入，仅请求内计算",
              publication_effect: "NONE" as const,
            },
          },
        }
      : column,
  );
  const binding = await buildQueryEvidenceSemanticBinding({
    ...bindingMaterial,
    columns,
    time_window: null,
  });
  const metric = base.context.metrics[0];
  if (!metric) throw new Error("TEST_METRIC_REQUIRED");
  const { context_hash: _contextHash, ...contextMaterial } = base.context;
  const dimensions = ["dimension.channel", ...(twoDimensions ? ["dimension.audience"] : [])];
  const context = await buildAnalysisContext({
    ...contextMaterial,
    metrics: ["metric.revenue", "metric.spend"].map((id) => ({
      ...metric,
      metric_ref: { ...metric.metric_ref, node_id: id },
      allowed_dimensions: [
        ...metric.allowed_dimensions,
        ...dimensions.map((dimension_id) => ({
          dimension_id,
          grain: { grain_id: dimension_id, granularity: "atomic" as const },
          data_type: "text" as const,
          sensitivity: "INTERNAL" as const,
          groupable: true,
          pivotable: true,
          causal_role: null,
        })),
      ],
    })),
  });
  const values = [
    { channel: "Email", spend: 100, revenue: 200, return_rate: 2 },
    { channel: "App", spend: 80, revenue: 120, return_rate: 1.5 },
    { channel: "SMS", spend: 50, revenue: 100, return_rate: 2 },
    { channel: "Social", spend: 0, revenue: 0, return_rate: null },
  ];
  const rows = values.flatMap((row) => {
    const value = {
      ...row,
      return_rate: row.return_rate === null ? null : row.return_rate - (derived ? 1 : 0),
    };
    return twoDimensions
      ? [
          { ...value, audience: "新客" },
          { ...value, audience: "老客" },
        ]
      : [value];
  });
  const document = await buildProductTeamArtifactDocument({
    ...base.document,
    provenance: { ...base.document.provenance, row_count: rows.length, semantic_binding: binding },
    projection: {
      kind: "TABLE",
      columns: columns.map((column) => ({
        key: column.output_name,
        label: column.output_name,
        data_type: column.logical_type === "STRING" ? "STRING" : "NUMBER",
      })),
      rows,
      total_rows: rows.length,
    },
  });
  if (document.artifact_ref.artifact_type !== "QueryEvidence")
    throw new Error("TEST_QUERY_REQUIRED");
  return { context, binding, document, reference: document.artifact_ref, rows };
}
