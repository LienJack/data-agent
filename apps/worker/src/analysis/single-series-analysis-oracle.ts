import { createHash } from "node:crypto";
import {
  type AnalysisReasonCode,
  artifactReferenceFor,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import {
  canonicalizeJson,
  contentHashSchema,
  sha256ContentHash,
} from "@data-agent/contracts/common";
import type { AnalysisSandboxExecutionReceipt } from "@data-agent/contracts/ports";
import {
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  statisticalOperatorCallReceiptSchema,
} from "@data-agent/contracts/statistical-operators";
import { z } from "zod";
import type {
  AnalysisBoundOutput,
  AnalysisOracleExpectation,
  AnalysisOraclePort,
} from "./executor.js";
import { verifyProductTeamQueryEvidenceInput } from "./governed-analysis-input.js";
import {
  extractSingleSeriesQueryShape,
  singleSeriesAnalysisPlanningInternals,
} from "./single-series-analysis-planning.js";

const finite = z.number().finite();
const monthSchema = z.string().regex(/^\d{4}-\d{2}-01$/u);
const resultDataSchema = z.strictObject({
  series: z.array(z.strictObject({ period: monthSchema, value: finite })).length(12),
  theil_sen: z.strictObject({
    series: z
      .array(
        z.strictObject({
          label: z.string().min(1).max(128),
          slope: finite,
          sample_size: z.literal(12),
          pair_count: z.literal(66),
        }),
      )
      .length(1),
  }),
  mann_kendall: z.strictObject({
    series: z
      .array(
        z.strictObject({
          label: z.string().min(1).max(128),
          s: z.number().int(),
          variance_s: finite.nonnegative(),
          z: finite,
          p_value: finite.min(0).max(1),
          tau: finite.min(-1).max(1),
          trend: z.enum(["INCREASING", "DECREASING", "NO_TREND"]),
          rejected: z.boolean(),
          sample_size: z.literal(12),
          tie_group_count: z.number().int().nonnegative(),
          alpha: z.literal(0.05),
          variant: z.literal("original"),
        }),
      )
      .length(1),
  }),
  summary_zh: z.string().trim().min(1).max(20_000),
});

const publishedResultSchema = z.strictObject({
  schema_version: z.literal("analysis-published-result@1.0.0"),
  contract_id: z.string(),
  contract_hash: z.string(),
  semantic_context_hash: z.string(),
  metrics: z.unknown(),
  dimensions: z.unknown(),
  grain: z.unknown(),
  lineage: z.unknown(),
  data: resultDataSchema,
});
const tableRowSchema = z.strictObject({ period: z.string(), value: finite });
const publishedTableSchema = z.strictObject({
  schema_version: z.literal("analysis-published-table@1.0.0"),
  table_id: z.literal("single_series_monthly"),
  title_zh: z.string().min(1),
  columns: z.unknown(),
  rows: z.array(tableRowSchema).length(12),
  total_rows: z.literal(12),
});
const publishedChartSchema = z.strictObject({
  schema_version: z.literal("analysis-published-chart@1.0.0"),
  chart_id: z.literal("single_series_monthly_line"),
  title_zh: z.string().min(1),
  intent: z.literal("TREND"),
  template_id: z.literal("line.multi-series@1"),
  bindings: z.strictObject({
    x_field: z.literal("period"),
    y_fields: z.tuple([z.literal("value")]),
    series_field: z.null(),
    lower_bound_field: z.null(),
    upper_bound_field: z.null(),
  }),
  dataset: z.strictObject({
    table_id: z.literal("single_series_monthly"),
    columns: z.unknown(),
    rows: z.array(tableRowSchema).length(12),
    total_rows: z.literal(12),
  }),
});

export const singleSeriesTrendOracleReceiptMaterialSchema = z.strictObject({
  schema_version: z.literal("single-series-trend-oracle@1.0.0"),
  verdict: z.literal("PASS"),
  query_evidence_ref: artifactReferenceFor("QueryEvidence"),
  query_result_hash: contentHashSchema,
  input_ref: artifactReferenceFor("SensitiveExecutionArtifact"),
  input_materialization_receipt_ref: artifactReferenceFor("AnalysisInputMaterializationReceipt"),
  expected_window: z.strictObject({
    start: monthSchema,
    end: monthSchema,
    month_count: z.literal(12),
  }),
  contract_hash: contentHashSchema,
  result_hash: contentHashSchema,
  table_hash: contentHashSchema,
  chart_hash: contentHashSchema,
  chart_dataset_hash: contentHashSchema,
  operator_registry_digest: contentHashSchema,
  operator_receipt_closure_hash: contentHashSchema,
  operator_receipts: z.array(statisticalOperatorCallReceiptSchema).length(2),
  trend_evidence: z.strictObject({
    slope: finite,
    tau: finite.min(-1).max(1),
    p_value: finite.min(0).max(1),
    rejected: z.boolean(),
    trend: z.enum(["INCREASING", "DECREASING", "NO_TREND"]),
  }),
  verifier_version: z.literal("single-series-trend-oracle@1.0.0"),
});

export const singleSeriesTrendOracleReceiptSchema =
  singleSeriesTrendOracleReceiptMaterialSchema.safeExtend({ receipt_hash: contentHashSchema });

export type SingleSeriesTrendOracleReceipt = z.infer<typeof singleSeriesTrendOracleReceiptSchema>;

async function buildOracleReceipt(
  input: z.input<typeof singleSeriesTrendOracleReceiptMaterialSchema>,
): Promise<SingleSeriesTrendOracleReceipt> {
  const parsed = singleSeriesTrendOracleReceiptMaterialSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("SINGLE_SERIES_ORACLE_RECEIPT_INVALID");
  const material = parsed.data;
  return Object.freeze(
    singleSeriesTrendOracleReceiptSchema.parse({
      ...material,
      receipt_hash: await sha256ContentHash({
        hash_domain: "single-series-trend-oracle@1.0.0",
        value: material,
      }),
    }),
  );
}

export async function verifySingleSeriesTrendOracleReceipt(
  input: unknown,
): Promise<SingleSeriesTrendOracleReceipt> {
  const parsed = singleSeriesTrendOracleReceiptSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("SINGLE_SERIES_ORACLE_RECEIPT_INVALID");
  const receipt = parsed.data;
  const { receipt_hash: observedHash, ...material } = receipt;
  const expected = await buildOracleReceipt(material);
  if (expected.receipt_hash !== observedHash) {
    throw new TypeError("SINGLE_SERIES_ORACLE_RECEIPT_HASH_MISMATCH");
  }
  return Object.freeze(receipt);
}

function fail(code: string): never {
  throw new TypeError(code);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function bytesHash(content: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function outputOf(
  outputs: readonly AnalysisBoundOutput[],
  artifactName: string,
  artifactKind: AnalysisBoundOutput["artifact_kind"],
): AnalysisBoundOutput {
  const matching = outputs.filter(
    ({ artifact_name: name, artifact_kind: kind }) =>
      name === artifactName && kind === artifactKind,
  );
  const output = matching[0];
  if (
    matching.length !== 1 ||
    !output ||
    output.bytes !== output.content.byteLength ||
    bytesHash(output.content) !== output.content_sha256 ||
    output.reference.content_hash !== output.content_sha256
  ) {
    return fail("SINGLE_SERIES_ORACLE_OUTPUT_CLOSURE_INVALID");
  }
  return output;
}

function parseJson(content: Uint8Array, code: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
  } catch {
    return fail(code);
  }
}

function parseOrFail<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fail(code);
}

function exactOperatorReceipt(
  receipt: AnalysisSandboxExecutionReceipt,
  callId: string,
  operatorId: string,
) {
  const matches = receipt.operator_receipts.filter(
    ({ call_id: candidateCallId, operator_id: candidateOperatorId }) =>
      candidateCallId === callId && candidateOperatorId === operatorId,
  );
  const candidate = matches[0];
  if (
    matches.length !== 1 ||
    !candidate ||
    candidate.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
    candidate.sample_size !== 12 ||
    candidate.group_count !== 1 ||
    candidate.family_size !== null ||
    candidate.rank !== null ||
    candidate.applicability === "HOLD"
  ) {
    return fail("SINGLE_SERIES_ORACLE_OPERATOR_RECEIPT_INVALID");
  }
  return candidate;
}

function assertOperatorClosure(input: {
  readonly receipt: AnalysisSandboxExecutionReceipt;
  readonly data: z.infer<typeof resultDataSchema>;
  readonly value_column: string;
}) {
  if (
    input.receipt.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
    !sameJson(
      input.receipt.operator_obligations,
      singleSeriesAnalysisPlanningInternals.trendOperatorObligations(),
    ) ||
    input.receipt.operator_receipts.length !== 2
  ) {
    fail("SINGLE_SERIES_ORACLE_OPERATOR_CLOSURE_INVALID");
  }
  const theil = exactOperatorReceipt(
    input.receipt,
    "single_series_theil_sen",
    "robust-trend.theil-sen-slope@1",
  );
  const mann = exactOperatorReceipt(
    input.receipt,
    "single_series_mann_kendall",
    "trend.mann-kendall-original@1",
  );
  if (
    !sameJson(theil.resolved_parameters, {}) ||
    theil.applicability !== "PASS" ||
    !sameJson(theil.limitation_codes, ["SLOPE_UNIT_DEPENDS_ON_DECLARED_X_SCALE"]) ||
    !sameJson(mann.resolved_parameters, {
      alpha: 0.05,
      continuity_correction: true,
      variant: "original",
    }) ||
    mann.applicability !== "ASSUMPTION_BOUND" ||
    !sameJson(mann.limitation_codes, [
      "SEASONALITY_NOT_CORRECTED",
      "SERIAL_CORRELATION_NOT_CORRECTED",
    ])
  ) {
    fail("SINGLE_SERIES_ORACLE_OPERATOR_POLICY_INVALID");
  }
  const theilValue = input.data.theil_sen.series[0] ?? fail("SINGLE_SERIES_ORACLE_RESULT_INVALID");
  const mannValue =
    input.data.mann_kendall.series[0] ?? fail("SINGLE_SERIES_ORACLE_RESULT_INVALID");
  if (
    theilValue.label !== input.value_column ||
    mannValue.label !== input.value_column ||
    mannValue.rejected !== mannValue.p_value <= mannValue.alpha ||
    mannValue.trend !==
      (mannValue.rejected
        ? mannValue.s > 0
          ? "INCREASING"
          : mannValue.s < 0
            ? "DECREASING"
            : "NO_TREND"
        : "NO_TREND") ||
    Math.sign(mannValue.tau) !== Math.sign(mannValue.s) ||
    (Math.sign(theilValue.slope) !== 0 &&
      Math.sign(mannValue.tau) !== 0 &&
      Math.sign(theilValue.slope) !== Math.sign(mannValue.tau))
  ) {
    fail("SINGLE_SERIES_ORACLE_OPERATOR_RESULT_INVALID");
  }
  return { theil, mann, theilValue, mannValue };
}

export function createSingleSeriesAnalysisOracle(): AnalysisOraclePort {
  return Object.freeze({
    async evaluate(
      input: Parameters<AnalysisOraclePort["evaluate"]>[0],
    ): Promise<AnalysisOracleExpectation> {
      if (
        input.governed_inputs.length !== 1 ||
        input.sandbox_outputs.length !== 3 ||
        input.node.result_contract.contract_id !== "single-series-trend.result" ||
        input.sandbox_receipt.result_contract_hash !== input.node.result_contract.contract_hash
      ) {
        fail("SINGLE_SERIES_ORACLE_SCOPE_INVALID");
      }
      const governed = input.governed_inputs[0];
      if (governed?.name !== "query_evidence" || governed.format !== "ARROW") {
        fail("SINGLE_SERIES_ORACLE_INPUT_INVALID");
      }
      const evidence = await verifyProductTeamArtifactDocument(
        governed.query_evidence_document,
      ).catch(() => fail("SINGLE_SERIES_ORACLE_INPUT_INVALID"));
      if (evidence.artifact_ref.artifact_type !== "QueryEvidence") {
        fail("SINGLE_SERIES_ORACLE_INPUT_INVALID");
      }
      const shape = await extractSingleSeriesQueryShape({
        query_evidence_ref: governed.query_evidence_ref,
        query_evidence_document: evidence,
      });
      await verifyProductTeamQueryEvidenceInput({
        query_evidence_ref: governed.query_evidence_ref,
        query_evidence_document: evidence,
        arrow_content: governed.content,
        expected_row_count: 12,
        expected_ordered_columns: [shape.time_column, shape.value_column],
      });

      const resultOutput = outputOf(input.sandbox_outputs, "result", "RESULT");
      const tableOutput = outputOf(input.sandbox_outputs, "table:single_series_monthly", "TABLE");
      const chartOutput = outputOf(
        input.sandbox_outputs,
        "chart:single_series_monthly_line",
        "CHART",
      );
      const result = parseOrFail(
        publishedResultSchema,
        parseJson(resultOutput.content, "SINGLE_SERIES_ORACLE_RESULT_INVALID"),
        "SINGLE_SERIES_ORACLE_RESULT_INVALID",
      );
      const table = parseOrFail(
        publishedTableSchema,
        parseJson(tableOutput.content, "SINGLE_SERIES_ORACLE_TABLE_INVALID"),
        "SINGLE_SERIES_ORACLE_TABLE_INVALID",
      );
      const chart = parseOrFail(
        publishedChartSchema,
        parseJson(chartOutput.content, "SINGLE_SERIES_ORACLE_CHART_INVALID"),
        "SINGLE_SERIES_ORACLE_CHART_INVALID",
      );
      const contract = input.node.result_contract;
      if (
        result.contract_id !== contract.contract_id ||
        result.contract_hash !== contract.contract_hash ||
        result.semantic_context_hash !== contract.semantic_context_hash ||
        !sameJson(result.metrics, contract.metric_bindings) ||
        !sameJson(result.dimensions, contract.dimension_bindings) ||
        !sameJson(result.grain, contract.grain) ||
        !sameJson(result.lineage, contract.lineage) ||
        !sameJson(table.columns, contract.tables[0]?.columns) ||
        !sameJson(chart.dataset.columns, contract.tables[0]?.columns)
      ) {
        fail("SINGLE_SERIES_ORACLE_CONTRACT_CLOSURE_INVALID");
      }
      const expectedRows = shape.ordered_months.map((period, index) => ({
        period,
        value: shape.ordered_values[index] ?? fail("SINGLE_SERIES_ORACLE_INPUT_INVALID"),
      }));
      if (
        !sameJson(result.data.series, expectedRows) ||
        !sameJson(table.rows, expectedRows) ||
        !sameJson(chart.dataset.rows, expectedRows)
      ) {
        fail("SINGLE_SERIES_ORACLE_SERIES_MISMATCH");
      }
      const operator = assertOperatorClosure({
        receipt: input.sandbox_receipt,
        data: result.data,
        value_column: shape.value_column,
      });
      const limitationCodes: AnalysisReasonCode[] = shape.ordered_values.some(
        (value, index) => index < shape.ordered_values.length - 1 && value === 0,
      )
        ? ["RELATIVE_DELTA_UNDEFINED"]
        : [];
      const points = expectedRows.map(({ period, value }, index) => {
        const previous = index === 0 ? null : (expectedRows[index - 1]?.value ?? null);
        return {
          period_start: `${period}T00:00:00.000Z`,
          value,
          absolute_delta: previous === null ? null : value - previous,
          relative_delta:
            previous === null || previous === 0 ? null : (value - previous) / previous,
        };
      });
      const inputRef = parseOrFail(
        artifactReferenceFor("SensitiveExecutionArtifact"),
        governed.input_ref,
        "SINGLE_SERIES_ORACLE_INPUT_INVALID",
      );
      const materializationReceiptRef = parseOrFail(
        artifactReferenceFor("AnalysisInputMaterializationReceipt"),
        governed.materialization_receipt_ref,
        "SINGLE_SERIES_ORACLE_INPUT_INVALID",
      );
      const firstMonth = shape.ordered_months[0] ?? fail("SINGLE_SERIES_ORACLE_INPUT_INVALID");
      const lastMonth = shape.ordered_months[11] ?? fail("SINGLE_SERIES_ORACLE_INPUT_INVALID");
      const receiptMaterial = {
        schema_version: "single-series-trend-oracle@1.0.0" as const,
        verdict: "PASS" as const,
        query_evidence_ref: governed.query_evidence_ref,
        query_result_hash: shape.result_hash,
        input_ref: inputRef,
        input_materialization_receipt_ref: materializationReceiptRef,
        expected_window: {
          start: firstMonth,
          end: singleSeriesAnalysisPlanningInternals.addUtcMonths(lastMonth, 1),
          month_count: 12 as const,
        },
        contract_hash: contract.contract_hash,
        result_hash: resultOutput.content_sha256,
        table_hash: tableOutput.content_sha256,
        chart_hash: chartOutput.content_sha256,
        chart_dataset_hash: await sha256ContentHash(chart.dataset),
        operator_registry_digest: input.sandbox_receipt.operator_registry_digest,
        operator_receipt_closure_hash: input.sandbox_receipt.operator_receipt_closure_hash,
        operator_receipts: [operator.theil, operator.mann],
        trend_evidence: {
          slope: operator.theilValue.slope,
          tau: operator.mannValue.tau,
          p_value: operator.mannValue.p_value,
          rejected: operator.mannValue.rejected,
          trend: operator.mannValue.trend,
        },
        verifier_version: "single-series-trend-oracle@1.0.0" as const,
      };
      return Object.freeze({
        result: {
          result_kind: "TREND_CHANGE" as const,
          points,
          first_value: expectedRows[0]?.value ?? null,
          last_value: expectedRows[11]?.value ?? null,
        },
        sample_size: 12,
        coverage_ratio: 1,
        limitation_codes: limitationCodes,
        material_change: operator.mannValue.rejected,
        oracle_receipt: await buildOracleReceipt(receiptMaterial),
      });
    },
  });
}

export const singleSeriesAnalysisOracleInternals = Object.freeze({
  assertOperatorClosure,
  outputOf,
  publishedChartSchema,
  publishedResultSchema,
  publishedTableSchema,
});
