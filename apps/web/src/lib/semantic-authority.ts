import "server-only";
import type { SemanticApplicationAuthority } from "@data-agent/contracts";
import type { AppCapability, AppCapabilityRole, BoundaryResult } from "@data-agent/platform";
import { z } from "zod";
import { publicSemanticGovernanceError } from "./semantic-governance-error";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);

const semanticAuthorityRequestSchema = z.strictObject({
  access: z.enum(["READ", "WRITE"]),
  semanticDomain: z.union([z.literal("all"), semanticDomainSchema]),
});

export type SemanticAuthorityAccess = "READ" | "WRITE";
export type SemanticAuthorityRole = "human-reviewer" | "publisher" | "admin" | "demo";

export interface SemanticAuthorityResolver {
  resolve(input: unknown): Promise<SemanticApplicationAuthority>;
}

interface PostgresAuthority {
  resolveForServerContext(input: unknown): Promise<BoundaryResult<AppCapability>>;
}

export interface PostgresSemanticAuthorityResolverOptions {
  readonly authority: PostgresAuthority;
  readonly deploymentId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly allowedDomains: readonly string[];
}

function semanticRoleForCapability(role: AppCapabilityRole): SemanticAuthorityRole {
  switch (role) {
    case "OWNER":
      return "admin";
    case "ANALYST":
      return "human-reviewer";
    case "VIEWER":
      return "human-reviewer";
    case "DEMO":
      return "demo";
  }
}

function normalizeAllowedDomains(domains: readonly string[]): readonly string[] {
  const parsed = z.array(semanticDomainSchema).min(1).max(256).safeParse(domains);
  if (!parsed.success) {
    throw publicSemanticGovernanceError("SEMANTIC_AUTHORITY_NOT_CONFIGURED");
  }
  return Object.freeze([...new Set(parsed.data)].sort());
}

export function createPostgresSemanticAuthorityResolver(
  options: PostgresSemanticAuthorityResolverOptions,
): SemanticAuthorityResolver {
  const allowedDomains = normalizeAllowedDomains(options.allowedDomains);

  return Object.freeze({
    async resolve(input: unknown): Promise<SemanticApplicationAuthority> {
      const parsed = semanticAuthorityRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw publicSemanticGovernanceError("SEMANTIC_UNAUTHENTICATED");
      }
      if (parsed.data.access === "WRITE" && parsed.data.semanticDomain === "all") {
        throw publicSemanticGovernanceError("SEMANTIC_SCOPE_FORBIDDEN");
      }
      if (
        parsed.data.semanticDomain !== "all" &&
        !allowedDomains.includes(parsed.data.semanticDomain)
      ) {
        throw publicSemanticGovernanceError("SEMANTIC_SCOPE_FORBIDDEN");
      }

      const resolved = await options.authority.resolveForServerContext({
        deployment_id: options.deploymentId,
        tenant_id: options.tenantId,
        principal_id: options.principalId,
        access: parsed.data.access,
      });
      if (!resolved.ok) {
        throw publicSemanticGovernanceError(
          resolved.error.code === "APP_SCOPE_FORBIDDEN"
            ? "SEMANTIC_SCOPE_FORBIDDEN"
            : "SEMANTIC_GOVERNANCE_UNAVAILABLE",
          resolved.error.retryable,
        );
      }

      const capability = resolved.value;
      if (
        capability.scope.tenant_id !== options.tenantId ||
        capability.deployment_id !== options.deploymentId ||
        capability.principal !== options.principalId
      ) {
        throw publicSemanticGovernanceError("SEMANTIC_SCOPE_FORBIDDEN");
      }
      return Object.freeze({
        authority: "POSTGRESQL" as const,
        capabilityInput: capability,
        scope: Object.freeze({
          appId: capability.scope.app_id,
          tenantId: capability.scope.tenant_id,
          environment: capability.scope.environment,
          semanticDomain: parsed.data.semanticDomain,
        }),
        deploymentId: capability.deployment_id,
        principal: capability.principal,
        semanticRole: semanticRoleForCapability(capability.role),
        allowedDomains,
      });
    },
  });
}

/** Build a semantic resolver from a capability already issued by the request guard. */
export function createCapabilitySemanticAuthorityResolver(
  capability: AppCapability,
  configuredDomains?: readonly string[],
): SemanticAuthorityResolver {
  const allowedDomains = configuredDomains?.length
    ? normalizeAllowedDomains(configuredDomains)
    : null;
  return Object.freeze({
    async resolve(input: unknown): Promise<SemanticApplicationAuthority> {
      const parsed = semanticAuthorityRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw publicSemanticGovernanceError("SEMANTIC_UNAUTHENTICATED");
      }
      if (parsed.data.access === "WRITE" && parsed.data.semanticDomain === "all") {
        throw publicSemanticGovernanceError("SEMANTIC_SCOPE_FORBIDDEN");
      }
      if (
        allowedDomains &&
        parsed.data.semanticDomain !== "all" &&
        !allowedDomains.includes(parsed.data.semanticDomain)
      ) {
        throw publicSemanticGovernanceError("SEMANTIC_SCOPE_FORBIDDEN");
      }
      if (parsed.data.access === "WRITE" && capability.role === "VIEWER") {
        throw publicSemanticGovernanceError("SEMANTIC_SCOPE_FORBIDDEN");
      }
      return Object.freeze({
        authority: "POSTGRESQL" as const,
        capabilityInput: capability,
        scope: Object.freeze({
          appId: capability.scope.app_id,
          tenantId: capability.scope.tenant_id,
          environment: capability.scope.environment,
          semanticDomain: parsed.data.semanticDomain,
        }),
        deploymentId: capability.deployment_id,
        principal: capability.principal,
        semanticRole: semanticRoleForCapability(capability.role),
        allowedDomains: allowedDomains ?? Object.freeze([]),
      });
    },
  });
}
