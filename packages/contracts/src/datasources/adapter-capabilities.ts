import { z } from "zod";
import {
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";

export const MANDATORY_DATASOURCE_ADAPTER_IDS = [
  "clickhouse",
  "duckdb",
  "mysql",
  "postgresql",
  "sqlite",
] as const;

export const datasourceAdapterIdSchema = z.enum(MANDATORY_DATASOURCE_ADAPTER_IDS);
export const datasourceAdapterCapabilitySchema = z.enum([
  "CONNECTION",
  "SCHEMA_SCAN",
  "GOVERNED_QUERY",
]);

const adapterFieldIdSchema = z.enum([
  "host",
  "port",
  "database",
  "username",
  "credentialRef",
  "ssl",
  "path",
]);

const adapterFieldSchema = z.strictObject({
  field_id: adapterFieldIdSchema,
  kind: z.enum(["TEXT", "INTEGER", "SECRET_REF", "SELECT", "FILE_PATH"]),
  label_key: versionIdentifierSchema,
  required: z.boolean(),
  default_value: z.union([z.string(), z.number().int().safe()]).nullable(),
  options: z.array(z.string().min(1).max(64)).max(16),
  placeholder: z.string().max(256).nullable(),
});

const packageBindingSchema = z.strictObject({
  package_name: z.string().min(1).max(128),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/),
  license: z.enum(["Apache-2.0", "MIT", "PostgreSQL"]),
});

const descriptorDraftSchema = z
  .strictObject({
    schema_version: z.literal("datasource-adapter-descriptor@1.0.0"),
    adapter_id: datasourceAdapterIdSchema,
    revision: z.number().int().positive().safe(),
    display_name: z.string().min(1).max(64),
    category: z.enum(["RELATIONAL", "ANALYTICS", "FILE"]),
    dialect: z.enum(["POSTGRESQL", "MYSQL", "SQLITE", "DUCKDB", "CLICKHOUSE"]),
    topology: z.enum(["WORKER_NETWORK", "WORKER_FILE", "WORKER_MEMORY"]),
    supported_capabilities: z.array(datasourceAdapterCapabilitySchema).length(3),
    fields: z.array(adapterFieldSchema).min(1).max(16),
    driver: packageBindingSchema,
    parser: packageBindingSchema,
    documentation_url: z.url().max(2_000),
  })
  .superRefine((descriptor, ctx) => {
    if (descriptor.supported_capabilities.join(",") !== "CONNECTION,SCHEMA_SCAN,GOVERNED_QUERY") {
      ctx.addIssue({
        code: "custom",
        message: "Adapter capabilities must contain the complete ordered mandatory set.",
        path: ["supported_capabilities"],
      });
    }
    const fieldIds = descriptor.fields.map(({ field_id }) => field_id);
    if (new Set(fieldIds).size !== fieldIds.length) {
      ctx.addIssue({ code: "custom", message: "Adapter fields must be unique.", path: ["fields"] });
    }
    descriptor.fields.forEach((field, index) => {
      if (
        (field.kind === "SELECT" && field.options.length === 0) ||
        (field.kind !== "SELECT" && field.options.length > 0)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Only SELECT fields may define non-empty options.",
          path: ["fields", index, "options"],
        });
      }
    });
  });

export const datasourceAdapterDescriptorSchema = descriptorDraftSchema.extend({
  descriptor_hash: contentHashSchema,
});

const field = (
  field_id: z.infer<typeof adapterFieldIdSchema>,
  kind: z.infer<typeof adapterFieldSchema>["kind"],
  required: boolean,
  options: readonly string[] = [],
  default_value: string | number | null = null,
  placeholder: string | null = null,
) => ({
  field_id,
  kind,
  label_key: `datasource.field.${field_id}`,
  required,
  default_value,
  options: [...options],
  placeholder,
});

const networkFields = (defaultPort: number, database: string) => [
  field("host", "TEXT", true, [], null, "db.example.com"),
  field("port", "INTEGER", true, [], defaultPort),
  field("database", "TEXT", true, [], database),
  field("username", "TEXT", true),
  field("credentialRef", "SECRET_REF", true),
  field("ssl", "SELECT", true, ["disable", "require", "verify-ca", "verify-full"], "verify-full"),
];

export const MANDATORY_DATASOURCE_ADAPTER_DEFINITIONS = [
  {
    adapter_id: "clickhouse",
    display_name: "ClickHouse",
    category: "ANALYTICS",
    dialect: "CLICKHOUSE",
    topology: "WORKER_NETWORK",
    fields: networkFields(8443, "default"),
    driver: { package_name: "@clickhouse/client", version: "1.20.0", license: "Apache-2.0" },
    parser: { package_name: "@clickhouse/client", version: "1.20.0", license: "Apache-2.0" },
    documentation_url: "https://clickhouse.com/docs/integrations/language-clients/javascript",
  },
  {
    adapter_id: "duckdb",
    display_name: "DuckDB",
    category: "ANALYTICS",
    dialect: "DUCKDB",
    topology: "WORKER_FILE",
    fields: [field("path", "FILE_PATH", true, [], null, "/data/analytics.duckdb")],
    driver: { package_name: "@duckdb/node-api", version: "1.5.2-r.2", license: "MIT" },
    parser: { package_name: "@duckdb/node-api", version: "1.5.2-r.2", license: "MIT" },
    documentation_url: "https://duckdb.org/docs/stable/clients/node_neo/overview",
  },
  {
    adapter_id: "mysql",
    display_name: "MySQL",
    category: "RELATIONAL",
    dialect: "MYSQL",
    topology: "WORKER_NETWORK",
    fields: networkFields(3306, "analytics"),
    driver: { package_name: "mysql2", version: "3.23.2", license: "MIT" },
    parser: { package_name: "node-sql-parser", version: "5.4.0", license: "Apache-2.0" },
    documentation_url: "https://sidorares.github.io/node-mysql2/docs",
  },
  {
    adapter_id: "postgresql",
    display_name: "PostgreSQL",
    category: "RELATIONAL",
    dialect: "POSTGRESQL",
    topology: "WORKER_NETWORK",
    fields: networkFields(5432, "analytics"),
    driver: { package_name: "pg", version: "8.22.0", license: "MIT" },
    parser: { package_name: "pgsql-parser", version: "18.1.1", license: "MIT" },
    documentation_url: "https://node-postgres.com/",
  },
  {
    adapter_id: "sqlite",
    display_name: "SQLite",
    category: "FILE",
    dialect: "SQLITE",
    topology: "WORKER_FILE",
    fields: [field("path", "FILE_PATH", true, [], null, "/data/analytics.sqlite")],
    driver: { package_name: "node:sqlite", version: "24.0.0", license: "MIT" },
    parser: { package_name: "node-sql-parser", version: "5.4.0", license: "Apache-2.0" },
    documentation_url: "https://nodejs.org/api/sqlite.html",
  },
] as const;

export async function buildDatasourceAdapterDescriptor(input: unknown) {
  const draft = descriptorDraftSchema.parse(input);
  return deepFreeze(
    datasourceAdapterDescriptorSchema.parse({
      ...draft,
      descriptor_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyDatasourceAdapterDescriptor(input: unknown) {
  const descriptor = datasourceAdapterDescriptorSchema.parse(input);
  const { descriptor_hash: actual, ...draft } = descriptor;
  if ((await sha256ContentHash(descriptorDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("DATASOURCE_ADAPTER_DESCRIPTOR_HASH_MISMATCH");
  }
  return deepFreeze(descriptor);
}

export const DATASOURCE_ADAPTER_CERTIFICATION_CHECKS = [
  "BYTE_LIMIT",
  "CONNECTION",
  "EXPLAIN",
  "READ_ONLY",
  "ROW_LIMIT",
  "SCHEMA_SCAN",
  "SECRET_REDACTION",
  "SINGLE_STATEMENT",
  "TARGET_SCOPE",
  "TIMEOUT",
] as const;

const certificationCheckSchema = z.strictObject({
  check_id: z.enum(DATASOURCE_ADAPTER_CERTIFICATION_CHECKS),
  status: z.enum(["PASS", "FAIL"]),
  evidence_hash: contentHashSchema,
});

const certificationDraftSchema = z
  .strictObject({
    schema_version: z.literal("datasource-adapter-certification@1.0.0"),
    adapter_id: datasourceAdapterIdSchema,
    adapter_revision: z.number().int().positive().safe(),
    descriptor_hash: contentHashSchema,
    implementation_hash: contentHashSchema,
    fixture_hash: contentHashSchema,
    checks: z
      .array(certificationCheckSchema)
      .length(DATASOURCE_ADAPTER_CERTIFICATION_CHECKS.length),
    result: z.enum(["READY", "BLOCKED"]),
    reason_codes: z.array(versionIdentifierSchema).max(32),
  })
  .superRefine((report, ctx) => {
    const checkIds = report.checks.map(({ check_id }) => check_id);
    if (checkIds.join(",") !== DATASOURCE_ADAPTER_CERTIFICATION_CHECKS.join(",")) {
      ctx.addIssue({
        code: "custom",
        message: "Certification checks must be complete, unique and canonically ordered.",
        path: ["checks"],
      });
    }
    const allPassed = report.checks.every(({ status }) => status === "PASS");
    if (
      (report.result === "READY" && (!allPassed || report.reason_codes.length > 0)) ||
      (report.result === "BLOCKED" && allPassed)
    ) {
      ctx.addIssue({ code: "custom", message: "Certification result does not match checks." });
    }
  });

export const datasourceAdapterCertificationSchema = certificationDraftSchema.extend({
  certification_hash: contentHashSchema,
});

export async function buildDatasourceAdapterCertification(input: unknown) {
  const draft = certificationDraftSchema.parse(input);
  return deepFreeze(
    datasourceAdapterCertificationSchema.parse({
      ...draft,
      certification_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyDatasourceAdapterCertification(input: unknown) {
  const report = datasourceAdapterCertificationSchema.parse(input);
  const { certification_hash: actual, ...draft } = report;
  if ((await sha256ContentHash(certificationDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("DATASOURCE_ADAPTER_CERTIFICATION_HASH_MISMATCH");
  }
  return deepFreeze(report);
}

export const datasourceAdapterRegistryItemSchema = z
  .strictObject({
    descriptor: datasourceAdapterDescriptorSchema,
    certification: datasourceAdapterCertificationSchema.nullable(),
    effective_capability: z.enum(["BLOCKED", "CONNECTION", "SCHEMA_SCAN", "GOVERNED_QUERY"]),
  })
  .superRefine((item, ctx) => {
    if (
      item.certification &&
      (item.certification.adapter_id !== item.descriptor.adapter_id ||
        item.certification.adapter_revision !== item.descriptor.revision ||
        item.certification.descriptor_hash !== item.descriptor.descriptor_hash)
    ) {
      ctx.addIssue({ code: "custom", message: "Certification must bind the exact descriptor." });
    }
    if (
      (item.effective_capability === "GOVERNED_QUERY") !==
      (item.certification?.result === "READY")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "GOVERNED_QUERY requires an exact READY certification.",
        path: ["effective_capability"],
      });
    }
  });

const registrySnapshotDraftSchema = z
  .strictObject({
    schema_version: z.literal("datasource-adapter-registry@1.0.0"),
    items: z.array(datasourceAdapterRegistryItemSchema).length(5),
    platform_ready: z.boolean(),
  })
  .superRefine((snapshot, ctx) => {
    const ids = snapshot.items.map(({ descriptor }) => descriptor.adapter_id);
    if (ids.join(",") !== MANDATORY_DATASOURCE_ADAPTER_IDS.join(",")) {
      ctx.addIssue({
        code: "custom",
        message: "Registry must contain the complete canonical mandatory Adapter set.",
        path: ["items"],
      });
    }
    const allReady = snapshot.items.every(
      ({ effective_capability }) => effective_capability === "GOVERNED_QUERY",
    );
    if (snapshot.platform_ready !== allReady) {
      ctx.addIssue({ code: "custom", message: "Platform readiness must match all Adapter items." });
    }
  });

export const datasourceAdapterRegistrySnapshotSchema = registrySnapshotDraftSchema.extend({
  registry_hash: contentHashSchema,
});

export async function buildDatasourceAdapterRegistrySnapshot(input: unknown) {
  const draft = registrySnapshotDraftSchema.parse(input);
  return deepFreeze(
    datasourceAdapterRegistrySnapshotSchema.parse({
      ...draft,
      registry_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyDatasourceAdapterRegistrySnapshot(input: unknown) {
  const snapshot = datasourceAdapterRegistrySnapshotSchema.parse(input);
  const { registry_hash: actual, ...draft } = snapshot;
  if ((await sha256ContentHash(registrySnapshotDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("DATASOURCE_ADAPTER_REGISTRY_HASH_MISMATCH");
  }
  return deepFreeze(snapshot);
}

export type DatasourceAdapterId = z.infer<typeof datasourceAdapterIdSchema>;
export type DatasourceAdapterCapability = z.infer<typeof datasourceAdapterCapabilitySchema>;
export type DatasourceAdapterDescriptor = z.infer<typeof datasourceAdapterDescriptorSchema>;
export type DatasourceAdapterCertification = z.infer<typeof datasourceAdapterCertificationSchema>;
export type DatasourceAdapterRegistryItem = z.infer<typeof datasourceAdapterRegistryItemSchema>;
export type DatasourceAdapterRegistrySnapshot = z.infer<
  typeof datasourceAdapterRegistrySnapshotSchema
>;

export const datasourceAdapterReferenceSchema = z.strictObject({
  adapter_id: datasourceAdapterIdSchema,
  adapter_revision: z.number().int().positive().safe(),
  descriptor_hash: contentHashSchema,
  dialect: z.enum(["POSTGRESQL", "MYSQL", "SQLITE", "DUCKDB", "CLICKHOUSE"]),
});

const governedQueryDraftSchema = z
  .strictObject({
    schema_version: z.literal("governed-datasource-query@1.0.0"),
    scope: appScopeSchema,
    query_id: immutableIdSchema,
    datasource_id: immutableIdSchema,
    adapter_ref: datasourceAdapterReferenceSchema,
    target_capability_hash: contentHashSchema,
    statement: z.string().trim().min(1).max(1_000_000),
    parameters: z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).max(256),
    allowed_relations: z.array(versionIdentifierSchema).min(1).max(256),
    limits: z.strictObject({
      timeout_ms: z.number().int().min(100).max(120_000).safe(),
      max_rows: z.number().int().positive().max(100_000).safe(),
      max_bytes: z.number().int().positive().max(100_000_000).safe(),
    }),
  })
  .superRefine((request, ctx) => {
    if (
      request.allowed_relations.some(
        (relation, index) => index > 0 && relation <= (request.allowed_relations[index - 1] ?? ""),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Allowed relations must be unique and canonically sorted.",
        path: ["allowed_relations"],
      });
    }
    const expectedDialect = request.adapter_ref.adapter_id.toUpperCase();
    if (request.adapter_ref.dialect !== expectedDialect) {
      ctx.addIssue({
        code: "custom",
        message: "Adapter ID and SQL dialect must match.",
        path: ["adapter_ref", "dialect"],
      });
    }
  });

export const governedDatasourceQueryRequestSchema = governedQueryDraftSchema.extend({
  request_hash: contentHashSchema,
});

export async function buildGovernedDatasourceQueryRequest(input: unknown) {
  const draft = governedQueryDraftSchema.parse(input);
  return deepFreeze(
    governedDatasourceQueryRequestSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyGovernedDatasourceQueryRequest(input: unknown) {
  const request = governedDatasourceQueryRequestSchema.parse(input);
  const { request_hash: actual, ...draft } = request;
  if ((await sha256ContentHash(governedQueryDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("GOVERNED_DATASOURCE_QUERY_HASH_MISMATCH");
  }
  return deepFreeze(request);
}

const governedQueryResultDraftSchema = z
  .strictObject({
    schema_version: z.literal("governed-datasource-query-result@1.0.0"),
    query_id: immutableIdSchema,
    request_hash: contentHashSchema,
    adapter_ref: datasourceAdapterReferenceSchema,
    columns: z
      .array(z.strictObject({ name: versionIdentifierSchema, type: z.string().max(128) }))
      .max(512),
    rows: z.array(z.record(z.string(), z.json())).max(100_000),
    row_count: z.number().int().nonnegative().max(100_000).safe(),
    byte_count: z.number().int().nonnegative().max(100_000_000).safe(),
    elapsed_ms: z.number().int().nonnegative().safe(),
    truncated: z.literal(false),
  })
  .superRefine((result, ctx) => {
    const expectedBytes = new TextEncoder().encode(
      canonicalizeJson({ columns: result.columns, rows: result.rows }),
    ).byteLength;
    if (result.row_count !== result.rows.length || result.byte_count !== expectedBytes) {
      ctx.addIssue({ code: "custom", message: "Query result counts do not match payload." });
    }
  });

export const governedDatasourceQueryResultSchema = governedQueryResultDraftSchema.extend({
  result_hash: contentHashSchema,
});

export async function buildGovernedDatasourceQueryResult(input: unknown) {
  const draft = governedQueryResultDraftSchema.parse(input);
  return deepFreeze(
    governedDatasourceQueryResultSchema.parse({
      ...draft,
      result_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyGovernedDatasourceQueryResult(input: unknown) {
  const result = governedDatasourceQueryResultSchema.parse(input);
  const { result_hash: actual, ...draft } = result;
  if ((await sha256ContentHash(governedQueryResultDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("GOVERNED_DATASOURCE_QUERY_RESULT_HASH_MISMATCH");
  }
  return deepFreeze(result);
}

export type DatasourceAdapterReference = z.infer<typeof datasourceAdapterReferenceSchema>;
export type GovernedDatasourceQueryRequest = z.infer<typeof governedDatasourceQueryRequestSchema>;
export type GovernedDatasourceQueryResult = z.infer<typeof governedDatasourceQueryResultSchema>;

const schemaScanDraftSchema = z.strictObject({
  schema_version: z.literal("governed-datasource-schema-scan@1.0.0"),
  scope: appScopeSchema,
  scan_id: immutableIdSchema,
  datasource_id: immutableIdSchema,
  adapter_ref: datasourceAdapterReferenceSchema,
  target_capability_hash: contentHashSchema,
  timeout_ms: z.number().int().min(100).max(120_000).safe(),
  max_objects: z.number().int().positive().max(10_000).safe(),
});

export const governedDatasourceSchemaScanRequestSchema = schemaScanDraftSchema.extend({
  request_hash: contentHashSchema,
});

export async function buildGovernedDatasourceSchemaScanRequest(input: unknown) {
  const draft = schemaScanDraftSchema.parse(input);
  return deepFreeze(
    governedDatasourceSchemaScanRequestSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyGovernedDatasourceSchemaScanRequest(input: unknown) {
  const request = governedDatasourceSchemaScanRequestSchema.parse(input);
  const { request_hash: actual, ...draft } = request;
  if ((await sha256ContentHash(schemaScanDraftSchema.parse(draft))) !== actual) {
    throw new TypeError("GOVERNED_DATASOURCE_SCHEMA_SCAN_HASH_MISMATCH");
  }
  return deepFreeze(request);
}

const schemaObjectSchema = z.strictObject({
  namespace: versionIdentifierSchema,
  name: versionIdentifierSchema,
  kind: z.enum(["TABLE", "VIEW"]),
  columns: z.array(
    z.strictObject({
      name: versionIdentifierSchema,
      type: z.string().min(1).max(256),
      nullable: z.boolean(),
    }),
  ),
});

const schemaScanResultDraftSchema = z
  .strictObject({
    schema_version: z.literal("governed-datasource-schema-scan-result@1.0.0"),
    scan_id: immutableIdSchema,
    request_hash: contentHashSchema,
    adapter_ref: datasourceAdapterReferenceSchema,
    objects: z.array(schemaObjectSchema).max(10_000),
  })
  .superRefine((result, ctx) => {
    const identities = result.objects.map(({ namespace, name }) => `${namespace}.${name}`);
    if (
      identities.some((identity, index) => index > 0 && identity <= (identities[index - 1] ?? ""))
    ) {
      ctx.addIssue({ code: "custom", message: "Schema objects must be unique and sorted." });
    }
  });

export const governedDatasourceSchemaScanResultSchema = schemaScanResultDraftSchema.extend({
  result_hash: contentHashSchema,
});

export async function buildGovernedDatasourceSchemaScanResult(input: unknown) {
  const draft = schemaScanResultDraftSchema.parse(input);
  return deepFreeze(
    governedDatasourceSchemaScanResultSchema.parse({
      ...draft,
      result_hash: await sha256ContentHash(draft),
    }),
  );
}

export type GovernedDatasourceSchemaScanRequest = z.infer<
  typeof governedDatasourceSchemaScanRequestSchema
>;
export type GovernedDatasourceSchemaScanResult = z.infer<
  typeof governedDatasourceSchemaScanResultSchema
>;
