import {
  deepFreeze,
  type ReportReadyCertificateV3Payload,
  type ResearchStopDecisionPayload,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "../errors.js";
import type { ResearchProtocolEvaluation } from "../protocol.js";
import { isControlledKernelEvaluation } from "./controlled-composition.js";

declare const researchKernelCandidateAuthorityBrand: unique symbol;
declare const kernelVerifiedReportReadyCandidateBrand: unique symbol;

/**
 * 只在当前进程确认「该候选来自 Research Kernel」的不可克隆能力。
 *
 * 它不代表数据库持久化、Public READY、CurrentReadiness 或 Run Grant 权限。
 */
export interface ResearchKernelCandidateAuthority {
  readonly scope: "KERNEL_CANDIDATE_ONLY";
  readonly persistence_authority: "NONE";
  readonly can_commit_public_terminal: false;
  readonly [researchKernelCandidateAuthorityBrand]: true;
}

export interface KernelVerifiedReportReadyCandidate {
  readonly report_ready_candidate: ReportReadyCertificateV3Payload;
  readonly stop_candidate: Extract<
    ResearchStopDecisionPayload,
    { readonly decision: "STOP_READY" }
  >;
  readonly verification_scope: "KERNEL_CANDIDATE_ONLY";
  readonly persistence_authority: "NONE";
  readonly can_commit_public_terminal: false;
  readonly [kernelVerifiedReportReadyCandidateBrand]: true;
}

export interface KernelVerifiedCandidateMetadata {
  readonly kernel_trace: ResearchProtocolEvaluation["kernel_trace"];
  readonly verification_scope: "KERNEL_CANDIDATE_ONLY";
  readonly persistence_authority: "NONE";
  readonly can_commit_public_terminal: false;
}

const candidateAuthorities = new WeakSet<object>();
const verifiedCandidates = new WeakSet<object>();
const verifiedCandidateMetadata = new WeakMap<object, KernelVerifiedCandidateMetadata>();

export function createResearchKernelCandidateAuthority(): ResearchKernelCandidateAuthority {
  const authority = deepFreeze({
    scope: "KERNEL_CANDIDATE_ONLY",
    persistence_authority: "NONE",
    can_commit_public_terminal: false,
  }) as ResearchKernelCandidateAuthority;
  candidateAuthorities.add(authority);
  return authority;
}

export function isResearchKernelCandidateAuthority(
  value: unknown,
): value is ResearchKernelCandidateAuthority {
  return typeof value === "object" && value !== null && candidateAuthorities.has(value);
}

function isCompleteReportReadyEvaluation(
  evaluation: ResearchProtocolEvaluation,
): evaluation is ResearchProtocolEvaluation & {
  readonly artifact_candidates: {
    readonly stop: Extract<ResearchStopDecisionPayload, { readonly decision: "STOP_READY" }>;
    readonly report_ready: ReportReadyCertificateV3Payload;
  };
} {
  const { artifact_candidates: artifacts } = evaluation;
  return (
    evaluation.kernel_outcome.kind === "REPORT_READY_CANDIDATE" &&
    evaluation.kernel_trace.includes("REPORTING") &&
    evaluation.kernel_trace.includes("READINESS") &&
    artifacts.stop?.decision === "STOP_READY" &&
    artifacts.manifest !== undefined &&
    artifacts.report !== undefined &&
    artifacts.projection_receipt !== undefined &&
    artifacts.gates !== undefined &&
    Object.values(artifacts.gates).every(({ verdict }) => verdict === "PASS") &&
    artifacts.report_ready !== undefined
  );
}

export function sealKernelVerifiedReportReadyCandidate(
  authority: ResearchKernelCandidateAuthority,
  evaluation: ResearchProtocolEvaluation,
): ResearchKernelResult<KernelVerifiedReportReadyCandidate> {
  if (!candidateAuthorities.has(authority)) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "必须使用当前进程签发的 Research Kernel Candidate Authority。",
    );
  }
  if (!isControlledKernelEvaluation(evaluation) || !isCompleteReportReadyEvaluation(evaluation)) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "只能封装由完整 Research Kernel 调用链产生的 ReportReady Candidate。",
    );
  }
  const candidate = deepFreeze({
    report_ready_candidate: evaluation.artifact_candidates.report_ready,
    stop_candidate: evaluation.artifact_candidates.stop,
    verification_scope: "KERNEL_CANDIDATE_ONLY",
    persistence_authority: "NONE",
    can_commit_public_terminal: false,
  }) as KernelVerifiedReportReadyCandidate;
  verifiedCandidates.add(candidate);
  verifiedCandidateMetadata.set(
    candidate,
    deepFreeze({
      kernel_trace: evaluation.kernel_trace,
      verification_scope: "KERNEL_CANDIDATE_ONLY",
      persistence_authority: "NONE",
      can_commit_public_terminal: false,
    }),
  );
  return researchKernelSuccess(candidate);
}

export function isKernelVerifiedReportReadyCandidate(
  value: unknown,
): value is KernelVerifiedReportReadyCandidate {
  return typeof value === "object" && value !== null && verifiedCandidates.has(value);
}

export function getKernelVerifiedCandidateMetadata(
  candidate: KernelVerifiedReportReadyCandidate,
): KernelVerifiedCandidateMetadata {
  const metadata = verifiedCandidateMetadata.get(candidate);
  if (!metadata || !verifiedCandidates.has(candidate)) {
    throw new TypeError("KERNEL_VERIFIED_REPORT_READY_CANDIDATE_REQUIRED");
  }
  return metadata;
}
