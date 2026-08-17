import "server-only";

import { type ArtifactReference, modelCertificationClaimsSchema } from "@data-agent/contracts";
import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresSchemaSnapshotStore,
  createPostgresSemanticCandidateCompileStore,
  createPostgresSemanticExplorerReader,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
  withAppTransaction,
} from "@data-agent/platform";
import pg from "pg";
import { PostgresSemanticGovernanceService } from "./postgres-semantic-governance-service";
import {
  createPostgresSemanticAuthorityResolver,
  type SemanticAuthorityContext,
  type SemanticAuthorityResolver,
} from "./semantic-authority";
import {
  createSemanticCandidateService,
  type SemanticCandidateService,
} from "./semantic-candidate-service";
import {
  type PersistedModelCertificationReceipt,
  resolveTestCenterModelRuntime,
} from "./test-center-model-runtime";

interface SemanticCandidateEnvironment extends NodeJS.ProcessEnv {
  readonly SEMANTIC_CANDIDATE_DATABASE_URL?: string;
  readonly DATABASE_URL?: string;
  readonly SEMANTIC_DEPLOYMENT_ID?: string;
  readonly SEMANTIC_TENANT_ID?: string;
  readonly SEMANTIC_PRINCIPAL_ID?: string;
  readonly SEMANTIC_ALLOWED_DOMAINS?: string;
  readonly SEMANTIC_CANDIDATE_MODEL_PROVIDER?: string;
}

interface StoredCertificationReceiptRow {
  readonly run_id: string;
  readonly artifact_id: string;
  readonly revision: number;
  readonly content_hash: string;
  readonly document_json: unknown;
}

export interface SemanticCandidateRuntime {
  readonly authorityResolver: SemanticAuthorityResolver;
  readonly service: SemanticCandidateService;
}

export interface SemanticCandidateRuntimeDependencies {
  readonly environment?: SemanticCandidateEnvironment;
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

async function resolvePersistedReceipt(input: {
  readonly sqlPool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly authority: SemanticAuthorityContext;
  readonly binding: {
    readonly profile_id: string;
    readonly provider: string;
    readonly default_model_id: string;
    readonly profile_version: string;
  };
}): Promise<PersistedModelCertificationReceipt | null> {
  const result = await withAppTransaction(
    input.sqlPool,
    input.authorizer,
    input.authority.capabilityInput,
    {
      access: "READ",
      allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
      operation_name: "semantic.resolve_candidate_model_receipt",
    },
    async ({ capability, client }) => {
      const query = await client.query<StoredCertificationReceiptRow>(
        `select run_id, artifact_id, revision, content_hash, document_json
           from app_data_agent.artifacts
          where app_id = $1::uuid
            and tenant_id = $2::uuid
            and environment = $3::text
            and artifact_type = 'ModelCertificationReceipt'
            and revision = 1
            and is_active
            and document_json ->> 'profile_id' = $4::text
            and document_json ->> 'provider' = $5::text
            and document_json ->> 'model_id' = $6::text
            and document_json ->> 'profile_version' = $7::text
            and document_json ->> 'verdict' = 'PASS'
          order by created_at desc
          limit 1`,
        [
          capability.scope.app_id,
          capability.scope.tenant_id,
          capability.scope.environment,
          input.binding.profile_id,
          input.binding.provider,
          input.binding.default_model_id,
          input.binding.profile_version,
        ],
      );
      return query.rows[0] ?? null;
    },
  );
  if (!result.ok || !result.value) return null;
  const row = result.value;
  const claims = modelCertificationClaimsSchema.safeParse(row.document_json);
  if (!claims.success) return null;
  const reference: ArtifactReference = {
    artifact_id: row.artifact_id,
    artifact_type: "ModelCertificationReceipt",
    app_id: input.authority.scope.appId,
    tenant_id: input.authority.scope.tenantId,
    environment: input.authority.scope.environment,
    run_id: row.run_id,
    revision: row.revision,
    content_hash: row.content_hash as `sha256:${string}`,
  };
  return Object.freeze({ reference, claims: claims.data });
}

export function createSemanticCandidateRuntime(
  dependencies: SemanticCandidateRuntimeDependencies = {},
): SemanticCandidateRuntime {
  const environment = dependencies.environment ?? process.env;
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
      governance_service: governanceService,
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
            resolve_receipt: (binding) =>
              resolvePersistedReceipt({ sqlPool, authorizer, authority, binding }),
          }),
      },
    }),
  });
}

let runtimeInstance: SemanticCandidateRuntime | null = null;

export function getSemanticCandidateRuntime(): SemanticCandidateRuntime {
  runtimeInstance ??= createSemanticCandidateRuntime();
  return runtimeInstance;
}
