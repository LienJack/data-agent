/**
 * 仅供可信服务端 Composition Root 使用的能力入口。
 *
 * 普通 Agent 与 Candidate 生产代码必须只依赖 package root；这里负责把真实
 * Artifact Store、Compiler Principal、EXPLAIN Admission 与 Result Oracle
 * 适配器注册为同进程 Authority，避免业务层通过结构型 callback 自签成功事实。
 */
export {
  type AuthoritativeLogicalPlanBinding,
  type AuthoritativeLogicalPlanPolicyBinding,
  type LogicalPlanPrincipalCapabilityClaim,
  registerAuthoritativeLogicalPlanBinding,
  registerTrustedLogicalPlanCompilerAuthority,
} from "./compiler/internal.js";
export {
  type ResultOracleAuthorityRegistration,
  registerTrustedGateArtifactAuthority,
  registerTrustedResourceAdmission,
  registerTrustedResultOracleAuthority,
  type TrustedGateArtifactAuthority,
  type TrustedResultOracleAuthority,
} from "./gates/internal.js";
export {
  type MetamorphicFixtureAuthorityRegistration,
  type MetamorphicOracleVerifierRegistration,
  registerTrustedMetamorphicFixtureAuthority,
  registerTrustedMetamorphicOracleVerifier,
  type TrustedMetamorphicFixtureAuthority,
  type TrustedMetamorphicOracleVerification,
  type TrustedMetamorphicOracleVerifier,
} from "./gates/metamorphic.js";
export { createBoundedRepairTrace } from "./repair/bounded-repair.js";
export {
  authorizeRepairTrace,
  loadCurrentRepairSession,
  type RepairSessionStoreAdapter,
  registerTrustedRepairAuthority,
} from "./repair/internal.js";
export type {
  RepairSessionCreateClaim,
  RepairSessionSnapshot,
  RepairSessionTransition,
  RepairSessionTransitionClaim,
} from "./repair/types.js";
