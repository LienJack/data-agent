import {
  allowedTableContractSchema,
  appScopeSchema,
  catalogColumnContractSchema,
  catalogRelationshipContractSchema,
  catalogTableContractSchema,
  dimensionBindingSchema,
  groundingContentSchema,
  immutableIdSchema,
  mandatoryPredicateContractSchema,
  metricBindingSchema,
  queryContractSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";

export const catalogColumnSchema = catalogColumnContractSchema;

export const catalogTableSchema = catalogTableContractSchema;

export const catalogRelationshipSchema = catalogRelationshipContractSchema;
export const catalogMetricSchema = metricBindingSchema;
export const catalogDimensionSchema = dimensionBindingSchema;

function addDuplicateIssue(
  values: readonly string[],
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: "custom", message, path });
  }
}

export const catalogSnapshotSchema = z
  .strictObject({
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    catalog_version: versionIdentifierSchema,
    datasource_id: queryContractSchema.shape.datasource_id,
    tables: z.array(catalogTableSchema).min(1),
    relationships: z.array(catalogRelationshipSchema),
    metrics: z.array(catalogMetricSchema).min(1),
    dimensions: z.array(catalogDimensionSchema),
  })
  .superRefine((catalog, ctx) => {
    const metricIds = new Set(catalog.metrics.map(({ metric_id }) => metric_id));
    addDuplicateIssue(
      catalog.tables.map(({ table_id }) => table_id),
      ctx,
      ["tables"],
      "CatalogSnapshot 不能包含重复 Table。",
    );
    addDuplicateIssue(
      catalog.relationships.map(({ relationship_id }) => relationship_id),
      ctx,
      ["relationships"],
      "CatalogSnapshot 不能包含重复 Relationship。",
    );
    addDuplicateIssue(
      catalog.metrics.map(({ metric_id }) => metric_id),
      ctx,
      ["metrics"],
      "CatalogSnapshot 不能包含重复 Metric。",
    );
    addDuplicateIssue(
      catalog.dimensions.map(({ dimension_id }) => dimension_id),
      ctx,
      ["dimensions"],
      "CatalogSnapshot 不能包含重复 Dimension。",
    );
    if (catalog.dimensions.some(({ dimension_id }) => metricIds.has(dimension_id))) {
      ctx.addIssue({
        code: "custom",
        message: "CatalogSnapshot 的 Metric 与 Dimension 身份必须互斥。",
        path: ["dimensions"],
      });
    }
    const columnsByTable = new Map(
      catalog.tables.map((table) => [
        table.table_id,
        new Map(table.columns.map((column) => [column.column_id, column])),
      ]),
    );
    for (const [index, relationship] of catalog.relationships.entries()) {
      const leftColumns = columnsByTable.get(relationship.left_table_id);
      const rightColumns = columnsByTable.get(relationship.right_table_id);
      if (
        !leftColumns ||
        !rightColumns ||
        relationship.left_column_ids.some((columnId) => !leftColumns.has(columnId)) ||
        relationship.right_column_ids.some((columnId) => !rightColumns.has(columnId))
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Catalog Relationship 必须引用已声明的 Table 与 Column。",
          path: ["relationships", index],
        });
        continue;
      }
      if (
        relationship.left_row_match === "required" &&
        relationship.left_column_ids.some(
          (columnId) => leftColumns.get(columnId)?.nullable === true,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Required left-row match 不能建立在可空 Join Key 上。",
          path: ["relationships", index, "left_row_match"],
        });
      }
      if (
        relationship.right_row_match === "required" &&
        relationship.right_column_ids.some(
          (columnId) => rightColumns.get(columnId)?.nullable === true,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Required right-row match 不能建立在可空 Join Key 上。",
          path: ["relationships", index, "right_row_match"],
        });
      }
    }
    for (const [metricIndex, metric] of catalog.metrics.entries()) {
      const columns = columnsByTable.get(metric.table_id);
      if (
        !columns?.has(metric.column_id) ||
        metric.dependency_column_ids.some((columnId) => !columns.has(columnId)) ||
        (metric.time_column_id !== null && !columns.has(metric.time_column_id))
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Catalog Metric 必须完整引用已声明的 Table 与 Column。",
          path: ["metrics", metricIndex],
        });
      }
    }
    for (const [dimensionIndex, dimension] of catalog.dimensions.entries()) {
      if (!columnsByTable.get(dimension.table_id)?.has(dimension.column_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Catalog Dimension 必须引用已声明的 Table 与 Column。",
          path: ["dimensions", dimensionIndex],
        });
      }
    }
  });

export const mandatoryPredicateSchema = mandatoryPredicateContractSchema;

export const policySnapshotSchema = z
  .strictObject({
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    policy_version: versionIdentifierSchema,
    datasource_id: queryContractSchema.shape.datasource_id,
    principal_id: z.string().min(1).max(256),
    allowed_tables: z.array(allowedTableContractSchema),
    mandatory_predicates: z.array(mandatoryPredicateSchema),
  })
  .superRefine((policy, ctx) => {
    addDuplicateIssue(
      policy.allowed_tables.map(({ table_id }) => table_id),
      ctx,
      ["allowed_tables"],
      "PolicySnapshot 不能包含重复 Allowed Table。",
    );
    addDuplicateIssue(
      policy.mandatory_predicates.map(
        ({ table_id, column_id, operator, parameter_key }) =>
          `${table_id}\u0000${column_id}\u0000${operator}\u0000${parameter_key}`,
      ),
      ctx,
      ["mandatory_predicates"],
      "PolicySnapshot 不能包含重复 Mandatory Predicate。",
    );
    const allowedColumns = new Map(
      policy.allowed_tables.map((table) => [table.table_id, new Set(table.column_ids)]),
    );
    if (policy.allowed_tables.length > 0) {
      for (const [predicateIndex, predicate] of policy.mandatory_predicates.entries()) {
        if (!allowedColumns.get(predicate.table_id)?.has(predicate.column_id)) {
          ctx.addIssue({
            code: "custom",
            message: "Policy Mandatory Predicate 必须引用 AllowedSchema Column。",
            path: ["mandatory_predicates", predicateIndex],
          });
        }
      }
    }
  });

export const retrievalCandidateSchema = z.strictObject({
  object_id: versionIdentifierSchema,
  score: z.number().finite(),
});

export const groundingRequestSchema = z.strictObject({
  query_contract: queryContractSchema,
  catalog: catalogSnapshotSchema,
  policy: policySnapshotSchema.nullable(),
  retrieval_candidates: z.array(retrievalCandidateSchema),
  max_context_objects: z.number().int().positive().max(10_000),
});

export const groundingPackageDraftSchema = groundingContentSchema;

export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;
export type CatalogRelationship = z.infer<typeof catalogRelationshipSchema>;
export type CatalogMetric = z.infer<typeof catalogMetricSchema>;
export type CatalogDimension = z.infer<typeof catalogDimensionSchema>;
export type PolicySnapshot = z.infer<typeof policySnapshotSchema>;
export type MandatoryPredicate = z.infer<typeof mandatoryPredicateSchema>;
export type GroundingPackageDraft = z.infer<typeof groundingPackageDraftSchema>;

export type GroundingResult =
  | Readonly<{ state: "READY"; grounding: GroundingPackageDraft }>
  | Readonly<{
      state: "CLARIFY";
      reason_code: "GROUNDING_JOIN_PATH_AMBIGUOUS" | "GROUNDING_CONTEXT_BUDGET_EXCEEDED";
      conflict_set: readonly string[];
    }>
  | Readonly<{
      state: "DENIED";
      reason_code:
        | "GROUNDING_POLICY_MISSING"
        | "GROUNDING_POLICY_UNAVAILABLE"
        | "GROUNDING_POLICY_SCOPE_MISMATCH"
        | "GROUNDING_ALLOWED_SCHEMA_EMPTY"
        | "GROUNDING_CATALOG_UNAVAILABLE"
        | "GROUNDING_CATALOG_SCOPE_MISMATCH"
        | "GROUNDING_RETRIEVAL_UNAVAILABLE"
        | "GROUNDING_SCOPE_MISMATCH"
        | "GROUNDING_DATASOURCE_MISMATCH"
        | "GROUNDING_METRIC_NOT_FOUND"
        | "GROUNDING_DIMENSION_NOT_FOUND"
        | "GROUNDING_DEPENDENCY_DENIED"
        | "GROUNDING_JOIN_PATH_MISSING"
        | "GROUNDING_FANOUT_UNSAFE";
      missing_ids?: readonly string[];
    }>;
