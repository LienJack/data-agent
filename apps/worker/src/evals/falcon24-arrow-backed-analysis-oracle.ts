import { createHash } from "node:crypto";
import type { AnalysisReasonCode } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type Falcon24AgentAnalysisCase,
  falcon24AnalysisCaseIdSchema,
  falcon24AnalysisOracleReceiptSchema,
} from "@data-agent/contracts/evals";
import {
  FALCON24_AGENT_ANALYSIS_CASES,
  falcon24AnalysisOutputSchema,
  validateFalcon24AnalysisOutput,
} from "@data-agent/evals";
import { tableFromIPC } from "apache-arrow";
import type { z } from "zod";
import type { AnalysisOracleExpectation, AnalysisOraclePort } from "../analysis/executor.js";
import type { GovernedPythonInput } from "../analysis/sandbox-executor.js";
import { FALCON24_ANALYSIS_QUERY_SPECS } from "./falcon24-analysis-queries.js";

type Falcon24Output = z.infer<typeof falcon24AnalysisOutputSchema>;
type Row = Readonly<Record<string, string | number | null>>;

const CASES = new Map(
  FALCON24_AGENT_ANALYSIS_CASES.map((testCase) => [testCase.case_id, testCase]),
);

function fail(code: string): never {
  throw new TypeError(code);
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") fail(`FALCON24_ORACLE_INPUT_TEXT_INVALID:${key}`);
  return value;
}

function number(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`FALCON24_ORACLE_INPUT_NUMBER_INVALID:${key}`);
  }
  return value;
}

function nullableNumber(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  return number(row, key);
}

function close(actual: number, expected: number, code: string, absolute = 1e-8): void {
  if (Math.abs(actual - expected) > Math.max(absolute, Math.abs(expected) * 1e-8)) fail(code);
}

function nullableClose(actual: number | null, expected: number | null, code: string): void {
  if (actual === null || expected === null) {
    if (actual !== expected) fail(code);
    return;
  }
  close(actual, expected, code);
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) fail("FALCON24_ORACLE_QUANTILE_EMPTY");
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];
  if (lowerValue === undefined || upperValue === undefined)
    fail("FALCON24_ORACLE_QUANTILE_INVALID");
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

function deduplicate(rows: readonly Row[], key: string): Row[] {
  const unique = new Map<string, Row>();
  for (const row of rows) {
    const identity = text(row, key);
    const previous = unique.get(identity);
    if (previous) {
      for (const field of Object.keys(previous)) {
        if (field !== "product_category" && previous[field] !== row[field]) {
          fail(`FALCON24_ORACLE_DUPLICATE_CONFLICT:${key}:${identity}:${field}`);
        }
      }
    } else {
      unique.set(identity, row);
    }
  }
  return [...unique.values()];
}

function decodeArrow(input: GovernedPythonInput, testCase: Falcon24AgentAnalysisCase): Row[] {
  const spec = FALCON24_ANALYSIS_QUERY_SPECS[testCase.case_id];
  if (input.name !== spec.input_name || input.format !== "ARROW") {
    fail("FALCON24_ORACLE_INPUT_BINDING_INVALID");
  }
  const table = tableFromIPC(input.content);
  if (table.numRows !== spec.expected_rows) fail("FALCON24_ORACLE_INPUT_ROW_COUNT_INVALID");
  const observedColumns = table.schema.fields.map(({ name }) => name);
  const expectedColumns = spec.columns.map(({ name }) => name);
  if (JSON.stringify(observedColumns) !== JSON.stringify(expectedColumns)) {
    fail("FALCON24_ORACLE_INPUT_COLUMNS_INVALID");
  }
  return Array.from({ length: table.numRows }, (_, rowIndex) =>
    Object.fromEntries(
      expectedColumns.map((column) => {
        const value = table.getChild(column)?.get(rowIndex) as string | number | null | undefined;
        if (value === undefined) fail(`FALCON24_ORACLE_INPUT_COLUMN_MISSING:${column}`);
        return [column, value];
      }),
    ),
  );
}

function parseResult(
  outputs: Parameters<AnalysisOraclePort["evaluate"]>[0]["sandbox_outputs"],
): unknown {
  if (outputs.length !== 1 || outputs[0]?.name !== "result" || outputs[0].type !== "JSON") {
    fail("FALCON24_ORACLE_OUTPUT_BINDING_INVALID");
  }
  try {
    return JSON.parse(Buffer.from(outputs[0].content_base64, "base64").toString("utf8"));
  } catch {
    return fail("FALCON24_ORACLE_OUTPUT_JSON_INVALID");
  }
}

function verifyBusiness(
  rows: readonly Row[],
  output: Extract<Falcon24Output, { case_id: "falcon24-business-review-18m" }>,
): void {
  const orders = deduplicate(rows, "order_id");
  const monthly = new Map<string, { revenue: number; orders: number; buyers: Set<string> }>();
  for (const row of orders) {
    const month = text(row, "order_date").slice(0, 7);
    const entry = monthly.get(month) ?? { revenue: 0, orders: 0, buyers: new Set<string>() };
    entry.revenue += number(row, "order_total");
    entry.orders += 1;
    entry.buyers.add(text(row, "customer_id"));
    monthly.set(month, entry);
  }
  if (monthly.size !== 18) fail("FALCON24_Q1_INPUT_MONTH_COUNT_INVALID");
  for (const observed of output.monthly_kpis) {
    const expected = monthly.get(observed.month);
    if (!expected) fail("FALCON24_Q1_MONTH_NOT_IN_INPUT");
    close(observed.revenue, expected.revenue, "FALCON24_Q1_REVENUE_MISMATCH", 0.01);
    if (
      observed.order_count !== expected.orders ||
      observed.active_buyers !== expected.buyers.size
    ) {
      fail("FALCON24_Q1_COUNT_MISMATCH");
    }
    close(
      observed.average_order_value,
      expected.revenue / expected.orders,
      "FALCON24_Q1_AOV_MISMATCH",
      0.01,
    );
    close(
      observed.orders_per_buyer,
      expected.orders / expected.buyers.size,
      "FALCON24_Q1_FREQUENCY_MISMATCH",
    );
  }
  const worstIndex = output.monthly_kpis.findIndex(
    ({ month }) => month === output.worst_revenue_decline.month,
  );
  const previous = output.monthly_kpis[worstIndex - 1];
  const current = output.monthly_kpis[worstIndex];
  if (!previous || !current) fail("FALCON24_Q1_WORST_MONTH_INPUT_INVALID");
  if (
    output.shapley_decomposition.start_month !== previous.month ||
    output.shapley_decomposition.end_month !== current.month
  ) {
    fail("FALCON24_Q1_SHAPLEY_WINDOW_MISMATCH");
  }
  close(
    output.shapley_decomposition.observed_revenue_change,
    current.revenue - previous.revenue,
    "FALCON24_Q1_SHAPLEY_OBSERVED_MISMATCH",
    0.01,
  );
  const dimensions = {
    customer_segment: "customer_segment",
    product_category: "product_category",
    payment_method: "payment_method",
  } as const;
  for (const driver of output.segment_drivers) {
    const field = dimensions[driver.dimension];
    let baseline = 0;
    let comparison = 0;
    for (const row of rows) {
      if (text(row, field) !== driver.member) continue;
      const month = text(row, "order_date").slice(0, 7);
      if (month !== previous.month && month !== current.month) continue;
      const value = number(row, "order_total");
      if (month === previous.month) baseline += value;
      else comparison += value;
    }
    close(
      driver.revenue_change,
      comparison - baseline,
      "FALCON24_Q1_SEGMENT_DRIVER_MISMATCH",
      0.01,
    );
  }
}

function verifyDelivery(
  rows: readonly Row[],
  output: Extract<Falcon24Output, { case_id: "falcon24-delivery-experience-12m" }>,
): void {
  const orders = deduplicate(rows, "order_id");
  const summarize = (selected: readonly Row[]) => ({
    p50_minutes: quantile(
      selected.map((row) => number(row, "delivery_time_minutes")),
      0.5,
    ),
    p90_minutes: quantile(
      selected.map((row) => number(row, "delivery_time_minutes")),
      0.9,
    ),
    on_time_rate:
      selected.filter((row) => text(row, "delivery_status") === "On Time").length / selected.length,
    low_rating_rate:
      selected.filter((row) => (nullableNumber(row, "rating") ?? Number.POSITIVE_INFINITY) <= 2)
        .length / selected.length,
  });
  const first = summarize(orders.filter((row) => text(row, "order_date") < "2024-05-01"));
  const second = summarize(orders.filter((row) => text(row, "order_date") >= "2024-05-01"));
  for (const key of ["p50_minutes", "p90_minutes", "on_time_rate", "low_rating_rate"] as const) {
    close(
      output.six_vs_six.first[key],
      first[key],
      `FALCON24_Q2_FIRST_${key.toUpperCase()}_MISMATCH`,
    );
    close(
      output.six_vs_six.second[key],
      second[key],
      `FALCON24_Q2_SECOND_${key.toUpperCase()}_MISMATCH`,
    );
  }
  const rated = orders.filter((row) => nullableNumber(row, "rating") !== null);
  if (output.adjusted_binomial_glm.sample_size !== rated.length)
    fail("FALCON24_Q2_GLM_SAMPLE_MISMATCH");
  for (const scenario of output.low_rating_scenarios) {
    const selected = orders.filter(
      (row) =>
        text(row, "product_category") === scenario.product_category &&
        text(row, "customer_segment") === scenario.customer_segment &&
        text(row, "delivery_status") === scenario.delivery_status,
    );
    if (selected.length !== scenario.order_count) fail("FALCON24_Q2_SCENARIO_COUNT_MISMATCH");
    close(
      scenario.low_rating_rate,
      selected.filter((row) => (nullableNumber(row, "rating") ?? Number.POSITIVE_INFINITY) <= 2)
        .length / selected.length,
      "FALCON24_Q2_SCENARIO_RATE_MISMATCH",
    );
  }
}

function percentile75(values: readonly number[]): number {
  return quantile(values, 0.75);
}

function theilSen(points: readonly { x: number; y: number }[]): number {
  const slopes: number[] = [];
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const a = points[left];
      const b = points[right];
      if (a && b && b.x !== a.x) slopes.push((b.y - a.y) / (b.x - a.x));
    }
  }
  return quantile(slopes, 0.5);
}

function verifyInventory(
  rows: readonly Row[],
  output: Extract<Falcon24Output, { case_id: "falcon24-inventory-damage-12m" }>,
): void {
  const byProduct = new Map<string, Row[]>();
  for (const row of rows) {
    const productId = text(row, "product_id");
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), row]);
  }
  const salesTotals = new Map(
    [...byProduct].map(([productId, productRows]) => [
      productId,
      productRows.reduce((sum, row) => sum + number(row, "sales_quantity"), 0),
    ]),
  );
  const categorySales = new Map<string, number[]>();
  for (const [productId, productRows] of byProduct) {
    const category = text(productRows[0] ?? fail("FALCON24_Q3_PRODUCT_EMPTY"), "category");
    categorySales.set(category, [
      ...(categorySales.get(category) ?? []),
      salesTotals.get(productId) ?? 0,
    ]);
  }
  for (const product of output.products) {
    const productRows = byProduct
      .get(product.product_id)
      ?.slice()
      .sort((a, b) => text(a, "month").localeCompare(text(b, "month")));
    if (productRows?.length !== 12) fail("FALCON24_Q3_PRODUCT_SERIES_MISSING");
    if (
      text(productRows[0] ?? fail("FALCON24_Q3_PRODUCT_EMPTY"), "category") !== product.category
    ) {
      fail("FALCON24_Q3_CATEGORY_MISMATCH");
    }
    close(
      product.sales_quantity,
      salesTotals.get(product.product_id) ?? 0,
      "FALCON24_Q3_SALES_MISMATCH",
    );
    close(
      product.category_sales_p75,
      percentile75(categorySales.get(product.category) ?? []),
      "FALCON24_Q3_CATEGORY_P75_MISMATCH",
    );
    const rates = productRows.map((row) => {
      const received = number(row, "stock_received");
      return received === 0 ? 0 : number(row, "damaged_stock") / received;
    });
    const previous = rates.slice(0, 9).reduce((sum, value) => sum + value, 0) / 9;
    const recent = rates.slice(9).reduce((sum, value) => sum + value, 0) / 3;
    close(product.previous9_damage_rate, previous, "FALCON24_Q3_PREVIOUS_RATE_MISMATCH");
    close(product.last3_damage_rate, recent, "FALCON24_Q3_RECENT_RATE_MISMATCH");
    close(
      product.theil_sen_slope,
      theilSen(rates.map((y, x) => ({ x, y }))),
      "FALCON24_Q3_THEIL_SEN_MISMATCH",
    );
  }
}

function verifyMarketing(
  rows: readonly Row[],
  output: Extract<Falcon24Output, { case_id: "falcon24-marketing-lag-effect" }>,
): void {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${text(row, "channel")}\u0000${text(row, "target_audience")}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (output.channel_audience_results.length !== groups.size)
    fail("FALCON24_Q4_GROUP_COVERAGE_MISMATCH");
  for (const result of output.channel_audience_results) {
    const selected = groups.get(`${result.channel}\u0000${result.target_audience}`);
    if (!selected) fail("FALCON24_Q4_GROUP_MISSING");
    const sum = (key: string) => selected.reduce((total, row) => total + number(row, key), 0);
    const impressions = sum("impressions");
    const clicks = sum("clicks");
    const conversions = sum("conversions");
    const spend = sum("spend");
    const revenue = sum("campaign_revenue");
    for (const [actual, expected, code] of [
      [result.impressions, impressions, "FALCON24_Q4_IMPRESSIONS_MISMATCH"],
      [result.clicks, clicks, "FALCON24_Q4_CLICKS_MISMATCH"],
      [result.conversions, conversions, "FALCON24_Q4_CONVERSIONS_MISMATCH"],
      [result.spend, spend, "FALCON24_Q4_SPEND_MISMATCH"],
      [result.revenue_generated, revenue, "FALCON24_Q4_REVENUE_MISMATCH"],
      [
        result.click_through_rate,
        impressions === 0 ? 0 : clicks / impressions,
        "FALCON24_Q4_CTR_MISMATCH",
      ],
      [
        result.conversion_rate,
        clicks === 0 ? 0 : conversions / clicks,
        "FALCON24_Q4_CONVERSION_RATE_MISMATCH",
      ],
      [result.roas, spend === 0 ? 0 : revenue / spend, "FALCON24_Q4_ROAS_MISMATCH"],
    ] as const)
      close(actual, expected, code, 0.01);
  }
}

function verifyCohort(
  rows: readonly Row[],
  output: Extract<Falcon24Output, { case_id: "falcon24-cohort-retention-m0-m6" }>,
): void {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${text(row, "registration_cohort")}\u0000${text(row, "customer_segment")}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (output.cohorts.length !== groups.size) fail("FALCON24_Q5_COHORT_COVERAGE_MISMATCH");
  const first = rows[0] ?? fail("FALCON24_Q5_INPUT_EMPTY");
  const anomaly = output.anomaly_precheck;
  for (const [actual, key] of [
    [anomaly.orders_before_registration, "orders_before_registration"],
    [
      anomaly.customers_first_order_before_registration,
      "customers_first_order_before_registration",
    ],
    [anomaly.valid_ordering_customers, "valid_ordering_customers"],
    [anomaly.no_order_customers, "no_order_customers"],
  ] as const)
    close(actual, number(first, key), `FALCON24_Q5_${key.toUpperCase()}_MISMATCH`);
  for (const cohort of output.cohorts) {
    const selected = groups
      .get(`${cohort.registration_cohort}\u0000${cohort.customer_segment}`)
      ?.slice()
      .sort((a, b) => number(a, "month_index") - number(b, "month_index"));
    if (selected?.length !== 7) fail("FALCON24_Q5_COHORT_SERIES_MISSING");
    for (const point of cohort.points) {
      const row = selected[point.month_index];
      if (!row || number(row, "month_index") !== point.month_index)
        fail("FALCON24_Q5_MONTH_POINT_MISSING");
      const cohortSize = number(row, "cohort_size");
      const active = number(row, "active_customers");
      close(point.retention_rate, active / cohortSize, "FALCON24_Q5_RETENTION_MISMATCH");
      close(
        point.repeat_purchase_rate,
        number(row, "repeat_customers") / cohortSize,
        "FALCON24_Q5_REPEAT_MISMATCH",
      );
      nullableClose(
        point.average_spend,
        active === 0 ? null : number(row, "revenue") / active,
        "FALCON24_Q5_SPEND_MISMATCH",
      );
      nullableClose(
        point.delivery_minutes,
        nullableNumber(row, "delivery_minutes"),
        "FALCON24_Q5_DELIVERY_MISMATCH",
      );
      nullableClose(
        point.average_rating,
        nullableNumber(row, "average_rating"),
        "FALCON24_Q5_RATING_MISMATCH",
      );
    }
  }
}

const verifiers = {
  "falcon24-business-review-18m": verifyBusiness,
  "falcon24-delivery-experience-12m": verifyDelivery,
  "falcon24-inventory-damage-12m": verifyInventory,
  "falcon24-marketing-lag-effect": verifyMarketing,
  "falcon24-cohort-retention-m0-m6": verifyCohort,
} as const;

export async function verifyFalcon24ArrowBackedOutput(input: {
  readonly test_case: Falcon24AgentAnalysisCase;
  readonly governed_input: GovernedPythonInput;
  readonly output: unknown;
}) {
  const rows = decodeArrow(input.governed_input, input.test_case);
  const output = falcon24AnalysisOutputSchema.parse(input.output);
  if (output.case_id !== input.test_case.case_id) fail("FALCON24_ORACLE_CASE_BINDING_INVALID");
  const validated = await validateFalcon24AnalysisOutput({ test_case: input.test_case, output });
  (verifiers[output.case_id] as (rows: readonly Row[], output: never) => void)(
    rows,
    output as never,
  );
  const inputHash = `sha256:${createHash("sha256")
    .update(input.governed_input.content)
    .digest("hex")}` as const;
  const verificationHash = await sha256ContentHash({
    case_id: input.test_case.case_id,
    input_hash: inputHash,
    input_materialization_receipt_hash:
      input.governed_input.materialization_receipt_ref.content_hash,
    query_evidence_hash: input.governed_input.query_evidence_ref.content_hash,
    output_hash: validated.output_hash,
    verifier: "falcon24-arrow-input-recompute@2.0.0",
  });
  const material = {
    schema_version: "falcon24-analysis-oracle@2.0.0" as const,
    oracle_kind: "ARROW_INPUT_RECOMPUTE" as const,
    case_id: input.test_case.case_id,
    verdict: "PASS" as const,
    input_hash: inputHash,
    input_materialization_receipt_hash:
      input.governed_input.materialization_receipt_ref.content_hash,
    query_evidence_hash: input.governed_input.query_evidence_ref.content_hash,
    output_hash: validated.output_hash,
    verification_hash: verificationHash,
    method_receipts: input.test_case.required_methods.map((methodId) => ({
      method_id: methodId,
      status: "PASS" as const,
      evidence_hash: verificationHash,
    })),
    disclosures: input.test_case.required_disclosures,
    quality_findings: input.test_case.required_quality_findings,
    terminal: input.test_case.expected_terminal,
  };
  return {
    output,
    sample_size: rows.length,
    receipt: falcon24AnalysisOracleReceiptSchema.parse({
      ...material,
      receipt_hash: await sha256ContentHash(material),
    }),
  };
}

export function createFalcon24ArrowBackedAnalysisOracle(): AnalysisOraclePort {
  return Object.freeze({
    async evaluate(input: Parameters<AnalysisOraclePort["evaluate"]>[0]) {
      const { node, governed_inputs, sandbox_outputs } = input;
      const caseId = falcon24AnalysisCaseIdSchema.parse(node.node_id);
      const testCase = CASES.get(caseId) ?? fail("FALCON24_ORACLE_CASE_NOT_REGISTERED");
      if (governed_inputs.length !== 1) fail("FALCON24_ORACLE_INPUT_COUNT_INVALID");
      const governedInput = governed_inputs[0] ?? fail("FALCON24_ORACLE_INPUT_MISSING");
      const output = parseResult(sandbox_outputs);
      const verified = await verifyFalcon24ArrowBackedOutput({
        test_case: testCase,
        governed_input: governedInput,
        output,
      });
      const resultOutput = sandbox_outputs[0] ?? fail("FALCON24_ORACLE_OUTPUT_MISSING");
      return {
        result: {
          result_kind: "GENERATED_ANALYSIS",
          declared_method: "falcon24-input-recompute@1",
          structured_output_refs: [resultOutput.reference],
          oracle_scope: "FULL",
        },
        sample_size: verified.sample_size,
        coverage_ratio: 1,
        limitation_codes: [] satisfies readonly AnalysisReasonCode[],
        material_change: true,
      } satisfies AnalysisOracleExpectation;
    },
  });
}

export const falcon24ArrowBackedAnalysisOracleInternals = Object.freeze({
  quantile,
  theilSen,
  verifiers,
});
