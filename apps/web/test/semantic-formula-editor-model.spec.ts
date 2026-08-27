import {
  SEMANTIC_FORMULA_AST_V2_VERSION,
  SEMANTIC_FORMULA_AST_VERSION,
  semanticFormulaExpressionSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  defaultFormulaExpression,
  FORMULA_EXPRESSION_KINDS,
  semanticFormulaLanguageVersion,
} from "@/components/semantic/studio/semantic-formula-editor-model";

describe("Semantic Formula editor model", () => {
  it("offers a valid grouped-count expression", () => {
    expect(FORMULA_EXPRESSION_KINDS).toContain("GROUP_COUNT");

    const expression = defaultFormulaExpression("GROUP_COUNT");

    expect(semanticFormulaExpressionSchema.parse(expression)).toEqual(expression);
    expect(expression).toEqual({
      kind: "GROUP_COUNT",
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
    });
  });

  it("upgrades grouped-count formulas to v2 without downgrading existing formulas", () => {
    expect(
      semanticFormulaLanguageVersion(
        defaultFormulaExpression("GROUP_COUNT"),
        SEMANTIC_FORMULA_AST_VERSION,
      ),
    ).toBe(SEMANTIC_FORMULA_AST_V2_VERSION);
    expect(
      semanticFormulaLanguageVersion(
        defaultFormulaExpression("LITERAL"),
        SEMANTIC_FORMULA_AST_V2_VERSION,
      ),
    ).toBe(SEMANTIC_FORMULA_AST_V2_VERSION);
  });
});
