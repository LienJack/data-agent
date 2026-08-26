import {
  type AnalysisContext,
  type ArtifactReference,
  buildAnalysisContext,
  type SemanticContextCommitResult,
  sha256ContentHash,
  verifySemanticContextCommitResult,
} from "@data-agent/contracts";
import type {
  SemanticExecutablePublicationProjection,
  SemanticRelationshipPublicationProjection,
  SemanticRuntimeRestrictionPublicationProjection,
} from "../production/publication-projection.js";

export type PublishedAnalysisContextCompilationErrorCode =
  | "PUBLISHED_ANALYSIS_CONTEXT_AUTHORITY_INVALID"
  | "PUBLISHED_ANALYSIS_CONTEXT_RELEASE_MISMATCH"
  | "PUBLISHED_ANALYSIS_CONTEXT_METRIC_NOT_RESOLVED";

export class PublishedAnalysisContextCompilationError extends TypeError {
  override readonly name = "PublishedAnalysisContextCompilationError";

  constructor(readonly code: PublishedAnalysisContextCompilationErrorCode) {
    super(code);
  }
}

export interface PublishedAnalysisSemanticCatalog {
  readonly release_identity: {
    readonly semantic_domain: string;
    readonly release_id: string;
    readonly release_digest: string;
  };
  readonly executable: SemanticExecutablePublicationProjection;
  readonly relationships: SemanticRelationshipPublicationProjection;
  readonly restrictions: SemanticRuntimeRestrictionPublicationProjection;
}

export interface CompilePublishedAnalysisContextInput {
  readonly run_id: string;
  readonly semantic_context: SemanticContextCommitResult;
  readonly catalog: PublishedAnalysisSemanticCatalog;
  readonly requested_metric_ids?: readonly string[];
}

function resourceReference(
  artifactType: "SemanticRelease" | "SchemaSnapshot" | "PolicyReceipt",
  resource: {
    readonly resource_id: string;
    readonly resource_revision: number;
    readonly resource_hash: string;
  },
  committed: SemanticContextCommitResult,
  runId: string,
): ArtifactReference {
  return {
    artifact_id: resource.resource_id,
    artifact_type: artifactType,
    ...committed.package.scope,
    run_id: runId,
    revision: resource.resource_revision,
    content_hash: resource.resource_hash as `sha256:${string}`,
  };
}

function selectedSemanticObjects(committed: SemanticContextCommitResult): Set<string> {
  const packageDocument = committed.package;
  return new Set([
    ...packageDocument.retrieval_receipt.selected_object_ids,
    ...packageDocument.mandatory_closure.object_ids,
    ...packageDocument.mandatory_closure.relationship_ids,
    ...packageDocument.evidence.map(({ evidence_id: evidenceId }) => evidenceId),
    ...(packageDocument.route_decision.selected_metric_id
      ? [packageDocument.route_decision.selected_metric_id]
      : []),
  ]);
}

function requestedMetricIds(
  input: CompilePublishedAnalysisContextInput,
  selected: ReadonlySet<string>,
): readonly string[] {
  const available = new Set(input.catalog.executable.metrics.map(({ metric_id: id }) => id));
  const requested = [
    ...new Set(
      input.requested_metric_ids && input.requested_metric_ids.length > 0
        ? input.requested_metric_ids
        : [...selected].filter((objectId) => available.has(objectId)),
    ),
  ].sort();
  if (
    requested.length === 0 ||
    requested.length > 16 ||
    requested.some((metricId) => !available.has(metricId) || !selected.has(metricId))
  ) {
    throw new PublishedAnalysisContextCompilationError(
      "PUBLISHED_ANALYSIS_CONTEXT_METRIC_NOT_RESOLVED",
    );
  }
  return requested;
}

function unqualifiedColumnId(tableId: string, columnId: string): string {
  const qualifiedPrefix = `${tableId}.`;
  return columnId.startsWith(qualifiedPrefix) ? columnId.slice(qualifiedPrefix.length) : columnId;
}

function resolveTimeDimensionRef(
  metric: SemanticExecutablePublicationProjection["metrics"][number],
  dimensionById: ReadonlyMap<string, SemanticExecutablePublicationProjection["dimensions"][number]>,
): string | null {
  if (metric.time_domain === null && metric.time_column_id === null) {
    return null;
  }
  if (metric.time_domain === null || metric.time_column_id === null) {
    throw new PublishedAnalysisContextCompilationError(
      "PUBLISHED_ANALYSIS_CONTEXT_METRIC_NOT_RESOLVED",
    );
  }

  const metricColumnId = unqualifiedColumnId(metric.table_id, metric.time_column_id);
  const candidates = metric.analysis.allowed_dimension_ids
    .map((dimensionId) => dimensionById.get(dimensionId))
    .filter((dimension) => dimension !== undefined)
    .filter(
      (dimension) =>
        dimension.table_id === metric.table_id &&
        unqualifiedColumnId(dimension.table_id, dimension.column_id) === metricColumnId &&
        (dimension.data_type === "date" || dimension.data_type === "timestamp") &&
        (dimension.sensitivity === "PUBLIC" || dimension.sensitivity === "INTERNAL"),
    );
  if (candidates.length !== 1) {
    throw new PublishedAnalysisContextCompilationError(
      "PUBLISHED_ANALYSIS_CONTEXT_METRIC_NOT_RESOLVED",
    );
  }
  return candidates[0]?.dimension_id ?? null;
}

/**
 * Compiles the run-bound analysis authority from the exact historical
 * publication projections already verified by the release read port.
 *
 * The semantic retrieval/inference closure selects the eligible metrics. The
 * compiler never receives an evaluation case id and cannot route by question
 * keywords.
 */
export async function compilePublishedAnalysisContext(
  input: CompilePublishedAnalysisContextInput,
): Promise<AnalysisContext> {
  const committed = await verifySemanticContextCommitResult(input.semantic_context);
  const packageDocument = committed.package;
  if (
    committed.receipt.consumer !== "RUN" ||
    committed.receipt.run_id !== input.run_id ||
    !["READY", "PARTIAL"].includes(packageDocument.route_decision.state)
  ) {
    throw new PublishedAnalysisContextCompilationError(
      "PUBLISHED_ANALYSIS_CONTEXT_AUTHORITY_INVALID",
    );
  }
  if (
    input.catalog.release_identity.semantic_domain !== packageDocument.semantic_domain ||
    input.catalog.release_identity.release_id !== packageDocument.semantic_release.resource_id ||
    input.catalog.release_identity.release_digest !== packageDocument.semantic_release.resource_hash
  ) {
    throw new PublishedAnalysisContextCompilationError(
      "PUBLISHED_ANALYSIS_CONTEXT_RELEASE_MISMATCH",
    );
  }

  const selected = selectedSemanticObjects(committed);
  const metricIds = requestedMetricIds(input, selected);
  const semanticReleaseRef = resourceReference(
    "SemanticRelease",
    packageDocument.semantic_release,
    committed,
    input.run_id,
  );
  const dimensionById = new Map(
    input.catalog.executable.dimensions.map((dimension) => [dimension.dimension_id, dimension]),
  );
  const formulaById = new Map(
    input.catalog.executable.formulas.map((formula) => [formula.node_id, formula]),
  );
  const metrics = await Promise.all(
    metricIds.map(async (metricId) => {
      const metric = input.catalog.executable.metrics.find(
        ({ metric_id: candidateId }) => candidateId === metricId,
      );
      if (!metric) {
        throw new PublishedAnalysisContextCompilationError(
          "PUBLISHED_ANALYSIS_CONTEXT_METRIC_NOT_RESOLVED",
        );
      }
      const formula = metric.formula ? (formulaById.get(metric.formula.formula_id) ?? null) : null;
      const timeDimensionRef = resolveTimeDimensionRef(metric, dimensionById);
      return {
        metric_ref: { container_ref: semanticReleaseRef, node_id: metric.metric_id },
        formula_hash: await sha256ContentHash({
          semantic_release_hash: packageDocument.semantic_release.resource_hash,
          metric: {
            metric_id: metric.metric_id,
            aggregation: metric.aggregation,
            formula: metric.formula,
            dependency_column_ids: metric.dependency_column_ids,
          },
          formula,
        }),
        unit: metric.unit,
        grain: metric.grain,
        time_domain: metric.time_domain,
        time_dimension_ref: timeDimensionRef,
        additivity: metric.additivity,
        null_policy: metric.null_policy,
        missing_period_policy: metric.analysis.missing_period_policy,
        seasonality: metric.analysis.seasonality,
        priority: metric.analysis.priority,
        causal_role: metric.analysis.causal_role,
        allowed_dimensions: metric.analysis.allowed_dimension_ids
          .map((dimensionId) => dimensionById.get(dimensionId))
          .filter((dimension) => dimension !== undefined)
          .filter(({ sensitivity }) => sensitivity === "PUBLIC" || sensitivity === "INTERNAL")
          .map((dimension) => ({
            dimension_id: dimension.dimension_id,
            grain: dimension.grain,
            data_type: dimension.data_type,
            sensitivity: dimension.sensitivity,
            groupable: dimension.analysis.groupable,
            pivotable: dimension.analysis.pivotable,
            causal_role: dimension.analysis.causal_role,
          })),
        analysis_capabilities: metric.analysis.capabilities,
      };
    }),
  );
  const metricTables = new Set(
    input.catalog.executable.metrics
      .filter(({ metric_id: metricId }) => metricIds.includes(metricId))
      .map(({ table_id: tableId }) => tableId),
  );

  return buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope: packageDocument.scope,
    semantic_context_binding: {
      package_id: packageDocument.package_id,
      package_hash: packageDocument.package_hash,
      receipt_id: committed.receipt.receipt_id,
      receipt_hash: committed.receipt.receipt_hash,
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: resourceReference(
      "SchemaSnapshot",
      packageDocument.schema_snapshot,
      committed,
      input.run_id,
    ),
    policy_receipt_ref: resourceReference(
      "PolicyReceipt",
      packageDocument.context_policy,
      committed,
      input.run_id,
    ),
    semantic_retrieval_receipt_hash: packageDocument.retrieval_receipt.receipt_hash,
    semantic_inference_receipt_hash: packageDocument.inference_receipt.receipt_hash,
    metrics,
    relationships: input.catalog.relationships.relationships
      .filter(
        (relationship) =>
          relationship.analysis.join_allowed &&
          relationship.proof_kind !== "DECLARED_ONLY" &&
          (selected.has(relationship.relationship_id) ||
            metricTables.has(relationship.left_table_id) ||
            metricTables.has(relationship.right_table_id)),
      )
      .map((relationship) => ({
        relationship_id: relationship.relationship_id,
        left_table_id: relationship.left_table_id,
        right_table_id: relationship.right_table_id,
        cardinality: relationship.cardinality,
        fanout_closed: relationship.analysis.fanout_closed,
        ontology_path: relationship.analysis.ontology_path,
      }))
      .sort((left, right) => left.relationship_id.localeCompare(right.relationship_id)),
    causal_policy: null,
  });
}

export const publishedAnalysisContextCompilerInternals = Object.freeze({
  requestedMetricIds,
  resolveTimeDimensionRef,
  selectedSemanticObjects,
});
