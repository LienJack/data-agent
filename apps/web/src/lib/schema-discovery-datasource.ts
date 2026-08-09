import "server-only";

import { dataSourceCredentialRefSchema, sha256ContentHash } from "@data-agent/contracts";
import type { PostgresCatalogConnector } from "@data-agent/platform";
import { z } from "zod";
import type { SchemaDiscoveryAuthorityContext } from "./schema-discovery-authority";
import type {
  ResolvedSchemaDiscoveryDatasource,
  SchemaDiscoveryDatasourceResolver,
} from "./schema-discovery-service";

const datasourceMetadataSchema = z.strictObject({
  schema_version: z.literal("schema-discovery-datasource-metadata@1.0.0"),
  datasource_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  type: z.literal("postgresql"),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  database: z.string().trim().min(1).max(256),
  username: z.string().trim().min(1).max(256),
  ssl: z.enum(["disable", "require", "verify-ca", "verify-full"]),
  credential_ref: dataSourceCredentialRefSchema,
});

const egressTargetSchema = z.strictObject({
  address: z.string().min(2).max(64),
  port: z.number().int().min(1).max(65_535),
  server_name: z.string().min(1).max(253),
  protocol: z.literal("postgresql:"),
  redirects: z.literal("DENY"),
});

const resolvedSecretSchema = z.strictObject({
  username: z.string().trim().min(1).max(256).optional(),
  secret_value: z.string().min(1).max(65_536),
});

export type SchemaDiscoveryDatasourceMetadata = z.infer<typeof datasourceMetadataSchema>;
export type SchemaDiscoveryEgressTarget = z.infer<typeof egressTargetSchema>;
export type SchemaDiscoveryResolvedSecret = z.infer<typeof resolvedSecretSchema>;

export interface SchemaDiscoveryDatasourceMetadataResolver {
  resolve(datasourceId: string, authority: SchemaDiscoveryAuthorityContext): Promise<unknown>;
}

export interface SchemaDiscoverySecretResolver {
  resolve(
    reference: SchemaDiscoveryDatasourceMetadata["credential_ref"],
    authority: SchemaDiscoveryAuthorityContext,
  ): Promise<unknown>;
}

export interface SchemaDiscoveryEgressAuthorizer {
  authorize(
    request: Readonly<{
      datasource_id: string;
      host: string;
      port: number;
      protocol: "postgresql:";
    }>,
    authority: SchemaDiscoveryAuthorityContext,
  ): Promise<unknown>;
}

export interface SchemaDiscoveryConnectorFactory {
  create(
    input: Readonly<{
      datasource_id: string;
      target: SchemaDiscoveryEgressTarget;
      database: string;
      username: string;
      secret_value: string;
      ssl: SchemaDiscoveryDatasourceMetadata["ssl"];
    }>,
  ): PostgresCatalogConnector;
}

export function createSchemaDiscoveryDatasourceResolver(
  dependencies: Readonly<{
    metadataResolver: SchemaDiscoveryDatasourceMetadataResolver;
    egressAuthorizer: SchemaDiscoveryEgressAuthorizer;
    secretResolver: SchemaDiscoverySecretResolver;
    connectorFactory: SchemaDiscoveryConnectorFactory;
  }>,
): SchemaDiscoveryDatasourceResolver {
  return Object.freeze({
    async resolve(
      datasourceId: string,
      authority: SchemaDiscoveryAuthorityContext,
    ): Promise<ResolvedSchemaDiscoveryDatasource> {
      const metadata = datasourceMetadataSchema.parse(
        await dependencies.metadataResolver.resolve(datasourceId, authority),
      );
      const reference = metadata.credential_ref;
      if (
        metadata.datasource_id !== datasourceId ||
        reference.app_id !== authority.scope.appId ||
        reference.tenant_id !== authority.scope.tenantId ||
        reference.environment !== authority.scope.environment ||
        reference.rotation_state !== "ACTIVE"
      ) {
        throw new Error("schema discovery datasource scope unavailable");
      }
      const target = egressTargetSchema.parse(
        await dependencies.egressAuthorizer.authorize(
          {
            datasource_id: metadata.datasource_id,
            host: metadata.host,
            port: metadata.port,
            protocol: "postgresql:",
          },
          authority,
        ),
      );
      if (target.port !== metadata.port || target.server_name !== metadata.host) {
        throw new Error("schema discovery egress target mismatch");
      }
      const secret = resolvedSecretSchema.parse(
        await dependencies.secretResolver.resolve(reference, authority),
      );
      const datasourceFingerprint = await sha256ContentHash({
        schema_version: "schema-discovery-datasource-fingerprint@1.0.0",
        datasource_id: metadata.datasource_id,
        type: metadata.type,
        host: metadata.host,
        port: metadata.port,
        database: metadata.database,
        username: secret.username ?? metadata.username,
        ssl: metadata.ssl,
        credential_ref_id: reference.credential_ref_id,
        secret_ref_id: reference.secret_ref_id,
        secret_version: reference.secret_version,
      });
      const connector = dependencies.connectorFactory.create({
        datasource_id: metadata.datasource_id,
        target,
        database: metadata.database,
        username: secret.username ?? metadata.username,
        secret_value: secret.secret_value,
        ssl: metadata.ssl,
      });
      if (!connector || typeof connector.connect !== "function") {
        throw new Error("schema discovery connector unavailable");
      }
      return Object.freeze({
        datasource_fingerprint: datasourceFingerprint,
        connector,
      });
    },
  });
}
