import { describe, expect, it } from "vitest";
import {
  evaluatePanelRatioRollup,
  resolvePanelRatioRollup,
} from "../../src/analysis/monthly-panel-ratio-rollup.js";
import { monthlyPanelFixture } from "./support/monthly-panel-fixture.js";

async function mapping() {
  const source = await monthlyPanelFixture(true, true, false, 2);
  const result = resolvePanelRatioRollup(source.binding, source.context, 2);
  if (!result) throw new Error("TEST_MAPPING_REQUIRED");
  return result;
}

const rows = [
  { month: "2024-01-01", channel: "A", audience: "small", spend: 10, revenue: 100, return_rate: 9 },
  { month: "2024-01-01", channel: "A", audience: "large", spend: 90, revenue: 90, return_rate: 0 },
  { month: "2024-02-01", channel: "A", audience: "small", spend: 20, revenue: 100, return_rate: 4 },
  {
    month: "2024-02-01",
    channel: "A",
    audience: "large",
    spend: 180,
    revenue: 198,
    return_rate: 0.1,
  },
];

describe("source-bound aggregate-before-filter ratio rollup", () => {
  it("selects the channel on raw sums and keeps even a non-declining audience", async () => {
    const result = evaluatePanelRatioRollup(await mapping(), rows);
    const channel = result.axes.find((axis) => axis.dimension_id === "dimension.channel");
    expect(channel?.groups).toHaveLength(1);
    expect(channel?.groups[0]).toMatchObject({
      value: "A",
      from: { numerator: 190, denominator: 100, ratio: 0.9 },
      to: { numerator: 298, denominator: 200, ratio: 0.49 },
      denominator_change: 100,
      ratio_change: 0.49 - 0.9,
      selected: true,
    });
    expect(channel?.groups[0]?.children.map(({ group }) => group.audience)).toEqual([
      "small",
      "large",
    ]);
    expect(channel?.groups[0]?.children[1]?.ratio_change).toBe(0.1);
    // Mean ratios 4.5 -> 2.05 are deliberately not the overall 0.9 -> 0.49.
    expect(result.axes.map(({ dimension_id }) => dimension_id)).toEqual([
      "dimension.channel",
      "dimension.audience",
    ]);
  });

  it.each(["zero", "negative", "missing", "no-match"])(
    "keeps %s parents unselected",
    async (kind) => {
      const input = structuredClone(rows);
      for (const row of input) {
        if (kind === "zero" && row.month === "2024-01-01") row.spend = 0;
        if (kind === "negative" && row.month === "2024-01-01") row.spend = -10;
        if (kind === "no-match") row.revenue = row.spend * 2;
      }
      const nullable: Record<string, unknown>[] = input;
      if (kind === "missing") nullable[0] = { ...nullable[0], revenue: null };
      const parent = evaluatePanelRatioRollup(await mapping(), nullable).axes[0]?.groups[0];
      expect(parent?.selected).toBe(false);
      expect(parent?.children).toEqual([]);
      if (kind === "missing" || kind === "zero") expect(parent?.from.ratio).toBeNull();
    },
  );

  it.each(["nonadditive", "missing-operand", "duplicate-operand"])(
    "rejects %s authority",
    async (kind) => {
      const source = structuredClone(await monthlyPanelFixture(true, true, false, 2));
      if (kind === "nonadditive") {
        const metric = source.context.metrics[0];
        if (metric) metric.additivity = "non-additive";
      }
      if (kind === "missing-operand")
        source.binding.columns = source.binding.columns.filter(
          (column) => column.output_name !== "spend",
        );
      if (kind === "duplicate-operand") {
        const metric = source.binding.columns.find((column) => column.output_name === "spend");
        if (metric) source.binding.columns.push({ ...metric, output_name: "another_spend" });
      }
      expect(() => resolvePanelRatioRollup(source.binding, source.context, 2)).toThrow(
        "MONTHLY_PANEL_RATIO_AUTHORITY_INVALID",
      );
    },
  );

  it("does not invent a ratio derivation or aggregate a twelve-month panel", async () => {
    const source = await monthlyPanelFixture(true, false, false, 2);
    expect(resolvePanelRatioRollup(source.binding, source.context, 2)).toBeNull();
    expect(resolvePanelRatioRollup(source.binding, source.context, 12)).toBeNull();
  });

  it("uses semantic roles with misleading aliases and preserves tuple identity", async () => {
    const bound = await mapping();
    const rename = (key: string) =>
      ({ revenue: "spend_label", spend: "revenue_label", channel: "a|b", audience: "c" })[key] ??
      key;
    const renamed = {
      ...bound,
      categories: bound.categories.map((axis) => ({
        ...axis,
        dimension_output: rename(axis.dimension_output),
      })),
      numerator_output: rename(bound.numerator_output),
      denominator_output: rename(bound.denominator_output),
    };
    const source = rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [rename(key), value])),
    );
    const result = evaluatePanelRatioRollup(renamed, source);
    expect(result.axes[0]?.groups[0]?.to.ratio).toBe(0.49);
    expect(result.axes[0]?.groups[0]?.children[0]?.group).toEqual({ "a|b": "A", c: "small" });
  });

  it("rejects finite-input total overflow rather than publishing infinity", async () => {
    const input = rows.map((row) => ({ ...row, revenue: Number.MAX_VALUE }));
    const bound = await mapping();
    expect(() => evaluatePanelRatioRollup(bound, input)).toThrow(
      "MONTHLY_PANEL_RATIO_NUMERIC_RANGE_INVALID",
    );
  });
});
