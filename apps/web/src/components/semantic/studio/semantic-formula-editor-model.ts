import {
  SEMANTIC_FORMULA_AST_V2_VERSION,
  SEMANTIC_FORMULA_AST_VERSION,
  type SemanticFormulaExpression,
} from "@data-agent/contracts/artifacts";

export const FORMULA_EXPRESSION_KINDS = [
  "LITERAL",
  "SLOT",
  "BINARY",
  "BOOLEAN",
  "NOT",
  "CASE",
  "AGGREGATE",
  "DATE_BUCKET",
  "GROUP_COUNT",
] as const satisfies readonly SemanticFormulaExpression["kind"][];

export function defaultFormulaExpression(
  kind: SemanticFormulaExpression["kind"],
): SemanticFormulaExpression {
  switch (kind) {
    case "LITERAL":
      return { kind, value: 0 };
    case "SLOT":
      return { kind, slot_id: "value" };
    case "BINARY":
      return {
        kind,
        operator: "ADD",
        left: { kind: "SLOT", slot_id: "value" },
        right: { kind: "LITERAL", value: 0 },
      };
    case "BOOLEAN":
      return {
        kind,
        operator: "AND",
        operands: [
          { kind: "LITERAL", value: true },
          { kind: "LITERAL", value: true },
        ],
      };
    case "NOT":
      return { kind, operand: { kind: "LITERAL", value: true } };
    case "CASE":
      return {
        kind,
        branches: [
          {
            when: { kind: "LITERAL", value: true },
            result: { kind: "LITERAL", value: 0 },
          },
        ],
        otherwise: null,
      };
    case "AGGREGATE":
      return {
        kind,
        function: "SUM",
        input: { kind: "SLOT", slot_id: "value" },
        distinct: false,
        filter: null,
      };
    case "DATE_BUCKET":
      return {
        kind,
        granularity: "day",
        input: { kind: "SLOT", slot_id: "value" },
      };
    case "GROUP_COUNT":
      return {
        kind,
        group_by: [{ kind: "SLOT", slot_id: "group_key" }],
        having: {
          kind: "BINARY",
          operator: "GT",
          left: {
            kind: "AGGREGATE",
            function: "COUNT_DISTINCT",
            input: { kind: "SLOT", slot_id: "value" },
            distinct: true,
            filter: null,
          },
          right: { kind: "LITERAL", value: 1 },
        },
      };
  }
}

function containsGroupCount(expression: SemanticFormulaExpression): boolean {
  switch (expression.kind) {
    case "GROUP_COUNT":
      return true;
    case "BINARY":
      return containsGroupCount(expression.left) || containsGroupCount(expression.right);
    case "BOOLEAN":
      return expression.operands.some(containsGroupCount);
    case "NOT":
      return containsGroupCount(expression.operand);
    case "CASE":
      return (
        expression.branches.some(
          ({ when, result }) => containsGroupCount(when) || containsGroupCount(result),
        ) ||
        (expression.otherwise !== null && containsGroupCount(expression.otherwise))
      );
    case "AGGREGATE":
      return (
        (expression.input !== null && containsGroupCount(expression.input)) ||
        (expression.filter !== null && containsGroupCount(expression.filter))
      );
    case "DATE_BUCKET":
      return containsGroupCount(expression.input);
    case "LITERAL":
    case "SLOT":
      return false;
  }
}

export function semanticFormulaLanguageVersion(
  expression: SemanticFormulaExpression,
  current:
    | typeof SEMANTIC_FORMULA_AST_VERSION
    | typeof SEMANTIC_FORMULA_AST_V2_VERSION = SEMANTIC_FORMULA_AST_VERSION,
): typeof SEMANTIC_FORMULA_AST_VERSION | typeof SEMANTIC_FORMULA_AST_V2_VERSION {
  return containsGroupCount(expression) ? SEMANTIC_FORMULA_AST_V2_VERSION : current;
}
