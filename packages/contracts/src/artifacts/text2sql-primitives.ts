import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  postgresqlOutputAliasSchema,
  versionIdentifierSchema,
} from "../common/index.js";

const contextVersionedResourceSchema = z.strictObject({
  resource_id: z.uuid(),
  resource_revision: z.number().int().positive().safe(),
  resource_hash: contentHashSchema,
});

const contextSemanticReleaseSchema = contextVersionedResourceSchema.extend({
  datasource_id: z.uuid(),
  semantic_generation: z.number().int().positive().safe(),
  publication_status: z.literal("PUBLISHED"),
});

const contextSchemaSnapshotSchema = contextVersionedResourceSchema.extend({
  datasource_id: z.uuid(),
  semantic_release_id: z.uuid(),
  semantic_generation: z.number().int().positive().safe(),
});

const canonicalBindingIdsSchema = z
  .array(versionIdentifierSchema)
  .min(1)
  .max(512)
  .superRefine((values, ctx) => {
    values.forEach((value, index) => {
      if (index > 0 && (values[index - 1] ?? "") >= value) {
        ctx.addIssue({
          code: "custom",
          message: "Text2SQL binding identities must be unique and canonically sorted.",
          path: [index],
        });
      }
    });
  });

const canonicalProjectionHashesSchema = z
  .array(contentHashSchema)
  .min(1)
  .max(32)
  .superRefine((values, ctx) => {
    values.forEach((value, index) => {
      if (index > 0 && (values[index - 1] ?? "") >= value) {
        ctx.addIssue({
          code: "custom",
          message: "Semantic projection hashes must be unique and canonically sorted.",
          path: [index],
        });
      }
    });
  });

export const resolvedContextText2SqlBindingDraftSchema = z
  .strictObject({
    schema_version: z.literal("resolved-context-text2sql-binding@1.0.0"),
    scope: appScopeSchema,
    resolved_context_package_ref: z.strictObject({
      package_id: z.uuid(),
      package_revision: z.literal(1),
      package_hash: contentHashSchema,
    }),
    authority_snapshot_hash: contentHashSchema,
    semantic_release: contextSemanticReleaseSchema,
    schema_snapshot: contextSchemaSnapshotSchema,
    route: z.enum(["METRIC", "ONTOLOGY_TEXT2SQL"]),
    selected_metric_id: versionIdentifierSchema.nullable(),
    selected_ontology_ids: z.array(versionIdentifierSchema).max(256),
    mapping_refs: canonicalBindingIdsSchema,
    semantic_projection_hashes: canonicalProjectionHashesSchema,
    mapping_closure_hash: contentHashSchema,
  })
  .superRefine((binding, ctx) => {
    if (
      binding.semantic_release.datasource_id !== binding.schema_snapshot.datasource_id ||
      binding.semantic_release.resource_id !== binding.schema_snapshot.semantic_release_id ||
      binding.semantic_release.semantic_generation !== binding.schema_snapshot.semantic_generation
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Text2SQL binding Release and Schema Snapshot must be exact.",
        path: ["schema_snapshot"],
      });
    }
    if ((binding.route === "METRIC") !== (binding.selected_metric_id !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "Metric route must bind exactly one selected Metric.",
        path: ["selected_metric_id"],
      });
    }
    if ((binding.route === "ONTOLOGY_TEXT2SQL") !== binding.selected_ontology_ids.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Ontology route must bind at least one selected Ontology object.",
        path: ["selected_ontology_ids"],
      });
    }
  });

export const resolvedContextText2SqlBindingSchema =
  resolvedContextText2SqlBindingDraftSchema.extend({ binding_hash: contentHashSchema });

export type ResolvedContextText2SqlBinding = z.infer<typeof resolvedContextText2SqlBindingSchema>;

export const qualifiedColumnIdSchema = versionIdentifierSchema.refine(
  (value) => /^[A-Za-z0-9][A-Za-z0-9_:@/+~-]*\.[A-Za-z0-9][A-Za-z0-9_:@/+~-]*$/.test(value),
  "字段 ID 必须使用稳定的 <table_id>.<column_id> 两段式限定名。",
);

export function qualifiedColumnBelongsToTable(columnId: string, tableId: string): boolean {
  return columnId.startsWith(`${tableId}.`);
}

export const catalogColumnContractSchema = z.strictObject({
  column_id: qualifiedColumnIdSchema,
  physical_name: versionIdentifierSchema,
  data_type: z.enum([
    "boolean",
    "date",
    "integer",
    "numeric",
    "text",
    "timestamp",
    "timestamptz",
    "uuid",
  ]),
  nullable: z.boolean(),
  sensitivity: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"]),
});

export const catalogTableContractSchema = z
  .strictObject({
    table_id: versionIdentifierSchema,
    physical_name: versionIdentifierSchema,
    columns: z.array(catalogColumnContractSchema).min(1),
  })
  .superRefine((table, ctx) => {
    const seenColumnIds = new Set<string>();
    for (const [columnIndex, column] of table.columns.entries()) {
      if (!qualifiedColumnBelongsToTable(column.column_id, table.table_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Catalog Column 的限定名前缀必须等于所属 table_id。",
          path: ["columns", columnIndex, "column_id"],
        });
      }
      if (seenColumnIds.has(column.column_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Catalog Table 不能包含重复 Column。",
          path: ["columns", columnIndex, "column_id"],
        });
      }
      seenColumnIds.add(column.column_id);
    }
  });

export const catalogRelationshipContractSchema = z
  .strictObject({
    relationship_id: versionIdentifierSchema,
    left_table_id: versionIdentifierSchema,
    left_column_ids: z.array(qualifiedColumnIdSchema).min(1),
    right_table_id: versionIdentifierSchema,
    right_column_ids: z.array(qualifiedColumnIdSchema).min(1),
    cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one"]),
    left_row_match: z.enum(["required", "optional"]),
    right_row_match: z.enum(["required", "optional"]),
  })
  .superRefine((relationship, ctx) => {
    if (relationship.left_column_ids.length !== relationship.right_column_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Relationship 两侧必须声明相同数量的复合 Join Key。",
        path: ["right_column_ids"],
      });
    }
    if (new Set(relationship.left_column_ids).size !== relationship.left_column_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Relationship 左侧复合 Join Key 不能重复 Column。",
        path: ["left_column_ids"],
      });
    }
    if (new Set(relationship.right_column_ids).size !== relationship.right_column_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Relationship 右侧复合 Join Key 不能重复 Column。",
        path: ["right_column_ids"],
      });
    }
    for (const [columnIndex, columnId] of relationship.left_column_ids.entries()) {
      if (!qualifiedColumnBelongsToTable(columnId, relationship.left_table_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Relationship 左侧 Column 必须属于 left_table_id。",
          path: ["left_column_ids", columnIndex],
        });
      }
    }
    for (const [columnIndex, columnId] of relationship.right_column_ids.entries()) {
      if (!qualifiedColumnBelongsToTable(columnId, relationship.right_table_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Relationship 右侧 Column 必须属于 right_table_id。",
          path: ["right_column_ids", columnIndex],
        });
      }
    }
  });

export type CatalogRelationshipContract = z.infer<typeof catalogRelationshipContractSchema>;

export function joinTypeForPreservedTable(
  relationship: CatalogRelationshipContract,
  preservedTableId: string,
): "inner" | "left" {
  if (preservedTableId === relationship.left_table_id) {
    return relationship.left_row_match === "required" ? "inner" : "left";
  }
  if (preservedTableId === relationship.right_table_id) {
    return relationship.right_row_match === "required" ? "inner" : "left";
  }
  throw new TypeError("RELATIONSHIP_PRESERVED_TABLE_NOT_FOUND");
}

export const metricBindingSchema = z
  .strictObject({
    metric_id: postgresqlOutputAliasSchema,
    aliases: z.array(z.string().min(1).max(128)).min(1),
    table_id: versionIdentifierSchema,
    column_id: qualifiedColumnIdSchema,
    aggregation: z.enum(["sum", "count", "count_distinct", "avg", "min", "max"]),
    grain: versionIdentifierSchema,
    unit: versionIdentifierSchema,
    time_column_id: qualifiedColumnIdSchema.nullable(),
    additivity: z.enum(["additive", "semi-additive", "non-additive"]),
    null_policy: z.enum(["preserve", "coalesce-zero", "exclude"]),
    dependency_column_ids: z.array(qualifiedColumnIdSchema).min(1),
    fanout_policy: z.enum(["preaggregate", "reject"]),
  })
  .superRefine((metric, ctx) => {
    if (new Set(metric.dependency_column_ids).size !== metric.dependency_column_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Metric Dependency Column 必须唯一。",
        path: ["dependency_column_ids"],
      });
    }
    const bindings: ReadonlyArray<{
      readonly columnId: string;
      readonly path: PropertyKey[];
    }> = [
      { columnId: metric.column_id, path: ["column_id"] },
      ...(metric.time_column_id === null
        ? []
        : [{ columnId: metric.time_column_id, path: ["time_column_id"] }]),
      ...metric.dependency_column_ids.map((columnId, index) => ({
        columnId,
        path: ["dependency_column_ids", index],
      })),
    ];
    for (const binding of bindings) {
      if (!qualifiedColumnBelongsToTable(binding.columnId, metric.table_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Metric 绑定 Column 必须属于其 table_id。",
          path: binding.path,
        });
      }
    }
  });

export const dimensionBindingSchema = z
  .strictObject({
    dimension_id: postgresqlOutputAliasSchema,
    aliases: z.array(z.string().min(1).max(128)).min(1),
    table_id: versionIdentifierSchema,
    column_id: qualifiedColumnIdSchema,
    grain: versionIdentifierSchema,
  })
  .superRefine((dimension, ctx) => {
    if (!qualifiedColumnBelongsToTable(dimension.column_id, dimension.table_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Dimension 绑定 Column 必须属于其 table_id。",
        path: ["column_id"],
      });
    }
  });

export const allowedTableContractSchema = z
  .strictObject({
    table_id: versionIdentifierSchema,
    column_ids: z.array(qualifiedColumnIdSchema).min(1),
  })
  .superRefine((table, ctx) => {
    const seenColumnIds = new Set<string>();
    for (const [columnIndex, columnId] of table.column_ids.entries()) {
      if (!qualifiedColumnBelongsToTable(columnId, table.table_id)) {
        ctx.addIssue({
          code: "custom",
          message: "AllowedSchema Column 必须属于其 table_id。",
          path: ["column_ids", columnIndex],
        });
      }
      if (seenColumnIds.has(columnId)) {
        ctx.addIssue({
          code: "custom",
          message: "AllowedSchema Table 不能包含重复 Column。",
          path: ["column_ids", columnIndex],
        });
      }
      seenColumnIds.add(columnId);
    }
  });

export const mandatoryPredicateContractSchema = z
  .strictObject({
    table_id: versionIdentifierSchema,
    column_id: qualifiedColumnIdSchema,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "is_null", "is_not_null"]),
    parameter_key: versionIdentifierSchema,
  })
  .superRefine((predicate, ctx) => {
    if (!qualifiedColumnBelongsToTable(predicate.column_id, predicate.table_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Mandatory Predicate Column 必须属于其 table_id。",
        path: ["column_id"],
      });
    }
  });
export const METRIC_AGGREGATION = ["sum", "count", "count_distinct", "avg", "min", "max"] as const;
export const METRIC_ADDITIVITY = ["additive", "semi-additive", "non-additive"] as const;
export const METRIC_NULL_POLICY = ["preserve", "coalesce-zero", "exclude"] as const;
export const METRIC_FANOUT_POLICY = ["preaggregate", "reject"] as const;
export const DATA_TYPE = [
  "boolean",
  "date",
  "integer",
  "numeric",
  "text",
  "timestamp",
  "timestamptz",
  "uuid",
] as const;
export const SENSITIVITY_LEVEL = ["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"] as const;
