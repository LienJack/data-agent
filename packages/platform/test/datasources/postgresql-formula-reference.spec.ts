import type { SemanticFormulaExpression } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { renderPostgresqlFormulaReference } from "../../src/datasources/adapters/postgresql-formula-reference.js";
import { resolvePostgresqlFormulaProjectionSlots } from "../../src/datasources/adapters/postgresql-text2sql-policy.js";

const slot = {
  slot_id: "amount",
  schema_name: "public",
  relation_name: "facts",
  column_name: 'amount"quoted',
  physical_type: "numeric",
};
const amount: SemanticFormulaExpression = { kind: "SLOT", slot_id: "amount" };
const sum: SemanticFormulaExpression = {
  kind: "AGGREGATE",
  function: "SUM",
  input: amount,
  distinct: false,
  filter: null,
};
const render = (expression: SemanticFormulaExpression, slots = [slot]) =>
  renderPostgresqlFormulaReference({ formula_id: "formula.test", expression, slots });

describe("published Formula syntax reference", () => {
  it.each([false, true])(
    "preserves DISTINCT=%s, FILTER, NULL and escaped identifiers under original AST proof",
    async (distinct) => {
      const expression: SemanticFormulaExpression = {
        kind: "CASE",
        branches: [
          {
            when: {
              kind: "BINARY",
              operator: "EQ",
              left: sum,
              right: { kind: "LITERAL", value: 0 },
            },
            result: { kind: "LITERAL", value: null },
          },
        ],
        otherwise: {
          ...sum,
          distinct,
          filter: {
            kind: "BINARY",
            operator: "GT",
            left: amount,
            right: { kind: "LITERAL", value: 7 },
          },
        },
      };
      const reference = render(expression);
      if (!reference) throw new Error("REFERENCE_REQUIRED");
      expect(reference.expression_sql).toContain('f."amount""quoted"');
      expect(reference.expression_sql.includes("DISTINCT")).toBe(distinct);
      expect(reference.parameters).toEqual([0, null, 7]);
      await expect(
        resolvePostgresqlFormulaProjectionSlots({
          sql: `SELECT ${reference.expression_sql} AS v FROM public.facts AS f`,
          parameters: reference.parameters,
          output_name: "v",
          expression,
          slots: [slot],
        }),
      ).resolves.toEqual(["amount"]);
    },
  );

  it("accepts duplicate equivalent bindings but rejects ambiguous, missing and cross-relation slots", () => {
    expect(render(sum, [slot, { ...slot }])).not.toBeNull();
    expect(render(sum, [])).toBeNull();
    expect(render(sum, [slot, { ...slot, column_name: "other" }])).toBeNull();
    const ratio: SemanticFormulaExpression = {
      kind: "BINARY",
      operator: "DIVIDE",
      left: sum,
      right: { ...sum, input: { kind: "SLOT", slot_id: "spend" } },
    };
    expect(
      render(ratio, [
        slot,
        { ...slot, slot_id: "spend", relation_name: "other", column_name: "spend" },
      ]),
    ).toBeNull();
  });

  it("omits unsupported and overly deep syntax instead of guessing an equivalent formula", () => {
    expect(render({ kind: "DATE_BUCKET", granularity: "month", input: amount })).toBeNull();
    let expression: SemanticFormulaExpression = sum;
    for (let i = 0; i < 70; i++) expression = { kind: "NOT", operand: expression };
    expect(render(expression)).toBeNull();
    expect(render({ kind: "LITERAL", value: 7 })).toBeNull();
  });
});
