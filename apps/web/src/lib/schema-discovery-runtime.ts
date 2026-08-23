import "server-only";

import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresSchemaSnapshotStore,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import pg from "pg";
import type { SchemaDiscoveryAuthorityResolver } from "./schema-discovery-authority";
import {
  createSchemaDiscoveryService,
  type SchemaDiscoveryDatasourceResolver,
  type SchemaDiscoveryService,
  unavailableSchemaDiscoveryDatasourceResolver,
} from "./schema-discovery-service";

interface SchemaDiscoveryEnvironment extends NodeJS.ProcessEnv {
  readonly SCHEMA_DISCOVERY_DATABASE_URL?: string;
  readonly DATABASE_URL?: string;
}

export interface SchemaDiscoveryRuntime {
  readonly service: SchemaDiscoveryService;
  readonly authorityResolver: SchemaDiscoveryAuthorityResolver;
}

export interface SchemaDiscoveryRuntimeDependencies {
  readonly environment: SchemaDiscoveryEnvironment;
  readonly pool?: pg.Pool;
  readonly sqlPool?: SqlPool;
  readonly transactionalAuthorizer?: TransactionalCapabilityAuthorizer;
  readonly authorityResolver: SchemaDiscoveryAuthorityResolver;
  readonly datasourceResolver?: SchemaDiscoveryDatasourceResolver;
}

export function createSchemaDiscoveryRuntime(
  dependencies: SchemaDiscoveryRuntimeDependencies,
): SchemaDiscoveryRuntime {
  const environment = dependencies.environment;
  const connectionString =
    environment.SCHEMA_DISCOVERY_DATABASE_URL ?? environment.DATABASE_URL ?? null;
  if (!connectionString && (!dependencies.sqlPool || !dependencies.transactionalAuthorizer)) {
    throw new TypeError("SCHEMA_DISCOVERY_RUNTIME_NOT_CONFIGURED");
  }
  const sqlPool =
    dependencies.sqlPool ??
    adaptPgPool(
      dependencies.pool ?? new pg.Pool({ connectionString: connectionString ?? undefined }),
    );
  const postgresAuthority = createPostgresCapabilityAuthority(sqlPool);
  const authorizer = dependencies.transactionalAuthorizer ?? postgresAuthority.authorizer;
  return Object.freeze({
    authorityResolver: dependencies.authorityResolver,
    service: createSchemaDiscoveryService({
      store: createPostgresSchemaSnapshotStore({ pool: sqlPool, authorizer }),
      datasourceResolver:
        dependencies.datasourceResolver ?? unavailableSchemaDiscoveryDatasourceResolver(),
    }),
  });
}
