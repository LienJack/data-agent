import "server-only";
import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import pg from "pg";
import { PostgresSemanticGovernanceService } from "./postgres-semantic-governance-service";
import {
  createExplicitMockSemanticAuthorityResolver,
  type SemanticAuthorityResolver,
} from "./semantic-authority";
import { parseSemanticGovernanceBackend } from "./semantic-governance-config";
import { publicSemanticGovernanceError } from "./semantic-governance-error";
import {
  MockSemanticGovernanceService,
  type SemanticGovernanceService,
} from "./semantic-governance-service";

export interface SemanticGovernanceRuntime {
  readonly backend: "postgres" | "mock";
  readonly service: SemanticGovernanceService;
  readonly authorityResolver: SemanticAuthorityResolver;
}

interface RuntimeEnvironment extends NodeJS.ProcessEnv {
  readonly SEMANTIC_GOVERNANCE_BACKEND?: string;
  readonly SEMANTIC_ALLOWED_DOMAINS?: string;
}

export interface SemanticGovernanceRuntimeDependencies {
  readonly environment?: RuntimeEnvironment;
  readonly pool?: pg.Pool;
  readonly sqlPool?: SqlPool;
  readonly transactionalAuthorizer?: TransactionalCapabilityAuthorizer;
  readonly authorityResolver?: SemanticAuthorityResolver;
}

function configuredAllowedDomains(environment: RuntimeEnvironment): readonly string[] {
  return (environment.SEMANTIC_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
}

export function createSemanticGovernanceRuntime(
  dependencies: SemanticGovernanceRuntimeDependencies = {},
): SemanticGovernanceRuntime {
  const environment = dependencies.environment ?? process.env;
  const hasAuthorityResolver = dependencies.authorityResolver !== undefined;
  const backend = parseSemanticGovernanceBackend(environment, { hasAuthorityResolver });

  if (backend.backend === "mock") {
    const allowedDomains = configuredAllowedDomains(environment);
    return Object.freeze({
      backend: "mock" as const,
      service: new MockSemanticGovernanceService(),
      authorityResolver:
        dependencies.authorityResolver ??
        createExplicitMockSemanticAuthorityResolver(
          allowedDomains.length > 0 ? allowedDomains : ["revenue", "customer", "marketing"],
        ),
    });
  }

  const sqlPool =
    dependencies.sqlPool ??
    adaptPgPool(dependencies.pool ?? new pg.Pool({ connectionString: backend.connectionString }));
  const postgresAuthority = createPostgresCapabilityAuthority(sqlPool);
  const authorityResolver = dependencies.authorityResolver;
  if (!authorityResolver) {
    throw publicSemanticGovernanceError("SEMANTIC_AUTHORITY_NOT_CONFIGURED");
  }

  return Object.freeze({
    backend: "postgres" as const,
    service: new PostgresSemanticGovernanceService(
      sqlPool,
      dependencies.transactionalAuthorizer ?? postgresAuthority.authorizer,
    ),
    authorityResolver,
  });
}

let runtimeInstance: SemanticGovernanceRuntime | null = null;

export function getSemanticGovernanceRuntime(): SemanticGovernanceRuntime {
  runtimeInstance ??= createSemanticGovernanceRuntime();
  return runtimeInstance;
}
