import type { Text2SqlQueryCandidate } from "@data-agent/contracts/agents";
import { canonicalizeJson } from "@data-agent/contracts/common";
import { parse } from "pgsql-parser";

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
    // SUM of int2/int4 truncates division. Never label that as the governed rate.
    check(
      /^(?:numeric(?:\(\d+(?:,\s*-?\d+)?\))?|real|double precision|bigint)$/u.test(
        source.value_type,
      ),
    );
    function scan(name: string, window: { readonly start: string; readonly end: string }) {
      const query = ctes.get(name);
      check(query);
      only(query, ["targetList", "fromClause", "whereClause", "groupClause", "limitOption", "op"]);
      check(query.op === "SETOP_NONE" && query.limitOption === "LIMIT_OPTION_DEFAULT");
      const relation = range(list(query.fromClause, 1)[0]);
      check(relation.schema === source.schema_name && relation.name === source.relation_name);
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
        const uncast = cast(expression, ["date"]);
        const call = node(uncast, "FuncCall");
        only(call, ["funcname", "args", "funcformat"]);
        const name = primitive(call.funcname);
        if (name === "date_trunc") {
          const args = list(call.args, 2);
          check(parameter(args[0], candidate.parameters) === "month" && timeColumn(args[1]));
          month = key;
          bucket = expression;
        } else {
          check(
            name === "sum" &&
              uncast === expression &&
              column(list(call.args, 1)[0], relation.alias, source.value_column),
          );
          amount = key;
        }
      }
      check(month && amount && month !== amount);
      const grouped = list(query.groupClause, 1)[0];
      const groupAlias = record(grouped).ColumnRef;
      check(
        same(grouped, bucket) ||
          (groupAlias &&
            canonicalizeJson(strings(record(groupAlias).fields)) === canonicalizeJson([month])),
      );
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
    const current = scan(left.name, input.current),
      prior = scan(right.name, input.comparison);
    const alignment = binary(join.quals, "=");
    check(column(alignment.lexpr, left.alias, current.month));
    const shifted = binary(alignment.rexpr, "+");
    check(column(shifted.lexpr, right.alias, prior.month));
    check(record(shifted.rexpr).TypeCast);
    check(parameter(cast(shifted.rexpr, ["interval"]), candidate.parameters) === "1 year");
    const outputs = targets(select);
    check(outputs.size === 4 && candidate.result_columns.length === 4);
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
    throw new TypeError(failure);
  }
}
