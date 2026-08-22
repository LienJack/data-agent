import {
  type AnalysisContext,
  type AnalysisSandboxProgramPayload,
  type ArtifactReference,
  artifactReferenceIdentity,
  type CausalAttributionAuthorityClosure,
  type CausalEstimatePayload,
  type CausalQuestionPayload,
  type IdentificationCertificatePayload,
  type IdentificationPlanPayload,
  type RootCauseDiscoveryCandidatePayload,
  type RootCauseDiscoveryReceiptPayload,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  type CausalEstimateComputation,
  createCausalEstimate,
  createCausalQuestion,
  createIdentificationCertificate,
  createIdentificationPlan,
  createRootCauseDiscoveryCandidate,
  createRootCauseDiscoveryReceipt,
  type RootCauseFactorObservation,
} from "@data-agent/research";
import { ANALYSIS_RUNTIME_ATTESTATIONS } from "./skill-catalog.js";

type RootCauseArtifactPayload =
  | RootCauseDiscoveryCandidatePayload
  | RootCauseDiscoveryReceiptPayload
  | CausalQuestionPayload
  | IdentificationPlanPayload
  | CausalEstimatePayload
  | IdentificationCertificatePayload;

export interface RootCauseArtifactAuthorityPort {
  commit(input: {
    readonly payload: RootCauseArtifactPayload;
    readonly idempotency_key: string;
  }): Promise<ArtifactReference>;
}

export interface CausalIdentificationSandboxPort {
  execute(input: {
    readonly context: AnalysisContext;
    readonly analysis_plan_ref: ArtifactReference;
    readonly question: CausalQuestionPayload;
    readonly question_ref: ArtifactReference;
    readonly plan: IdentificationPlanPayload;
    readonly plan_ref: ArtifactReference;
  }): Promise<{
    readonly program: AnalysisSandboxProgramPayload;
    readonly program_ref: ArtifactReference;
    readonly execution_receipt_ref: ArtifactReference;
    readonly result_refs: readonly ArtifactReference[];
    readonly computation: CausalEstimateComputation;
  }>;
}

export interface CausalAttributionAuthorityPort {
  resolve(input: {
    readonly context: AnalysisContext;
    readonly question: CausalQuestionPayload;
    readonly question_ref: ArtifactReference;
    readonly plan: IdentificationPlanPayload;
    readonly plan_ref: ArtifactReference;
  }): Promise<CausalAttributionAuthorityClosure>;
}

export interface RootCauseExecutionInput {
  readonly mode: "L4_DISCOVERY" | "L5_CAUSAL";
  readonly now: Date;
  readonly context: AnalysisContext;
  readonly plan_ref: ArtifactReference;
  readonly source_evidence_refs: readonly ArtifactReference[];
  readonly outcome_metric_ref: RootCauseDiscoveryCandidatePayload["outcome_metric_ref"];
  readonly observations: readonly RootCauseFactorObservation[];
  readonly treatment_object_id?: string;
  readonly population?: string;
  readonly estimand?: CausalQuestionPayload["estimand"];
  readonly time_zero?: string;
  readonly intervention_semantics_ref?: string;
  readonly target_window?: CausalQuestionPayload["target_window"];
  readonly estimator?: IdentificationPlanPayload["estimator"];
}

export type RootCauseExecutionResult =
  | {
      readonly status: "L4_CANDIDATE" | "HOLD";
      readonly candidate_ref: ArtifactReference;
      readonly discovery_receipt_ref: ArtifactReference;
      readonly question_ref: null;
      readonly plan_ref: null;
      readonly estimate_ref: null;
      readonly certificate_ref: null;
    }
  | {
      readonly status: "CERTIFIED" | "HOLD";
      readonly candidate_ref: ArtifactReference;
      readonly discovery_receipt_ref: ArtifactReference;
      readonly question_ref: ArtifactReference;
      readonly plan_ref: ArtifactReference;
      readonly estimate_ref: ArtifactReference;
      readonly certificate_ref: ArtifactReference;
    };

function exactScope(left: ArtifactReference, right: ArtifactReference) {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

export function createRootCauseExecutor(dependencies: {
  readonly artifacts: RootCauseArtifactAuthorityPort;
  readonly sandbox: CausalIdentificationSandboxPort;
  readonly attribution: CausalAttributionAuthorityPort;
}) {
  const commit = async (
    payload: RootCauseArtifactPayload,
    planRef: ArtifactReference,
    idempotencyKey: string,
  ) => {
    const reference = await dependencies.artifacts.commit({
      payload,
      idempotency_key: idempotencyKey,
    });
    if (
      reference.artifact_type !== payload.artifact_type ||
      !exactScope(reference, planRef) ||
      reference.content_hash !== (await sha256ContentHash(payload))
    ) {
      throw new TypeError("ROOT_CAUSE_ARTIFACT_COMMIT_CORRELATION_INVALID");
    }
    return reference;
  };

  return Object.freeze({
    async execute(input: RootCauseExecutionInput): Promise<RootCauseExecutionResult> {
      const candidate = await createRootCauseDiscoveryCandidate({
        context: input.context,
        plan_ref: input.plan_ref,
        source_evidence_refs: input.source_evidence_refs,
        outcome_metric_ref: input.outcome_metric_ref,
        observations: input.observations,
      });
      const candidateRef = await commit(
        candidate,
        input.plan_ref,
        `root-cause-candidate:${candidate.candidate_hash}`,
      );
      const receipt = await createRootCauseDiscoveryReceipt({
        context: input.context,
        candidate,
        candidate_ref: candidateRef,
      });
      const receiptRef = await commit(
        receipt,
        input.plan_ref,
        `root-cause-receipt:${receipt.receipt_hash}`,
      );
      if (input.mode === "L4_DISCOVERY" || receipt.validation_verdict !== "PASS") {
        return Object.freeze({
          status:
            input.mode === "L4_DISCOVERY" && receipt.validation_verdict === "PASS"
              ? "L4_CANDIDATE"
              : "HOLD",
          candidate_ref: candidateRef,
          discovery_receipt_ref: receiptRef,
          question_ref: null,
          plan_ref: null,
          estimate_ref: null,
          certificate_ref: null,
        });
      }
      if (
        !input.treatment_object_id ||
        !input.population ||
        !input.estimand ||
        !input.time_zero ||
        !input.intervention_semantics_ref ||
        !input.target_window ||
        !input.estimator
      ) {
        throw new TypeError("CAUSAL_IDENTIFICATION_INPUT_REQUIRED");
      }
      const question = await createCausalQuestion({
        context: input.context,
        candidate,
        candidate_ref: candidateRef,
        treatment_object_id: input.treatment_object_id,
        population: input.population,
        estimand: input.estimand,
        time_zero: input.time_zero,
        intervention_semantics_ref: input.intervention_semantics_ref,
        target_window: input.target_window,
      });
      const questionRef = await commit(
        question,
        input.plan_ref,
        `causal-question:${question.question_hash}`,
      );
      const attestation = ANALYSIS_RUNTIME_ATTESTATIONS.CAUSAL_L5;
      const identificationPlan = await createIdentificationPlan({
        context: input.context,
        question,
        question_ref: questionRef,
        candidate,
        receipt,
        receipt_ref: receiptRef,
        estimator: input.estimator,
        runtime_digest: attestation.runtime_digest,
        dependency_lock_digest: attestation.dependency_lock_digest,
      });
      const identificationPlanRef = await commit(
        identificationPlan,
        input.plan_ref,
        `identification-plan:${identificationPlan.plan_hash}`,
      );
      const authority = await dependencies.attribution.resolve({
        context: input.context,
        question,
        question_ref: questionRef,
        plan: identificationPlan,
        plan_ref: identificationPlanRef,
      });
      const execution = await dependencies.sandbox.execute({
        context: input.context,
        analysis_plan_ref: input.plan_ref,
        question,
        question_ref: questionRef,
        plan: identificationPlan,
        plan_ref: identificationPlanRef,
      });
      if (
        execution.program.import_profile !== "CAUSAL_L5" ||
        execution.program.runtime_digest !== attestation.runtime_digest ||
        execution.program.dependency_lock_digest !== attestation.dependency_lock_digest ||
        execution.program_ref.artifact_type !== "SandboxProgram" ||
        execution.program.plan_ref.artifact_type !== "AnalysisPlan" ||
        artifactReferenceIdentity(execution.program.plan_ref) !==
          artifactReferenceIdentity(input.plan_ref) ||
        !exactScope(execution.program_ref, input.plan_ref) ||
        execution.program_ref.content_hash !== (await sha256ContentHash(execution.program))
      ) {
        throw new TypeError("CAUSAL_SANDBOX_ATTESTATION_INVALID");
      }
      const estimate = await createCausalEstimate({
        question,
        question_ref: questionRef,
        plan: identificationPlan,
        plan_ref: identificationPlanRef,
        sandbox_program_ref: execution.program_ref,
        sandbox_execution_receipt_ref: execution.execution_receipt_ref,
        sandbox_result_refs: execution.result_refs,
        computation: execution.computation,
      });
      const estimateRef = await commit(
        estimate,
        input.plan_ref,
        `causal-estimate:${estimate.estimate_hash}`,
      );
      const certificate = await createIdentificationCertificate({
        now: input.now,
        context: input.context,
        question,
        question_ref: questionRef,
        plan: identificationPlan,
        plan_ref: identificationPlanRef,
        estimate,
        estimate_ref: estimateRef,
        receipt_ref: receiptRef,
        program: execution.program,
        authority,
      });
      const certificateRef = await commit(
        certificate,
        input.plan_ref,
        `identification-certificate:${certificate.certificate_hash}`,
      );
      return Object.freeze({
        status: certificate.verdict,
        candidate_ref: candidateRef,
        discovery_receipt_ref: receiptRef,
        question_ref: questionRef,
        plan_ref: identificationPlanRef,
        estimate_ref: estimateRef,
        certificate_ref: certificateRef,
      });
    },
  });
}
