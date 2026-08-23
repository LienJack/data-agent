import {
  type AnalysisCapability,
  type AnalysisContext,
  type ArtifactReference,
  artifactReferenceIdentity,
  assertSemanticSourceBundleInvariants,
  buildAnalysisContext,
  computeSemanticSourceBundleHash,
  type OntologyAnalysisSourceBinding,
  type SemanticContextPackage,
  type SemanticContextReceipt,
  type SemanticSourceBundle,
  sha256ContentHash,
  verifyOntologyAnalysisSourceBinding,
  verifySemanticContextPackage,
  verifySemanticContextReceipt,
} from "@data-agent/contracts";
import {
  ContributionLoweringStatus,
  lowerDescriptiveContributionProfile,
} from "../compiler/contribution-profile-compiler.js";

export type AnalysisContextCompilationErrorCode =
  | "ANALYSIS_CONTEXT_NOT_READY"
  | "ANALYSIS_CONTEXT_SCOPE_MISMATCH"
  | "ANALYSIS_CONTEXT_RELEASE_STALE"
  | "ANALYSIS_CONTEXT_SCHEMA_STALE"
  | "ANALYSIS_CONTEXT_POLICY_STALE"
  | "ANALYSIS_CONTEXT_SOURCE_BUNDLE_STALE"
  | "ANALYSIS_CONTEXT_ONTOLOGY_BINDING_STALE"
  | "ANALYSIS_CONTEXT_METRIC_NOT_RESOLVED"
  | "ANALYSIS_CONTEXT_CANDIDATE_FORBIDDEN";

export class AnalysisContextCompilationError extends TypeError {
  override readonly name = "AnalysisContextCompilationError";

  constructor(readonly code: AnalysisContextCompilationErrorCode) {
    super(code);
  }
}

const MAX_REQUESTED_ANALYSIS_METRICS = 16;

export interface CompileAnalysisContextInput {
  readonly package: SemanticContextPackage;
  readonly context_receipt: SemanticContextReceipt;
  readonly semantic_release_ref: ArtifactReference;
  readonly schema_snapshot_ref: ArtifactReference;
  readonly policy_receipt_ref: ArtifactReference;
  readonly semantic_source_bundle_ref: ArtifactReference;
  readonly semantic_source_bundle: SemanticSourceBundle;
  readonly ontology_analysis_binding: OntologyAnalysisSourceBinding;
  readonly requested_metric_ids: readonly string[];
}

function sameScope(reference: ArtifactReference, scope: SemanticContextPackage["scope"]): boolean {
  return (
    reference.app_id === scope.app_id &&
    reference.tenant_id === scope.tenant_id &&
    reference.environment === scope.environment
  );
}

function exactResourceReference(
  reference: ArtifactReference,
  resource: { resource_id: string; resource_revision: number; resource_hash: string },
): boolean {
  return (
    reference.artifact_id === resource.resource_id &&
    reference.revision === resource.resource_revision &&
    reference.content_hash === resource.resource_hash
  );
}

function effectiveCapabilities(
  metric: SemanticSourceBundle["metrics"][number],
  bundle: SemanticSourceBundle,
  contributionLowerable: boolean,
): AnalysisCapability[] {
  return metric.analysis.capabilities.filter((capability) => {
    switch (capability) {
      case "CONTRIBUTION":
      case "CONCENTRATION":
        return (
          metric.additivity === "additive" &&
          contributionLowerable &&
          (bundle.contribution_profile?.targets.some(
            ({ metric_ref }) => metric_ref === metric.metric_id,
          ) ??
            false)
        );
      case "TREND_CHANGE":
      case "ROBUST_ANOMALY":
        return metric.time_domain !== null && metric.time_column_id !== null;
      case "FORECAST":
        return (
          metric.time_domain !== null &&
          metric.time_column_id !== null &&
          metric.analysis.seasonality !== null
        );
      case "CAUSAL_IDENTIFICATION":
        return bundle.domain_causal_policy != null && metric.analysis.causal_role !== null;
      default:
        return true;
    }
  });
}

function hasLowerableContributionProfile(bundle: SemanticSourceBundle): boolean {
  if (!bundle.contribution_profile) return false;
  return (
    lowerDescriptiveContributionProfile(bundle, bundle.contribution_profile).status ===
    ContributionLoweringStatus.LOWERED
  );
}

export async function compileAnalysisContext(
  input: CompileAnalysisContextInput,
): Promise<AnalysisContext> {
  const [resolvedPackage, contextReceipt, ontologyBinding] = await Promise.all([
    verifySemanticContextPackage(input.package),
    verifySemanticContextReceipt(input.context_receipt),
    verifyOntologyAnalysisSourceBinding(input.ontology_analysis_binding),
  ]);
  if (
    !["READY", "PARTIAL"].includes(resolvedPackage.route_decision.state) ||
    contextReceipt.consumer !== "RUN" ||
    contextReceipt.run_id === null ||
    contextReceipt.state !== resolvedPackage.route_decision.state ||
    contextReceipt.route !== resolvedPackage.route_decision.route ||
    contextReceipt.package_ref.package_id !== resolvedPackage.package_id ||
    contextReceipt.package_ref.package_hash !== resolvedPackage.package_hash ||
    contextReceipt.authority_snapshot_hash !== resolvedPackage.authority_snapshot_hash
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_NOT_READY");
  }
  for (const reference of [
    input.semantic_release_ref,
    input.schema_snapshot_ref,
    input.policy_receipt_ref,
    input.semantic_source_bundle_ref,
  ]) {
    if (!sameScope(reference, resolvedPackage.scope)) {
      throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_SCOPE_MISMATCH");
    }
  }
  if (
    input.semantic_release_ref.artifact_type !== "SemanticRelease" ||
    !exactResourceReference(input.semantic_release_ref, resolvedPackage.semantic_release)
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_RELEASE_STALE");
  }
  if (
    input.schema_snapshot_ref.artifact_type !== "SchemaSnapshot" ||
    !exactResourceReference(input.schema_snapshot_ref, resolvedPackage.schema_snapshot)
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_SCHEMA_STALE");
  }
  if (
    input.policy_receipt_ref.artifact_type !== "PolicyReceipt" ||
    !exactResourceReference(input.policy_receipt_ref, resolvedPackage.context_policy)
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_POLICY_STALE");
  }

  const sourceBundle = input.semantic_source_bundle;
  assertSemanticSourceBundleInvariants(sourceBundle);
  const sourceBundleHash = await computeSemanticSourceBundleHash(sourceBundle);
  if (
    input.semantic_source_bundle_ref.artifact_type !== "SemanticSourceBundle" ||
    input.semantic_source_bundle_ref.content_hash !== sourceBundleHash
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_SOURCE_BUNDLE_STALE");
  }
  if (
    sourceBundle.metadata.scope.app_id !== resolvedPackage.scope.app_id ||
    sourceBundle.metadata.scope.tenant_id !== resolvedPackage.scope.tenant_id ||
    sourceBundle.metadata.scope.environment !== resolvedPackage.scope.environment
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_SCOPE_MISMATCH");
  }
  if (
    ontologyBinding.semantic_release_id !== resolvedPackage.semantic_release.resource_id ||
    ontologyBinding.semantic_release_revision !==
      resolvedPackage.semantic_release.resource_revision ||
    ontologyBinding.semantic_release_hash !== resolvedPackage.semantic_release.resource_hash ||
    ontologyBinding.semantic_source_bundle.source_id !==
      input.semantic_source_bundle_ref.artifact_id ||
    ontologyBinding.semantic_source_bundle.source_hash !== sourceBundleHash
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_ONTOLOGY_BINDING_STALE");
  }

  const publishedMetricIds = new Set(
    resolvedPackage.evidence
      .filter(({ evidence_kind }) => evidence_kind === "METRIC")
      .map(({ evidence_id }) => evidence_id),
  );
  if (resolvedPackage.route_decision.selected_metric_id) {
    publishedMetricIds.add(resolvedPackage.route_decision.selected_metric_id);
  }
  const requestedMetricIds =
    input.requested_metric_ids.length > 0
      ? [...new Set(input.requested_metric_ids)].sort()
      : [...publishedMetricIds].sort();
  if (
    requestedMetricIds.length === 0 ||
    requestedMetricIds.length > MAX_REQUESTED_ANALYSIS_METRICS ||
    requestedMetricIds.some((metricId) => !publishedMetricIds.has(metricId))
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_METRIC_NOT_RESOLVED");
  }

  const dimensionById = new Map(
    sourceBundle.dimensions.map((dimension) => [dimension.dimension_id, dimension]),
  );
  const metricById = new Map(sourceBundle.metrics.map((metric) => [metric.metric_id, metric]));
  const contributionLowerable = hasLowerableContributionProfile(sourceBundle);
  const metrics = await Promise.all(
    requestedMetricIds.map(async (metricId) => {
      const metric = metricById.get(metricId);
      if (!metric) {
        throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_CANDIDATE_FORBIDDEN");
      }
      const formulaSignature = sourceBundle.formulas.find(
        ({ formula_id }) => formula_id === metric.formula?.formula_id,
      );
      return {
        metric_ref: { container_ref: input.semantic_release_ref, node_id: metric.metric_id },
        formula_hash: await sha256ContentHash({
          formula: metric.formula,
          signature: formulaSignature ?? null,
        }),
        unit: metric.unit,
        grain: metric.grain,
        time_domain: metric.time_domain,
        time_dimension_ref: metric.time_column_id,
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
        analysis_capabilities: effectiveCapabilities(metric, sourceBundle, contributionLowerable),
      };
    }),
  );
  if (
    sourceBundle.domain_causal_policy?.policy_refs.some(
      (reference) =>
        reference.artifact_type !== "PolicyReceipt" || !sameScope(reference, resolvedPackage.scope),
    )
  ) {
    throw new AnalysisContextCompilationError("ANALYSIS_CONTEXT_POLICY_STALE");
  }

  return buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope: resolvedPackage.scope,
    semantic_context_binding: {
      package_id: resolvedPackage.package_id,
      package_hash: resolvedPackage.package_hash,
      receipt_id: contextReceipt.receipt_id,
      receipt_hash: contextReceipt.receipt_hash,
    },
    semantic_release_ref: input.semantic_release_ref,
    schema_snapshot_ref: input.schema_snapshot_ref,
    policy_receipt_ref: input.policy_receipt_ref,
    semantic_retrieval_receipt_hash: resolvedPackage.retrieval_receipt.receipt_hash,
    semantic_inference_receipt_hash: resolvedPackage.inference_receipt.receipt_hash,
    metrics,
    relationships: sourceBundle.relationships
      .filter(({ analysis, proof_kind }) => analysis.join_allowed && proof_kind !== "DECLARED_ONLY")
      .map((relationship) => ({
        relationship_id: relationship.relationship_id,
        left_table_id: relationship.left_table_id,
        right_table_id: relationship.right_table_id,
        cardinality: relationship.cardinality,
        fanout_closed: relationship.analysis.fanout_closed,
        ontology_path: relationship.analysis.ontology_path,
      }))
      .sort((left, right) => left.relationship_id.localeCompare(right.relationship_id)),
    causal_policy:
      sourceBundle.domain_causal_policy == null
        ? null
        : {
            ...sourceBundle.domain_causal_policy,
            policy_refs: [...sourceBundle.domain_causal_policy.policy_refs].sort((left, right) =>
              artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
            ),
            directed_edges: [...sourceBundle.domain_causal_policy.directed_edges].sort(
              (left, right) =>
                `${left.source_object_id}\0${left.target_object_id}\0${left.mechanism_ref}`.localeCompare(
                  `${right.source_object_id}\0${right.target_object_id}\0${right.mechanism_ref}`,
                ),
            ),
          },
  });
}

export const analysisContextCompilerInternals = Object.freeze({
  max_requested_analysis_metrics: MAX_REQUESTED_ANALYSIS_METRICS,
});
