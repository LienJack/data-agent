import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  loadRuntimeBuildIdentity,
  loadRuntimeMigrationFact,
  projectPublicRuntimeBuildIdentity,
  type RuntimeBuildIdentity,
  RuntimeBuildIdentityConfigurationError,
  type RuntimeMigrationFact,
} from "@data-agent/contracts/server";
import {
  adaptPgPool,
  createNeo4jRelationshipGraphAdapterFromEnvironment,
  createPostgresCapabilityAuthority,
  createPostgresRelationshipIndexStore,
  createPostgresSemanticExplorerReader,
  registerPersistenceDiagnosticLogger,
} from "@data-agent/platform";
import { buildSemanticExplorerReadModel } from "@data-agent/semantic/read-model";
import pg from "pg";
import { z } from "zod";
import { createWorkerSemanticJobComposition } from "./job-composition.js";

const environmentSchema = z.strictObject({
  DATABASE_URL: z.string().min(1),
  SEMANTIC_DEPLOYMENT_ID: z.uuid(),
  SEMANTIC_TENANT_ID: z.uuid(),
  SEMANTIC_PRINCIPAL_ID: z.uuid(),
  SEMANTIC_RELATIONSHIP_DOMAINS: z.string().min(1),
  SEMANTIC_RELATIONSHIP_INDEX_ENABLED: z.literal("true"),
  SEMANTIC_RELATIONSHIP_INDEX_WORKER_ID: z.uuid().optional(),
  SEMANTIC_RELATIONSHIP_INDEX_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(5_000),
  SEMANTIC_RELATIONSHIP_INDEX_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(180),
  SEMANTIC_RELATIONSHIP_INDEX_HEALTH_PORT: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(65_535)
    .default(9_090),
  NEO4J_URI: z.string().min(1),
  NEO4J_USERNAME: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  NEO4J_DATABASE: z.string().min(1).optional(),
  NEO4J_RELATIONSHIP_BATCH_SIZE: z.string().optional(),
});

function parseEnvironment(environment: NodeJS.ProcessEnv) {
  return environmentSchema.parse({
    DATABASE_URL: environment.DATABASE_URL,
    SEMANTIC_DEPLOYMENT_ID: environment.SEMANTIC_DEPLOYMENT_ID,
    SEMANTIC_TENANT_ID: environment.SEMANTIC_TENANT_ID,
    SEMANTIC_PRINCIPAL_ID: environment.SEMANTIC_PRINCIPAL_ID,
    SEMANTIC_RELATIONSHIP_DOMAINS: environment.SEMANTIC_RELATIONSHIP_DOMAINS,
    SEMANTIC_RELATIONSHIP_INDEX_ENABLED: environment.SEMANTIC_RELATIONSHIP_INDEX_ENABLED,
    SEMANTIC_RELATIONSHIP_INDEX_WORKER_ID: environment.SEMANTIC_RELATIONSHIP_INDEX_WORKER_ID,
    SEMANTIC_RELATIONSHIP_INDEX_INTERVAL_MS: environment.SEMANTIC_RELATIONSHIP_INDEX_INTERVAL_MS,
    SEMANTIC_RELATIONSHIP_INDEX_LEASE_SECONDS:
      environment.SEMANTIC_RELATIONSHIP_INDEX_LEASE_SECONDS,
    SEMANTIC_RELATIONSHIP_INDEX_HEALTH_PORT: environment.SEMANTIC_RELATIONSHIP_INDEX_HEALTH_PORT,
    NEO4J_URI: environment.NEO4J_URI,
    NEO4J_USERNAME: environment.NEO4J_USERNAME,
    NEO4J_PASSWORD: environment.NEO4J_PASSWORD,
    NEO4J_DATABASE: environment.NEO4J_DATABASE,
    NEO4J_RELATIONSHIP_BATCH_SIZE: environment.NEO4J_RELATIONSHIP_BATCH_SIZE,
  });
}

function parseDomains(value: string): readonly string[] {
  return z
    .array(
      z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
    )
    .min(1)
    .max(256)
    .parse(
      [
        ...new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ].sort(),
    );
}

export interface RelationshipIndexerHealthState {
  initialized: boolean;
  last_cycle_at: string | null;
}

export function projectRelationshipIndexerHealthResponse(
  health: RelationshipIndexerHealthState,
  identity: RuntimeBuildIdentity,
  migration: RuntimeMigrationFact | null = null,
) {
  return {
    status: health.initialized ? ("ready" as const) : ("starting" as const),
    ...health,
    ...projectPublicRuntimeBuildIdentity(identity),
    ...(migration
      ? {
          migration_ready: migration.migration_ready,
          migration_frontier: migration.migration_frontier,
        }
      : {}),
  };
}

export async function runRelationshipIndexerProcess(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const runtimeIdentity = loadRuntimeBuildIdentity({
    expectedRole: "relationship-indexer",
    environment,
  });
  const migrationFact = loadRuntimeMigrationFact(environment);
  const config = parseEnvironment(environment);
  const domains = parseDomains(config.SEMANTIC_RELATIONSHIP_DOMAINS);
  const workerId = config.SEMANTIC_RELATIONSHIP_INDEX_WORKER_ID ?? randomUUID();
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    statement_timeout: 12_000,
    idle_in_transaction_session_timeout: 15_000,
  });
  const sqlPool = adaptPgPool(pool);
  const authority = createPostgresCapabilityAuthority(sqlPool);
  const reader = createPostgresSemanticExplorerReader({
    pool: sqlPool,
    authorizer: authority.authorizer,
  });
  const graph = createNeo4jRelationshipGraphAdapterFromEnvironment(environment);
  if (!graph) throw new Error("Relationship index is not enabled.");
  const indexer = createWorkerSemanticJobComposition({
    feature: "RELATIONSHIP_INDEX",
    store: createPostgresRelationshipIndexStore({
      pool: sqlPool,
      authorizer: authority.authorizer,
    }),
    graph,
    snapshots: {
      async getRelease(capabilityInput, semanticDomain, releaseId) {
        const source = await reader.getReleaseSource(capabilityInput, {
          semantic_domain: semanticDomain,
          release_id: releaseId,
        });
        if (!source.ok) return source;
        try {
          return {
            ok: true as const,
            value: (await buildSemanticExplorerReadModel(source.value)).snapshot,
          };
        } catch {
          return {
            ok: false as const,
            error: {
              code: "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
              message: "关系索引器无法读取有效的 PostgreSQL exact-release 快照。",
              retryable: false,
            },
          };
        }
      },
    },
  });
  const abort = new AbortController();
  const health: RelationshipIndexerHealthState = { initialized: false, last_cycle_at: null };
  const server = createServer((request, response) => {
    if (request.url !== "/live") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(health.initialized ? 200 : 503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify(
        projectRelationshipIndexerHealthResponse(health, runtimeIdentity, migrationFact),
      ),
    );
  });
  const stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const releasePersistenceDiagnostics = registerPersistenceDiagnosticLogger({
    identity: runtimeIdentity,
    logger: (record) => console.error(JSON.stringify(record)),
  });

  try {
    await indexer.initialize();
    health.initialized = true;
    server.listen(config.SEMANTIC_RELATIONSHIP_INDEX_HEALTH_PORT, "0.0.0.0");
    console.info(
      JSON.stringify({
        event: "semantic_relationship_indexer_started",
        build_id: runtimeIdentity.build_id,
        generation_id: runtimeIdentity.generation_id,
        git_commit: runtimeIdentity.git_commit,
        git_dirty: runtimeIdentity.git_dirty,
        ...(migrationFact
          ? {
              migration_ready: migrationFact.migration_ready,
              migration_frontier: migrationFact.migration_frontier,
            }
          : {}),
      }),
    );
    while (!abort.signal.aborted) {
      for (const semanticDomain of domains) {
        const resolved = await authority.resolveForServerContext({
          deployment_id: config.SEMANTIC_DEPLOYMENT_ID,
          tenant_id: config.SEMANTIC_TENANT_ID,
          principal_id: config.SEMANTIC_PRINCIPAL_ID,
          access: "WRITE",
        });
        if (!resolved.ok) {
          console.error(
            JSON.stringify({
              event: "semantic_relationship_index_authority_unavailable",
              code: resolved.error.code,
              semantic_domain: semanticDomain,
            }),
          );
          continue;
        }
        try {
          const result = await indexer.runOnce(resolved.value, resolved.value.scope, {
            semantic_domain: semanticDomain,
            worker_id: workerId,
            lease_seconds: config.SEMANTIC_RELATIONSHIP_INDEX_LEASE_SECONDS,
          });
          console.info(
            JSON.stringify({
              event: "semantic_relationship_index_cycle",
              semantic_domain: semanticDomain,
              ...result,
            }),
          );
        } catch {
          console.error(
            JSON.stringify({
              event: "semantic_relationship_index_cycle_failed",
              code: "INDEXER_CYCLE_UNAVAILABLE",
              semantic_domain: semanticDomain,
            }),
          );
        }
      }
      health.last_cycle_at = new Date().toISOString();
      await delay(config.SEMANTIC_RELATIONSHIP_INDEX_INTERVAL_MS, undefined, {
        signal: abort.signal,
      }).catch(() => undefined);
    }
  } finally {
    releasePersistenceDiagnostics();
    health.initialized = false;
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await indexer.close();
    await pool.end();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runRelationshipIndexerProcess().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "semantic_relationship_indexer_stopped",
        code:
          error instanceof RuntimeBuildIdentityConfigurationError
            ? error.code
            : error instanceof z.ZodError
              ? "CONFIG_INVALID"
              : "INDEXER_UNAVAILABLE",
      }),
    );
    process.exitCode = 1;
  });
}
