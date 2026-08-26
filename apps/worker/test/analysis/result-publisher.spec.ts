import { buildAnalysisResultContract } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import { describe, expect, it } from "vitest";
import {
  type AnalysisResultAtomicStagePort,
  analysisExtractedSymbolsSchema,
  prepareAnalysisResult,
  resultPublisherInternals,
  stagePreparedAnalysisResult,
} from "../../src/analysis/result-publisher.js";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const decoder = new TextDecoder();

async function contract(maxRows = 18, withTextPolicy = false) {
  return buildAnalysisResultContract({
    schema_version: "analysis-result-contract@2.0.0",
    contract_id: "falcon24.q1.result",
    semantic_context_hash: hash("a"),
    result_fields: [
      { field: "revenue", data_type: "DECIMAL", nullable: false, semantic_role: "METRIC" },
      { field: "month", data_type: "DATE", nullable: false, semantic_role: "DIMENSION" },
      {
        field: "limitation",
        data_type: "STRING",
        nullable: true,
        semantic_role: "LIMITATION",
        ...(withTextPolicy
          ? {
              text_constraints: {
                required_substrings: ["关联"],
                forbidden_substrings: ["导致"],
                required_suffix: "仅支持关联。",
              },
            }
          : {}),
      },
    ],
    metric_bindings: [
      {
        semantic_metric_id: "metric.order_revenue",
        field: "revenue",
        unit: "CNY",
        aggregation: "SUM",
        formula_hash: hash("b"),
      },
    ],
    dimension_bindings: [{ semantic_dimension_id: "dimension.order_month", field: "month" }],
    grain: {
      dimension_ids: ["dimension.order_month"],
      time_dimension_id: "dimension.order_month",
      time_grain: "MONTH",
    },
    lineage: [
      {
        field: "revenue",
        source_semantic_object_ids: ["metric.order_revenue"],
        source_physical_fields: ["orders.total_amount"],
        transformation: "AGGREGATION",
      },
      {
        field: "month",
        source_semantic_object_ids: ["dimension.order_month"],
        source_physical_fields: ["orders.order_date"],
        transformation: "DIRECT",
      },
      {
        field: "limitation",
        source_semantic_object_ids: ["quality.header_detail_mismatch"],
        source_physical_fields: ["orders.total_amount"],
        transformation: "DIRECT",
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
            data_type: "DATE",
            nullable: false,
            semantic_object_id: "dimension.order_month",
            semantic_role: "DIMENSION",
          },
          {
            key: "revenue",
            label_zh: "订单收入",
            data_type: "NUMBER",
            nullable: false,
            semantic_object_id: "metric.order_revenue",
            semantic_role: "METRIC",
          },
        ],
        projection: { mode: "MODEL_DERIVED" },
        max_rows: maxRows,
      },
    ],
    charts: [
      {
        chart_id: "monthly_trend_chart",
        title_zh: "月度订单收入趋势",
        required: true,
        intent: "TREND",
        table_id: "monthly_trend",
        allowed_template_ids: ["line.multi-series@1"],
      },
    ],
    limits: {
      max_result_bytes: 1_048_576,
      max_table_rows: Math.max(1, maxRows),
      max_table_columns: 16,
      max_closure_bytes: 4_194_304,
    },
  });
}

async function inventoryProjectionContract() {
  return buildAnalysisResultContract({
    schema_version: "analysis-result-contract@2.0.0",
    contract_id: "falcon24.q3.result",
    semantic_context_hash: hash("a"),
    result_fields: [
      { field: "products", data_type: "JSON", nullable: false, semantic_role: "DERIVED" },
    ],
    metric_bindings: [],
    dimension_bindings: [],
    grain: { dimension_ids: [], time_dimension_id: null, time_grain: "NONE" },
    lineage: [
      {
        field: "products",
        source_semantic_object_ids: ["metric.sales_quantity", "formula.inventory_damage_rate"],
        source_physical_fields: ["inventory.product_id", "inventory.damaged_stock"],
        transformation: "FORMULA",
      },
    ],
    collection_constraints: [
      {
        collection_field: "products",
        min_items: 1,
        max_items: 100,
        all_items: [
          {
            left_field: "sales_quantity",
            operator: "GTE",
            right: { kind: "FIELD", field: "category_sales_p75" },
          },
          {
            left_field: "theil_sen_slope",
            operator: "GT",
            right: { kind: "NUMBER", value: 0 },
          },
        ],
      },
    ],
    tables: [
      {
        table_id: "inventory_priority",
        title_zh: "库存优先级",
        required: true,
        columns: [
          {
            key: "product_id",
            label_zh: "商品",
            data_type: "STRING",
            nullable: false,
            semantic_object_id: "dimension.product",
            semantic_role: "DIMENSION",
          },
          {
            key: "total_sales",
            label_zh: "销量",
            data_type: "NUMBER",
            nullable: false,
            semantic_object_id: "metric.sales_quantity",
            semantic_role: "METRIC",
          },
        ],
        projection: {
          mode: "RESULT_COLLECTION",
          collection_field: "products",
          column_mappings: [
            { result_field: "product_id", table_column: "product_id" },
            { result_field: "sales_quantity", table_column: "total_sales" },
          ],
        },
        max_rows: 100,
      },
    ],
    charts: [
      {
        chart_id: "inventory_priority_chart",
        title_zh: "库存优先级",
        required: true,
        intent: "PRIORITY",
        table_id: "inventory_priority",
        allowed_template_ids: ["matrix.priority@1"],
      },
    ],
    limits: {
      max_result_bytes: 1_048_576,
      max_table_rows: 100,
      max_table_columns: 2,
      max_closure_bytes: 4_194_304,
    },
  });
}

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

function extraction(input?: {
  readonly extraResultField?: boolean;
  readonly changedOperator?: boolean;
}) {
  return {
    schema_version: "analysis-extracted-symbols@1.0.0" as const,
    symbols: [
      {
        symbol_name: "result_document",
        symbol_kind: "MAPPING" as const,
        value: {
          kind: "OBJECT" as const,
          entries: [
            { key: "revenue", value: { kind: "DECIMAL" as const, value: "1250.10" } },
            { key: "month", value: { kind: "DATE" as const, value: "2024-10-01" } },
            { key: "limitation", value: { kind: "NULL" as const } },
            ...(input?.extraResultField
              ? [{ key: "unexpected", value: { kind: "STRING" as const, value: "x" } }]
              : []),
          ],
        },
      },
      {
        symbol_name: "monthly_table",
        symbol_kind: "TABLE" as const,
        columns: ["month", "revenue"],
        rows: [
          [
            { kind: "DATE" as const, value: "2024-09-01" },
            { kind: "NUMBER" as const, value: 1100.5 },
          ],
          [
            { kind: "DATE" as const, value: "2024-10-01" },
            { kind: "NUMBER" as const, value: 1250.1 },
          ],
        ],
      },
      {
        symbol_name: "shapley_result",
        symbol_kind: "MAPPING" as const,
        value: {
          kind: "OBJECT" as const,
          entries: [
            {
              key: "contribution",
              value: { kind: "NUMBER" as const, value: input?.changedOperator ? 2 : 1 },
            },
          ],
        },
      },
    ],
  };
}

function stagePort(calls: unknown[]): AnalysisResultAtomicStagePort {
  return {
    async stage(input) {
      calls.push(input);
      return { stage_id: "stage-q1", closure_hash: input.closure.closure_hash };
    },
  };
}

const operatorFinalization = {
  schema_version: "statistical-operator-finalization-result@1.0.0" as const,
  operator_registry_digest: hash("d"),
  operator_receipts: [],
  operator_receipt_closure_hash: hash("e"),
};

async function publishPrepared(
  input: Parameters<typeof prepareAnalysisResult>[0] & {
    readonly stage: AnalysisResultAtomicStagePort;
  },
) {
  const { stage, ...prepareInput } = input;
  return stagePreparedAnalysisResult({
    prepared: await prepareAnalysisResult(prepareInput),
    operator_finalization: operatorFinalization,
    cells: [],
    provider_invocation_refs: [],
    stage,
  });
}

async function governedOutput() {
  const resultSha256 = await sha256ContentHash({ contribution: 1 });
  const scope = {
    app_id: "019d2d97-110c-7735-8fbb-000000000001",
    tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
    environment: "test",
  } as const;
  const runId = "019d2d97-110c-7735-8fbb-000000000003";
  return {
    call_id: "shapley",
    operator_id: "decomposition.product-shapley-exact@1" as const,
    result_sha256: resultSha256,
    governed_result: {
      schema_version: "governed-operator-result-ref@1.0.0" as const,
      scope,
      run_id: runId,
      node_id: "node-1",
      attempt_id: "019d2d97-110c-7735-8fbb-000000000004",
      context_generation: 1,
      call_id: "shapley",
      operator_id: "decomposition.product-shapley-exact@1" as const,
      program_hash: hash("a"),
      request_sha256: hash("b"),
      result_artifact_ref: {
        artifact_id: "019d2d97-110c-7735-8fbb-000000000005",
        artifact_type: "SandboxResult" as const,
        ...scope,
        run_id: runId,
        revision: 1,
        content_hash: resultSha256,
      },
      result_sha256: resultSha256,
      result_bytes: 18,
      shape: { kind: "MAPPING" as const, keys: 1, bounded_summary: "contribution" },
      receipt_ref: {
        artifact_id: "019d2d97-110c-7735-8fbb-000000000006",
        artifact_type: "SandboxExecutionReceipt" as const,
        ...scope,
        run_id: runId,
        revision: 1,
        content_hash: hash("c"),
      },
      worker_fence: 1,
    },
  };
}

describe("server-owned Result Publisher", () => {
  it("normalizes 1,000 seeded scalar/date/Decimal/missing-value and DataFrame-wire cases", async () => {
    const resultContract = await contract(5);
    const tableContract = resultContract.tables[0];
    if (!tableContract) throw new Error("monthly table contract missing");
    let seed = 0x9e3779b9;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let caseIndex = 0; caseIndex < 1_000; caseIndex += 1) {
      const day = 1 + Math.floor(random() * 27);
      const month = 1 + Math.floor(random() * 12);
      const date = `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const signed = Math.floor(random() * 2_000_001) - 1_000_000;
      const decimal = `${signed}.${String(caseIndex % 10_000).padStart(4, "0")}`;
      const limitation = caseIndex % 3 === 0 ? null : `case-${caseIndex}`;
      const result = { revenue: decimal, month: date, limitation };
      expect(resultPublisherInternals.validateResultDocument(result, resultContract)).toEqual(
        result,
      );

      const rowCount = 1 + Math.floor(random() * 5);
      const table = {
        symbol_name: "monthly_table",
        symbol_kind: "TABLE" as const,
        columns: ["month", "revenue"],
        rows: Array.from({ length: rowCount }, (_, rowIndex) => [
          { kind: "DATE" as const, value: date },
          { kind: "NUMBER" as const, value: signed / 100 + rowIndex },
        ]),
      };
      expect(
        resultPublisherInternals.validateTable(table, tableContract, resultContract),
      ).toHaveLength(rowCount);

      const scalars = [
        { kind: "NULL" as const },
        { kind: "BOOLEAN" as const, value: caseIndex % 2 === 0 },
        { kind: "STRING" as const, value: `s-${caseIndex}` },
        { kind: "INTEGER" as const, value: String(signed) },
        { kind: "NUMBER" as const, value: signed / 10 },
        { kind: "DECIMAL" as const, value: decimal },
        { kind: "DATE" as const, value: date },
        { kind: "TIMESTAMP" as const, value: `${date}T00:00:00.000Z` },
      ];
      const scalar = scalars[caseIndex % scalars.length];
      if (!scalar) throw new Error("seeded scalar missing");
      expect(() => resultPublisherInternals.decodeWireValue(scalar)).not.toThrow();
    }

    expect(
      analysisExtractedSymbolsSchema.safeParse({
        schema_version: "analysis-extracted-symbols@1.0.0",
        symbols: [
          {
            symbol_name: "nan_value",
            symbol_kind: "MAPPING",
            value: {
              kind: "OBJECT",
              entries: [{ key: "value", value: { kind: "NUMBER", value: Number.NaN } }],
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(() =>
      resultPublisherInternals.decodeWireValue({
        kind: "INTEGER",
        value: "9007199254740992",
      }),
    ).toThrow("ANALYSIS_RESULT_INTEGER_UNSAFE");
    expect(() =>
      resultPublisherInternals.decodeWireValue({
        kind: "OBJECT",
        entries: [
          { key: "duplicate", value: { kind: "NULL" } },
          { key: "duplicate", value: { kind: "NULL" } },
        ],
      }),
    ).toThrow("ANALYSIS_RESULT_OBJECT_KEY_DUPLICATE");
    expect(() =>
      resultPublisherInternals.validateResultDocument(
        { revenue: "1.0", month: "2024-01-01", limitation: 1 },
        resultContract,
      ),
    ).toThrow("ANALYSIS_RESULT_VALUE_TYPE_MISMATCH");
    expect(() =>
      resultPublisherInternals.validateResultDocument(
        { revenue: null, month: "2024-01-01", limitation: null },
        resultContract,
      ),
    ).toThrow("ANALYSIS_RESULT_NULLABILITY_MISMATCH");
    expect(() =>
      resultPublisherInternals.validateTable(
        {
          symbol_name: "monthly_table",
          symbol_kind: "TABLE",
          columns: ["month", "amount"],
          rows: [
            [
              { kind: "DATE", value: "2024-01-01" },
              { kind: "NUMBER", value: 1 },
            ],
          ],
        },
        tableContract,
        resultContract,
      ),
    ).toThrow("ANALYSIS_RESULT_TABLE_COLUMNS_MISMATCH");
  });

  it("extracts allowlisted symbols and atomically stages deterministic result/table/chart closure", async () => {
    const calls: unknown[] = [];
    const publish = async () =>
      publishPrepared({
        contract: await contract(),
        manifest: manifest(),
        governed_operator_outputs: [await governedOutput()],
        extractor: {
          async extract() {
            return extraction();
          },
        },
        stage: stagePort(calls),
      });

    const first = await publish();
    const second = await publish();

    expect(calls).toHaveLength(2);
    expect(first.observation.status).toBe("STAGED");
    expect(first.observation.closure_hash).toBe(second.observation.closure_hash);
    expect(first.closure.artifacts.map(({ artifact_kind }) => artifact_kind)).toEqual([
      "RESULT",
      "TABLE",
      "CHART",
    ]);
    const resultArtifact = first.closure.artifacts.find(
      ({ artifact_kind }) => artifact_kind === "RESULT",
    );
    if (!resultArtifact) throw new Error("result artifact missing");
    const result = JSON.parse(decoder.decode(resultArtifact.content)) as {
      data: { revenue: string; limitation: null };
    };
    expect(result.data).toMatchObject({ revenue: "1250.10", limitation: null });
    const chartArtifact = first.closure.artifacts.find(
      ({ artifact_kind }) => artifact_kind === "CHART",
    );
    if (!chartArtifact) throw new Error("chart artifact missing");
    const chart = JSON.parse(decoder.decode(chartArtifact.content)) as {
      template_id: string;
      dataset: { total_rows: number };
    };
    expect(chart).toMatchObject({
      template_id: "line.multi-series@1",
      dataset: { total_rows: 2 },
    });
  });

  it("enforces bounded literal text policy before any result is staged", async () => {
    const resultContract = await contract(18, true);
    expect(
      resultPublisherInternals.validateResultDocument(
        {
          revenue: "1.0",
          month: "2024-01-01",
          limitation: "调整后仍有统计关联，仅支持关联。",
        },
        resultContract,
      ),
    ).toMatchObject({ limitation: "调整后仍有统计关联，仅支持关联。" });
    for (const limitation of [
      "调整后不显著，仅支持判断。",
      "延迟不能被识别为导致体验下降，仅支持关联。",
      "调整后仍有统计关联。",
    ]) {
      expect(() =>
        resultPublisherInternals.validateResultDocument(
          { revenue: "1.0", month: "2024-01-01", limitation },
          resultContract,
        ),
      ).toThrow("ANALYSIS_RESULT_TEXT_POLICY_MISMATCH");
    }
  });

  it("enforces semantic collection predicates and exact result-to-table projections", async () => {
    const resultContract = await inventoryProjectionContract();
    const tableContract = resultContract.tables[0];
    if (!tableContract) throw new Error("inventory table contract missing");
    const validProducts = [
      {
        product_id: "P-1",
        sales_quantity: 120,
        category_sales_p75: 100,
        theil_sen_slope: 0.01,
      },
      {
        product_id: "P-2",
        sales_quantity: 150,
        category_sales_p75: 110,
        theil_sen_slope: 0.02,
      },
    ];
    expect(
      resultPublisherInternals.validateResultDocument({ products: validProducts }, resultContract),
    ).toEqual({ products: validProducts });
    expect(() =>
      resultPublisherInternals.validateResultDocument(
        {
          products: [
            {
              product_id: "P-3",
              sales_quantity: 80,
              category_sales_p75: 100,
              theil_sen_slope: 0.01,
            },
          ],
        },
        resultContract,
      ),
    ).toThrow("ANALYSIS_RESULT_COLLECTION_PREDICATE_MISMATCH");

    expect(() =>
      resultPublisherInternals.validateTableProjection(
        [{ product_id: "P-1", total_sales: 120 }],
        tableContract,
        { products: validProducts },
      ),
    ).toThrow("ANALYSIS_RESULT_TABLE_PROJECTION_MISMATCH");
    expect(() =>
      resultPublisherInternals.validateTableProjection(
        [
          { product_id: "P-2", total_sales: 150 },
          { product_id: "P-1", total_sales: 120 },
        ],
        tableContract,
        { products: validProducts },
      ),
    ).not.toThrow();
  });

  it("rejects changed operator values and malformed result fields before staging", async () => {
    for (const extracted of [
      extraction({ changedOperator: true }),
      extraction({ extraResultField: true }),
    ]) {
      const calls: unknown[] = [];
      await expect(
        publishPrepared({
          contract: await contract(),
          manifest: manifest(),
          governed_operator_outputs: [await governedOutput()],
          extractor: {
            async extract() {
              return extracted;
            },
          },
          stage: stagePort(calls),
        }),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    }
  });

  it("enforces row bounds and rejects stage correlation drift", async () => {
    const boundedCalls: unknown[] = [];
    await expect(
      publishPrepared({
        contract: await contract(1),
        manifest: manifest(),
        governed_operator_outputs: [await governedOutput()],
        extractor: {
          async extract() {
            return extraction();
          },
        },
        stage: stagePort(boundedCalls),
      }),
    ).rejects.toThrow("ANALYSIS_RESULT_TABLE_BOUNDS_OR_SCHEMA_INVALID");
    expect(boundedCalls).toHaveLength(0);

    await expect(
      publishPrepared({
        contract: await contract(),
        manifest: manifest(),
        governed_operator_outputs: [await governedOutput()],
        extractor: {
          async extract() {
            return extraction();
          },
        },
        stage: {
          async stage() {
            return { stage_id: "stage-q1", closure_hash: hash("f") };
          },
        },
      }),
    ).rejects.toThrow("ANALYSIS_RESULT_STAGE_CORRELATION_INVALID");
  });
});
