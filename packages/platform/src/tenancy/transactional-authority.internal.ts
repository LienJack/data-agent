import type {
  AppCapability,
  AppCapabilityRole,
  BoundaryResult,
  CapabilityAuthorizer,
  CapabilityOperation,
  CapabilityQueryClient,
} from "./capability.js";

export const revalidateInTransaction = Symbol.for("data-agent.revalidate-in-transaction");

export interface TransactionalCapabilityAuthorizer extends CapabilityAuthorizer {
  [revalidateInTransaction](
    value: unknown,
    allowedRoles: readonly AppCapabilityRole[],
    operation: CapabilityOperation,
    client: CapabilityQueryClient,
  ): Promise<BoundaryResult<AppCapability>>;
}

export function usesTransactionalDatabaseAuthority(
  authorizer: CapabilityAuthorizer | null | undefined,
): authorizer is TransactionalCapabilityAuthorizer {
  return (
    typeof authorizer === "object" &&
    authorizer !== null &&
    typeof (authorizer as Partial<TransactionalCapabilityAuthorizer>)[revalidateInTransaction] ===
      "function"
  );
}

export async function revalidateCapabilityInTransaction(
  authorizer: TransactionalCapabilityAuthorizer,
  value: unknown,
  allowedRoles: readonly AppCapabilityRole[],
  operation: CapabilityOperation,
  client: CapabilityQueryClient,
): Promise<BoundaryResult<AppCapability>> {
  return authorizer[revalidateInTransaction](value, allowedRoles, operation, client);
}
