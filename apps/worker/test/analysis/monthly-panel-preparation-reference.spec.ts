import { describe, expect, it } from "vitest";
import { MONTHLY_PANEL_PREPARATION_REFERENCE } from "../../src/analysis/monthly-panel-preparation-reference.js";
import {
  panelReferenceCase,
  panelReferenceVariants,
} from "./support/monthly-panel-reference-cases.js";

describe("monthly panel data-free Python reference", () => {
  it.each(panelReferenceVariants)("binds exact source metadata for %s", async (variant) => {
    const sample = await panelReferenceCase(variant);
    expect(sample.configuration.source_columns).toEqual(
      Object.keys(sample.source_rows[0] ?? {}).sort(
        (a, b) =>
          sample.configuration.source_columns.indexOf(a) -
          sample.configuration.source_columns.indexOf(b),
      ),
    );
    expect(sample.configuration.source_columns).toContain(sample.configuration.time_column);
    expect(sample.configuration.source_columns).toEqual(
      expect.arrayContaining(sample.configuration.category_columns),
    );
    expect(sample.expected.observations).toHaveLength(sample.source_rows.length);
    expect(sample.configuration).not.toHaveProperty("observations");
    expect(sample.configuration).not.toHaveProperty("largest_declines");
    expect(MONTHLY_PANEL_PREPARATION_REFERENCE).not.toContain("month_str");
    expect(MONTHLY_PANEL_PREPARATION_REFERENCE).not.toMatch(
      /2024-|Email|falcon|\.to_csv\(|open\(/u,
    );
  });
});
