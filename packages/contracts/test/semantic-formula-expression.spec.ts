import { describe, expect, it } from "vitest";
import {
  formulaNodeSchema,
  SEMANTIC_FORMULA_AST_V2_VERSION,
  semanticFormulaExpressionSchema,
} from "../src/artifacts/semantic-graph-v2.js";

describe("semantic formula expression", () => {
  it("represents a count of groups selected by an aggregate HAVING predicate", () => {
    const expression = {
      kind: "GROUP_COUNT",
      group_by: [{ kind: "SLOT", slot_id: "customer_id" }],
      having: {
        kind: "BINARY",
        operator: "GT",
        left: {
          kind: "AGGREGATE",
          function: "COUNT_DISTINCT",
          input: { kind: "SLOT", slot_id: "order_id" },
          distinct: true,
          filter: null,
        },
        right: { kind: "LITERAL", value: 1 },
      },
    } as const;

    expect(semanticFormulaExpressionSchema.parse(expression)).toEqual(expression);
    expect(semanticFormulaExpressionSchema.safeParse({ ...expression, group_by: [] }).success).toBe(
      false,
    );
    const node = {
      node_id: "formula.repeat_customers",
      node_version: 1,
      node_type: "FORMULA",
      name: "repeat_customers",
      aliases: [],
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags: [],
      formula_type: "non_additive_aggregate",
      return_type: "integer",
      language: "semantic-ast",
      language_version: SEMANTIC_FORMULA_AST_V2_VERSION,
      expression,
    } as const;
    expect(formulaNodeSchema.parse(node)).toEqual(node);
    expect(
      formulaNodeSchema.safeParse({ ...node, language_version: "semantic-formula-ast@1" }).success,
    ).toBe(false);
  });
});
