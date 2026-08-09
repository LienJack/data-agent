import { z } from "zod";
import { contentHashSchema, immutableIdSchema, timestampSchema } from "../common/index.js";
import {
  checkConstraintSchema,
  columnIdentitySchema,
  foreignKeySchema,
  indexSchema,
  namedRelationObjectIdentitySchema,
  physicalColumnSchema,
  physicalRelationSchema,
  primaryKeySchema,
  relationIdentitySchema,
  relationKindSchema,
  uniqueConstraintSchema,
} from "./physical-schema.js";

const operationBase = {
  severity: z.enum(["INFO", "WARNING", "BREAKING"]),
} as const;

function addedOperation<K extends string, S extends z.ZodType>(kind: K, after: S) {
  return z.strictObject({ operation_kind: z.literal(kind), ...operationBase, after });
}

function removedOperation<K extends string, S extends z.ZodType>(kind: K, before: S) {
  return z.strictObject({ operation_kind: z.literal(kind), ...operationBase, before });
}

function changedOperation<K extends string, I extends z.ZodType, S extends z.ZodType>(
  kind: K,
  identity: I,
  value: S,
) {
  return z.strictObject({
    operation_kind: z.literal(kind),
    ...operationBase,
    identity,
    before: value,
    after: value,
  });
}

function identifiedAddedOperation<K extends string, I extends z.ZodType, S extends z.ZodType>(
  kind: K,
  identity: I,
  after: S,
) {
  return z.strictObject({ operation_kind: z.literal(kind), ...operationBase, identity, after });
}

function identifiedRemovedOperation<K extends string, I extends z.ZodType, S extends z.ZodType>(
  kind: K,
  identity: I,
  before: S,
) {
  return z.strictObject({ operation_kind: z.literal(kind), ...operationBase, identity, before });
}

const relationAddedSchema = addedOperation("RELATION_ADDED", physicalRelationSchema);
const relationRemovedSchema = removedOperation("RELATION_REMOVED", physicalRelationSchema);
const columnAddedSchema = z.strictObject({
  operation_kind: z.literal("COLUMN_ADDED"),
  ...operationBase,
  identity: columnIdentitySchema,
  after: physicalColumnSchema,
});
const columnRemovedSchema = z.strictObject({
  operation_kind: z.literal("COLUMN_REMOVED"),
  ...operationBase,
  identity: columnIdentitySchema,
  before: physicalColumnSchema,
});
const namedObjectChangeSchemas = [
  identifiedAddedOperation(
    "PRIMARY_KEY_ADDED",
    namedRelationObjectIdentitySchema,
    primaryKeySchema,
  ),
  identifiedRemovedOperation(
    "PRIMARY_KEY_REMOVED",
    namedRelationObjectIdentitySchema,
    primaryKeySchema,
  ),
  changedOperation("PRIMARY_KEY_CHANGED", namedRelationObjectIdentitySchema, primaryKeySchema),
  identifiedAddedOperation(
    "FOREIGN_KEY_ADDED",
    namedRelationObjectIdentitySchema,
    foreignKeySchema,
  ),
  identifiedRemovedOperation(
    "FOREIGN_KEY_REMOVED",
    namedRelationObjectIdentitySchema,
    foreignKeySchema,
  ),
  changedOperation("FOREIGN_KEY_CHANGED", namedRelationObjectIdentitySchema, foreignKeySchema),
  identifiedAddedOperation(
    "UNIQUE_CONSTRAINT_ADDED",
    namedRelationObjectIdentitySchema,
    uniqueConstraintSchema,
  ),
  identifiedRemovedOperation(
    "UNIQUE_CONSTRAINT_REMOVED",
    namedRelationObjectIdentitySchema,
    uniqueConstraintSchema,
  ),
  changedOperation(
    "UNIQUE_CONSTRAINT_CHANGED",
    namedRelationObjectIdentitySchema,
    uniqueConstraintSchema,
  ),
  identifiedAddedOperation(
    "CHECK_CONSTRAINT_ADDED",
    namedRelationObjectIdentitySchema,
    checkConstraintSchema,
  ),
  identifiedRemovedOperation(
    "CHECK_CONSTRAINT_REMOVED",
    namedRelationObjectIdentitySchema,
    checkConstraintSchema,
  ),
  changedOperation(
    "CHECK_CONSTRAINT_CHANGED",
    namedRelationObjectIdentitySchema,
    checkConstraintSchema,
  ),
  identifiedAddedOperation("INDEX_ADDED", namedRelationObjectIdentitySchema, indexSchema),
  identifiedRemovedOperation("INDEX_REMOVED", namedRelationObjectIdentitySchema, indexSchema),
  changedOperation("INDEX_CHANGED", namedRelationObjectIdentitySchema, indexSchema),
] as const;

export const schemaDriftOperationSchema = z.discriminatedUnion("operation_kind", [
  relationAddedSchema,
  relationRemovedSchema,
  changedOperation("RELATION_KIND_CHANGED", relationIdentitySchema, relationKindSchema),
  changedOperation(
    "RELATION_COMMENT_CHANGED",
    relationIdentitySchema,
    z.string().max(32_768).nullable(),
  ),
  columnAddedSchema,
  columnRemovedSchema,
  changedOperation("COLUMN_ORDINAL_CHANGED", columnIdentitySchema, z.number().int().positive()),
  changedOperation(
    "COLUMN_TYPE_CHANGED",
    columnIdentitySchema,
    z.strictObject({
      formatted_type: z.string().min(1).max(2_048),
      type_identity: physicalColumnSchema.shape.type_identity,
    }),
  ),
  changedOperation("COLUMN_NULLABILITY_CHANGED", columnIdentitySchema, z.boolean()),
  changedOperation(
    "COLUMN_DEFAULT_CHANGED",
    columnIdentitySchema,
    z.string().max(32_768).nullable(),
  ),
  changedOperation(
    "COLUMN_IDENTITY_CHANGED",
    columnIdentitySchema,
    z.enum(["ALWAYS", "BY_DEFAULT"]).nullable(),
  ),
  changedOperation(
    "COLUMN_GENERATED_CHANGED",
    columnIdentitySchema,
    z.string().max(32_768).nullable(),
  ),
  changedOperation(
    "COLUMN_COMMENT_CHANGED",
    columnIdentitySchema,
    z.string().max(32_768).nullable(),
  ),
  ...namedObjectChangeSchemas,
]);

export const schemaDriftEventSchema = z.strictObject({
  schema_version: z.literal("schema-drift-event@1.0.0"),
  drift_event_id: immutableIdSchema,
  datasource_id: z.string().min(1).max(128),
  datasource_fingerprint: contentHashSchema,
  base_snapshot_content_hash: contentHashSchema,
  current_snapshot_content_hash: contentHashSchema,
  observed_at: timestampSchema,
  severity: z.enum(["NONE", "INFO", "WARNING", "BREAKING"]),
  binding_impact: z.literal("UNKNOWN"),
  operations: z.array(schemaDriftOperationSchema).max(1_000_000),
});

export const schemaDriftCommitResultSchema = z.strictObject({
  schema_version: z.literal("schema-drift-commit-result@1.0.0"),
  authority: z.enum(["POSTGRESQL", "NON_AUTHORITATIVE_MOCK"]),
  drift_event_id: immutableIdSchema,
  event_storage_digest: contentHashSchema,
  created: z.boolean(),
});

export type SchemaDriftOperation = z.infer<typeof schemaDriftOperationSchema>;
export type SchemaDriftEvent = z.infer<typeof schemaDriftEventSchema>;
export type SchemaDriftCommitResult = z.infer<typeof schemaDriftCommitResultSchema>;
