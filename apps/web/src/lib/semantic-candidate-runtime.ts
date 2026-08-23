import "server-only";

import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresSchemaSnapshotStore,
  createPostgresSemanticCandidateCompileStore,
  createPostgresSemanticExplorerReader,
  PostgresSemanticGovernanceService,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import {
  createSemanticCandidateService,
  type SemanticCandidateService,
} from "@data-agent/semantic/application";
import pg from "pg";
import {
  createPostgresSemanticAuthorityResolver,
  type SemanticAuthorityResolver,
} from "./semantic-authority";
import { resolveTestCenterModelRuntime } from "./test-center-model-runtime";

interface SemanticCandidateEnvironment extends NodeJS.ProcessEnv {
  readonly SEMANTIC_CANDIDATE_DATABASE_URL?: string;
  readonly DATABASE_URL?: string;
  readonly SEMANTIC_DEPLOYMENT_ID?: string;
  readonly SEMANTIC_TENANT_ID?: string;
  readonly SEMANTIC_PRINCIPAL_ID?: string;
  readonly SEMANTIC_ALLOWED_DOMAINS?: string;
  readonly SEMANTIC_CANDIDATE_MODEL_PROVIDER?: string;
}

export interface SemanticCandidateRuntime {
  readonly authorityResolver: SemanticAuthorityResolver;
  readonly service: SemanticCandidateService;
}

export interface SemanticCandidateRuntimeDependencies {
  readonly environment: SemanticCandidateEnvironment;
  readonly pool?: pg.Pool;
  readonly sqlPool?: SqlPool;
  readonly transactionalAuthorizer?: TransactionalCapabilityAuthorizer;
  readonly authorityResolver?: SemanticAuthorityResolver;
}

export class SemanticCandidateRuntimeError extends Error {
  override readonly name = "SemanticCandidateRuntimeError";
  readonly code = "SEMANTIC_CANDIDATE_RUNTIME_NOT_CONFIGURED";
}

function configuredAllowedDomains(environment: SemanticCandidateEnvironment): readonly string[] {
  return (environment.SEMANTIC_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
}

export function createSemanticCandidateRuntime(
  dependencies: SemanticCandidateRuntimeDependencies,
): SemanticCandidateRuntime {
  const environment = dependencies.environment;
  const connectionString = environment.SEMANTIC_CANDIDATE_DATABASE_URL ?? environment.DATABASE_URL;
  const allowedDomains = configuredAllowedDomains(environment);
  if (
    (!connectionString && !dependencies.sqlPool) ||
    (!dependencies.authorityResolver &&
      (!environment.SEMANTIC_DEPLOYMENT_ID ||
        !environment.SEMANTIC_TENANT_ID ||
        !environment.SEMANTIC_PRINCIPAL_ID ||
        allowedDomains.length === 0))
  ) {
    throw new SemanticCandidateRuntimeError("语义候选编译运行时尚未配置。");
  }
  const sqlPool =
    dependencies.sqlPool ??
    adaptPgPool(
      dependencies.pool ??
        new pg.Pool({
          connectionString,
          connectionTimeoutMillis: 5_000,
          query_timeout: 150_000,
          statement_timeout: 150_000,
          idle_in_transaction_session_timeout: 150_000,
        }),
    );
  const postgresAuthority = createPostgresCapabilityAuthority(sqlPool);
  const authorizer = dependencies.transactionalAuthorizer ?? postgresAuthority.authorizer;
  const authorityResolver =
    dependencies.authorityResolver ??
    createPostgresSemanticAuthorityResolver({
      authority: postgresAuthority,
      deploymentId: environment.SEMANTIC_DEPLOYMENT_ID ?? "",
      tenantId: environment.SEMANTIC_TENANT_ID ?? "",
      principalId: environment.SEMANTIC_PRINCIPAL_ID ?? "",
      allowedDomains,
    });
  const governanceService = new PostgresSemanticGovernanceService(sqlPool, authorizer);
  return Object.freeze({
    authorityResolver,
    service: createSemanticCandidateService({
      snapshot_store: createPostgresSchemaSnapshotStore({ pool: sqlPool, authorizer }),
      explorer_reader: createPostgresSemanticExplorerReader({ pool: sqlPool, authorizer }),
      compile_store: createPostgresSemanticCandidateCompileStore({ pool: sqlPool, authorizer }),
      candidate_review: governanceService,
      model_runtime: {
        resolve: async (authority) =>
          resolveTestCenterModelRuntime({
            scope: {
              app_id: authority.scope.appId,
              tenant_id: authority.scope.tenantId,
              environment: authority.scope.environment,
            },
            environment: {
              ...environment,
              TEST_CENTER_MODEL_PROVIDER:
                environment.SEMANTIC_CANDIDATE_MODEL_PROVIDER ??
                environment.TEST_CENTER_MODEL_PROVIDER,
            },
          }),
      },
    }),
  });
}
