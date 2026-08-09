import "server-only";

import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresSchemaSnapshotStore,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import pg from "pg";
import {
  createPostgresSchemaDiscoveryAuthorityResolver,
  type SchemaDiscoveryAuthorityResolver,
  unavailableSchemaDiscoveryAuthorityResolver,
} from "./schema-discovery-authority";
import {
  createSchemaDiscoveryService,
  type SchemaDiscoveryDatasourceResolver,
  type SchemaDiscoveryService,
  unavailableSchemaDiscoveryDatasourceResolver,
} from "./schema-discovery-service";

interface SchemaDiscoveryEnvironment extends NodeJS.ProcessEnv {
  readonly SCHEMA_DISCOVERY_DATABASE_URL?: string;
  readonly DATABASE_URL?: string;
  readonly SCHEMA_DISCOVERY_DEPLOYMENT_ID?: string;
  readonly SCHEMA_DISCOVERY_TENANT_ID?: string;
  readonly SCHEMA_DISCOVERY_PRINCIPAL_ID?: string;
}

export interface SchemaDiscoveryRuntime {
  readonly service: SchemaDiscoveryService;
  readonly authorityResolver: SchemaDiscoveryAuthorityResolver;
}

export interface SchemaDiscoveryRuntimeDependencies {
  readonly environment?: SchemaDiscoveryEnvironment;
  readonly pool?: pg.Pool;
  readonly sqlPool?: SqlPool;
  readonly transactionalAuthorizer?: TransactionalCapabilityAuthorizer;
  readonly authorityResolver?: SchemaDiscoveryAuthorityResolver;
  readonly datasourceResolver?: SchemaDiscoveryDatasourceResolver;
}

export function createSchemaDiscoveryRuntime(
  dependencies: SchemaDiscoveryRuntimeDependencies = {},
): SchemaDiscoveryRuntime {
  const environment = dependencies.environment ?? process.env;
  const connectionString =
    environment.SCHEMA_DISCOVERY_DATABASE_URL ?? environment.DATABASE_URL ?? null;
  if (!connectionString && (!dependencies.sqlPool || !dependencies.transactionalAuthorizer)) {
    const unavailableStore = createUnavailableStore();
    return Object.freeze({
      authorityResolver:
        dependencies.authorityResolver ?? unavailableSchemaDiscoveryAuthorityResolver(),
      service: createSchemaDiscoveryService({
        store: unavailableStore,
        datasourceResolver:
          dependencies.datasourceResolver ?? unavailableSchemaDiscoveryDatasourceResolver(),
      }),
    });
  }
  const sqlPool =
    dependencies.sqlPool ??
    adaptPgPool(
      dependencies.pool ?? new pg.Pool({ connectionString: connectionString ?? undefined }),
    );
  const postgresAuthority = createPostgresCapabilityAuthority(sqlPool);
  const authorizer = dependencies.transactionalAuthorizer ?? postgresAuthority.authorizer;
  return Object.freeze({
    authorityResolver:
      dependencies.authorityResolver ??
      createPostgresSchemaDiscoveryAuthorityResolver({
        authority: postgresAuthority,
        deploymentId: environment.SCHEMA_DISCOVERY_DEPLOYMENT_ID ?? "",
        tenantId: environment.SCHEMA_DISCOVERY_TENANT_ID ?? "",
        principalId: environment.SCHEMA_DISCOVERY_PRINCIPAL_ID ?? "",
      }),
    service: createSchemaDiscoveryService({
      store: createPostgresSchemaSnapshotStore({ pool: sqlPool, authorizer }),
      datasourceResolver:
        dependencies.datasourceResolver ?? unavailableSchemaDiscoveryDatasourceResolver(),
    }),
  });
}

function createUnavailableStore(): ReturnType<typeof createPostgresSchemaSnapshotStore> {
  const unavailable = async () => ({
    ok: false as const,
    error: {
      code: "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
      message: "Schema Discovery Authority 尚未配置。",
      retryable: false,
    },
  });
  return {
    commitSuccess: unavailable,
    commitFailure: unavailable,
    commitDrift: unavailable,
    getScan: unavailable,
    getSnapshot: unavailable,
    getDrift: unavailable,
  };
}

let runtimeInstance: SchemaDiscoveryRuntime | null = null;

export function getSchemaDiscoveryRuntime(): SchemaDiscoveryRuntime {
  runtimeInstance ??= createSchemaDiscoveryRuntime();
  return runtimeInstance;
}
