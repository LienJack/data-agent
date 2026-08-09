import "server-only";

import type { AppCapability, BoundaryResult } from "@data-agent/platform";
import { z } from "zod";

const authorityRequestSchema = z.strictObject({
  access: z.enum(["READ", "WRITE"]),
});

export interface SchemaDiscoveryAuthorityContext {
  readonly authority: "POSTGRESQL";
  readonly capabilityInput: unknown;
  readonly scope: {
    readonly appId: string;
    readonly tenantId: string;
    readonly environment: string;
  };
  readonly deploymentId: string;
  readonly principal: string;
}

export interface SchemaDiscoveryAuthorityResolver {
  resolve(input: unknown): Promise<SchemaDiscoveryAuthorityContext>;
}

interface PostgresAuthority {
  resolveForServerContext(input: unknown): Promise<BoundaryResult<AppCapability>>;
}

export class SchemaDiscoveryAuthorityError extends Error {
  override readonly name = "SchemaDiscoveryAuthorityError";

  constructor(
    readonly code: "SCHEMA_SCAN_SCOPE_FORBIDDEN" | "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export function createPostgresSchemaDiscoveryAuthorityResolver(
  options: Readonly<{
    authority: PostgresAuthority;
    deploymentId: string;
    tenantId: string;
    principalId: string;
  }>,
): SchemaDiscoveryAuthorityResolver {
  const configured = z
    .strictObject({
      deploymentId: z.uuid(),
      tenantId: z.uuid(),
      principalId: z.uuid(),
    })
    .safeParse({
      deploymentId: options.deploymentId,
      tenantId: options.tenantId,
      principalId: options.principalId,
    });
  return Object.freeze({
    async resolve(input: unknown): Promise<SchemaDiscoveryAuthorityContext> {
      const request = authorityRequestSchema.safeParse(input);
      if (!request.success || !configured.success) {
        throw new SchemaDiscoveryAuthorityError("SCHEMA_SCAN_DATASOURCE_UNAVAILABLE", false);
      }
      const resolved = await options.authority.resolveForServerContext({
        deployment_id: configured.data.deploymentId,
        tenant_id: configured.data.tenantId,
        principal_id: configured.data.principalId,
        access: request.data.access,
      });
      if (!resolved.ok) {
        throw new SchemaDiscoveryAuthorityError(
          resolved.error.code === "APP_SCOPE_FORBIDDEN"
            ? "SCHEMA_SCAN_SCOPE_FORBIDDEN"
            : "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
          resolved.error.retryable,
        );
      }
      const capability = resolved.value;
      if (
        capability.scope.tenant_id !== configured.data.tenantId ||
        capability.deployment_id !== configured.data.deploymentId ||
        capability.principal !== configured.data.principalId
      ) {
        throw new SchemaDiscoveryAuthorityError("SCHEMA_SCAN_SCOPE_FORBIDDEN", false);
      }
      return Object.freeze({
        authority: "POSTGRESQL" as const,
        capabilityInput: capability,
        scope: Object.freeze({
          appId: capability.scope.app_id,
          tenantId: capability.scope.tenant_id,
          environment: capability.scope.environment,
        }),
        deploymentId: capability.deployment_id,
        principal: capability.principal,
      });
    },
  });
}

export function unavailableSchemaDiscoveryAuthorityResolver(): SchemaDiscoveryAuthorityResolver {
  return Object.freeze({
    async resolve() {
      throw new SchemaDiscoveryAuthorityError("SCHEMA_SCAN_DATASOURCE_UNAVAILABLE", false);
    },
  });
}
