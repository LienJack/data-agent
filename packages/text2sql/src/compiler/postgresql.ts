import type { SqlArtifactPayloadContract } from "@data-agent/contracts";
import {
  canonicalizeJson,
  computeGroundingHash,
  computeSqlArtifactQueryHash,
  deepFreeze,
  sha256ContentHash,
  sqlArtifactSchema,
} from "@data-agent/contracts";
import { isAuthoritativeSemanticContextText2SqlBinding } from "@data-agent/contracts/server";
import { z } from "zod";
import { type GroundingPackageDraft, groundingPackageDraftSchema } from "../grounding/types.js";
import type { LogicalOperationDraft } from "../planning/types.js";
import {
  isValidatedLogicalPlan,
  type ValidatedLogicalPlan,
} from "../planning/validate-logical-plan.js";
import {
  type AuthoritativeLogicalPlanBinding,
  isAuthoritativeLogicalPlanBinding,
} from "./internal.js";
import {
  generatedIdentifier,
  renderPostgresqlQueryAst,
  validatedOutputIdentifier,
} from "./postgresql-ast.js";
import {
  POSTGRESQL_COMPILER_VERSION,
  type PostgresqlCompilationProof,
  type PostgresqlCompilationReasonCode,
  type PostgresqlCompilationResult,
  type PostgresqlCondition,
  type PostgresqlDataType,
  type PostgresqlExpression,
  type PostgresqlGeneratedIdentifier,
  type PostgresqlGroundedIdentifier,
  type PostgresqlIdentifier,
  type PostgresqlParameterOrderEntry,
  type PostgresqlQueryAst,
  type PostgresqlRelationAst,
  type PostgresqlSelectAst,
  registerPostgresqlCompilation,
} from "./types.js";

const compilerInputSchema = z.strictObject({
  logical_plan_binding: z.unknown(),
  grounding: groundingPackageDraftSchema,
  semantic_context_binding: z.unknown().optional(),
});

const dialectCompilerInputSchema = compilerInputSchema.extend({
  dialect: z.string().min(1).max(64),
});

type ParameterValue = Exclude<SqlArtifactPayloadContract["parameters"][string], null | undefined>;
type GroundingTable = GroundingPackageDraft["allowed_schema"]["tables"][number];
type GroundingColumn = GroundingTable["columns"][number];
type FieldReference = Extract<
  LogicalOperationDraft,
  { operation: "aggregate" }
>["group_by"][number];
type Measure = Extract<LogicalOperationDraft, { operation: "aggregate" }>["measures"][number];
type BoundParameter = ValidatedLogicalPlan["parameters"][string];
type FailedReasonCode = Exclude<
  PostgresqlCompilationReasonCode,
  "UNSUPPORTED_DIALECT" | "POSTGRESQL_COMPILER_PREAGGREGATION_UNSUPPORTED"
>;

type FieldBinding = Readonly<{
  alias: PostgresqlGeneratedIdentifier;
  data_type: PostgresqlDataType;
}>;

type ResultBinding = Readonly<{
  alias: PostgresqlIdentifier;
  data_type: PostgresqlDataType;
  source_kind: "group" | "measure" | "project";
}>;

type RelationOutput = Readonly<{
  namespace: "field" | "result";
  key: string;
  binding: FieldBinding | ResultBinding;
}>;

type RelationState = Readonly<{
  cte: PostgresqlGeneratedIdentifier;
  fields: ReadonlyMap<string, FieldBinding>;
  results: ReadonlyMap<string, ResultBinding>;
  outputs: readonly RelationOutput[];
}>;

class CompilerFailure extends Error {
  readonly reasonCode: Exclude<PostgresqlCompilationReasonCode, "UNSUPPORTED_DIALECT">;

  constructor(reasonCode: Exclude<PostgresqlCompilationReasonCode, "UNSUPPORTED_DIALECT">) {
    super(reasonCode);
    this.name = "CompilerFailure";
    this.reasonCode = reasonCode;
  }
}

function failWith(
  reasonCode: Exclude<PostgresqlCompilationReasonCode, "UNSUPPORTED_DIALECT">,
): never {
  throw new CompilerFailure(reasonCode);
}

function failed(reasonCode: FailedReasonCode): PostgresqlCompilationResult {
  return deepFreeze({
    state: "FAILED",
    reason_code: reasonCode,
  });
}

function unsupported(
  reasonCode: "UNSUPPORTED_DIALECT" | "POSTGRESQL_COMPILER_PREAGGREGATION_UNSUPPORTED",
): PostgresqlCompilationResult {
  return deepFreeze({
    state: "UNSUPPORTED",
    reason_code: reasonCode,
  });
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fieldKey(tableId: string, columnId: string): string {
  return `${tableId}\u0000${columnId}`;
}

function groundedIdentifier(logicalId: string, physicalName: string): PostgresqlGroundedIdentifier {
  return {
    origin: "GROUNDING_PHYSICAL_NAME",
    logical_id: logicalId,
    value: physicalName,
  };
}

function relationForCte(
  cte: PostgresqlGeneratedIdentifier,
  alias: PostgresqlGeneratedIdentifier,
): PostgresqlRelationAst {
  return {
    kind: "cte",
    cte,
    alias,
  };
}

function columnExpression(
  relation: PostgresqlGeneratedIdentifier,
  column: PostgresqlIdentifier,
): PostgresqlExpression {
  return {
    kind: "column",
    relation,
    column,
  };
}

function valueCompatibleWithType(value: ParameterValue, dataType: PostgresqlDataType): boolean {
  switch (dataType) {
    case "boolean":
      return typeof value === "boolean" || value === "true" || value === "false";
    case "integer":
      return (
        (typeof value === "number" && Number.isInteger(value)) ||
        (typeof value === "string" && /^[-+]?[0-9]+$/.test(value))
      );
    case "numeric":
      return (
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" &&
          /^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/.test(value))
      );
    case "date":
    case "timestamp":
    case "timestamptz":
    case "uuid":
      return typeof value === "string";
    case "text":
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    default: {
      const exhaustive: never = dataType;
      return exhaustive;
    }
  }
}

class ParameterRegistry {
  readonly #definitions: ValidatedLogicalPlan["parameters"];
  readonly #policyBindings: Readonly<Record<string, unknown>>;
  readonly #entries: PostgresqlParameterOrderEntry[] = [];
  readonly #values: Record<string, ParameterValue> = {};
  readonly #registered = new Map<
    string,
    Readonly<{
      expression: Extract<PostgresqlExpression, { kind: "parameter" }>;
      data_type: PostgresqlDataType;
    }>
  >();

  constructor(
    definitions: ValidatedLogicalPlan["parameters"],
    policyBindings: Readonly<Record<string, unknown>>,
  ) {
    this.#definitions = definitions;
    this.#policyBindings = policyBindings;
  }

  expression(parameterKey: string, dataType: PostgresqlDataType): PostgresqlExpression {
    const existing = this.#registered.get(parameterKey);
    if (existing) {
      if (existing.data_type !== dataType) {
        failWith("POSTGRESQL_COMPILER_PARAMETER_TYPE_CONFLICT");
      }
      return existing.expression;
    }

    const definition = this.#definitions[parameterKey];
    if (!definition) {
      failWith("POSTGRESQL_COMPILER_PARAMETER_NOT_FOUND");
    }
    const value = this.#resolveValue(definition);
    if (!valueCompatibleWithType(value, dataType)) {
      if (definition.source === "policy") {
        failWith("POSTGRESQL_COMPILER_POLICY_BINDING_INVALID");
      }
      failWith("POSTGRESQL_COMPILER_PARAMETER_VALUE_INVALID");
    }
    const position = this.#entries.length + 1;
    const placeholder = `$${position}` as `$${number}`;
    const expression = {
      kind: "parameter",
      placeholder,
      data_type: dataType,
    } as const;
    this.#entries.push({
      position,
      placeholder,
      parameter_key: parameterKey,
      source: definition.source,
      data_type: dataType,
    });
    this.#values[placeholder] = value;
    this.#registered.set(parameterKey, { expression, data_type: dataType });
    return expression;
  }

  assertAllDefinitionsConsumed(): void {
    const definitionKeys = Object.keys(this.#definitions).sort(compareStable);
    const registeredKeys = [...this.#registered.keys()].sort(compareStable);
    if (
      definitionKeys.length !== registeredKeys.length ||
      definitionKeys.some((key, index) => key !== registeredKeys[index])
    ) {
      failWith("POSTGRESQL_COMPILER_PARAMETER_NOT_FOUND");
    }
  }

  entries(): readonly PostgresqlParameterOrderEntry[] {
    return this.#entries;
  }

  values(): Readonly<Record<string, ParameterValue>> {
    return this.#values;
  }

  #resolveValue(definition: BoundParameter): ParameterValue {
    if (definition.source === "literal" || definition.source === "time") {
      const value = definition.value;
      if (
        value === null ||
        (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      ) {
        failWith("POSTGRESQL_COMPILER_PARAMETER_VALUE_INVALID");
      }
      return value;
    }
    const value = this.#policyBindings[definition.policy_key];
    if (
      value === null ||
      value === undefined ||
      (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    ) {
      failWith("POSTGRESQL_COMPILER_POLICY_BINDING_INVALID");
    }
    return value;
  }
}

type CompilationContext = {
  readonly logicalPlan: ValidatedLogicalPlan;
  readonly grounding: GroundingPackageDraft;
  readonly tables: ReadonlyMap<string, GroundingTable>;
  readonly columns: ReadonlyMap<string, GroundingColumn>;
  readonly fieldAliases: ReadonlyMap<string, PostgresqlGeneratedIdentifier>;
  readonly states: Map<string, RelationState>;
  readonly ctes: PostgresqlQueryAst["ctes"][number][];
  readonly parameters: ParameterRegistry;
};

function requireTable(
  tables: ReadonlyMap<string, GroundingTable>,
  tableId: string,
): GroundingTable {
  const table = tables.get(tableId);
  if (!table) failWith("POSTGRESQL_COMPILER_IDENTIFIER_NOT_GROUNDED");
  return table;
}

function requireGroundingColumn(
  context: Pick<CompilationContext, "columns">,
  tableId: string,
  columnId: string,
): GroundingColumn {
  const column = context.columns.get(fieldKey(tableId, columnId));
  if (!column) failWith("POSTGRESQL_COMPILER_IDENTIFIER_NOT_GROUNDED");
  return column;
}

function requireFieldAlias(
  context: Pick<CompilationContext, "fieldAliases">,
  tableId: string,
  columnId: string,
): PostgresqlGeneratedIdentifier {
  const alias = context.fieldAliases.get(fieldKey(tableId, columnId));
  if (!alias) failWith("POSTGRESQL_COMPILER_IDENTIFIER_NOT_GROUNDED");
  return alias;
}

function requireState(context: CompilationContext, operationId: string): RelationState {
  const state = context.states.get(operationId);
  if (!state) failWith("POSTGRESQL_COMPILER_DATAFLOW_INVALID");
  return state;
}

function fieldExpressionFromState(
  state: RelationState,
  field: FieldReference,
  relation: PostgresqlGeneratedIdentifier,
): PostgresqlExpression {
  const binding = state.fields.get(fieldKey(field.table_id, field.column_id));
  if (!binding) failWith("POSTGRESQL_COMPILER_DATAFLOW_INVALID");
  return columnExpression(relation, binding.alias);
}

function selectAllColumns(
  state: RelationState,
  relation: PostgresqlGeneratedIdentifier,
): PostgresqlSelectAst["columns"] {
  return state.outputs.map(({ binding }) => ({
    expression: columnExpression(relation, binding.alias),
    alias: binding.alias,
  }));
}

function compilePredicate(
  predicate: Extract<LogicalOperationDraft, { operation: "filter" }>["predicates"][number],
  state: RelationState,
  relation: PostgresqlGeneratedIdentifier,
  context: CompilationContext,
): PostgresqlCondition {
  if (predicate.kind === "comparison") {
    const column = requireGroundingColumn(
      context,
      predicate.left.table_id,
      predicate.left.column_id,
    );
    return {
      kind: "comparison",
      left: fieldExpressionFromState(state, predicate.left, relation),
      operator: predicate.operator,
      right: context.parameters.expression(predicate.right.parameter_key, column.data_type),
    };
  }
  if (predicate.kind === "membership") {
    const column = requireGroundingColumn(
      context,
      predicate.field.table_id,
      predicate.field.column_id,
    );
    return {
      kind: "membership",
      field: fieldExpressionFromState(state, predicate.field, relation),
      values: predicate.values.map(({ parameter_key }) =>
        context.parameters.expression(parameter_key, column.data_type),
      ),
    };
  }
  return {
    kind: "null-check",
    field: fieldExpressionFromState(state, predicate.field, relation),
    operator: predicate.operator,
  };
}

function compileScan(
  operation: Extract<LogicalOperationDraft, { operation: "scan" }>,
  cte: PostgresqlGeneratedIdentifier,
  context: CompilationContext,
): RelationState {
  const table = requireTable(context.tables, operation.table_id);
  const source = generatedIdentifier("source");
  const fields = new Map<string, FieldBinding>();
  const outputs: RelationOutput[] = [];
  const columns = operation.column_ids.map((columnId) => {
    const column = requireGroundingColumn(context, operation.table_id, columnId);
    const alias = requireFieldAlias(context, operation.table_id, columnId);
    const binding = { alias, data_type: column.data_type } satisfies FieldBinding;
    fields.set(fieldKey(operation.table_id, columnId), binding);
    outputs.push({
      namespace: "field",
      key: fieldKey(operation.table_id, columnId),
      binding,
    });
    return {
      expression: columnExpression(
        source,
        groundedIdentifier(column.column_id, column.physical_name),
      ),
      alias,
    };
  });
  context.ctes.push({
    operation_id: operation.operation_id,
    operation: "scan",
    name: cte,
    query: {
      kind: "select",
      columns,
      from: {
        kind: "grounded-table",
        table: groundedIdentifier(table.table_id, table.physical_name),
        alias: source,
      },
      joins: [],
      where: [],
      group_by: [],
    },
  });
  return {
    cte,
    fields,
    results: new Map(),
    outputs,
  };
}

function compileFilter(
  operation: Extract<LogicalOperationDraft, { operation: "filter" }>,
  cte: PostgresqlGeneratedIdentifier,
  context: CompilationContext,
): RelationState {
  const input = requireState(context, operation.input_id);
  const source = generatedIdentifier("source");
  context.ctes.push({
    operation_id: operation.operation_id,
    operation: "filter",
    name: cte,
    query: {
      kind: "select",
      columns: selectAllColumns(input, source),
      from: relationForCte(input.cte, source),
      joins: [],
      where: operation.predicates.map((predicate) =>
        compilePredicate(predicate, input, source, context),
      ),
      group_by: [],
    },
  });
  return {
    cte,
    fields: new Map(input.fields),
    results: new Map(input.results),
    outputs: [...input.outputs],
  };
}

function joinOrientation(
  operation: Extract<LogicalOperationDraft, { operation: "join" }>,
  left: RelationState,
  right: RelationState,
): "direct" | "reverse" {
  const relationship = operation.relationship;
  const direct =
    relationship.left_column_ids.every((columnId) =>
      left.fields.has(fieldKey(relationship.left_table_id, columnId)),
    ) &&
    relationship.right_column_ids.every((columnId) =>
      right.fields.has(fieldKey(relationship.right_table_id, columnId)),
    );
  const reverse =
    relationship.left_column_ids.every((columnId) =>
      right.fields.has(fieldKey(relationship.left_table_id, columnId)),
    ) &&
    relationship.right_column_ids.every((columnId) =>
      left.fields.has(fieldKey(relationship.right_table_id, columnId)),
    );
  if (direct === reverse) failWith("POSTGRESQL_COMPILER_DATAFLOW_INVALID");
  return direct ? "direct" : "reverse";
}

function mergedStateMaps(
  left: RelationState,
  right: RelationState,
): Pick<RelationState, "fields" | "results" | "outputs"> {
  const fields = new Map(left.fields);
  for (const [key, binding] of right.fields) {
    if (fields.has(key)) failWith("POSTGRESQL_COMPILER_ALIAS_COLLISION");
    fields.set(key, binding);
  }
  const results = new Map(left.results);
  for (const [key, binding] of right.results) {
    if (results.has(key)) failWith("POSTGRESQL_COMPILER_ALIAS_COLLISION");
    results.set(key, binding);
  }
  const outputs = [...left.outputs, ...right.outputs];
  if (new Set(outputs.map(({ binding }) => binding.alias.value)).size !== outputs.length) {
    failWith("POSTGRESQL_COMPILER_ALIAS_COLLISION");
  }
  return { fields, results, outputs };
}

function compileJoin(
  operation: Extract<LogicalOperationDraft, { operation: "join" }>,
  cte: PostgresqlGeneratedIdentifier,
  context: CompilationContext,
): RelationState {
  const left = requireState(context, operation.left_input_id);
  const right = requireState(context, operation.right_input_id);
  const orientation = joinOrientation(operation, left, right);
  const leftSource = generatedIdentifier("left_source");
  const rightSource = generatedIdentifier("right_source");
  const conditions = operation.relationship.left_column_ids.map((leftColumnId, index) => {
    const rightColumnId = operation.relationship.right_column_ids[index];
    if (!rightColumnId) failWith("POSTGRESQL_COMPILER_DATAFLOW_INVALID");
    const direct = orientation === "direct";
    const leftField = direct
      ? {
          table_id: operation.relationship.left_table_id,
          column_id: leftColumnId,
        }
      : {
          table_id: operation.relationship.right_table_id,
          column_id: rightColumnId,
        };
    const rightField = direct
      ? {
          table_id: operation.relationship.right_table_id,
          column_id: rightColumnId,
        }
      : {
          table_id: operation.relationship.left_table_id,
          column_id: leftColumnId,
        };
    return {
      kind: "comparison",
      left: fieldExpressionFromState(left, leftField, leftSource),
      operator: "eq",
      right: fieldExpressionFromState(right, rightField, rightSource),
    } satisfies PostgresqlCondition;
  });
  const merged = mergedStateMaps(left, right);
  context.ctes.push({
    operation_id: operation.operation_id,
    operation: "join",
    name: cte,
    query: {
      kind: "select",
      columns: [...selectAllColumns(left, leftSource), ...selectAllColumns(right, rightSource)],
      from: relationForCte(left.cte, leftSource),
      joins: [
        {
          join_type: operation.join_type,
          relation: relationForCte(right.cte, rightSource),
          conditions,
        },
      ],
      where: [],
      group_by: [],
    },
  });
  return {
    cte,
    ...merged,
  };
}

function aggregateFunction(measure: Measure): "AVG" | "COUNT" | "MAX" | "MIN" | "SUM" {
  switch (measure.function) {
    case "avg":
      return "AVG";
    case "count":
    case "count_distinct":
      return "COUNT";
    case "max":
      return "MAX";
    case "min":
      return "MIN";
    case "sum":
      return "SUM";
    default: {
      const exhaustive: never = measure.function;
      return exhaustive;
    }
  }
}

function compileMeasureExpression(
  measure: Measure,
  input: RelationState,
  source: PostgresqlGeneratedIdentifier,
  context: CompilationContext,
): Readonly<{
  expression: PostgresqlExpression;
  data_type: PostgresqlDataType;
}> {
  const column = requireGroundingColumn(context, measure.field.table_id, measure.field.column_id);
  if (
    (measure.function === "sum" || measure.function === "avg") &&
    column.data_type !== "integer" &&
    column.data_type !== "numeric"
  ) {
    failWith("POSTGRESQL_COMPILER_MEASURE_UNSUPPORTED");
  }
  let argument = fieldExpressionFromState(input, measure.field, source);
  if (measure.null_policy === "coalesce-zero") {
    if (column.data_type !== "integer" && column.data_type !== "numeric") {
      failWith("POSTGRESQL_COMPILER_MEASURE_UNSUPPORTED");
    }
    argument = {
      kind: "coalesce-zero",
      expression: argument,
    };
  }
  let expression: PostgresqlExpression = {
    kind: "aggregate",
    function: aggregateFunction(measure),
    distinct: measure.distinct,
    argument,
  };
  if (
    measure.null_policy === "coalesce-zero" &&
    measure.function !== "count" &&
    measure.function !== "count_distinct"
  ) {
    expression = {
      kind: "coalesce-zero",
      expression,
    };
  }
  return {
    expression,
    data_type:
      measure.function === "count" || measure.function === "count_distinct"
        ? "numeric"
        : column.data_type,
  };
}

function compileAggregate(
  operation: Extract<LogicalOperationDraft, { operation: "aggregate" }>,
  cte: PostgresqlGeneratedIdentifier,
  context: CompilationContext,
): RelationState {
  const input = requireState(context, operation.input_id);
  const source = generatedIdentifier("source");
  const fields = new Map<string, FieldBinding>();
  const results = new Map<string, ResultBinding>();
  const outputs: RelationOutput[] = [];
  const columns: PostgresqlSelectAst["columns"][number][] = [];
  const groupBy: PostgresqlExpression[] = [];
  for (const field of operation.group_by) {
    const key = fieldKey(field.table_id, field.column_id);
    if (fields.has(key)) continue;
    const inputBinding = input.fields.get(key);
    if (!inputBinding) failWith("POSTGRESQL_COMPILER_DATAFLOW_INVALID");
    const alias = generatedIdentifier(`group_${fields.size + 1}`);
    const binding = {
      alias,
      data_type: inputBinding.data_type,
    } satisfies FieldBinding;
    const resultBinding = {
      alias,
      data_type: inputBinding.data_type,
      source_kind: "group",
    } satisfies ResultBinding;
    const expression = fieldExpressionFromState(input, field, source);
    fields.set(key, binding);
    const existingResult = results.get(field.column_id);
    if (existingResult && existingResult.alias.value !== alias.value) {
      failWith("POSTGRESQL_COMPILER_ALIAS_COLLISION");
    }
    results.set(field.column_id, resultBinding);
    outputs.push({ namespace: "field", key, binding });
    columns.push({ expression, alias });
    groupBy.push(expression);
  }
  for (const [measureIndex, measure] of operation.measures.entries()) {
    if (results.has(measure.alias)) {
      failWith("POSTGRESQL_COMPILER_ALIAS_COLLISION");
    }
    const compiled = compileMeasureExpression(measure, input, source, context);
    const alias = generatedIdentifier(`measure_${measureIndex + 1}`);
    const binding = {
      alias,
      data_type: compiled.data_type,
      source_kind: "measure",
    } satisfies ResultBinding;
    results.set(measure.alias, binding);
    outputs.push({ namespace: "result", key: measure.alias, binding });
    columns.push({ expression: compiled.expression, alias });
  }
  context.ctes.push({
    operation_id: operation.operation_id,
    operation: "aggregate",
    name: cte,
    query: {
      kind: "select",
      columns,
      from: relationForCte(input.cte, source),
      joins: [],
      where: [],
      group_by: groupBy,
    },
  });
  return { cte, fields, results, outputs };
}

function compileProject(
  operation: Extract<LogicalOperationDraft, { operation: "project" }>,
  cte: PostgresqlGeneratedIdentifier,
  context: CompilationContext,
): RelationState {
  const input = requireState(context, operation.input_id);
  const source = generatedIdentifier("source");
  const results = new Map<string, ResultBinding>();
  const outputs: RelationOutput[] = [];
  const columns = operation.columns.map((column) => {
    const inputBinding = input.results.get(column.source_id);
    if (!inputBinding || inputBinding.source_kind !== column.source_kind) {
      failWith("POSTGRESQL_COMPILER_DATAFLOW_INVALID");
    }
    if (results.has(column.alias)) {
      failWith("POSTGRESQL_COMPILER_ALIAS_COLLISION");
    }
    const alias = validatedOutputIdentifier(column.alias);
    const binding = {
      alias,
      data_type: inputBinding.data_type,
      source_kind: "project",
    } satisfies ResultBinding;
    results.set(column.alias, binding);
    outputs.push({ namespace: "result", key: column.alias, binding });
    return {
      expression: columnExpression(source, inputBinding.alias),
      alias,
    };
  });
  context.ctes.push({
    operation_id: operation.operation_id,
    operation: "project",
    name: cte,
    query: {
      kind: "select",
      columns,
      from: relationForCte(input.cte, source),
      joins: [],
      where: [],
      group_by: [],
    },
  });
  return {
    cte,
    fields: new Map(),
    results,
    outputs,
  };
}

function compileOperation(
  operation: LogicalOperationDraft,
  index: number,
  context: CompilationContext,
): RelationState {
  const cte = generatedIdentifier(`query_${index + 1}`);
  switch (operation.operation) {
    case "scan":
      return compileScan(operation, cte, context);
    case "filter":
      return compileFilter(operation, cte, context);
    case "join":
      return compileJoin(operation, cte, context);
    case "preaggregate":
      return failWith("POSTGRESQL_COMPILER_PREAGGREGATION_UNSUPPORTED");
    case "aggregate":
      return compileAggregate(operation, cte, context);
    case "project":
      return compileProject(operation, cte, context);
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

function derivePolicyBindings(
  logicalPlan: ValidatedLogicalPlan,
  logicalPlanBinding: AuthoritativeLogicalPlanBinding,
): Readonly<Record<string, ParameterValue>> {
  const policyKeys = [
    ...new Set(
      Object.values(logicalPlan.parameters).flatMap((parameter) =>
        parameter.source === "policy" ? [parameter.policy_key] : [],
      ),
    ),
  ].sort(compareStable);
  const supportedBindings = logicalPlanBinding.policy_binding;
  const resolved: Record<string, ParameterValue> = {};
  for (const policyKey of policyKeys) {
    switch (policyKey) {
      case "app_id":
      case "tenant_id":
      case "environment":
      case "principal_id":
        resolved[policyKey] = supportedBindings[policyKey];
        break;
      default:
        failWith("POSTGRESQL_COMPILER_POLICY_BINDING_UNSUPPORTED");
    }
  }
  return deepFreeze(resolved);
}

function canonicalPolicyPredicate(
  predicate:
    | GroundingPackageDraft["mandatory_predicates"][number]
    | Readonly<{
        table_id: string;
        column_id: string;
        operator: string;
        parameter_key?: string | null;
      }>,
): string {
  if (predicate.operator === "is_null" || predicate.operator === "is_not_null") {
    return canonicalizeJson({
      table_id: predicate.table_id,
      column_id: predicate.column_id,
      operator: predicate.operator,
    });
  }
  return canonicalizeJson({
    table_id: predicate.table_id,
    column_id: predicate.column_id,
    operator: predicate.operator,
    parameter_key: predicate.parameter_key ?? null,
  });
}

function assertMandatoryPolicyPredicateCoverage(
  logicalPlan: ValidatedLogicalPlan,
  grounding: GroundingPackageDraft,
): void {
  const observed = logicalPlan.operations.flatMap((operation) =>
    operation.operation === "filter"
      ? operation.predicates.flatMap((predicate) => {
          if (predicate.authority !== "policy") return [];
          const field = predicate.kind === "comparison" ? predicate.left : predicate.field;
          if (predicate.kind === "null-check") {
            return [
              canonicalPolicyPredicate({
                table_id: field.table_id,
                column_id: field.column_id,
                operator: predicate.operator,
              }),
            ];
          }
          if (predicate.kind !== "comparison") return [];
          const parameter = logicalPlan.parameters[predicate.right.parameter_key];
          return [
            canonicalPolicyPredicate({
              table_id: field.table_id,
              column_id: field.column_id,
              operator: predicate.operator,
              parameter_key: parameter?.source === "policy" ? parameter.policy_key : null,
            }),
          ];
        })
      : [],
  );
  const expected = grounding.mandatory_predicates.map(canonicalPolicyPredicate);
  const sortedObserved = [...observed].sort(compareStable);
  const sortedExpected = [...expected].sort(compareStable);
  if (
    sortedObserved.length !== sortedExpected.length ||
    sortedObserved.some((value, index) => value !== sortedExpected[index])
  ) {
    failWith("POSTGRESQL_COMPILER_POLICY_PREDICATE_COVERAGE_MISMATCH");
  }
}

async function assertGroundingHash(
  logicalPlan: ValidatedLogicalPlan,
  grounding: GroundingPackageDraft,
): Promise<void> {
  const { grounding_hash: declaredHash, ...hashMaterial } = grounding;
  const observedHash = await computeGroundingHash(hashMaterial);
  if (observedHash !== declaredHash || logicalPlan.grounding_hash !== declaredHash) {
    failWith("POSTGRESQL_COMPILER_GROUNDING_HASH_MISMATCH");
  }
}

function createCompilationContext(
  logicalPlan: ValidatedLogicalPlan,
  grounding: GroundingPackageDraft,
  policyBindings: Readonly<Record<string, unknown>>,
): CompilationContext {
  const tables = new Map(grounding.allowed_schema.tables.map((table) => [table.table_id, table]));
  const columns = new Map(
    grounding.allowed_schema.tables.flatMap((table) =>
      table.columns.map((column) => [fieldKey(table.table_id, column.column_id), column] as const),
    ),
  );
  const sortedFieldKeys = [...columns.keys()].sort(compareStable);
  const fieldAliases = new Map(
    sortedFieldKeys.map((key, index) => [key, generatedIdentifier(`field_${index + 1}`)]),
  );
  return {
    logicalPlan,
    grounding,
    tables,
    columns,
    fieldAliases,
    states: new Map(),
    ctes: [],
    parameters: new ParameterRegistry(logicalPlan.parameters, policyBindings),
  };
}

function rootSelect(rootState: RelationState): PostgresqlSelectAst {
  const source = generatedIdentifier("root_source");
  return {
    kind: "select",
    columns: selectAllColumns(rootState, source),
    from: relationForCte(rootState.cte, source),
    joins: [],
    where: [],
    group_by: [],
  };
}

function assertSqlSafety(
  sql: string,
  parameterOrder: readonly PostgresqlParameterOrderEntry[],
  parameters: Readonly<Record<string, ParameterValue>>,
): void {
  const forbidden = [
    /\bNATURAL\s+JOIN\b/i,
    /\bBETWEEN\b/i,
    /\bSELECT\s+INTO\b/i,
    /\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b/i,
  ];
  if (sql.includes(";") || forbidden.some((pattern) => pattern.test(sql))) {
    failWith("POSTGRESQL_COMPILER_AST_SAFETY_VIOLATION");
  }
  const expectedPlaceholders = parameterOrder.map(({ placeholder }) => placeholder);
  if (
    expectedPlaceholders.some((placeholder, index) => placeholder !== `$${index + 1}`) ||
    Object.keys(parameters).some(
      (placeholder, index) => placeholder !== expectedPlaceholders[index],
    ) ||
    Object.keys(parameters).length !== expectedPlaceholders.length
  ) {
    failWith("POSTGRESQL_COMPILER_AST_SAFETY_VIOLATION");
  }
  const expected = new Set(expectedPlaceholders);
  const observed = [...sql.matchAll(/\$[1-9][0-9]*/g)].map(([placeholder]) => placeholder);
  if (
    observed.some((placeholder) => !expected.has(placeholder as `$${number}`)) ||
    expectedPlaceholders.some((placeholder) => !observed.includes(placeholder))
  ) {
    failWith("POSTGRESQL_COMPILER_AST_SAFETY_VIOLATION");
  }
}

function identifierProof(
  grounding: GroundingPackageDraft,
): PostgresqlCompilationProof["identifiers"] {
  return grounding.allowed_schema.tables
    .flatMap((table) => [
      {
        kind: "table" as const,
        logical_id: table.table_id,
        physical_name: table.physical_name,
      },
      ...table.columns.map((column) => ({
        kind: "column" as const,
        logical_id: column.column_id,
        physical_name: column.physical_name,
      })),
    ])
    .sort((left, right) =>
      compareStable(
        `${left.kind}\u0000${left.logical_id}`,
        `${right.kind}\u0000${right.logical_id}`,
      ),
    );
}

async function compileParsedInput(
  parsed: z.infer<typeof compilerInputSchema>,
): Promise<PostgresqlCompilationResult> {
  if (!isAuthoritativeLogicalPlanBinding(parsed.logical_plan_binding)) {
    return failed("POSTGRESQL_COMPILER_LOGICAL_PLAN_AUTHORITY_REQUIRED");
  }
  if (
    parsed.semantic_context_binding !== undefined &&
    !isAuthoritativeSemanticContextText2SqlBinding(parsed.semantic_context_binding)
  ) {
    return failed("POSTGRESQL_COMPILER_SEMANTIC_CONTEXT_AUTHORITY_REQUIRED");
  }
  const logicalPlan = parsed.logical_plan_binding.logical_plan;
  const logicalPlanReference = parsed.logical_plan_binding.reference;
  if (!isValidatedLogicalPlan(logicalPlan)) {
    return failed("POSTGRESQL_COMPILER_LOGICAL_PLAN_VALIDATION_REQUIRED");
  }
  try {
    await assertGroundingHash(logicalPlan, parsed.grounding);
    assertMandatoryPolicyPredicateCoverage(logicalPlan, parsed.grounding);
    const policyBindings = derivePolicyBindings(logicalPlan, parsed.logical_plan_binding);
    const context = createCompilationContext(logicalPlan, parsed.grounding, policyBindings);
    for (const [index, operation] of logicalPlan.operations.entries()) {
      const state = compileOperation(operation, index, context);
      context.states.set(operation.operation_id, state);
    }
    const rootOperation = logicalPlan.operations.find(
      ({ operation_id }) => operation_id === logicalPlan.root_operation_id,
    );
    if (rootOperation?.operation !== "project") {
      failWith("POSTGRESQL_COMPILER_ROOT_NOT_PROJECT");
    }
    const rootState = requireState(context, logicalPlan.root_operation_id);
    context.parameters.assertAllDefinitionsConsumed();
    const ast = deepFreeze({
      kind: "postgresql-query",
      compiler_version: POSTGRESQL_COMPILER_VERSION,
      ctes: context.ctes,
      root: rootSelect(rootState),
    } satisfies PostgresqlQueryAst);
    const astHash = await sha256ContentHash(ast);
    const sql = renderPostgresqlQueryAst(ast);
    const parameterOrder = deepFreeze([...context.parameters.entries()]);
    const parameters = deepFreeze({ ...context.parameters.values() });
    assertSqlSafety(sql, parameterOrder, parameters);
    const queryHash = await computeSqlArtifactQueryHash({
      dialect: "postgresql",
      sql,
      parameters,
    });
    const policyBindingHash = await sha256ContentHash({
      logical_plan_ref: logicalPlanReference,
      policy_bindings: policyBindings,
    });
    const logicalPlanHash = await sha256ContentHash(logicalPlan);
    const sqlArtifact = deepFreeze(
      sqlArtifactSchema.parse({
        artifact_type: "SqlArtifact",
        logical_plan_ref: logicalPlanReference,
        compiler_version: POSTGRESQL_COMPILER_VERSION,
        ast_hash: astHash,
        dialect: "postgresql",
        sql,
        parameters,
        query_hash: queryHash,
        ...(parsed.semantic_context_binding
          ? { semantic_context_binding_hash: parsed.semantic_context_binding.binding_hash }
          : {}),
      }),
    );
    const proof = deepFreeze({
      compiler_version: POSTGRESQL_COMPILER_VERSION,
      dialect: "postgresql",
      logical_plan_ref: logicalPlanReference,
      logical_plan_hash: logicalPlanHash,
      grounding_hash: logicalPlan.grounding_hash,
      policy_version: parsed.grounding.policy_version,
      policy_binding_hash: policyBindingHash,
      policy_binding_authority: "LOGICAL_PLAN_REF_AND_SERVER_PRINCIPAL_CAPABILITY",
      query_hash: sqlArtifact.query_hash,
      ...(parsed.semantic_context_binding
        ? { semantic_context_binding_hash: parsed.semantic_context_binding.binding_hash }
        : {}),
      identifier_authority: "GROUNDING_PHYSICAL_NAME_ONLY",
      alias_strategy: "VALIDATED_LOGICAL_OUTPUT_ALIAS_QUOTED",
      parameterization: "POSTGRESQL_POSITIONAL_ALL_VALUES",
      time_semantics: "HALF_OPEN_GTE_LT",
      search_path_binding: "REQUIRED_AT_EXECUTION",
      forbidden_constructs: ["NATURAL_JOIN", "BETWEEN", "SELECT_INTO", "LOCKING_CLAUSE"],
      identifiers: identifierProof(parsed.grounding),
      operations: ast.ctes.map(({ operation_id, operation, name }) => ({
        operation_id,
        operation,
        cte_name: name.value,
      })),
      output_columns: rootState.outputs.map(({ key, binding }) => ({
        logical_alias: key,
        sql_alias: binding.alias.value,
      })),
    } satisfies PostgresqlCompilationProof);
    const compilation = deepFreeze(
      registerPostgresqlCompilation({
        dialect: "postgresql",
        sql_artifact: sqlArtifact,
        ast,
        proof,
        parameter_order: parameterOrder,
      }),
    );
    return deepFreeze({
      state: "COMPILED",
      compilation,
    });
  } catch (error) {
    if (error instanceof CompilerFailure) {
      if (error.reasonCode === "POSTGRESQL_COMPILER_PREAGGREGATION_UNSUPPORTED") {
        return unsupported(error.reasonCode);
      }
      return failed(error.reasonCode);
    }
    return failed("POSTGRESQL_COMPILER_INTERNAL_ERROR");
  }
}

export async function compilePostgresqlLogicalPlan(
  input: unknown,
): Promise<PostgresqlCompilationResult> {
  const parsed = compilerInputSchema.safeParse(input);
  if (!parsed.success) {
    return failed("POSTGRESQL_COMPILER_INPUT_INVALID");
  }
  return compileParsedInput(parsed.data);
}

function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function compileSqlDialect(input: unknown): Promise<PostgresqlCompilationResult> {
  if (!isObjectRecord(input) || typeof input.dialect !== "string") {
    return failed("POSTGRESQL_COMPILER_INPUT_INVALID");
  }
  if (input.dialect !== "postgresql") {
    return unsupported("UNSUPPORTED_DIALECT");
  }
  const parsed = dialectCompilerInputSchema.safeParse(input);
  if (!parsed.success) {
    return failed("POSTGRESQL_COMPILER_INPUT_INVALID");
  }
  return compileParsedInput(parsed.data);
}
