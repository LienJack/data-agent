import type { U6ResearchReasonCode } from "@data-agent/contracts";

export const RESEARCH_KERNEL_BOUNDARY_ERROR_CODES = [
  "RESEARCH_BRIEF_INVALID",
  "HYPOTHESIS_SET_INVALID",
  "EVIDENCE_PLAN_INVALID",
  "EVIDENCE_RELATION_IDENTITY_CONFLICT",
  "COVERAGE_INPUT_INVALID",
  "RESEARCH_STOP_INPUT_STALE",
  "RESEARCH_STOP_INPUT_INCONSISTENT",
  "REPORT_PROJECTION_AUTHORITY_INVALID",
  "REPORT_READY_AUTHORITY_REQUIRED",
  "REPORT_READY_CERTIFICATE_TAMPERED",
  "CERTIFICATE_SEMANTIC_HASH_MISMATCH",
] as const;

export type ResearchKernelBoundaryErrorCode = (typeof RESEARCH_KERNEL_BOUNDARY_ERROR_CODES)[number];
export type ResearchKernelErrorCode = U6ResearchReasonCode | ResearchKernelBoundaryErrorCode;

export interface ResearchKernelError {
  readonly code: ResearchKernelErrorCode;
  readonly message: string;
  readonly retryable: false;
}

export type ResearchKernelResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ResearchKernelError };

export function researchKernelFailure(
  code: ResearchKernelErrorCode,
  message: string,
): ResearchKernelResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

export function researchKernelSuccess<T>(value: T): ResearchKernelResult<T> {
  return { ok: true, value };
}
