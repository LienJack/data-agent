import "server-only";

import {
  adaptPgPool,
  createNeo4jRelationshipGraphAdapterFromEnvironment,
  createPostgresCapabilityAuthority,
  createPostgresRelationshipIndexStore,
  createPostgresSemanticExplorerReader,
  type PostgresRelationshipIndexStore,
  type PostgresSemanticExplorerReader,
  type SemanticRelationshipGraphAdapter,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import pg from "pg";
import {
  createPostgresSemanticAuthorityResolver,
  type SemanticAuthorityResolver,
} from "./semantic-authority";
import {
  createSemanticExplorerService,
  type SemanticExplorerService,
} from "./semantic-explorer-service";

interface SemanticExplorerEnvironment extends NodeJS.ProcessEnv {
  readonly SEMANTIC_EXPLORER_ENABLED?: string;
  readonly SEMANTIC_EXPLORER_DATABASE_URL?: string;
  readonly SEMANTIC_RELATIONSHIP_INDEX_ENABLED?: string;
  readonly DATABASE_URL?: string;
  readonly SEMANTIC_DEPLOYMENT_ID?: string;
  readonly SEMANTIC_TENANT_ID?: string;
  readonly SEMANTIC_PRINCIPAL_ID?: string;
  readonly SEMANTIC_ALLOWED_DOMAINS?: string;
}

export type SemanticExplorerRuntime =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly authorityResolver: SemanticAuthorityResolver;
      readonly service: SemanticExplorerService;
    };

export interface SemanticExplorerRuntimeDependencies {
  readonly environment?: SemanticExplorerEnvironment;
  readonly pool?: pg.Pool;
  readonly sqlPool?: SqlPool;
  readonly transactionalAuthorizer?: TransactionalCapabilityAuthorizer;
  readonly authorityResolver?: SemanticAuthorityResolver;
  readonly reader?: PostgresSemanticExplorerReader;
  readonly relationshipIndexStore?: PostgresRelationshipIndexStore;
  readonly relationshipGraph?: SemanticRelationshipGraphAdapter;
}

export class SemanticExplorerRuntimeError extends Error {
  override readonly name = "SemanticExplorerRuntimeError";

  constructor(readonly code: "SEMANTIC_EXPLORER_CONFIG_INVALID") {
    super("Semantic Explorer server runtime is not configured.");
  }
}

function featureEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false" || value === "0") return false;
  if (value === "true" || value === "1") return true;
  throw new SemanticExplorerRuntimeError("SEMANTIC_EXPLORER_CONFIG_INVALID");
}

function configuredAllowedDomains(environment: SemanticExplorerEnvironment): readonly string[] {
  return (environment.SEMANTIC_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
}

function hasFixedAuthority(environment: SemanticExplorerEnvironment): boolean {
  return Boolean(
    environment.SEMANTIC_DEPLOYMENT_ID &&
      environment.SEMANTIC_TENANT_ID &&
      environment.SEMANTIC_PRINCIPAL_ID &&
      configuredAllowedDomains(environment).length > 0,
  );
}

export function createSemanticExplorerRuntime(
  dependencies: SemanticExplorerRuntimeDependencies = {},
): SemanticExplorerRuntime {
  const environment = dependencies.environment ?? process.env;
  if (!featureEnabled(environment.SEMANTIC_EXPLORER_ENABLED)) {
    return Object.freeze({ enabled: false as const });
  }
  if (!dependencies.authorityResolver && !hasFixedAuthority(environment)) {
    throw new SemanticExplorerRuntimeError("SEMANTIC_EXPLORER_CONFIG_INVALID");
  }

  const connectionString =
    environment.SEMANTIC_EXPLORER_DATABASE_URL ?? environment.DATABASE_URL ?? null;
  if (!dependencies.reader && !dependencies.sqlPool && !dependencies.pool && !connectionString) {
    throw new SemanticExplorerRuntimeError("SEMANTIC_EXPLORER_CONFIG_INVALID");
  }

  const sqlPool =
    dependencies.sqlPool ??
    (dependencies.reader
      ? null
      : adaptPgPool(
          dependencies.pool ??
            new pg.Pool({
              connectionString: connectionString ?? undefined,
              connectionTimeoutMillis: 5_000,
              query_timeout: 15_000,
              statement_timeout: 12_000,
              idle_in_transaction_session_timeout: 15_000,
            }),
        ));
  const postgresAuthority = sqlPool ? createPostgresCapabilityAuthority(sqlPool) : null;
  let authorityResolver = dependencies.authorityResolver;
  if (!authorityResolver) {
    if (!postgresAuthority) {
      throw new SemanticExplorerRuntimeError("SEMANTIC_EXPLORER_CONFIG_INVALID");
    }
    authorityResolver = createPostgresSemanticAuthorityResolver({
      authority: postgresAuthority,
      deploymentId: environment.SEMANTIC_DEPLOYMENT_ID ?? "",
      tenantId: environment.SEMANTIC_TENANT_ID ?? "",
      principalId: environment.SEMANTIC_PRINCIPAL_ID ?? "",
      allowedDomains: configuredAllowedDomains(environment),
    });
  }

  let reader = dependencies.reader;
  if (!reader) {
    const authorizer = dependencies.transactionalAuthorizer ?? postgresAuthority?.authorizer;
    if (!sqlPool || !authorizer) {
      throw new SemanticExplorerRuntimeError("SEMANTIC_EXPLORER_CONFIG_INVALID");
    }
    reader = createPostgresSemanticExplorerReader({ pool: sqlPool, authorizer });
  }

  const relationshipIndexEnabled = featureEnabled(environment.SEMANTIC_RELATIONSHIP_INDEX_ENABLED);
  let relationshipIndexStore = dependencies.relationshipIndexStore;
  let relationshipGraph = dependencies.relationshipGraph;
  if (relationshipIndexEnabled) {
    const authorizer = dependencies.transactionalAuthorizer ?? postgresAuthority?.authorizer;
    if (!relationshipIndexStore) {
      if (!sqlPool || !authorizer) {
        throw new SemanticExplorerRuntimeError("SEMANTIC_EXPLORER_CONFIG_INVALID");
      }
      relationshipIndexStore = createPostgresRelationshipIndexStore({ pool: sqlPool, authorizer });
    }
    relationshipGraph ??=
      createNeo4jRelationshipGraphAdapterFromEnvironment(environment) ?? undefined;
    if (!relationshipGraph) {
      throw new SemanticExplorerRuntimeError("SEMANTIC_EXPLORER_CONFIG_INVALID");
    }
  }

  return Object.freeze({
    enabled: true as const,
    authorityResolver,
    service: createSemanticExplorerService(reader, {
      store: relationshipIndexStore ?? null,
      graph: relationshipGraph ?? null,
      disabledReason: relationshipIndexEnabled ? "INDEX_NOT_CONFIGURED" : "INDEX_DISABLED",
    }),
  });
}

let runtimeInstance: SemanticExplorerRuntime | null = null;

export function getSemanticExplorerRuntime(): SemanticExplorerRuntime {
  runtimeInstance ??= createSemanticExplorerRuntime();
  return runtimeInstance;
}
