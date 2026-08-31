import type { SemanticFormulaExpression, Text2SqlQueryCandidate } from "@data-agent/contracts";

type Slot = {
  readonly slot_id: string;
  readonly schema_name: string;
  readonly relation_name: string;
  readonly column_name: string;
};

export interface PostgresqlFormulaReference {
  readonly formula_id: string;
  readonly schema_name: string;
  readonly relation_name: string;
  readonly table_alias: "f";
  readonly expression_sql: string;
  readonly parameters: Text2SqlQueryCandidate["parameters"];
}

/** Data-free syntax only. Caller must prove it against the original published binding. */
export function renderPostgresqlFormulaReference(input: {
  readonly formula_id: string;
  readonly expression: SemanticFormulaExpression;
  readonly slots: readonly Slot[];
}): PostgresqlFormulaReference | null {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const parameters: Text2SqlQueryCandidate["parameters"] = [];
  const used: Slot[] = [];
  let nodes = 0;
  const render = (expression: SemanticFormulaExpression, depth = 0): string | null => {
    if (depth > 64 || ++nodes > 256) return null;
    const child = (value: SemanticFormulaExpression) => render(value, depth + 1);
    switch (expression.kind) {
      case "LITERAL":
        parameters.push(expression.value);
        return `$${parameters.length}`;
      case "SLOT": {
        const choices = new Map(
          input.slots
            .filter((s) => s.slot_id === expression.slot_id)
            .map((s) => [JSON.stringify([s.schema_name, s.relation_name, s.column_name]), s]),
        );
        const slot = choices.values().next().value;
        if (choices.size !== 1 || !slot) return null;
        used.push(slot);
        return `f.${quote(slot.column_name)}`;
      }
      case "BINARY": {
        const left = child(expression.left),
          right = child(expression.right);
        const operator = {
          ADD: "+",
          SUBTRACT: "-",
          MULTIPLY: "*",
          DIVIDE: "/",
          EQ: "=",
          NEQ: "<>",
          GT: ">",
          GTE: ">=",
          LT: "<",
          LTE: "<=",
        }[expression.operator];
        return left && right && operator ? `(${left} ${operator} ${right})` : null;
      }
      case "AGGREGATE": {
        if (
          !expression.input ||
          !["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX"].includes(expression.function)
        )
          return null;
        const value = child(expression.input),
          filter = expression.filter ? child(expression.filter) : null;
        if (!value || (expression.filter && !filter)) return null;
        const name = expression.function === "COUNT_DISTINCT" ? "COUNT" : expression.function;
        return `${name}(${expression.distinct || expression.function === "COUNT_DISTINCT" ? "DISTINCT " : ""}${value})${filter ? ` FILTER (WHERE ${filter})` : ""}`;
      }
      case "CASE": {
        const branches = expression.branches.map((branch) => {
          const when = child(branch.when),
            result = child(branch.result);
          return when && result ? `WHEN ${when} THEN ${result}` : null;
        });
        const otherwise = expression.otherwise ? child(expression.otherwise) : null;
        if (branches.some((b) => b === null) || (expression.otherwise && !otherwise)) return null;
        return `(CASE ${branches.join(" ")}${otherwise ? ` ELSE ${otherwise}` : ""} END)`;
      }
      case "BOOLEAN": {
        const operands = expression.operands.map(child);
        return operands.some((v) => v === null)
          ? null
          : `(${operands.join(` ${expression.operator} `)})`;
      }
      case "NOT": {
        const operand = child(expression.operand);
        return operand ? `(NOT ${operand})` : null;
      }
      case "DATE_BUCKET":
      case "GROUP_COUNT":
        return null;
    }
  };
  const expressionSql = render(input.expression),
    source = used[0];
  if (
    !expressionSql ||
    !source ||
    used.some(
      (s) => s.schema_name !== source.schema_name || s.relation_name !== source.relation_name,
    )
  )
    return null;
  return {
    formula_id: input.formula_id,
    schema_name: source.schema_name,
    relation_name: source.relation_name,
    table_alias: "f",
    expression_sql: expressionSql,
    parameters,
  };
}
