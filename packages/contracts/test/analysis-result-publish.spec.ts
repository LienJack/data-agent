import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST,
  analysisResultPublishModelArgumentsSchema,
  analysisResultPublishToolArgumentsSchema,
} from "../src/ports/analysis-result-publish.js";

function manifest() {
  return {
    schema_version: "analysis-result-publish-tool@1.0.0" as const,
    publish_id: "q1-final",
    result_symbol: "result_document",
    table_bindings: [{ table_id: "monthly_trend", data_symbol: "monthly_table" }],
    chart_bindings: [
      {
        chart_id: "monthly_trend_chart",
        intent: "TREND" as const,
        template_id: "line.multi-series@1" as const,
        data_symbol: "monthly_table",
        x_field: "month",
        y_fields: ["revenue"],
        series_field: "",
        lower_bound_field: "",
        upper_bound_field: "",
      },
    ],
    operator_bindings: [
      {
        call_id: "shapley",
        operator_id: "decomposition.product-shapley-exact@1" as const,
        result_symbol: "shapley_result",
      },
    ],
  };
}

describe("publish_analysis_result manifest", () => {
  it("keeps one authoritative input schema on the publish manifest", () => {
    expect(analysisResultPublishToolArgumentsSchema.parse(manifest())).toEqual(manifest());
    expect(ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST.input_schema).toBe(
      analysisResultPublishToolArgumentsSchema,
    );
  });

  it("contains symbol and template bindings but no file/path publishing surface", () => {
    const serialized = JSON.stringify(
      z.toJSONSchema(ANALYSIS_RESULT_PUBLISH_TOOL_MANIFEST.input_schema),
    );
    expect(serialized).toContain("result_symbol");
    expect(serialized).toContain("template_id");
    expect(serialized).not.toContain("declared_output_names");
    expect(serialized).not.toContain("/workspace/outputs");
    expect(serialized).not.toContain('"path"');
  });

  it("keeps contract-owned chart identity out of model arguments", () => {
    const { schema_version: _schemaVersion, ...authorityManifest } = manifest();
    const modelManifest = {
      ...authorityManifest,
      chart_bindings: authorityManifest.chart_bindings.map(
        ({ intent: _intent, template_id: _templateId, data_symbol: _dataSymbol, ...binding }) =>
          binding,
      ),
    };
    expect(analysisResultPublishModelArgumentsSchema.parse(modelManifest)).toEqual(modelManifest);
    expect(analysisResultPublishModelArgumentsSchema.safeParse(authorityManifest).success).toBe(
      false,
    );
    const serialized = JSON.stringify(z.toJSONSchema(analysisResultPublishModelArgumentsSchema));
    expect(serialized).not.toContain("template_id");
    expect(serialized).not.toContain('"intent"');
  });

  it("fails closed on duplicate ids, arbitrary paths and unknown fields", () => {
    expect(
      analysisResultPublishToolArgumentsSchema.safeParse({
        ...manifest(),
        table_bindings: [
          ...manifest().table_bindings,
          { table_id: "monthly_trend", data_symbol: "other" },
        ],
      }).success,
    ).toBe(false);
    expect(
      analysisResultPublishToolArgumentsSchema.safeParse({
        ...manifest(),
        result_symbol: "/workspace/outputs/result.json",
      }).success,
    ).toBe(false);
    expect(
      analysisResultPublishToolArgumentsSchema.safeParse({
        ...manifest(),
        output_path: "/workspace/outputs/result.json",
      }).success,
    ).toBe(false);
  });
});
