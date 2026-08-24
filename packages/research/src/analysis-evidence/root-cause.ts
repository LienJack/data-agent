import {
  type AnalysisContext,
  type ArtifactReference,
  artifactReferenceIdentity,
  type RootCauseDiscoveryCandidatePayload,
  type RootCauseDiscoveryReceiptPayload,
  rootCauseDiscoveryCandidatePayloadSchema,
  rootCauseDiscoveryReceiptPayloadSchema,
  sha256ContentHash,
  verifyAnalysisContext,
} from "@data-agent/contracts";

export interface RootCauseFactorObservation {
  readonly factor_id: string;
  readonly factor_kind: "METRIC" | "DIMENSION" | "EVENT" | "RELATIONSHIP";
  readonly ontology_path: readonly string[];
  readonly temporal_order: "PRECEDES" | "SAME_WINDOW" | "UNKNOWN";
  readonly method: string;
  readonly effect_direction: "POSITIVE" | "NEGATIVE" | "ZERO" | "UNKNOWN";
  readonly effect_size: number | null;
  readonly interval_low: number | null;
  readonly interval_high: number | null;
  readonly raw_p_value: number | null;
  readonly sample_size: number;
  readonly competing_explanations: readonly string[];
  readonly uncovered_boundaries: readonly string[];
}

function sameScope(reference: ArtifactReference, scope: AnalysisContext["scope"], runId: string) {
  return (
    reference.app_id === scope.app_id &&
    reference.tenant_id === scope.tenant_id &&
    reference.environment === scope.environment &&
    reference.run_id === runId
  );
}

function ontologyPaths(context: AnalysisContext): ReadonlySet<string> {
  return new Set([
    ...context.relationships.map(({ ontology_path }) => ontology_path.join("\0")),
    ...(context.causal_policy?.directed_edges.map(({ ontology_path }) =>
      ontology_path.join("\0"),
    ) ?? []),
  ]);
}

function knownFactor(context: AnalysisContext, factorId: string): boolean {
  return context.metrics.some(
    ({ metric_ref, allowed_dimensions }) =>
      metric_ref.node_id === factorId ||
      allowed_dimensions.some(({ dimension_id }) => dimension_id === factorId),
  );
}

export async function computeRootCauseCandidateHash(
  input: Omit<RootCauseDiscoveryCandidatePayload, "candidate_hash">,
) {
  return sha256ContentHash({ hash_domain: "root-cause-discovery@1.0.0", value: input });
}

export async function createRootCauseDiscoveryCandidate(input: {
  readonly context: AnalysisContext;
  readonly plan_ref: ArtifactReference;
  readonly source_evidence_refs: readonly ArtifactReference[];
  readonly outcome_metric_ref: RootCauseDiscoveryCandidatePayload["outcome_metric_ref"];
  readonly candidate_kind?: RootCauseDiscoveryCandidatePayload["candidate_kind"];
  readonly observations: readonly RootCauseFactorObservation[];
  readonly maximum_candidates?: number;
}): Promise<RootCauseDiscoveryCandidatePayload> {
  const context = await verifyAnalysisContext(input.context);
  const maximumCandidates = Math.min(64, Math.max(1, input.maximum_candidates ?? 16));
  if (
    input.plan_ref.artifact_type !== "AnalysisProgram" ||
    !sameScope(input.plan_ref, context.scope, input.plan_ref.run_id) ||
    input.source_evidence_refs.length === 0 ||
    input.source_evidence_refs.some(
      (reference) =>
        !sameScope(reference, context.scope, input.plan_ref.run_id) ||
        !["QueryEvidence", "DerivedAnalysisEvidence"].includes(reference.artifact_type),
    ) ||
    !context.metrics.some(
      ({ metric_ref }) =>
        metric_ref.node_id === input.outcome_metric_ref.node_id &&
        artifactReferenceIdentity(metric_ref.container_ref) ===
          artifactReferenceIdentity(input.outcome_metric_ref.container_ref),
    )
  ) {
    throw new TypeError("ROOT_CAUSE_INPUT_CLOSURE_INVALID");
  }
  if (input.observations.length === 0 || input.observations.length > 64) {
    throw new TypeError("ROOT_CAUSE_UNIVERSE_BOUNDS_INVALID");
  }
  const planRef = input.plan_ref as RootCauseDiscoveryCandidatePayload["analysis_program_ref"];
  const sourceEvidenceRefs =
    input.source_evidence_refs as RootCauseDiscoveryCandidatePayload["source_evidence_refs"];
  const paths = ontologyPaths(context);
  const hypothesisCount = input.observations.length;
  const candidates = input.observations
    .map((observation) => {
      if (
        !knownFactor(context, observation.factor_id) ||
        !paths.has(observation.ontology_path.join("\0")) ||
        observation.competing_explanations.length === 0 ||
        observation.uncovered_boundaries.length === 0
      ) {
        throw new TypeError("ROOT_CAUSE_ONTOLOGY_GROUNDING_INVALID");
      }
      const adjusted =
        observation.raw_p_value === null
          ? null
          : Math.min(1, observation.raw_p_value * hypothesisCount);
      return {
        factor_id: observation.factor_id,
        factor_kind: observation.factor_kind,
        ontology_path: [...observation.ontology_path],
        temporal_order: observation.temporal_order,
        statistical_support: {
          method: observation.method,
          effect_direction: observation.effect_direction,
          effect_size: observation.effect_size,
          interval_low: observation.interval_low,
          interval_high: observation.interval_high,
          raw_p_value: observation.raw_p_value,
          adjusted_p_value: adjusted,
          sample_size: observation.sample_size,
        },
        competing_explanations: [...observation.competing_explanations],
        uncovered_boundaries: [...observation.uncovered_boundaries],
      };
    })
    .sort((left, right) => {
      const p =
        (left.statistical_support.adjusted_p_value ?? 1) -
        (right.statistical_support.adjusted_p_value ?? 1);
      if (p !== 0) return p;
      const effect =
        Math.abs(right.statistical_support.effect_size ?? 0) -
        Math.abs(left.statistical_support.effect_size ?? 0);
      return effect !== 0 ? effect : left.factor_id.localeCompare(right.factor_id);
    })
    .slice(0, maximumCandidates);
  const limitationCodes: RootCauseDiscoveryCandidatePayload["limitation_codes"] = candidates.some(
    ({ temporal_order, statistical_support }) =>
      temporal_order !== "PRECEDES" ||
      statistical_support.adjusted_p_value === null ||
      statistical_support.adjusted_p_value > 0.05,
  )
    ? ["ROOT_CAUSE_NOT_IDENTIFIABLE"]
    : [];
  const material: Omit<RootCauseDiscoveryCandidatePayload, "candidate_hash"> = {
    artifact_type: "DiscoveryCandidate",
    protocol_version: "root-cause-discovery@1.0.0",
    analysis_program_ref: planRef,
    analysis_context_hash: context.context_hash,
    source_evidence_refs: [...sourceEvidenceRefs].sort((left, right) =>
      artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
    ),
    outcome_metric_ref: input.outcome_metric_ref,
    candidate_kind: input.candidate_kind ?? "ROOT_CAUSE",
    candidates,
    evidence_level: "L4_DISCOVERY",
    multiple_testing_policy_version: "bonferroni@1.0.0",
    limitation_codes: limitationCodes,
  };
  return rootCauseDiscoveryCandidatePayloadSchema.parse({
    ...material,
    candidate_hash: await computeRootCauseCandidateHash(material),
  });
}

export async function computeRootCauseReceiptHash(
  input: Omit<RootCauseDiscoveryReceiptPayload, "receipt_hash">,
) {
  return sha256ContentHash({
    hash_domain: "root-cause-discovery-receipt@1.0.0",
    value: input,
  });
}

export async function createRootCauseDiscoveryReceipt(input: {
  readonly context: AnalysisContext;
  readonly candidate: RootCauseDiscoveryCandidatePayload;
  readonly candidate_ref: ArtifactReference;
}): Promise<RootCauseDiscoveryReceiptPayload> {
  const context = await verifyAnalysisContext(input.context);
  const candidate = rootCauseDiscoveryCandidatePayloadSchema.parse(input.candidate);
  const { candidate_hash: _candidateHash, ...candidateMaterial } = candidate;
  if (
    input.candidate_ref.artifact_type !== "DiscoveryCandidate" ||
    !sameScope(input.candidate_ref, context.scope, candidate.analysis_program_ref.run_id) ||
    input.candidate_ref.content_hash !== (await sha256ContentHash(candidate)) ||
    candidate.analysis_context_hash !== context.context_hash ||
    candidate.candidate_hash !== (await computeRootCauseCandidateHash(candidateMaterial))
  ) {
    throw new TypeError("ROOT_CAUSE_CANDIDATE_CURRENTNESS_INVALID");
  }
  const multipleTestingPass = candidate.candidates.every(
    ({ statistical_support }) =>
      statistical_support.adjusted_p_value !== null && statistical_support.adjusted_p_value <= 0.05,
  );
  const temporalPass = candidate.candidates.every(
    ({ temporal_order }) => temporal_order === "PRECEDES",
  );
  const validationPass = multipleTestingPass && temporalPass;
  const candidateRef = input.candidate_ref as RootCauseDiscoveryReceiptPayload["candidate_ref"];
  const material: Omit<RootCauseDiscoveryReceiptPayload, "receipt_hash"> = {
    artifact_type: "DiscoveryReceipt",
    protocol_version: "root-cause-discovery-receipt@1.0.0",
    candidate_ref: candidateRef,
    frontier: {
      semantic_release_ref: context.semantic_release_ref,
      schema_snapshot_ref: context.schema_snapshot_ref,
      policy_receipt_ref: context.policy_receipt_ref,
      analysis_context_hash: context.context_hash,
      runtime_profile: null,
      agent_image: null,
      operator_image: null,
    },
    input_closure_hash: await sha256ContentHash({
      candidate_ref: candidateRef,
      source_evidence_refs: candidate.source_evidence_refs,
    }),
    novelty_verdict: "PASS",
    multiple_testing_verdict: multipleTestingPass ? "PASS" : "HOLD",
    temporal_order_verdict: temporalPass ? "PASS" : "HOLD",
    validation_verdict: validationPass ? "PASS" : "HOLD",
    reason_codes: validationPass ? [] : ["ROOT_CAUSE_NOT_IDENTIFIABLE"],
  };
  return rootCauseDiscoveryReceiptPayloadSchema.parse({
    ...material,
    receipt_hash: await computeRootCauseReceiptHash(material),
  });
}
