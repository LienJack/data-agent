import "server-only";

import type { DataSourceCredentialRef } from "@data-agent/contracts";
import { adaptPgCatalogPool } from "@data-agent/platform";
import { Pool } from "pg";
import {
  ECOMMERCE_DEMO_DATASOURCE_ID,
  ECOMMERCE_DEMO_LOCAL_PASSWORD,
  ECOMMERCE_DEMO_SECRET_REF_ID,
  resolveEcommerceDemoConnectionConfiguration,
} from "./ecommerce-demo-bootstrap";
import type { SchemaDiscoveryAuthorityContext } from "./schema-discovery-authority";
import type {
  SchemaDiscoveryConnectorFactory,
  SchemaDiscoveryEgressAuthorizer,
  SchemaDiscoverySecretResolver,
} from "./schema-discovery-datasource";

const pools = new Map<string, Pool>();

export function createEcommerceDemoSecretResolver(
  environment: NodeJS.ProcessEnv,
): SchemaDiscoverySecretResolver {
  return Object.freeze({
    async resolve(reference: DataSourceCredentialRef, authority: SchemaDiscoveryAuthorityContext) {
      if (
        reference.secret_ref_id !== ECOMMERCE_DEMO_SECRET_REF_ID ||
        reference.secret_version !== 1 ||
        reference.rotation_state !== "ACTIVE" ||
        reference.app_id !== authority.scope.appId ||
        reference.tenant_id !== authority.scope.tenantId ||
        reference.environment !== authority.scope.environment
      ) {
        throw new Error("ECOMMERCE_DEMO_SECRET_REF_INVALID");
      }
      const configuration = resolveEcommerceDemoConnectionConfiguration(
        environment,
        authority.scope.environment,
      );
      return {
        username: "data_agent_ecommerce_reader",
        secret_value: configuration.password,
      };
    },
  });
}

export function createEcommerceDemoEgressAuthorizer(
  environment: NodeJS.ProcessEnv,
): SchemaDiscoveryEgressAuthorizer {
  const authorizer: SchemaDiscoveryEgressAuthorizer = {
    async authorize(request, authority) {
      const configuration = resolveEcommerceDemoConnectionConfiguration(
        environment,
        authority.scope.environment,
      );
      if (
        request.datasource_id !== ECOMMERCE_DEMO_DATASOURCE_ID ||
        request.host !== configuration.host ||
        request.port !== configuration.port ||
        request.protocol !== "postgresql:"
      ) {
        throw new Error("ECOMMERCE_DEMO_EGRESS_DENIED");
      }
      return {
        address: configuration.host,
        port: configuration.port,
        server_name: configuration.host,
        protocol: "postgresql:" as const,
        redirects: "DENY" as const,
      };
    },
  };
  return Object.freeze(authorizer);
}

export function createEcommerceDemoConnectorFactory(): SchemaDiscoveryConnectorFactory {
  const factory: SchemaDiscoveryConnectorFactory = {
    create(input) {
      if (input.datasource_id !== ECOMMERCE_DEMO_DATASOURCE_ID) {
        throw new Error("ECOMMERCE_DEMO_CONNECTOR_DENIED");
      }
      const key = JSON.stringify([
        input.target.address,
        input.target.port,
        input.database,
        input.username,
        input.ssl,
      ]);
      let pool = pools.get(key);
      if (!pool) {
        pool = new Pool({
          host: input.target.address,
          port: input.target.port,
          database: input.database,
          user: input.username,
          password: input.secret_value,
          ssl:
            input.ssl === "disable" ? false : { rejectUnauthorized: input.ssl === "verify-full" },
          max: 2,
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
          application_name: "data-agent-ecommerce-schema-discovery",
        });
        pools.set(key, pool);
      }
      return adaptPgCatalogPool(pool);
    },
  };
  return Object.freeze(factory);
}

export async function closeEcommerceDemoConnectorPools(): Promise<void> {
  const active = [...pools.values()];
  pools.clear();
  await Promise.all(active.map((pool) => pool.end()));
}

export function ecommerceDemoRuntimeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    DATA_AGENT_ECOMMERCE_READER_PASSWORD:
      environment.DATA_AGENT_ECOMMERCE_READER_PASSWORD ?? ECOMMERCE_DEMO_LOCAL_PASSWORD,
  };
}
