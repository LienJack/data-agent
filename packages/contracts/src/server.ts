/**
 * 仅供可信服务端 Composition Root 使用的能力入口。
 *
 * 浏览器、Agent Candidate 与普通领域调用方必须只依赖 package root；这里导出的
 * Registrar/Authorizer 会把真实持久化、事务与执行记录适配器注册为同进程 Authority。
 */

export {
  type AuthoritativeMetamorphicFixtureReceipt,
  type AuthoritativeMetamorphicOracleProjection,
  type AuthoritativeMetamorphicOracleReceipt,
  type AuthoritativeMetamorphicSandboxEvidence,
  type AuthoritativeResultOracleReceipt,
  authorizeMetamorphicFixtureReceipt,
  authorizeMetamorphicOracleReceipt,
  authorizeResultOracleReceipt,
  createMetamorphicFixtureAuthority,
  createMetamorphicOracleAuthority,
  createResultOracleReceiptAuthority,
  getAuthoritativeMetamorphicOracleProjection,
  isAuthoritativeMetamorphicFixtureReceipt,
  isAuthoritativeMetamorphicOracleReceipt,
  isAuthoritativeResultOracleReceipt,
  type MetamorphicFixtureAuthority,
  type MetamorphicFixtureAuthorityOptions,
  type MetamorphicOracleAuthority,
  type MetamorphicOracleAuthorityOptions,
  type ResultOracleReceiptAuthority,
  type ResultOracleReceiptAuthorityOptions,
} from "./artifacts/text2sql-evidence-authority.js";
export {
  type AuthoritativeSandboxExecutionIdentity,
  type AuthoritativeSandboxExecutionReceipt,
  type AuthoritativeSandboxResult,
  authorizeSandboxExecutionReceipt,
  authorizeSandboxResult,
  executeAuthorizedSandboxRequest,
  getAuthoritativeSandboxExecutionIdentity,
  isAuthoritativeSandboxExecutionIdentity,
  registerSandboxServerAuthority,
  type SandboxAuthorityFenceRequest,
  type SandboxAuthorityRevalidationRequest,
  type SandboxExecutionIdempotencyClaim,
  SandboxExecutionIdempotencyConflictError,
  type SandboxExecutionIdempotencyResolution,
  type SandboxServerAuthority,
  type SandboxServerAuthorityRegistration,
} from "./ports/sandbox.js";
