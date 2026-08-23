import {
  canonicalizeJson,
  deepFreeze,
  hasLogicalPlanDataflow,
  queryContractSchema,
  semanticQueryContentSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { groundingPackageDraftSchema } from "../grounding/types.js";
import { type LogicalOperationDraft, logicalPlanDraftSchema } from "./types.js";

const validationInputSchema = z.strictObject({
  logical_plan: logicalPlanDraftSchema,
  grounding: groundingPackageDraftSchema,
  semantic_query: semanticQueryContentSchema,
  query_contract: queryContractSchema,
});

export const LOGICAL_PLAN_VALIDATION_REASON_CODES = [
  "LOGICAL_PLAN_INVALID_SCHEMA",
  "LOGICAL_PLAN_DUPLICATE_OPERATION_ID",
  "LOGICAL_PLAN_ROOT_NOT_FOUND",
  "LOGICAL_PLAN_INPUT_NOT_FOUND",
  "LOGICAL_PLAN_CYCLE_DETECTED",
  "LOGICAL_PLAN_NOT_TOPOLOGICALLY_SORTED",
  "LOGICAL_PLAN_UNREACHABLE_OPERATION",
  "LOGICAL_PLAN_GROUNDING_HASH_MISMATCH",
  "LOGICAL_PLAN_FIELD_NOT_GROUNDED",
  "LOGICAL_PLAN_RELATIONSHIP_NOT_GROUNDED",
  "LOGICAL_PLAN_PREAGGREGATION_MISMATCH",
  "LOGICAL_PLAN_DATAFLOW_INVALID",
  "LOGICAL_PLAN_MEASURE_MISMATCH",
  "LOGICAL_PLAN_RESULT_BINDING_MISMATCH",
  "LOGICAL_PLAN_PARAMETER_MISMATCH",
  "LOGICAL_PLAN_PREDICATE_COVERAGE_MISMATCH",
  "LOGICAL_PLAN_RESULT_SIGNATURE_MISMATCH",
] as const;

export type LogicalPlanValidationReasonCode = (typeof LOGICAL_PLAN_VALIDATION_REASON_CODES)[number];

declare const validatedLogicalPlan: unique symbol;
const validatedLogicalPlans = new WeakSet<object>();

export type ValidatedLogicalPlan = Readonly<
  z.infer<typeof logicalPlanDraftSchema> & {
    readonly [validatedLogicalPlan]: true;
  }
>;

export type LogicalPlanValidationResult =
  | Readonly<{ state: "VALID"; logical_plan: ValidatedLogicalPlan }>
  | Readonly<{
      state: "INVALID";
      reason_code: LogicalPlanValidationReasonCode;
    }>;

function invalid(reasonCode: LogicalPlanValidationReasonCode): LogicalPlanValidationResult {
  return deepFreeze({
    state: "INVALID",
    reason_code: reasonCode,
  });
}

function assertNever(_value: never): never {
  throw new TypeError("LOGICAL_PLAN_OPERATION_UNHANDLED");
}

function operationInputs(operation: LogicalOperationDraft): readonly string[] {
  switch (operation.operation) {
    case "scan":
      return [];
    case "filter":
    case "preaggregate":
    case "aggregate":
    case "project":
      return [operation.input_id];
    case "join":
      return [operation.left_input_id, operation.right_input_id];
    default:
      return assertNever(operation);
  }
}

function hasCycle(
  operationsById: ReadonlyMap<string, LogicalOperationDraft>,
  operationIds: readonly string[],
): boolean {
  const states = new Map<string, "VISITING" | "VISITED">();

  const visit = (operationId: string): boolean => {
    const state = states.get(operationId);
    if (state === "VISITING") return true;
    if (state === "VISITED") return false;

    const operation = operationsById.get(operationId);
    if (!operation) return true;
    states.set(operationId, "VISITING");
    for (const inputId of operationInputs(operation)) {
      if (visit(inputId)) return true;
    }
    states.set(operationId, "VISITED");
    return false;
  };

  return operationIds.some(visit);
}

function allFieldsGrounded(
  operations: readonly LogicalOperationDraft[],
  grounding: z.infer<typeof groundingPackageDraftSchema>,
): boolean {
  const requiredColumns = new Set(grounding.required_column_ids);
  const allowedColumnsByTable = new Map(
    grounding.allowed_schema.tables.map((table) => [
      table.table_id,
      new Set(table.columns.map(({ column_id }) => column_id)),
    ]),
  );
  const fieldGrounded = (tableId: string, columnId: string): boolean =>
    requiredColumns.has(columnId) && allowedColumnsByTable.get(tableId)?.has(columnId) === true;

  for (const operation of operations) {
    switch (operation.operation) {
      case "scan":
        if (operation.column_ids.some((columnId) => !fieldGrounded(operation.table_id, columnId))) {
          return false;
        }
        break;
      case "filter":
        for (const predicate of operation.predicates) {
          const field = predicate.kind === "comparison" ? predicate.left : predicate.field;
          if (!fieldGrounded(field.table_id, field.column_id)) return false;
        }
        break;
      case "join":
        if (
          operation.relationship.left_column_ids.some(
            (columnId) => !fieldGrounded(operation.relationship.left_table_id, columnId),
          ) ||
          operation.relationship.right_column_ids.some(
            (columnId) => !fieldGrounded(operation.relationship.right_table_id, columnId),
          )
        ) {
          return false;
        }
        break;
      case "preaggregate":
      case "aggregate":
        if (
          operation.group_by.some((field) => !fieldGrounded(field.table_id, field.column_id)) ||
          operation.measures.some(({ field }) => !fieldGrounded(field.table_id, field.column_id))
        ) {
          return false;
        }
        break;
      case "project":
        break;
      default:
        return assertNever(operation);
    }
  }
  return true;
}

function reachableOperationIds(
  rootOperationId: string,
  operationsById: ReadonlyMap<string, LogicalOperationDraft>,
): ReadonlySet<string> {
  const reachable = new Set<string>();
  const pending = [rootOperationId];
  while (pending.length > 0) {
    const operationId = pending.pop();
    if (!operationId || reachable.has(operationId)) continue;
    reachable.add(operationId);
    const operation = operationsById.get(operationId);
    if (operation) pending.push(...operationInputs(operation));
  }
  return reachable;
}

function canonicalSet(values: readonly unknown[]): string[] {
  return values.map(canonicalizeJson).sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateLogicalPlan(input: unknown): LogicalPlanValidationResult {
  const parsed = validationInputSchema.safeParse(input);
  if (!parsed.success) return invalid("LOGICAL_PLAN_INVALID_SCHEMA");

  const {
    logical_plan: logicalPlan,
    grounding,
    semantic_query: semanticQuery,
    query_contract: queryContract,
  } = parsed.data;
  const operationIds = logicalPlan.operations.map(({ operation_id }) => operation_id);
  if (new Set(operationIds).size !== operationIds.length) {
    return invalid("LOGICAL_PLAN_DUPLICATE_OPERATION_ID");
  }

  const operationsById = new Map(
    logicalPlan.operations.map((operation) => [operation.operation_id, operation]),
  );
  if (!operationsById.has(logicalPlan.root_operation_id)) {
    return invalid("LOGICAL_PLAN_ROOT_NOT_FOUND");
  }

  for (const operation of logicalPlan.operations) {
    if (operationInputs(operation).some((inputId) => !operationsById.has(inputId))) {
      return invalid("LOGICAL_PLAN_INPUT_NOT_FOUND");
    }
  }
  if (hasCycle(operationsById, operationIds)) {
    return invalid("LOGICAL_PLAN_CYCLE_DETECTED");
  }

  const operationIndexes = new Map(operationIds.map((operationId, index) => [operationId, index]));
  for (const [operationIndex, operation] of logicalPlan.operations.entries()) {
    for (const inputId of operationInputs(operation)) {
      const inputIndex = operationIndexes.get(inputId);
      if (inputIndex === undefined || inputIndex >= operationIndex) {
        return invalid("LOGICAL_PLAN_NOT_TOPOLOGICALLY_SORTED");
      }
    }
  }
  if (
    reachableOperationIds(logicalPlan.root_operation_id, operationsById).size !==
    logicalPlan.operations.length
  ) {
    return invalid("LOGICAL_PLAN_UNREACHABLE_OPERATION");
  }

  if (
    logicalPlan.grounding_hash !== grounding.grounding_hash ||
    logicalPlan.grounding_hash !== semanticQuery.grounding_hash
  ) {
    return invalid("LOGICAL_PLAN_GROUNDING_HASH_MISMATCH");
  }
  if (!allFieldsGrounded(logicalPlan.operations, grounding)) {
    return invalid("LOGICAL_PLAN_FIELD_NOT_GROUNDED");
  }
  const observedRelationships = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "join" ? [operation.relationship] : [],
  );
  if (
    !arraysEqual(canonicalSet(observedRelationships), canonicalSet(grounding.join_closure.edges))
  ) {
    return invalid("LOGICAL_PLAN_RELATIONSHIP_NOT_GROUNDED");
  }
  const observedPreaggregations = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "preaggregate"
      ? [
          {
            table_id: operation.measures[0]?.field.table_id ?? "",
            group_by_column_ids: operation.group_by.map(({ column_id }) => column_id),
            measure_column_ids: operation.measures.map(({ field }) => field.column_id),
            reason_code: operation.reason_code,
          },
        ]
      : [],
  );
  if (
    !arraysEqual(
      canonicalSet(observedPreaggregations),
      canonicalSet(grounding.join_closure.preaggregations),
    )
  ) {
    return invalid("LOGICAL_PLAN_PREAGGREGATION_MISMATCH");
  }
  const expectedMeasure = {
    metric_id: semanticQuery.metric.metric_id,
    function: semanticQuery.metric.aggregation,
    field: {
      table_id: semanticQuery.metric.table_id,
      column_id: semanticQuery.metric.column_id,
    },
    alias: semanticQuery.metric.metric_id,
    unit: semanticQuery.metric.unit,
    null_policy: semanticQuery.metric.null_policy,
    distinct: semanticQuery.metric.aggregation === "count_distinct",
  };
  const measures = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "aggregate" || operation.operation === "preaggregate"
      ? operation.measures
      : [],
  );
  if (
    measures.length === 0 ||
    measures.some((measure) => canonicalizeJson(measure) !== canonicalizeJson(expectedMeasure))
  ) {
    return invalid("LOGICAL_PLAN_MEASURE_MISMATCH");
  }
  const finalAggregates = logicalPlan.operations.filter(
    (operation) => operation.operation === "aggregate",
  );
  const rootOperation = operationsById.get(logicalPlan.root_operation_id);
  const expectedGroupBy = semanticQuery.dimensions.map((dimension) => ({
    table_id: dimension.table_id,
    column_id: dimension.column_id,
  }));
  const expectedProjection = [
    ...semanticQuery.dimensions.map((dimension) => ({
      source_kind: "group",
      source_id: dimension.column_id,
      alias: dimension.dimension_id,
    })),
    {
      source_kind: "measure",
      source_id: semanticQuery.metric.metric_id,
      alias: semanticQuery.metric.metric_id,
    },
  ];
  if (
    finalAggregates.length !== 1 ||
    !finalAggregates[0] ||
    canonicalizeJson(finalAggregates[0].group_by) !== canonicalizeJson(expectedGroupBy) ||
    rootOperation?.operation !== "project" ||
    rootOperation.input_id !== finalAggregates[0].operation_id ||
    canonicalizeJson(rootOperation.columns) !== canonicalizeJson(expectedProjection)
  ) {
    return invalid("LOGICAL_PLAN_RESULT_BINDING_MISMATCH");
  }
  if (!hasLogicalPlanDataflow(logicalPlan.operations, grounding.join_closure.root_table_id)) {
    return invalid("LOGICAL_PLAN_DATAFLOW_INVALID");
  }
  if (canonicalizeJson(logicalPlan.parameters) !== canonicalizeJson(semanticQuery.parameters)) {
    return invalid("LOGICAL_PLAN_PARAMETER_MISMATCH");
  }
  const expectedPredicates = [
    ...semanticQuery.predicates,
    {
      kind: "comparison" as const,
      left: semanticQuery.time_predicate.field,
      operator: "gte" as const,
      right: { parameter_key: semanticQuery.time_predicate.lower.parameter_key },
      authority: "time" as const,
    },
    {
      kind: "comparison" as const,
      left: semanticQuery.time_predicate.field,
      operator: "lt" as const,
      right: { parameter_key: semanticQuery.time_predicate.upper.parameter_key },
      authority: "time" as const,
    },
  ];
  const observedPredicates = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "filter" ? operation.predicates : [],
  );
  if (!arraysEqual(canonicalSet(observedPredicates), canonicalSet(expectedPredicates))) {
    return invalid("LOGICAL_PLAN_PREDICATE_COVERAGE_MISMATCH");
  }

  const signature = logicalPlan.semantic_signature;
  if (
    signature.metric_id !== semanticQuery.metric.metric_id ||
    !arraysEqual(
      signature.dimension_ids,
      semanticQuery.dimensions.map(({ dimension_id }) => dimension_id),
    ) ||
    signature.metric_id !== queryContract.metric ||
    !arraysEqual(signature.dimension_ids, queryContract.dimensions) ||
    signature.grain !== queryContract.grain ||
    signature.unit !== queryContract.unit ||
    signature.time_semantics !== queryContract.time_range.semantics
  ) {
    return invalid("LOGICAL_PLAN_RESULT_SIGNATURE_MISMATCH");
  }

  validatedLogicalPlans.add(logicalPlan);
  const validated = deepFreeze(logicalPlan) as ValidatedLogicalPlan;
  return deepFreeze({ state: "VALID", logical_plan: validated });
}

export function isValidatedLogicalPlan(value: unknown): value is ValidatedLogicalPlan {
  return typeof value === "object" && value !== null && validatedLogicalPlans.has(value);
}
