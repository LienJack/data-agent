import type { Text2SqlQueryCandidate } from "@data-agent/contracts/agents";
import { canonicalizeJson } from "@data-agent/contracts/common";
import { parse } from "pgsql-parser";
import type { POSTGRESQL_PERIOD_COMPARISON_REPAIR_HINTS } from "./postgresql-period-comparison-diagnostics.js";
import type { POSTGRESQL_AGGREGATE_RATIO_REPAIR_HINTS } from "./postgresql-request-derivation-diagnostics.js";

type Node = Record<string, unknown>;
const failure = "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH";
function check(condition: unknown): asserts condition {
  if (!condition) throw new TypeError(failure);
}
function record(value: unknown): Node {
  check(value && typeof value === "object" && !Array.isArray(value));
  return value as Node;
}
function node(value: unknown, kind: string): Node {
  const wrapper = record(value);
  check(Object.keys(wrapper).length === 1);
  return record(wrapper[kind]);
}
function list(value: unknown, length: number): unknown[] {
  check(Array.isArray(value) && value.length === length);
  return value;
}
function strings(value: unknown): string[] {
  check(Array.isArray(value));
  return value.map((item) => {
    const text = node(item, "String").sval;
    check(typeof text === "string");
    return text;
  });
}
function primitive(value: unknown): string {
  const names = strings(value);
  check(names.length === 1 || (names.length === 2 && names[0] === "pg_catalog"));
  return names[names.length - 1] as string;
}
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "location")
      .map(([key, child]) => [key, clean(child)]),
  );
}
function same(left: unknown, right: unknown): boolean {
  return canonicalizeJson(clean(left)) === canonicalizeJson(clean(right));
}
function only(value: Node, keys: readonly string[]) {
  check(Object.keys(value).every((key) => keys.includes(key) || key === "location"));
}
function column(value: unknown, alias: string, name: string): boolean {
  const fields = strings(node(value, "ColumnRef").fields);
  return fields.length === 2 && fields[0] === alias && fields[1] === name;
}
function binary(value: unknown, operator: string, kind = "AEXPR_OP") {
  const expression = node(value, "A_Expr");
  only(expression, ["kind", "name", "lexpr", "rexpr"]);
  check(expression.kind === kind && primitive(expression.name) === operator);
  return expression;
}
function cast(value: unknown, types: readonly string[]): unknown {
  if (!record(value).TypeCast) return value;
  const expression = node(value, "TypeCast");
  only(expression, ["arg", "typeName"]);
  const type = record(expression.typeName);
  only(type, ["names", "typemod"]);
  check(type.typemod === -1 && types.includes(primitive(type.names)));
  return expression.arg;
}
function parameter(value: unknown, parameters: Text2SqlQueryCandidate["parameters"]): unknown {
  const index = node(value, "ParamRef").number;
  check(
    typeof index === "number" &&
      Number.isSafeInteger(index) &&
      index > 0 &&
      index <= parameters.length,
  );
  return parameters[index - 1];
}
function targets(select: Node) {
  check(Array.isArray(select.targetList));
  const entries = select.targetList.map((item) => {
    const target = node(item, "ResTarget");
    only(target, ["name", "val"]);
    check(typeof target.name === "string");
    return [target.name, target.val] as const;
  });
  const result = new Map(entries);
  check(result.size === entries.length);
  return result;
}
function range(value: unknown) {
  const relation = node(value, "RangeVar");
  only(relation, ["schemaname", "relname", "inh", "relpersistence", "alias"]);
  const alias = record(relation.alias);
  only(alias, ["aliasname"]);
  check(
    typeof alias.aliasname === "string" &&
      relation.inh === true &&
      typeof relation.relname === "string",
  );
  return { schema: relation.schemaname, name: relation.relname, alias: alias.aliasname };
}

/** Request-only SUM-before-ratio proof. No formula publication or SQL rewriting. */
export async function provePostgresqlAggregateRatio(input: {
  readonly candidate: Text2SqlQueryCandidate;
  readonly output_name: string;
  readonly interpretation_id: string;
  readonly numerator_metric_id: string;
  readonly denominator_metric_id: string;
  readonly numerator_adjustment: "NONE" | "SUBTRACT_DENOMINATOR";
  readonly source: {
    readonly schema_name: string;
    readonly relation_name: string;
    readonly numerator_column: string;
    readonly numerator_type: string;
    readonly denominator_column: string;
    readonly denominator_type: string;
  };
  readonly dimensions: readonly { readonly object_id: string; readonly column_name: string }[];
}): Promise<{
  group_outputs: string[];
  numerator_outputs: string[];
  denominator_outputs: string[];
}> {
  let diagnostic: keyof typeof POSTGRESQL_AGGREGATE_RATIO_REPAIR_HINTS =
    "TEXT2SQL_RATIO_QUERY_SHAPE_REJECTED";
  try {
    const { candidate, source } = input;
    const ast = record(await parse(candidate.sql));
    const select = node(record(list(ast.stmts, 1)[0]).stmt, "SelectStmt");
    only(select, ["targetList", "fromClause", "groupClause", "sortClause", "limitOption", "op"]);
    check(
      select.op === "SETOP_NONE" &&
        select.limitOption === "LIMIT_OPTION_DEFAULT" &&
        candidate.time_window === null,
    );
    const relation = range(list(select.fromClause, 1)[0]);
    diagnostic = "TEXT2SQL_RATIO_SOURCE_REJECTED";
    check(relation.schema === source.schema_name && relation.name === source.relation_name);
    const fractionalSum = (type: string) =>
      /^(?:numeric(?:\(\d+(?:,\s*-?\d+)?\))?|real|double precision|bigint)$/u.test(type);
    const types = [source.numerator_type, source.denominator_type];
    check(
      types.every((type) => ["smallint", "integer"].includes(type) || fractionalSum(type)) &&
        types.some(fractionalSum),
    );
    const sum = (expression: unknown, name: string) => {
      const call = node(expression, "FuncCall");
      only(call, ["funcname", "args", "funcformat"]);
      check(
        primitive(call.funcname) === "sum" && column(list(call.args, 1)[0], relation.alias, name),
      );
    };
    const literal = (expression: unknown, expected: 0 | null) => {
      if (record(expression).ParamRef)
        return parameter(expression, candidate.parameters) === expected;
      const constant = node(expression, "A_Const");
      if (expected === null) return constant.isnull === true;
      if (constant.ival) return (record(constant.ival).ival ?? 0) === 0;
      if (constant.fval) return Number(record(constant.fval).fval) === 0;
      return false;
    };
    const quotient = (expression: unknown, guarded: boolean) => {
      const ratio = binary(expression, "/");
      if (input.numerator_adjustment === "SUBTRACT_DENOMINATOR") {
        const difference = binary(ratio.lexpr, "-");
        sum(difference.lexpr, source.numerator_column);
        sum(difference.rexpr, source.denominator_column);
      } else sum(ratio.lexpr, source.numerator_column);
      if (guarded) sum(ratio.rexpr, source.denominator_column);
      else {
        const denominator = binary(ratio.rexpr, "=", "AEXPR_NULLIF");
        sum(denominator.lexpr, source.denominator_column);
        check(literal(denominator.rexpr, 0));
      }
    };
    diagnostic = "TEXT2SQL_RATIO_PROJECTION_REJECTED";
    const projected = targets(select);
    check(projected.size === candidate.result_columns.length);
    const groups = new Map<string, unknown>();
    const groupColumns = new Set<string>();
    const numeratorOutputs: string[] = [],
      denominatorOutputs: string[] = [];
    let rates = 0;
    for (const output of candidate.result_columns) {
      diagnostic = "TEXT2SQL_RATIO_PROJECTION_REJECTED";
      check(projected.has(output.name));
      const expression = projected.get(output.name);
      const binding = output.semantic_binding;
      if (binding.object_kind === "DIMENSION") {
        const dimensions = input.dimensions.filter(
          ({ object_id }) => object_id === binding.object_id,
        );
        const dimension = dimensions[0];
        check(dimensions.length === 1 && dimension && !groupColumns.has(dimension.column_name));
        check(column(expression, relation.alias, dimension.column_name));
        groupColumns.add(dimension.column_name);
        groups.set(output.name, expression);
      } else if (binding.object_kind === "METRIC") {
        check(output.semantic_type === "NUMBER");
        if (binding.object_id === input.numerator_metric_id) {
          sum(expression, source.numerator_column);
          numeratorOutputs.push(output.name);
        } else {
          check(binding.object_id === input.denominator_metric_id);
          sum(expression, source.denominator_column);
          denominatorOutputs.push(output.name);
        }
      } else {
        check(
          binding.object_kind === "REQUEST_DERIVED" &&
            binding.object_id === input.interpretation_id &&
            output.name === input.output_name &&
            output.semantic_type === "NUMBER",
        );
        rates += 1;
        diagnostic = "TEXT2SQL_RATIO_RATE_REJECTED";
        if (record(expression).CaseExpr) {
          const guarded = node(expression, "CaseExpr");
          only(guarded, ["args", "defresult"]);
          const branch = node(list(guarded.args, 1)[0], "CaseWhen");
          only(branch, ["expr", "result"]);
          const condition = binary(branch.expr, "=");
          sum(condition.lexpr, source.denominator_column);
          check(literal(condition.rexpr, 0) && literal(branch.result, null));
          quotient(guarded.defresult, true);
        } else quotient(expression, false);
      }
    }
    check(rates === 1);
    diagnostic = "TEXT2SQL_RATIO_GROUP_REJECTED";
    const grouped = list(select.groupClause ?? [], groups.size);
    const matched = new Set<string>();
    for (const expression of grouped) {
      const alias = record(expression).ColumnRef;
      const match = [...groups].filter(
        ([name, value]) =>
          same(value, expression) ||
          (alias && canonicalizeJson(strings(record(alias).fields)) === canonicalizeJson([name])),
      );
      const name = match[0]?.[0];
      check(match.length === 1 && name && !matched.has(name));
      matched.add(name);
    }
    diagnostic = "TEXT2SQL_RATIO_ORDERING_REJECTED";
    check(select.sortClause === undefined || Array.isArray(select.sortClause));
    for (const entry of (select.sortClause ?? []) as unknown[]) {
      const sort = node(entry, "SortBy");
      only(sort, ["node", "sortby_dir", "sortby_nulls"]);
      check(
        ["SORTBY_DEFAULT", "SORTBY_ASC", "SORTBY_DESC"].includes(String(sort.sortby_dir)) &&
          ["SORTBY_NULLS_DEFAULT", "SORTBY_NULLS_FIRST", "SORTBY_NULLS_LAST"].includes(
            String(sort.sortby_nulls),
          ),
      );
      const names = strings(node(sort.node, "ColumnRef").fields);
      check(names.length === 1 && projected.has(names[0] as string));
    }
    return {
      group_outputs: [...groups.keys()],
      numerator_outputs: numeratorOutputs,
      denominator_outputs: denominatorOutputs,
    };
  } catch {
    throw Object.assign(new TypeError(failure), { diagnostic_code: diagnostic });
  }
}

/** A proof, never a SQL generator or fallback. Unsupported shapes fail before target I/O. */
export async function provePostgresqlPeriodComparison(input: {
  readonly candidate: Text2SqlQueryCandidate;
  readonly output_name: string;
  readonly metric_id: string;
  readonly dimension_id: string;
  readonly source: {
    readonly schema_name: string;
    readonly relation_name: string;
    readonly value_column: string;
    readonly time_column: string;
    readonly time_type: string;
    readonly value_type: string;
  };
  readonly current: { readonly start: string; readonly end: string };
  readonly comparison: { readonly start: string; readonly end: string };
}): Promise<{ readonly current_output: string; readonly comparison_output: string }> {
  let diagnostic: keyof typeof POSTGRESQL_PERIOD_COMPARISON_REPAIR_HINTS =
    "TEXT2SQL_COMPARISON_QUERY_SHAPE_REJECTED";
  try {
    const ast = record(await parse(input.candidate.sql));
    const raw = record(list(ast.stmts, 1)[0]);
    const select = node(raw.stmt, "SelectStmt");
    only(select, ["targetList", "fromClause", "sortClause", "withClause", "limitOption", "op"]);
    check(select.op === "SETOP_NONE" && select.limitOption === "LIMIT_OPTION_DEFAULT");
    const withClause = record(select.withClause);
    only(withClause, ["ctes"]);
    const ctes = new Map(
      list(withClause.ctes, 2).map((item) => {
        const cte = node(item, "CommonTableExpr");
        only(cte, ["ctename", "ctematerialized", "ctequery"]);
        check(typeof cte.ctename === "string" && cte.ctematerialized === "CTEMaterializeDefault");
        return [cte.ctename, node(cte.ctequery, "SelectStmt")] as const;
      }),
    );
    check(ctes.size === 2);
    const join = node(list(select.fromClause, 1)[0], "JoinExpr");
    only(join, ["jointype", "larg", "rarg", "quals"]);
    check(join.jointype === "JOIN_LEFT");
    const left = range(join.larg),
      right = range(join.rarg);
    check(
      left.schema === undefined &&
        right.schema === undefined &&
        left.name !== right.name &&
        left.alias !== right.alias,
    );
    const { source, candidate } = input;
    diagnostic = "TEXT2SQL_COMPARISON_SOURCE_TYPE_REJECTED";
    // SUM of int2/int4 truncates division. Never label that as the governed rate.
    check(
      /^(?:numeric(?:\(\d+(?:,\s*-?\d+)?\))?|real|double precision|bigint)$/u.test(
        source.value_type,
      ),
    );
    function scan(
      name: string,
      window: { readonly start: string; readonly end: string },
      period: "CURRENT" | "PRIOR",
    ) {
      diagnostic = `TEXT2SQL_COMPARISON_${period}_SOURCE_REJECTED`;
      const query = ctes.get(name);
      check(query);
      only(query, ["targetList", "fromClause", "whereClause", "groupClause", "limitOption", "op"]);
      check(query.op === "SETOP_NONE" && query.limitOption === "LIMIT_OPTION_DEFAULT");
      const relation = range(list(query.fromClause, 1)[0]);
      check(relation.schema === source.schema_name && relation.name === source.relation_name);
      diagnostic = `TEXT2SQL_COMPARISON_${period}_PROJECTION_REJECTED`;
      const outputs = targets(query);
      check(outputs.size === 2);
      let month: string | undefined, amount: string | undefined, bucket: unknown;
      function timeColumn(expression: unknown): boolean {
        if (source.time_type === "text") {
          check(record(expression).TypeCast);
          expression = cast(expression, ["timestamp"]);
        }
        return column(expression, relation.alias, source.time_column);
      }
      for (const [key, expression] of outputs) {
        diagnostic = `TEXT2SQL_COMPARISON_${period}_PROJECTION_REJECTED`;
        const uncast = cast(expression, ["date"]);
        const call = node(uncast, "FuncCall");
        only(call, ["funcname", "args", "funcformat"]);
        const name = primitive(call.funcname);
        if (name === "date_trunc") {
          diagnostic = `TEXT2SQL_COMPARISON_${period}_MONTH_UNIT_REJECTED`;
          const args = list(call.args, 2);
          check(parameter(args[0], candidate.parameters) === "month");
          diagnostic = `TEXT2SQL_COMPARISON_${period}_TIME_INPUT_REJECTED`;
          check(timeColumn(args[1]));
          month = key;
          bucket = expression;
        } else {
          diagnostic = `TEXT2SQL_COMPARISON_${period}_SUM_INPUT_REJECTED`;
          check(
            name === "sum" &&
              uncast === expression &&
              column(list(call.args, 1)[0], relation.alias, source.value_column),
          );
          amount = key;
        }
      }
      diagnostic = `TEXT2SQL_COMPARISON_${period}_PROJECTION_REJECTED`;
      check(month && amount && month !== amount);
      diagnostic = `TEXT2SQL_COMPARISON_${period}_GROUP_REJECTED`;
      const grouped = list(query.groupClause, 1)[0];
      const groupAlias = record(grouped).ColumnRef;
      check(
        same(grouped, bucket) ||
          (groupAlias &&
            canonicalizeJson(strings(record(groupAlias).fields)) === canonicalizeJson([month])),
      );
      diagnostic = `TEXT2SQL_COMPARISON_${period}_WINDOW_REJECTED`;
      const where = node(query.whereClause, "BoolExpr");
      only(where, ["boolop", "args"]);
      check(where.boolop === "AND_EXPR");
      const bounds = list(where.args, 2).map((item) => node(item, "A_Expr"));
      for (const [operator, expected] of [
        [">=", window.start],
        ["<", window.end],
      ] as const) {
        const bound = bounds.filter((item) => primitive(item.name) === operator);
        check(bound.length === 1);
        const expression = binary({ A_Expr: bound[0] }, operator);
        check(timeColumn(expression.lexpr));
        const value = parameter(
          cast(expression.rexpr, ["date", "timestamp"]),
          candidate.parameters,
        );
        check(
          typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/u.test(value) &&
            Date.parse(value) === Date.parse(expected),
        );
      }
      return { month, amount };
    }
    const current = scan(left.name, input.current, "CURRENT"),
      prior = scan(right.name, input.comparison, "PRIOR");
    diagnostic = "TEXT2SQL_COMPARISON_ALIGNMENT_REJECTED";
    const alignment = binary(join.quals, "=");
    check(column(alignment.lexpr, left.alias, current.month));
    const shifted = binary(alignment.rexpr, "+");
    check(column(shifted.lexpr, right.alias, prior.month));
    check(record(shifted.rexpr).TypeCast);
    check(parameter(cast(shifted.rexpr, ["interval"]), candidate.parameters) === "1 year");
    diagnostic = "TEXT2SQL_COMPARISON_OUTPUT_BINDING_REJECTED";
    const outputs = targets(select);
    check(outputs.size === 4 && candidate.result_columns.length === 4);
    diagnostic = "TEXT2SQL_COMPARISON_RATE_REJECTED";
    const rate = binary(outputs.get(input.output_name), "/");
    const difference = binary(rate.lexpr, "-");
    check(
      column(difference.lexpr, left.alias, current.amount) &&
        column(difference.rexpr, right.alias, prior.amount),
    );
    const denominator = binary(rate.rexpr, "=", "AEXPR_NULLIF");
    check(column(denominator.lexpr, right.alias, prior.amount));
    const zero = record(denominator.rexpr);
    check(
      zero.ParamRef
        ? parameter(zero, candidate.parameters) === 0
        : same(zero, { A_Const: { ival: {} } }),
    );
    diagnostic = "TEXT2SQL_COMPARISON_OUTPUT_BINDING_REJECTED";
    let currentOutput: string | undefined,
      comparisonOutput: string | undefined,
      monthOutput: string | undefined;
    for (const declaration of candidate.result_columns) {
      if (declaration.name === input.output_name) {
        check(
          declaration.semantic_type === "NUMBER" &&
            declaration.semantic_binding.object_kind === "REQUEST_DERIVED",
        );
        continue;
      }
      const expression = outputs.get(declaration.name);
      const fields = strings(node(cast(expression, ["date"]), "ColumnRef").fields);
      check(fields.length === 2);
      if (fields[0] === left.alias && fields[1] === current.month) {
        check(
          declaration.semantic_binding.object_kind === "DIMENSION" &&
            declaration.semantic_binding.object_id === input.dimension_id &&
            ["DATE", "DATETIME"].includes(declaration.semantic_type),
        );
        monthOutput = declaration.name;
      } else {
        check(
          declaration.semantic_binding.object_kind === "METRIC" &&
            declaration.semantic_binding.object_id === input.metric_id &&
            declaration.semantic_type === "NUMBER",
        );
        if (column(expression, left.alias, current.amount)) currentOutput = declaration.name;
        else {
          check(column(expression, right.alias, prior.amount));
          comparisonOutput = declaration.name;
        }
      }
    }
    check(currentOutput && comparisonOutput && monthOutput);
    diagnostic = "TEXT2SQL_COMPARISON_ORDERING_REJECTED";
    if (select.sortClause) {
      const sort = node(list(select.sortClause, 1)[0], "SortBy");
      only(sort, ["node", "sortby_dir", "sortby_nulls"]);
      check(
        ["SORTBY_DEFAULT", "SORTBY_ASC"].includes(String(sort.sortby_dir)) &&
          sort.sortby_nulls === "SORTBY_NULLS_DEFAULT",
      );
      check(
        canonicalizeJson(strings(node(sort.node, "ColumnRef").fields)) ===
          canonicalizeJson([monthOutput]),
      );
    }
    return { current_output: currentOutput, comparison_output: comparisonOutput };
  } catch {
    throw Object.assign(new TypeError(failure), { diagnostic_code: diagnostic });
  }
}
