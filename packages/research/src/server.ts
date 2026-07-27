/**
 * Server-only Composition Root。
 *
 * 这里的 Authority 只能确认当前进程内的 Research Kernel Candidate 来源；
 * 不提供持久化、Public READY、CurrentReadiness 或 Run Grant 权限。
 */

export type {
  ResearchProtocolEvaluation,
  ResearchProtocolInput,
  ResearchProtocolKernelOutcome,
} from "./protocol.js";
export {
  createResearchKernelCandidateAuthority,
  getKernelVerifiedCandidateMetadata,
  isKernelVerifiedReportReadyCandidate,
  isResearchKernelCandidateAuthority,
  type KernelVerifiedCandidateMetadata,
  type KernelVerifiedReportReadyCandidate,
  type ResearchKernelCandidateAuthority,
  sealKernelVerifiedReportReadyCandidate,
} from "./server/candidate-authority.js";
export { runControlledProtocolKernel } from "./server/controlled-composition.js";
export {
  type ControlledFixtureHandle,
  type ControlledResearchProtocolInput,
  getControlledFixtureHandle,
  isControlledFixtureHandle,
  materializeControlledProtocolInput,
} from "./server/controlled-fixture.js";
