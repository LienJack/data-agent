import { z } from "zod";
import { contentHashSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

const datasourceIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

export const postgresIdentifierSchema = z.string().min(1).max(256);

export const schemaScanRequestSchema = z.strictObject({
  schema_version: z.literal("schema-scan-request@1.0.0"),
  datasource_id: datasourceIdentifierSchema,
  include_schemas: z.array(postgresIdentifierSchema).min(1).max(64),
  page_size: z.number().int().min(1).max(1_000),
  statement_timeout_ms: z.number().int().min(100).max(120_000),
  base_snapshot_id: immutableIdSchema.optional(),
  idempotency_key: immutableIdSchema,
});

export const relationIdentitySchema = z.strictObject({
  schema_name: postgresIdentifierSchema,
  relation_name: postgresIdentifierSchema,
});

export const columnIdentitySchema = z.strictObject({
  relation: relationIdentitySchema,
  column_name: postgresIdentifierSchema,
});

export const namedRelationObjectIdentitySchema = z.strictObject({
  relation: relationIdentitySchema,
  object_name: postgresIdentifierSchema,
});

export const physicalTypeIdentitySchema = z.strictObject({
  type_schema: postgresIdentifierSchema,
  type_name: postgresIdentifierSchema,
  type_kind: z.enum(["BASE", "DOMAIN", "ENUM", "COMPOSITE", "PSEUDO", "RANGE", "MULTIRANGE"]),
  array_dimensions: z.number().int().min(0).max(32),
});

export const physicalColumnSchema = z.strictObject({
  column_name: postgresIdentifierSchema,
  ordinal_position: z.number().int().min(1).max(100_000),
  formatted_type: z.string().min(1).max(2_048),
  type_identity: physicalTypeIdentitySchema,
  nullable: z.boolean(),
  default_expression: z.string().max(32_768).nullable(),
  identity_generation: z.enum(["ALWAYS", "BY_DEFAULT"]).nullable(),
  generated_expression: z.string().max(32_768).nullable(),
  comment: z.string().max(32_768).nullable(),
});

export const primaryKeySchema = z.strictObject({
  constraint_name: postgresIdentifierSchema,
  columns: z.array(postgresIdentifierSchema).min(1).max(1_000),
  deferrable: z.boolean(),
  initially_deferred: z.boolean(),
});

export const foreignKeyColumnPairSchema = z.strictObject({
  column_name: postgresIdentifierSchema,
  referenced_column_name: postgresIdentifierSchema,
});

export const foreignKeySchema = z.strictObject({
  constraint_name: postgresIdentifierSchema,
  referenced_relation: relationIdentitySchema,
  column_pairs: z.array(foreignKeyColumnPairSchema).min(1).max(1_000),
  match_type: z.enum(["FULL", "PARTIAL", "SIMPLE"]),
  on_update: z.enum(["NO_ACTION", "RESTRICT", "CASCADE", "SET_NULL", "SET_DEFAULT"]),
  on_delete: z.enum(["NO_ACTION", "RESTRICT", "CASCADE", "SET_NULL", "SET_DEFAULT"]),
  deferrable: z.boolean(),
  initially_deferred: z.boolean(),
});

export const uniqueConstraintSchema = z.strictObject({
  constraint_name: postgresIdentifierSchema,
  columns: z.array(postgresIdentifierSchema).min(1).max(1_000),
  nulls_not_distinct: z.boolean(),
  deferrable: z.boolean(),
  initially_deferred: z.boolean(),
});

export const checkConstraintSchema = z.strictObject({
  constraint_name: postgresIdentifierSchema,
  expression: z.string().min(1).max(32_768),
  no_inherit: z.boolean(),
});

export const indexSchema = z.strictObject({
  index_name: postgresIdentifierSchema,
  access_method: postgresIdentifierSchema,
  unique: z.boolean(),
  valid: z.boolean(),
  ready: z.boolean(),
  key_expressions: z.array(z.string().min(1).max(32_768)).min(1).max(1_000),
  included_columns: z.array(postgresIdentifierSchema).max(1_000),
  predicate: z.string().max(32_768).nullable(),
});

export const relationKindSchema = z.enum([
  "TABLE",
  "PARTITIONED_TABLE",
  "VIEW",
  "MATERIALIZED_VIEW",
  "FOREIGN_TABLE",
]);

export const physicalRelationSchema = z.strictObject({
  identity: relationIdentitySchema,
  relation_kind: relationKindSchema,
  comment: z.string().max(32_768).nullable(),
  columns: z.array(physicalColumnSchema).max(10_000),
  primary_key: primaryKeySchema.nullable(),
  foreign_keys: z.array(foreignKeySchema).max(10_000),
  unique_constraints: z.array(uniqueConstraintSchema).max(10_000),
  check_constraints: z.array(checkConstraintSchema).max(10_000),
  indexes: z.array(indexSchema).max(10_000),
});

export const physicalSchemaContentSchema = z.strictObject({
  schema_version: z.literal("physical-schema-content@1.0.0"),
  datasource_id: datasourceIdentifierSchema,
  datasource_fingerprint: contentHashSchema,
  engine: z.literal("postgresql"),
  engine_version: z.strictObject({
    major: z.number().int().min(9).max(100),
    minor: z.number().int().min(0).max(10_000),
  }),
  database_identity: z.strictObject({
    database_name: postgresIdentifierSchema,
    database_oid: z.number().int().positive().safe(),
  }),
  included_schemas: z.array(postgresIdentifierSchema).min(1).max(64),
  relations: z.array(physicalRelationSchema).max(100_000),
});

export const physicalSchemaSnapshotDraftSchema = z.strictObject({
  schema_version: z.literal("physical-schema-snapshot-draft@1.0.0"),
  snapshot_id: immutableIdSchema,
  scan_run_id: immutableIdSchema,
  captured_at: timestampSchema,
  content: physicalSchemaContentSchema,
});

export const physicalSchemaSnapshotSchema = z.strictObject({
  schema_version: z.literal("physical-schema-snapshot@1.0.0"),
  snapshot_id: immutableIdSchema,
  scan_run_id: immutableIdSchema,
  snapshot_content_hash: contentHashSchema,
  captured_at: timestampSchema,
  content: physicalSchemaContentSchema,
});

export const schemaScanErrorCodeSchema = z.enum([
  "SCHEMA_SCAN_CANCELLED",
  "SCHEMA_SCAN_TIMEOUT",
  "SCHEMA_SCAN_PERMISSION_DENIED",
  "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE",
  "SCHEMA_SCAN_CATALOG_CONTRACT_INVALID",
  "SCHEMA_SCAN_LIMIT_EXCEEDED",
  "SCHEMA_SCAN_SCOPE_FORBIDDEN",
  "SCHEMA_SCAN_IDEMPOTENCY_CONFLICT",
]);

export const schemaScanTerminalSchema = z.union([
  z.literal("SUCCEEDED"),
  schemaScanErrorCodeSchema,
]);

export const schemaScanRunSchema = z.strictObject({
  schema_version: z.literal("schema-scan-run@1.0.0"),
  scan_run_id: immutableIdSchema,
  datasource_id: datasourceIdentifierSchema,
  datasource_fingerprint: contentHashSchema,
  snapshot_id: immutableIdSchema.nullable(),
  snapshot_content_hash: contentHashSchema.nullable(),
  terminal: schemaScanTerminalSchema,
  captured_at: timestampSchema,
});

export const schemaScanCommitResultSchema = z.strictObject({
  schema_version: z.literal("schema-scan-commit-result@1.0.0"),
  authority: z.enum(["POSTGRESQL", "NON_AUTHORITATIVE_MOCK"]),
  scan_run_id: immutableIdSchema,
  snapshot_id: immutableIdSchema.nullable(),
  snapshot_content_hash: contentHashSchema.nullable(),
  terminal: schemaScanTerminalSchema,
  created: z.boolean(),
});

export type SchemaScanRequest = z.infer<typeof schemaScanRequestSchema>;
export type RelationIdentity = z.infer<typeof relationIdentitySchema>;
export type ColumnIdentity = z.infer<typeof columnIdentitySchema>;
export type NamedRelationObjectIdentity = z.infer<typeof namedRelationObjectIdentitySchema>;
export type PhysicalColumn = z.infer<typeof physicalColumnSchema>;
export type PrimaryKey = z.infer<typeof primaryKeySchema>;
export type ForeignKey = z.infer<typeof foreignKeySchema>;
export type UniqueConstraint = z.infer<typeof uniqueConstraintSchema>;
export type CheckConstraint = z.infer<typeof checkConstraintSchema>;
export type PhysicalIndex = z.infer<typeof indexSchema>;
export type RelationKind = z.infer<typeof relationKindSchema>;
export type PhysicalRelation = z.infer<typeof physicalRelationSchema>;
export type PhysicalSchemaContent = z.infer<typeof physicalSchemaContentSchema>;
export type PhysicalSchemaSnapshotDraft = z.infer<typeof physicalSchemaSnapshotDraftSchema>;
export type PhysicalSchemaSnapshot = z.infer<typeof physicalSchemaSnapshotSchema>;
export type SchemaScanErrorCode = z.infer<typeof schemaScanErrorCodeSchema>;
export type SchemaScanTerminal = z.infer<typeof schemaScanTerminalSchema>;
export type SchemaScanRun = z.infer<typeof schemaScanRunSchema>;
export type SchemaScanCommitResult = z.infer<typeof schemaScanCommitResultSchema>;
