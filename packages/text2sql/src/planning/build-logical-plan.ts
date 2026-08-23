import { deepFreeze, joinTypeForPreservedTable } from "@data-agent/contracts";
import { z } from "zod";
import { groundingPackageDraftSchema } from "../grounding/types.js";
import { semanticQueryDraftSchema } from "../semantic/types.js";
import {
  type LogicalOperationDraft,
  type LogicalPlanDraft,
  logicalPlanDraftSchema,
} from "./types.js";

const inputSchema = z.strictObject({
  semantic_query: semanticQueryDraftSchema,
  grounding: groundingPackageDraftSchema,
});

function aliasFor(tableId: string): string {
  return `t_${tableId.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function predicateTableId(
  predicate: z.infer<typeof semanticQueryDraftSchema>["predicates"][number],
): string {
  return predicate.kind === "comparison" ? predicate.left.table_id : predicate.field.table_id;
}

export function buildLogicalPlan(input: unknown): LogicalPlanDraft {
  const parsed = inputSchema.parse(input);
  if (parsed.semantic_query.grounding_hash !== parsed.grounding.grounding_hash) {
    throw new TypeError("LOGICAL_PLAN_GROUNDING_HASH_MISMATCH");
  }
  const operations: LogicalOperationDraft[] = parsed.grounding.allowed_schema.tables.map(
    (table) => ({
      operation: "scan",
      operation_id: `scan_${table.table_id}`,
      table_id: table.table_id,
      alias: aliasFor(table.table_id),
      column_ids: table.columns.map(({ column_id }) => column_id),
    }),
  );
  const rootTableId = parsed.grounding.join_closure.root_table_id;
  const timePredicates = [
    {
      kind: "comparison" as const,
      left: parsed.semantic_query.time_predicate.field,
      operator: "gte" as const,
      right: { parameter_key: parsed.semantic_query.time_predicate.lower.parameter_key },
      authority: "time" as const,
    },
    {
      kind: "comparison" as const,
      left: parsed.semantic_query.time_predicate.field,
      operator: "lt" as const,
      right: { parameter_key: parsed.semantic_query.time_predicate.upper.parameter_key },
      authority: "time" as const,
    },
  ];
  let predicates = [...parsed.semantic_query.predicates, ...timePredicates];
  let currentOperationId = `scan_${rootTableId}`;
  const rootPreaggregation = parsed.grounding.join_closure.preaggregations.find(
    ({ table_id }) => table_id === rootTableId,
  );
  if (rootPreaggregation) {
    const rootPredicates = predicates.filter(
      (predicate) => predicateTableId(predicate) === rootTableId,
    );
    if (rootPredicates.length > 0) {
      operations.push({
        operation: "filter",
        operation_id: "filter_preaggregate_root",
        input_id: currentOperationId,
        predicates: rootPredicates,
      });
      currentOperationId = "filter_preaggregate_root";
      predicates = predicates.filter((predicate) => predicateTableId(predicate) !== rootTableId);
    }
    operations.push({
      operation: "preaggregate",
      operation_id: `preaggregate_${rootTableId}`,
      input_id: currentOperationId,
      group_by: rootPreaggregation.group_by_column_ids.map((columnId) => ({
        table_id: rootTableId,
        column_id: columnId,
      })),
      measures: [
        {
          metric_id: parsed.semantic_query.metric.metric_id,
          function: parsed.semantic_query.metric.aggregation,
          field: {
            table_id: parsed.semantic_query.metric.table_id,
            column_id: parsed.semantic_query.metric.column_id,
          },
          alias: parsed.semantic_query.metric.metric_id,
          unit: parsed.semantic_query.metric.unit,
          null_policy: parsed.semantic_query.metric.null_policy,
          distinct: parsed.semantic_query.metric.aggregation === "count_distinct",
        },
      ],
      reason_code: rootPreaggregation.reason_code,
    });
    currentOperationId = `preaggregate_${rootTableId}`;
  }
  const joinedTables = new Set([rootTableId]);
  const pendingRelationships = [...parsed.grounding.join_closure.edges];
  let joinIndex = 0;
  while (pendingRelationships.length > 0) {
    const candidate = pendingRelationships
      .map((relationship, index) => ({ relationship, index }))
      .filter(({ relationship }) => {
        const leftJoined = joinedTables.has(relationship.left_table_id);
        const rightJoined = joinedTables.has(relationship.right_table_id);
        return leftJoined !== rightJoined;
      })
      .sort((left, right) =>
        compareStable(left.relationship.relationship_id, right.relationship.relationship_id),
      )[0];
    if (!candidate) {
      throw new TypeError("LOGICAL_PLAN_JOIN_CLOSURE_DISCONNECTED");
    }
    pendingRelationships.splice(candidate.index, 1);
    const { relationship } = candidate;
    const leftJoined = joinedTables.has(relationship.left_table_id);
    const preservedTableId = leftJoined ? relationship.left_table_id : relationship.right_table_id;
    const nextTable = leftJoined ? relationship.right_table_id : relationship.left_table_id;
    if (!parsed.grounding.allowed_schema.tables.some(({ table_id }) => table_id === nextTable)) {
      throw new TypeError("LOGICAL_PLAN_JOIN_TABLE_UNGROUNDED");
    }
    joinIndex += 1;
    const operationId = `join_${joinIndex}`;
    operations.push({
      operation: "join",
      operation_id: operationId,
      left_input_id: currentOperationId,
      right_input_id: `scan_${nextTable}`,
      relationship,
      join_type: joinTypeForPreservedTable(relationship, preservedTableId),
    });
    joinedTables.add(relationship.left_table_id);
    joinedTables.add(relationship.right_table_id);
    currentOperationId = operationId;
  }
  if (predicates.length > 0) {
    operations.push({
      operation: "filter",
      operation_id: "filter_authorized",
      input_id: currentOperationId,
      predicates,
    });
    currentOperationId = "filter_authorized";
  }
  const dimensionFields = parsed.semantic_query.dimensions.map((dimension) => ({
    table_id: dimension.table_id,
    column_id: dimension.column_id,
  }));
  operations.push({
    operation: "aggregate",
    operation_id: "aggregate_metric",
    input_id: currentOperationId,
    group_by: dimensionFields,
    measures: [
      {
        metric_id: parsed.semantic_query.metric.metric_id,
        function: parsed.semantic_query.metric.aggregation,
        field: {
          table_id: parsed.semantic_query.metric.table_id,
          column_id: parsed.semantic_query.metric.column_id,
        },
        alias: parsed.semantic_query.metric.metric_id,
        unit: parsed.semantic_query.metric.unit,
        null_policy: parsed.semantic_query.metric.null_policy,
        distinct: parsed.semantic_query.metric.aggregation === "count_distinct",
      },
    ],
  });
  operations.push({
    operation: "project",
    operation_id: "project_result",
    input_id: "aggregate_metric",
    columns: [
      ...parsed.semantic_query.dimensions.map((dimension) => ({
        source_kind: "group" as const,
        source_id: dimension.column_id,
        alias: dimension.dimension_id,
      })),
      {
        source_kind: "measure",
        source_id: parsed.semantic_query.metric.metric_id,
        alias: parsed.semantic_query.metric.metric_id,
      },
    ],
  });
  return deepFreeze(
    logicalPlanDraftSchema.parse({
      operations,
      root_operation_id: "project_result",
      parameters: parsed.semantic_query.parameters,
      grounding_hash: parsed.grounding.grounding_hash,
      semantic_signature: {
        metric_id: parsed.semantic_query.metric.metric_id,
        dimension_ids: parsed.semantic_query.dimensions.map(({ dimension_id }) => dimension_id),
        grain: parsed.semantic_query.metric.grain,
        unit: parsed.semantic_query.metric.unit,
        time_semantics: "HALF_OPEN",
      },
    }),
  );
}
