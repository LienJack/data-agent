import {
  type AnalysisContext,
  type AnalysisReasonCode,
  contentHashSchema,
  sha256ContentHash,
  verifyAnalysisContext,
} from "@data-agent/contracts";

export type AnalysisTransformRequest =
  | {
      readonly kind: "FILTER";
      readonly metric_id: string;
      readonly dimension_id: string;
      readonly operator: "EQ" | "NEQ" | "IN" | "BETWEEN" | "IS_NULL" | "IS_NOT_NULL";
      readonly parameter_key: string;
    }
  | {
      readonly kind: "GROUP_BY";
      readonly metric_id: string;
      readonly dimension_ids: readonly string[];
    }
  | {
      readonly kind: "JOIN";
      readonly metric_id: string;
      readonly relationship_id: string;
    }
  | {
      readonly kind: "PIVOT";
      readonly metric_id: string;
      readonly dimension_id: string;
      readonly max_columns: number;
    }
  | {
      readonly kind: "WINDOW";
      readonly metric_id: string;
      readonly operation: "LAG" | "ROLLING_MEAN" | "ROLLING_SUM" | "PERIOD_DELTA";
      readonly periods: number;
    }
  | {
      readonly kind: "DERIVED_METRIC";
      readonly metric_id: string;
      readonly formula_hash: `sha256:${string}`;
    }
  | {
      readonly kind: "CHART_DATASET";
      readonly metric_id: string;
      readonly dimension_ids: readonly string[];
      readonly max_rows: number;
    };

export type AnalysisTransformCompilation =
  | {
      readonly status: "COMPILED";
      readonly transform: AnalysisTransformRequest;
      readonly context_hash: string;
      readonly transform_hash: string;
    }
  | {
      readonly status: "REJECTED";
      readonly reason_code: AnalysisReasonCode;
    };

function rejected(reason_code: AnalysisReasonCode): AnalysisTransformCompilation {
  return { status: "REJECTED", reason_code };
}

export async function compileAnalysisTransform(
  unverifiedContext: AnalysisContext,
  request: AnalysisTransformRequest,
): Promise<AnalysisTransformCompilation> {
  const context = await verifyAnalysisContext(unverifiedContext);
  const metric = context.metrics.find(({ metric_ref }) => metric_ref.node_id === request.metric_id);
  if (!metric) return rejected("UNRESOLVED_SEMANTICS");

  let normalized: AnalysisTransformRequest = request;
  switch (request.kind) {
    case "FILTER": {
      const dimension = metric.allowed_dimensions.find(
        ({ dimension_id }) => dimension_id === request.dimension_id,
      );
      if (!dimension) return rejected("DIMENSION_NOT_ALLOWED");
      if (["RESTRICTED", "SECRET"].includes(dimension.sensitivity)) {
        return rejected("SENSITIVE_DIMENSION_BLOCKED");
      }
      break;
    }
    case "GROUP_BY": {
      const dimensionIds = [...new Set(request.dimension_ids)].sort();
      const dimensions = dimensionIds.map((dimensionId) =>
        metric.allowed_dimensions.find(({ dimension_id }) => dimension_id === dimensionId),
      );
      if (
        dimensions.some(
          (dimension) =>
            !dimension?.groupable ||
            ["RESTRICTED", "SECRET"].includes(dimension?.sensitivity ?? "SECRET"),
        )
      ) {
        return rejected("DIMENSION_NOT_ALLOWED");
      }
      if (dimensions.some((dimension) => dimension?.grain.grain_id !== metric.grain.grain_id)) {
        return rejected("GRAIN_MISMATCH");
      }
      normalized = { ...request, dimension_ids: dimensionIds };
      break;
    }
    case "JOIN": {
      const relationship = context.relationships.find(
        ({ relationship_id }) => relationship_id === request.relationship_id,
      );
      if (!relationship) return rejected("RELATIONSHIP_NOT_PUBLISHED");
      if (!relationship.fanout_closed || relationship.cardinality === "many-to-many") {
        return rejected("FANOUT_NOT_CLOSED");
      }
      break;
    }
    case "PIVOT": {
      const dimension = metric.allowed_dimensions.find(
        ({ dimension_id }) => dimension_id === request.dimension_id,
      );
      if (!dimension?.pivotable) return rejected("DIMENSION_NOT_ALLOWED");
      if (
        !Number.isSafeInteger(request.max_columns) ||
        request.max_columns < 1 ||
        request.max_columns > 50
      ) {
        return rejected("ANALYSIS_BUDGET_EXCEEDED");
      }
      break;
    }
    case "WINDOW":
      if (metric.time_domain === null || metric.time_dimension_ref === null) {
        return rejected("TIME_DOMAIN_NOT_PUBLISHED");
      }
      if (!Number.isSafeInteger(request.periods) || request.periods < 1 || request.periods > 512) {
        return rejected("ANALYSIS_BUDGET_EXCEEDED");
      }
      break;
    case "DERIVED_METRIC":
      if (request.formula_hash !== metric.formula_hash) {
        return rejected("UNPUBLISHED_SEMANTIC_INPUT");
      }
      break;
    case "CHART_DATASET": {
      if (!metric.analysis_capabilities.includes("CHART_DATASET")) {
        return rejected("ANALYSIS_CAPABILITY_NOT_PUBLISHED");
      }
      const dimensionIds = [...new Set(request.dimension_ids)].sort();
      if (
        dimensionIds.some(
          (dimensionId) =>
            !metric.allowed_dimensions.some(({ dimension_id }) => dimension_id === dimensionId),
        )
      ) {
        return rejected("DIMENSION_NOT_ALLOWED");
      }
      if (
        !Number.isSafeInteger(request.max_rows) ||
        request.max_rows < 1 ||
        request.max_rows > 5_000
      ) {
        return rejected("ANALYSIS_BUDGET_EXCEEDED");
      }
      normalized = { ...request, dimension_ids: dimensionIds };
      break;
    }
  }

  const material = {
    schema_version: "analysis-transform@1.0.0",
    context_hash: context.context_hash,
    transform: normalized,
  } as const;
  return {
    status: "COMPILED",
    transform: normalized,
    context_hash: context.context_hash,
    transform_hash: contentHashSchema.parse(await sha256ContentHash(material)),
  };
}
