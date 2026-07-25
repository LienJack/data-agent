import type {
  AppCapability,
  AppCapabilityRole,
  BoundaryResult,
  CapabilityAuthorizer,
  CapabilityOperation,
  CapabilityQueryClient,
} from "../../src/tenancy/capability.js";
import {
  revalidateInTransaction,
  type TransactionalCapabilityAuthorizer,
} from "../../src/tenancy/transactional-authority.internal.js";

/**
 * 仅供无 PostgreSQL 的单元测试显式模拟事务权威。
 *
 * 生产入口不会导出此适配器；集成测试必须使用 createPostgresCapabilityAuthority。
 */
export function asTransactionalTestAuthority(
  authorizer: CapabilityAuthorizer,
): TransactionalCapabilityAuthorizer {
  return Object.freeze({
    verify(value: unknown): BoundaryResult<AppCapability> {
      return authorizer.verify(value);
    },
    requireRole(
      value: unknown,
      allowedRoles: readonly AppCapabilityRole[],
      operation: CapabilityOperation = "READ",
    ): BoundaryResult<AppCapability> {
      return authorizer.requireRole(value, allowedRoles, operation);
    },
    revalidate(
      value: unknown,
      allowedRoles: readonly AppCapabilityRole[],
      operation: CapabilityOperation = "READ",
    ): Promise<BoundaryResult<AppCapability>> {
      return authorizer.revalidate(value, allowedRoles, operation);
    },
    [revalidateInTransaction](
      value: unknown,
      allowedRoles: readonly AppCapabilityRole[],
      operation: CapabilityOperation,
      _client: CapabilityQueryClient,
    ): Promise<BoundaryResult<AppCapability>> {
      return authorizer.revalidate(value, allowedRoles, operation);
    },
  });
}
