import type {
  AnalysisReportV2Payload,
  CoverageStatePayload,
  EvidenceGateReceiptPayload,
  ReportManifestV2Payload,
  ReportProjectionReceiptPayload,
  ReportReadyCertificateV3Payload,
  ResearchStopDecisionPayload,
  U6ResearchReasonCode,
} from "@data-agent/contracts";
import type { HypothesisObservationStatus } from "./observation.js";

export interface ResearchProtocolHypothesisInput {
  readonly hypothesis_id: string;
  readonly metric_alias: "promotion_decline_share" | "late_refund_decline_share";
  readonly support_predicate:
    | { readonly operator: "GTE"; readonly threshold: number }
    | { readonly operator: "LTE"; readonly threshold: number };
  readonly refute_predicate:
    | { readonly operator: "GTE"; readonly threshold: number }
    | { readonly operator: "LTE"; readonly threshold: number };
}

export interface ResearchProtocolObservationInput {
  readonly q1: {
    readonly baseline_net_revenue: number;
    readonly current_net_revenue: number;
    readonly decline_amount: number;
    readonly promotion_contribution: number;
    readonly late_refund_contribution: number;
    readonly other_contribution: number;
  };
  readonly q2: {
    readonly promotion_decline_share: number;
    readonly late_refund_decline_share: number;
  };
  readonly q1_snapshot_token: string;
  readonly q2_snapshot_token: string;
  readonly q2_dependency_query_ids: readonly string[];
}

export interface ResearchProtocolEvidenceFacts {
  readonly deterministic_check_observed_hash: string;
  readonly deterministic_check_expected_hash: string;
  readonly material_conflict_count: number;
  readonly disclosed_material_conflict_count: number;
  readonly critical_query_execution_status: "SUCCEEDED" | "FAILED";
  readonly observed_schema_revision: number;
  readonly current_schema_revision: number;
  readonly writer_projection_mode: "DETERMINISTIC" | "FREEFORM";
  readonly provenance_groups: readonly string[];
  readonly source_independence_mode:
    | "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE"
    | "MULTI_PROVENANCE_REQUIRED";
  readonly minimum_provenance_groups: number;
  readonly query_metric_id: string;
  readonly obligation_metric_id: string;
  readonly query_filter_hash: string;
  readonly obligation_filter_hash: string;
  readonly report_disclosures: readonly string[];
  readonly remaining_budget_steps: number;
  readonly required_followup_budget_steps: number;
}

export interface ResearchProtocolNextQueryFacts {
  readonly query_present: boolean;
  readonly semantic_admissible: boolean;
  readonly information_gain_microunits: number;
  readonly required_budget_steps: number;
  readonly waiting_on_codes: readonly string[];
  readonly replan_trigger: "PLAN_INVALIDATED" | null;
  readonly budget_top_up_allowed: boolean;
}

export interface ResearchProtocolBoundaryFacts {
  readonly issuer_role: "READINESS_AUTHORITY" | "SUPERVISOR";
  readonly closure_hash_transport: "UNCHANGED" | "ZEROED";
  readonly semantic_hash_transport: "UNCHANGED" | "REPLACED";
  readonly revocation_event_seq: number | null;
  readonly consumption_event_seq: number;
}

export interface ResearchProtocolInput {
  readonly observations: ResearchProtocolObservationInput;
  readonly hypotheses: readonly ResearchProtocolHypothesisInput[];
  readonly evidence_facts: ResearchProtocolEvidenceFacts;
  readonly next_query_facts: ResearchProtocolNextQueryFacts;
  readonly boundary_facts: ResearchProtocolBoundaryFacts;
}

export interface ProtocolHypothesisAssessment {
  readonly hypothesis_id: string;
  readonly status: HypothesisObservationStatus;
}

export type ResearchProtocolStopDecision =
  | "CONTINUE"
  | "REPLAN"
  | "STOP_READY"
  | "STOP_PARTIAL"
  | "STOP_NEEDS_MORE_RESEARCH"
  | "STOP_INCONCLUSIVE";

export type NonReadyTerminalCandidate = "PARTIAL" | "NEEDS_MORE_RESEARCH" | "INCONCLUSIVE";

export type ResearchProtocolKernelOutcome =
  | {
      readonly kind: "REPORT_READY_CANDIDATE";
      readonly reason_code: "OBLIGATION_SATISFIED";
      readonly report_ready_candidate_eligible: true;
    }
  | {
      readonly kind: "RESEARCH_STOP_CANDIDATE";
      readonly reason_code: U6ResearchReasonCode;
      readonly terminal_candidate: {
        readonly terminal: NonReadyTerminalCandidate;
        readonly commitment: "NOT_COMMITTED";
      } | null;
    }
  | {
      readonly kind: "REVOCATION_REQUIRED";
      readonly reason_code:
        | "EVIDENCE_REVISION_STALE"
        | "DATA_SNAPSHOT_STALE"
        | "READINESS_REVOKED_DURING_CONSUMPTION";
      readonly required_platform_transition: "REVOCATION_TRANSACTION";
      readonly verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION";
    }
  | {
      readonly kind: "RUNTIME_FAILURE_REQUIRED";
      readonly reason_code: "REPORT_PROJECTION_AUTHORITY_INVALID";
      readonly required_platform_transition: "RUNTIME_FAILURE_TRANSACTION";
      readonly verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION";
    }
  | {
      readonly kind: "READINESS_REJECTED";
      readonly reason_code:
        | "REPORT_READY_AUTHORITY_REQUIRED"
        | "REPORT_READY_CERTIFICATE_TAMPERED"
        | "CERTIFICATE_SEMANTIC_HASH_MISMATCH";
      readonly verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION";
    }
  | {
      readonly kind: "REJECTED";
      readonly reason_code:
        | "ATOMIC_CLAIM_OBSERVATION_MISMATCH"
        | "RESEARCH_STOP_INPUT_INCONSISTENT";
    };

export interface ResearchProtocolEvaluation {
  readonly hypothesis_assessments: readonly ProtocolHypothesisAssessment[];
  readonly stop_decision_candidate: ResearchProtocolStopDecision | null;
  readonly kernel_outcome: ResearchProtocolKernelOutcome;
  readonly kernel_trace: readonly (
    | "OBSERVATION"
    | "COVERAGE"
    | "STOP"
    | "REPORTING"
    | "READINESS"
  )[];
  readonly artifact_candidates: {
    readonly coverage?: CoverageStatePayload;
    readonly stop?: ResearchStopDecisionPayload | null;
    readonly manifest?: ReportManifestV2Payload;
    readonly report?: AnalysisReportV2Payload;
    readonly projection_receipt?: ReportProjectionReceiptPayload;
    readonly gates?: {
      readonly support: EvidenceGateReceiptPayload;
      readonly conflict: EvidenceGateReceiptPayload;
      readonly freshness: EvidenceGateReceiptPayload;
      readonly source_independence: EvidenceGateReceiptPayload;
    };
    readonly report_ready?: ReportReadyCertificateV3Payload;
  };
}
