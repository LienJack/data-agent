import { describe, expect, it } from "vitest";
import {
  buildAnalysisResultContract,
  verifyAnalysisResultContract,
} from "../src/artifacts/analysis-result-contract.js";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("TEST_FIXTURE_VALUE_MISSING");
  return value;
}

function material() {
  return {
    schema_version: "analysis-result-contract@2.0.0" as const,
    contract_id: "falcon24.q1.result",
    semantic_context_hash: hash("a"),
    result_fields: [
      {
        field: "revenue",
        data_type: "DECIMAL" as const,
        nullable: false,
        semantic_role: "METRIC" as const,
      },
      {
        field: "month",
        data_type: "DATE" as const,
        nullable: false,
        semantic_role: "DIMENSION" as const,
      },
      {
        field: "limitation",
        data_type: "STRING" as const,
        nullable: true,
        semantic_role: "LIMITATION" as const,
      },
    ],
    metric_bindings: [
      {
        semantic_metric_id: "metric.order_revenue",
        field: "revenue",
        unit: "CNY",
        aggregation: "SUM" as const,
        formula_hash: hash("b"),
      },
    ],
    dimension_bindings: [{ semantic_dimension_id: "dimension.order_month", field: "month" }],
    grain: {
      dimension_ids: ["dimension.order_month"],
      time_dimension_id: "dimension.order_month",
      time_grain: "MONTH" as const,
    },
    lineage: [
      {
        field: "revenue",
        source_semantic_object_ids: ["metric.order_revenue"],
        source_physical_fields: ["orders.total_amount"],
        transformation: "AGGREGATION" as const,
      },
      {
        field: "month",
        source_semantic_object_ids: ["dimension.order_month"],
        source_physical_fields: ["orders.order_date"],
        transformation: "DIRECT" as const,
      },
      {
        field: "limitation",
        source_semantic_object_ids: ["quality.order_header_detail_mismatch"],
        source_physical_fields: ["orders.total_amount"],
        transformation: "DIRECT" as const,
      },
    ],
    collection_constraints: [],
    tables: [
      {
        table_id: "monthly_trend",
        title_zh: "月度收入趋势",
        required: true,
        columns: [
          {
            key: "month",
            label_zh: "月份",
            data_type: "DATE" as const,
            nullable: false,
            semantic_object_id: "dimension.order_month",
            semantic_role: "DIMENSION" as const,
          },
          {
            key: "revenue",
            label_zh: "订单收入",
            data_type: "NUMBER" as const,
            nullable: false,
            semantic_object_id: "metric.order_revenue",
            semantic_role: "METRIC" as const,
          },
        ],
        projection: { mode: "MODEL_DERIVED" as const },
        max_rows: 18,
      },
    ],
    charts: [
      {
        chart_id: "monthly_trend_chart",
        title_zh: "月度订单收入趋势",
        required: true,
        intent: "TREND" as const,
        table_id: "monthly_trend",
        allowed_template_ids: ["line.multi-series@1" as const],
      },
    ],
    limits: {
      max_result_bytes: 1_048_576,
      max_table_rows: 100,
      max_table_columns: 16,
      max_closure_bytes: 4_194_304,
    },
  };
}

function directCollectionMaterial() {
  const base = material();
  return {
    ...base,
    result_fields: [
      {
        field: "series",
        data_type: "JSON" as const,
        nullable: false,
        semantic_role: "DERIVED" as const,
      },
    ],
    metric_bindings: base.metric_bindings.map((binding) => ({ ...binding, field: "series" })),
    dimension_bindings: base.dimension_bindings.map((binding) => ({ ...binding, field: "series" })),
    lineage: [
      {
        field: "series",
        source_semantic_object_ids: ["metric.order_revenue", "dimension.order_month"],
        source_physical_fields: ["query_evidence.period", "query_evidence.current_revenue"],
        transformation: "DIRECT" as const,
      },
    ],
    tables: base.tables.map((table) => ({
      ...table,
      projection: {
        mode: "RESULT_COLLECTION" as const,
        collection_field: "series",
        column_mappings: [
          {
            result_field: "month",
            table_column: "month",
            source: { input_name: "query_evidence", output_name: "period" },
          },
          {
            result_field: "revenue",
            table_column: "revenue",
            source: { input_name: "query_evidence", output_name: "current_revenue" },
          },
        ],
      },
    })),
  };
}

describe("AnalysisResultContract@2", () => {
  it("binds explicit source columns into a direct projection contract hash", async () => {
    const input = directCollectionMaterial();
    const contract = await buildAnalysisResultContract(input);
    await expect(verifyAnalysisResultContract(contract)).resolves.toEqual(contract);
    const changed = directCollectionMaterial();
    required(changed.tables[0]).projection.column_mappings[1] = {
      result_field: "revenue",
      table_column: "revenue",
      source: { input_name: "query_evidence", output_name: "prior_revenue" },
    };
    required(changed.lineage[0]).source_physical_fields.push("query_evidence.prior_revenue");
    expect((await buildAnalysisResultContract(changed)).contract_hash).not.toBe(
      contract.contract_hash,
    );
    await expect(
      verifyAnalysisResultContract({ ...changed, contract_hash: contract.contract_hash }),
    ).rejects.toThrow("ANALYSIS_RESULT_CONTRACT_HASH_MISMATCH");
  });

  it.each(["missing-lineage", "not-direct", "duplicate-source", "invalid-source", "unknown-field"])(
    "rejects explicit source mapping %s",
    async (variant) => {
      const input = directCollectionMaterial();
      const lineage = required(input.lineage[0]);
      const mappings = required(input.tables[0]).projection.column_mappings;
      if (variant === "missing-lineage") lineage.source_physical_fields.pop();
      if (variant === "duplicate-source")
        required(mappings[1]).source = required(mappings[0]).source;
      if (variant === "invalid-source") required(mappings[1]).source.output_name = "value;drop";
      await expect(
        buildAnalysisResultContract({
          ...input,
          ...(variant === "not-direct"
            ? { lineage: [{ ...lineage, transformation: "FORMULA" }] }
            : {}),
          ...(variant === "unknown-field"
            ? {
                tables: [
                  {
                    ...required(input.tables[0]),
                    projection: {
                      ...required(input.tables[0]).projection,
                      column_mappings: mappings.map((mapping) => ({
                        ...mapping,
                        source: { ...mapping.source, trusted: true },
                      })),
                    },
                  },
                ],
              }
            : {}),
        }),
      ).rejects.toThrow();
    },
  );

  it("builds and verifies a content-addressed semantic result contract", async () => {
    const contract = await buildAnalysisResultContract(material());

    await expect(verifyAnalysisResultContract(contract)).resolves.toEqual(contract);
    expect(contract.contract_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(contract.contract_hash).toBe(
      "sha256:f8799262ea92ad2e0ad85feb1f9ec518931b8a0934fa073d20a18ec9f3fc4945",
    );
    expect(Object.isFrozen(contract)).toBe(true);
  });

  it("rejects hash drift and incomplete semantic lineage", async () => {
    const contract = await buildAnalysisResultContract(material());
    await expect(
      verifyAnalysisResultContract({ ...contract, semantic_context_hash: hash("f") }),
    ).rejects.toThrow("ANALYSIS_RESULT_CONTRACT_HASH_MISMATCH");

    await expect(
      buildAnalysisResultContract({
        ...material(),
        lineage: material().lineage.filter(({ field }) => field !== "revenue"),
      }),
    ).rejects.toThrow();
  });

  it("rejects the retired v1 shape instead of maintaining a compatibility path", async () => {
    await expect(
      buildAnalysisResultContract({
        ...material(),
        schema_version: "analysis-result-contract@1.0.0" as never,
      }),
    ).rejects.toThrow();
    const { projection: _projection, ...tableWithoutProjection } = required(material().tables[0]);
    await expect(
      buildAnalysisResultContract({
        ...material(),
        tables: [tableWithoutProjection] as never,
      }),
    ).rejects.toThrow();
  });

  it("rejects collection predicates on non-JSON fields and incomplete projections", async () => {
    await expect(
      buildAnalysisResultContract({
        ...material(),
        collection_constraints: [
          {
            collection_field: "revenue",
            min_items: 1,
            max_items: 10,
            all_items: [
              {
                left_field: "value",
                operator: "GT",
                right: { kind: "NUMBER", value: 0 },
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      buildAnalysisResultContract({
        ...material(),
        tables: [
          {
            ...required(material().tables[0]),
            projection: {
              mode: "RESULT_COLLECTION",
              collection_field: "limitation",
              column_mappings: [{ result_field: "month", table_column: "month" }],
            },
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects grain, metric and chart references outside the declared semantic closure", async () => {
    await expect(
      buildAnalysisResultContract({
        ...material(),
        metric_bindings: [{ ...required(material().metric_bindings[0]), field: "month" }],
        grain: {
          ...material().grain,
          dimension_ids: ["dimension.unknown"],
        },
        charts: [{ ...required(material().charts[0]), table_id: "unknown_table" }],
      }),
    ).rejects.toThrow();
  });

  it("allows literal text constraints only on STRING fields", async () => {
    const constrained = await buildAnalysisResultContract({
      ...material(),
      result_fields: material().result_fields.map((field) =>
        field.field === "limitation"
          ? {
              ...field,
              text_constraints: {
                required_substrings: ["关联"],
                forbidden_substrings: ["导致"],
                required_suffix: null,
              },
            }
          : field,
      ),
    });
    expect(constrained.result_fields.at(-1)?.text_constraints).toMatchObject({
      required_substrings: ["关联"],
    });
    await expect(
      buildAnalysisResultContract({
        ...material(),
        result_fields: material().result_fields.map((field) =>
          field.field === "revenue"
            ? {
                ...field,
                text_constraints: {
                  required_substrings: ["关联"],
                  forbidden_substrings: [],
                  required_suffix: null,
                },
              }
            : field,
        ),
      }),
    ).rejects.toThrow();
  });
});
