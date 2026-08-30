import { describe, expect, it } from "vitest";
import { artifactWorkspaceTableProjectionSchema } from "../src/artifacts/export-receipt.js";
import { formatArtifactTableCell } from "../src/artifacts/table-presentation.js";

describe("Artifact table presentation", () => {
  it("formats a governed monthly instant in its explicit timezone, retaining raw input", () => {
    const column = {
      key: "period",
      label: "月份",
      data_type: "STRING" as const,
      display: {
        kind: "TEMPORAL" as const,
        logical_type: "DATETIME" as const,
        granularity: "month" as const,
        timezone: "Asia/Shanghai",
      },
    };
    const raw = "2023-10-31T16:00:00.000Z";
    expect(formatArtifactTableCell(raw, column)).toBe("2023-11");
    expect(raw).toBe("2023-10-31T16:00:00.000Z");
    expect(
      formatArtifactTableCell(raw, { key: "period", label: "普通文本", data_type: "STRING" }),
    ).toBe(raw);
    expect(
      artifactWorkspaceTableProjectionSchema.parse({
        kind: "TABLE",
        columns: [column],
        rows: [{ period: raw }],
        total_rows: 1,
      }).rows,
    ).toEqual([{ period: raw }]);
  });

  it("formats numbers without float tails and keeps null distinct from zero", () => {
    const column = { key: "value", label: "数值", data_type: "NUMBER" as const };
    expect(formatArtifactTableCell(567783.7399999999, column)).toBe("567,783.74");
    expect(formatArtifactTableCell(-0.0559835119752147, column)).toBe("-0.0559835119752");
    expect(formatArtifactTableCell(0.000000000123456789, column)).toBe("0.000000000123456789");
    expect(formatArtifactTableCell(9007199254740991, column)).toBe("9,007,199,254,740,991");
    expect(formatArtifactTableCell(null, column)).toBe("—");
    expect(formatArtifactTableCell(0, column)).toBe("0");
    expect(formatArtifactTableCell("567783.7399999999", { ...column, data_type: "STRING" })).toBe(
      "567783.7399999999",
    );
  });

  it.each([
    ["2024-02-29", "DATE", "day", "America/Los_Angeles", "2024-02-29"],
    ["2024-02-30", "DATE", "day", null, "2024-02-30"],
    ["2024-04-01", "DATE", "quarter", null, "2024-Q2"],
    ["2024-03-10T07:30:00.000Z", "DATETIME", "atomic", "America/New_York", "2024-03-10 03:30:00"],
    ["2024-03-10T07:30:00", "DATETIME", "day", "America/New_York", "2024-03-10T07:30:00"],
    ["not-a-date", "DATETIME", "month", "Asia/Shanghai", "not-a-date"],
  ] as const)(
    "formats %s with explicit %s/%s semantics",
    (value, logical_type, granularity, timezone, expected) => {
      expect(
        formatArtifactTableCell(value, {
          key: "time",
          label: "时间",
          data_type: "STRING",
          display: { kind: "TEMPORAL", logical_type, granularity, timezone },
        }),
      ).toBe(expected);
    },
  );

  it.each([
    ["DATETIME", null, "STRING"],
    ["DATETIME", "Not/A_Timezone", "STRING"],
    ["DATE", null, "NUMBER"],
  ] as const)("rejects invalid display binding %s/%s/%s", (logical_type, timezone, data_type) => {
    expect(
      artifactWorkspaceTableProjectionSchema.safeParse({
        kind: "TABLE",
        columns: [
          {
            key: "time",
            label: "时间",
            data_type,
            display: { kind: "TEMPORAL", logical_type, timezone, granularity: "month" },
          },
        ],
        rows: [{ time: "2024-01-01" }],
        total_rows: 1,
      }).success,
    ).toBe(false);
  });
});
