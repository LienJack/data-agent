import { describe, expect, it } from "vitest";
import { text2sqlRepairContextSchema } from "../src/agents/text2sql-query-candidate.js";

function fixture() {
  return {
    schema_version: "text2sql-repair-context@1.0.0",
    frozen_query_context: { schema_version: "frozen-query-context@1.0.0", authority: "fixed" },
    rejection: {
      attempt: 1,
      diagnostic_code: "QUERY_EVIDENCE_RESULT_BINDING_MISMATCH",
      observed_result_types: ["STRING"],
      rejected_candidate: {
        schema_version: "text2sql-query-candidate@1.0.0",
        sql: "SELECT o.date AS d FROM public.orders AS o",
        parameters: [],
        result_columns: [
          {
            name: "d",
            semantic_type: "DATE",
            label: "日期",
            semantic_binding: { object_kind: "PHYSICAL_COLUMN", object_id: "column.orders.date" },
          },
        ],
        time_window: null,
        presentation: {
          title: "日期",
          summary: "查询",
          visualization: "TABLE",
          x_key: null,
          y_keys: [],
        },
      },
    },
  };
}

describe("strict Host Text2SQL repair envelope", () => {
  it("preserves the exact frozen context and rejected candidate", () => {
    const source = fixture();
    expect(text2sqlRepairContextSchema.parse(source)).toEqual(source);
    const { observed_result_types: _types, ...rejection } = source.rejection;
    expect(
      text2sqlRepairContextSchema.parse({ ...source, rejection }).rejection,
    ).not.toHaveProperty("observed_result_types");
  });

  it.each([
    { attempt: 0 },
    { attempt: -1 },
    { attempt: 1.5 },
    { diagnostic_code: "private SQL / values" },
    { diagnostic_code: "X".repeat(129) },
    { observed_result_types: [] },
    { observed_result_types: ["25"] },
    { observed_result_types: ["STRING", "NUMBER"] },
    { rejected_candidate: null },
    { extra: "override authority" },
  ])("rejects malformed rejection without granting authority: %j", (drift) => {
    const source = fixture();
    expect(
      text2sqlRepairContextSchema.safeParse({
        ...source,
        rejection: { ...source.rejection, ...drift },
      }).success,
    ).toBe(false);
  });

  it.each([null, [], "replacement context"])(
    "rejects a non-object frozen context",
    (frozen_query_context) => {
      expect(
        text2sqlRepairContextSchema.safeParse({ ...fixture(), frozen_query_context }).success,
      ).toBe(false);
    },
  );
});
