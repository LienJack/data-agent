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
  it("uses a new explicit publish version for a source facet", () => {
    const source = manifest();
    const candidate = {
      ...source,
      schema_version: "analysis-result-publish-tool@1.1.0",
      chart_bindings: source.chart_bindings.map((binding) => ({
        ...binding,
        series_field: "channel",
        facet_field: "audience",
      })),
    };
    expect(analysisResultPublishToolArgumentsSchema.parse(candidate)).toEqual(candidate);
    const { schema_version: _version, ...model } = candidate;
    const input = {
      ...model,
      chart_bindings: model.chart_bindings.map(
        ({ intent: _i, template_id: _t, data_symbol: _d, ...binding }) => binding,
      ),
    };
    expect(analysisResultPublishModelArgumentsSchema.parse(input)).toEqual(input);
  });

  it.each(["old-version", "empty-new", "axis", "measure", "series", "empty-field"])(
    "rejects invalid publish facet: %s",
    (kind) => {
      const source = manifest();
      const candidate = {
        ...source,
        schema_version:
          kind === "old-version" ? source.schema_version : "analysis-result-publish-tool@1.1.0",
        chart_bindings: source.chart_bindings.map((binding) => ({
          ...binding,
          series_field: "channel",
          ...(kind === "empty-new"
            ? {}
            : {
                facet_field:
                  kind === "axis"
                    ? "month"
                    : kind === "measure"
                      ? "revenue"
                      : kind === "series"
                        ? "channel"
                        : kind === "empty-field"
                          ? ""
                          : "audience",
              }),
        })),
      };
      expect(analysisResultPublishToolArgumentsSchema.safeParse(candidate).success).toBe(false);
    },
  );

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
