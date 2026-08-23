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

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return (1 + erf) / 2;
}

function twoSidedNormalP(zScore: number): number {
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(zScore)))));
}

function zeroMatrix(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));
}

function solve(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  const size = matrix.length;
  if (size === 0 || vector.length !== size || matrix.some((row) => row.length !== size)) {
    fail("FALCON24_ORACLE_MATRIX_SHAPE_INVALID");
  }
  const augmented = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]?.[column] ?? 0) < 1e-12) {
      fail("FALCON24_ORACLE_MATRIX_SINGULAR");
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot] ?? [], augmented[column] ?? []];
    const pivotRow = augmented[column] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
    const pivotValue = pivotRow[column] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
    for (let index = column; index <= size; index += 1) {
      const current = pivotRow[index] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
      pivotRow[index] = current / pivotValue;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const currentRow = augmented[row] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
      const factor = currentRow[column] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
      for (let index = column; index <= size; index += 1) {
        const current = currentRow[index] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
        const pivotCurrent = pivotRow[index] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
        currentRow[index] = current - factor * pivotCurrent;
      }
    }
  }
  return augmented.map((row) => row[size] ?? fail("FALCON24_ORACLE_MATRIX_INVALID"));
}

function inverse(matrix: readonly (readonly number[])[]): number[][] {
  return matrix
    .map((_, column) =>
      solve(
        matrix,
        Array.from({ length: matrix.length }, (_unused, row) => (row === column ? 1 : 0)),
      ),
    )
    .reduce(
      (result, column, columnIndex) => {
        for (let row = 0; row < column.length; row += 1) {
          const resultRow = result[row] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
          resultRow[columnIndex] = column[row] ?? 0;
        }
        return result;
      },
      zeroMatrix(matrix.length, matrix.length),
    );
}

function crossProduct(
  design: readonly (readonly number[])[],
  weights?: readonly number[],
): number[][] {
  const width = design[0]?.length ?? fail("FALCON24_ORACLE_DESIGN_EMPTY");
  const result = zeroMatrix(width, width);
  for (let row = 0; row < design.length; row += 1) {
    const values = design[row] ?? fail("FALCON24_ORACLE_DESIGN_INVALID");
    const weight = weights?.[row] ?? 1;
    for (let left = 0; left < width; left += 1) {
      for (let right = 0; right < width; right += 1) {
        const resultRow = result[left] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
        resultRow[right] =
          (resultRow[right] ?? 0) + (values[left] ?? 0) * (values[right] ?? 0) * weight;
      }
    }
  }
  return result;
}

function crossVector(
  design: readonly (readonly number[])[],
  values: readonly number[],
  weights?: readonly number[],
): number[] {
  const width = design[0]?.length ?? fail("FALCON24_ORACLE_DESIGN_EMPTY");
  const result = Array.from({ length: width }, () => 0);
  for (let row = 0; row < design.length; row += 1) {
    const designRow = design[row] ?? fail("FALCON24_ORACLE_DESIGN_INVALID");
    const weightedValue =
      (values[row] ?? fail("FALCON24_ORACLE_VECTOR_INVALID")) * (weights?.[row] ?? 1);
    for (let column = 0; column < width; column += 1) {
      result[column] = (result[column] ?? 0) + (designRow[column] ?? 0) * weightedValue;
    }
  }
  return result;
}

function multiply(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
): number[][] {
  const rows = left.length;
  const inner = left[0]?.length ?? 0;
  const columns = right[0]?.length ?? 0;
  if (inner === 0 || right.length !== inner) fail("FALCON24_ORACLE_MATRIX_SHAPE_INVALID");
  const result = zeroMatrix(rows, columns);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      for (let index = 0; index < inner; index += 1) {
        const resultRow = result[row] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
        resultRow[column] =
          (resultRow[column] ?? 0) + (left[row]?.[index] ?? 0) * (right[index]?.[column] ?? 0);
      }
    }
  }
  return result;
}

function benjaminiHochberg(values: ReadonlyMap<string, number>): Map<string, number> {
  const sorted = [...values].sort(
    ([leftId, left], [rightId, right]) => left - right || leftId.localeCompare(rightId),
  );
  const result = new Map<string, number>();
  let next = 1;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const current = sorted[index] ?? fail("FALCON24_ORACLE_BH_INVALID");
    next = Math.min(next, (current[1] * sorted.length) / (index + 1));
    result.set(current[0], Math.max(0, Math.min(1, next)));
  }
  return result;
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

function groupBy(rows: readonly Row[], key: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const identity = text(row, key);
    groups.set(identity, [...(groups.get(identity) ?? []), row]);
  }
  return groups;
}

function assertConstant(rows: readonly Row[], fields: readonly string[], code: string): Row {
  const first = rows[0] ?? fail(`${code}:EMPTY`);
  for (const row of rows.slice(1)) {
    for (const field of fields) {
      if (row[field] !== first[field]) fail(`${code}:${field}`);
    }
  }
  return first;
}

function shapleyThreeFactor(
  baseline: readonly [number, number, number],
  comparison: readonly [number, number, number],
): readonly [number, number, number] {
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ] as const;
  const contributions = [0, 0, 0];
  const product = (values: readonly number[]) => values.reduce((total, value) => total * value, 1);
  for (const permutation of permutations) {
    const values = [...baseline];
    for (const factor of permutation) {
      const before = product(values);
      values[factor] = comparison[factor];
      contributions[factor] = (contributions[factor] ?? 0) + product(values) - before;
    }
  }
  return contributions.map((value) => value / permutations.length) as unknown as readonly [
    number,
    number,
    number,
  ];
}

function verifyBusiness(
  rows: readonly Row[],
  output: Extract<Falcon24Output, { case_id: "falcon24-business-review-18m" }>,
): void {
  const orderGroups = groupBy(rows, "order_id");
  const orders = [...orderGroups].map(([orderId, orderRows]) => ({
    order_id: orderId,
    row: assertConstant(
      orderRows,
      ["order_date", "payment_method", "customer_id", "customer_segment", "order_total"],
      `FALCON24_Q1_ORDER_CONFLICT:${orderId}`,
    ),
    item_rows: orderRows,
  }));
  const monthly = new Map<string, { revenue: number; orders: number; buyers: Set<string> }>();
  for (const order of orders) {
    const month = text(order.row, "order_date").slice(0, 7);
    const entry = monthly.get(month) ?? { revenue: 0, orders: 0, buyers: new Set<string>() };
    entry.revenue += number(order.row, "order_total");
    entry.orders += 1;
    entry.buyers.add(text(order.row, "customer_id"));
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
  const [buyerContribution, frequencyContribution, aovContribution] = shapleyThreeFactor(
    [previous.active_buyers, previous.orders_per_buyer, previous.average_order_value],
    [current.active_buyers, current.orders_per_buyer, current.average_order_value],
  );
  close(
    output.shapley_decomposition.buyer_contribution,
    buyerContribution,
    "FALCON24_Q1_SHAPLEY_BUYER_MISMATCH",
    0.01,
  );
  close(
    output.shapley_decomposition.frequency_contribution,
    frequencyContribution,
    "FALCON24_Q1_SHAPLEY_FREQUENCY_MISMATCH",
    0.01,
  );
  close(
    output.shapley_decomposition.aov_contribution,
    aovContribution,
    "FALCON24_Q1_SHAPLEY_AOV_MISMATCH",
    0.01,
  );
  close(output.shapley_decomposition.closure_error, 0, "FALCON24_Q1_SHAPLEY_ERROR_MISMATCH", 0.01);
  const changes = new Map<string, Map<string, number>>([
    ["customer_segment", new Map()],
    ["product_category", new Map()],
    ["payment_method", new Map()],
  ]);
  const add = (dimension: string, member: string, month: string, revenue: number) => {
    if (month !== previous.month && month !== current.month) return;
    const members = changes.get(dimension) ?? fail("FALCON24_Q1_DIMENSION_INVALID");
    const signed = month === previous.month ? -revenue : revenue;
    members.set(member, (members.get(member) ?? 0) + signed);
  };
  for (const order of orders) {
    const month = text(order.row, "order_date").slice(0, 7);
    const revenue = number(order.row, "order_total");
    add("customer_segment", text(order.row, "customer_segment"), month, revenue);
    add("payment_method", text(order.row, "payment_method"), month, revenue);
    const categoryQuantities = new Map<string, number>();
    for (const row of order.item_rows) {
      const category = text(row, "product_category");
      categoryQuantities.set(
        category,
        (categoryQuantities.get(category) ?? 0) + Math.max(0, number(row, "quantity")),
      );
    }
    const totalQuantity = [...categoryQuantities.values()].reduce((sum, value) => sum + value, 0);
    for (const [category, quantity] of categoryQuantities) {
      const share = totalQuantity > 0 ? quantity / totalQuantity : 1 / categoryQuantities.size;
      add("product_category", category, month, revenue * share);
    }
  }
  if (output.segment_drivers.length !== 3) fail("FALCON24_Q1_SEGMENT_DRIVER_COVERAGE_INVALID");
  for (const driver of output.segment_drivers) {
    const members = changes.get(driver.dimension) ?? fail("FALCON24_Q1_DIMENSION_INVALID");
    const expected = [...members].sort(
      ([leftMember, left], [rightMember, right]) =>
        left - right || leftMember.localeCompare(rightMember),
    )[0];
    if (!expected || driver.member !== expected[0])
      fail("FALCON24_Q1_SEGMENT_DRIVER_MEMBER_MISMATCH");
    close(driver.revenue_change, expected[1], "FALCON24_Q1_SEGMENT_DRIVER_MISMATCH", 0.01);
  }
}

function fitDeliveryGlm(rated: readonly Row[]) {
  const levels = (key: string) =>
    [...new Set(rated.map((row) => text(row, key)))].sort((left, right) =>
      left.localeCompare(right),
    );
  const categorical = [
    ["order_date", levels("order_date").map((value) => value.slice(0, 7))],
    ["product_category", levels("product_category")],
    ["customer_segment", levels("customer_segment")],
  ] as const;
  categorical[0][1].sort((left, right) => left.localeCompare(right));
  const uniqueCategorical = categorical.map(
    ([key, values]) => [key, [...new Set(values)]] as const,
  );
  const design = rated.map((row) => [
    1,
    text(row, "delivery_status") === "On Time" ? 0 : 1,
    Math.log1p(number(row, "order_total")),
    ...uniqueCategorical.flatMap(([key, values]) =>
      values.slice(1).map((value) => {
        const observed = key === "order_date" ? text(row, key).slice(0, 7) : text(row, key);
        return observed === value ? 1 : 0;
      }),
    ),
  ]);
  const response = rated.map((row) => ((nullableNumber(row, "rating") ?? 5) <= 2 ? 1 : 0));
  if (design.length <= (design[0]?.length ?? 0)) fail("FALCON24_Q2_GLM_UNDERSPECIFIED");
  let coefficients = Array.from({ length: design[0]?.length ?? 0 }, () => 0);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const fitted = design.map((row) =>
      row.reduce((sum, value, index) => sum + value * (coefficients[index] ?? 0), 0),
    );
    const probabilities = fitted.map(
      (value) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value)))),
    );
    const weights = probabilities.map((value) => Math.max(1e-10, value * (1 - value)));
    const adjusted = fitted.map(
      (value, index) =>
        value + ((response[index] ?? 0) - (probabilities[index] ?? 0)) / (weights[index] ?? 1),
    );
    const next = solve(crossProduct(design, weights), crossVector(design, adjusted, weights));
    const difference = Math.max(
      ...next.map((value, index) => Math.abs(value - (coefficients[index] ?? 0))),
    );
    coefficients = next;
    if (difference < 1e-10) break;
  }
  const probabilities = design.map((row) => {
    const fitted = row.reduce((sum, value, index) => sum + value * (coefficients[index] ?? 0), 0);
    return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, fitted))));
  });
  const covariance = inverse(
    crossProduct(
      design,
      probabilities.map((value) => Math.max(1e-10, value * (1 - value))),
    ),
  );
  const coefficient = coefficients[1] ?? fail("FALCON24_Q2_GLM_COEFFICIENT_MISSING");
  const variance = covariance[1]?.[1] ?? fail("FALCON24_Q2_GLM_VARIANCE_MISSING");
  return {
    coefficient,
    pValue: variance <= 0 ? 1 : twoSidedNormalP(coefficient / Math.sqrt(variance)),
  };
}

function verifyDelivery(
  rows: readonly Row[],
  output: Extract<Falcon24Output, { case_id: "falcon24-delivery-experience-12m" }>,
): void {
  const orders = [...groupBy(rows, "order_id")].map(([orderId, orderRows]) => {
    const first = assertConstant(
      orderRows,
      [
        "order_date",
        "delivery_status",
        "order_total",
        "customer_segment",
        "rating",
        "feedback_category",
        "sentiment",
        "distance_km",
        "delivery_time_minutes",
      ],
      `FALCON24_Q2_ORDER_CONFLICT:${orderId}`,
    );
    return {
      ...first,
      product_category:
        orderRows
          .map((row) => text(row, "product_category"))
          .sort((left, right) => left.localeCompare(right))[0] ??
        fail("FALCON24_Q2_CATEGORY_MISSING"),
    };
  });
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
  const { coefficient: delayedCoefficient, pValue: delayedPValue } = fitDeliveryGlm(rated);
  close(
    output.adjusted_binomial_glm.delayed_coefficient,
    delayedCoefficient,
    "FALCON24_Q2_GLM_COEFFICIENT_MISMATCH",
    1e-6,
  );
  close(
    output.adjusted_binomial_glm.delayed_p_value,
    delayedPValue,
    "FALCON24_Q2_GLM_P_VALUE_MISMATCH",
    1e-6,
  );
  const scenarioGroups = new Map<string, Row[]>();
  for (const row of orders) {
    const key = `${text(row, "product_category")}\u0000${text(row, "customer_segment")}\u0000${text(row, "delivery_status")}`;
    scenarioGroups.set(key, [...(scenarioGroups.get(key) ?? []), row]);
  }
  const expectedScenarios = [...scenarioGroups]
    .map(([key, selected]) => ({
      key,
      selected,
      lowRatings: selected.filter(
        (row) => (nullableNumber(row, "rating") ?? Number.POSITIVE_INFINITY) <= 2,
      ).length,
    }))
    .sort(
      (left, right) =>
        right.lowRatings - left.lowRatings ||
        right.lowRatings / right.selected.length - left.lowRatings / left.selected.length ||
        right.selected.length - left.selected.length ||
        left.key.localeCompare(right.key),
    )
    .slice(0, 5);
  if (output.low_rating_scenarios.length !== expectedScenarios.length) {
    fail("FALCON24_Q2_SCENARIO_COVERAGE_MISMATCH");
  }
  for (const [index, scenario] of output.low_rating_scenarios.entries()) {
    const expectedScenario = expectedScenarios[index] ?? fail("FALCON24_Q2_SCENARIO_MISSING");
    const [productCategory, customerSegment, deliveryStatus] = expectedScenario.key.split("\u0000");
    if (
      scenario.product_category !== productCategory ||
      scenario.customer_segment !== customerSegment ||
      scenario.delivery_status !== deliveryStatus
    ) {
      fail("FALCON24_Q2_SCENARIO_RANK_MISMATCH");
    }
    const selected = expectedScenario.selected;
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

function mannKendallP(values: readonly number[]): number {
  let score = 0;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      score += Math.sign((values[right] ?? 0) - (values[left] ?? 0));
    }
  }
  const ties = new Map<number, number>();
  for (const value of values) ties.set(value, (ties.get(value) ?? 0) + 1);
  const tieAdjustment = [...ties.values()].reduce(
    (sum, count) => sum + count * (count - 1) * (2 * count + 5),
    0,
  );
  const variance =
    (values.length * (values.length - 1) * (2 * values.length + 5) - tieAdjustment) / 18;
  if (variance <= 0 || score === 0) return 1;
  const zScore = score > 0 ? (score - 1) / Math.sqrt(variance) : (score + 1) / Math.sqrt(variance);
  return twoSidedNormalP(zScore);
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
  const statistics = new Map<
    string,
    {
      readonly category: string;
      readonly sales: number;
      readonly categoryP75: number;
      readonly slope: number;
      readonly previous: number;
      readonly recent: number;
      readonly rawP: number;
    }
  >();
  for (const [productId, unsortedRows] of byProduct) {
    const productRows = unsortedRows
      .slice()
      .sort((left, right) => text(left, "month").localeCompare(text(right, "month")));
    if (productRows.length !== 12) fail("FALCON24_Q3_PRODUCT_SERIES_MISSING");
    const category = text(productRows[0] ?? fail("FALCON24_Q3_PRODUCT_EMPTY"), "category");
    if (productRows.some((row) => text(row, "category") !== category)) {
      fail("FALCON24_Q3_CATEGORY_CONFLICT");
    }
    const rates = productRows.map((row) => {
      const received = number(row, "stock_received");
      return received === 0 ? 0 : number(row, "damaged_stock") / received;
    });
    statistics.set(productId, {
      category,
      sales: salesTotals.get(productId) ?? 0,
      categoryP75: percentile75(categorySales.get(category) ?? []),
      slope: theilSen(rates.map((y, x) => ({ x, y }))),
      previous: rates.slice(0, 9).reduce((sum, value) => sum + value, 0) / 9,
      recent: rates.slice(9).reduce((sum, value) => sum + value, 0) / 3,
      rawP: mannKendallP(rates),
    });
  }
  const qValues = benjaminiHochberg(
    new Map([...statistics].map(([productId, statistic]) => [productId, statistic.rawP])),
  );
  const candidates = new Set(
    [...statistics]
      .filter(
        ([, statistic]) =>
          statistic.sales >= statistic.categoryP75 &&
          statistic.slope > 0 &&
          statistic.recent > statistic.previous,
      )
      .map(([productId]) => productId),
  );
  if (
    output.products.length !== candidates.size ||
    new Set(output.products.map(({ product_id }) => product_id)).size !== candidates.size
  ) {
    fail("FALCON24_Q3_PRODUCT_COVERAGE_MISMATCH");
  }
  for (const product of output.products) {
    if (!candidates.has(product.product_id)) fail("FALCON24_Q3_PRODUCT_NOT_CANDIDATE");
    const statistic = statistics.get(product.product_id) ?? fail("FALCON24_Q3_PRODUCT_MISSING");
    if (statistic.category !== product.category) fail("FALCON24_Q3_CATEGORY_MISMATCH");
    close(product.sales_quantity, statistic.sales, "FALCON24_Q3_SALES_MISMATCH");
    close(product.category_sales_p75, statistic.categoryP75, "FALCON24_Q3_CATEGORY_P75_MISMATCH");
    close(product.previous9_damage_rate, statistic.previous, "FALCON24_Q3_PREVIOUS_RATE_MISMATCH");
    close(product.last3_damage_rate, statistic.recent, "FALCON24_Q3_RECENT_RATE_MISMATCH");
    close(product.theil_sen_slope, statistic.slope, "FALCON24_Q3_THEIL_SEN_MISMATCH");
    close(product.raw_p_value, statistic.rawP, "FALCON24_Q3_RAW_P_MISMATCH", 1e-6);
    const qValue = qValues.get(product.product_id) ?? fail("FALCON24_Q3_Q_VALUE_MISSING");
    close(product.bh_q_value, qValue, "FALCON24_Q3_BH_Q_MISMATCH", 1e-6);
    if (product.status !== (qValue <= 0.05 ? "PRIORITY" : "WATCHLIST")) {
      fail("FALCON24_Q3_STATUS_MISMATCH");
    }
  }
}

function olsHac(input: {
  readonly design: readonly (readonly number[])[];
  readonly response: readonly number[];
  readonly coefficient_index: number;
  readonly max_lag: number;
}): { readonly coefficient: number; readonly pValue: number } {
  const { design, response } = input;
  const width = design[0]?.length ?? fail("FALCON24_Q4_DESIGN_EMPTY");
  if (design.length !== response.length || design.length <= width) {
    fail("FALCON24_Q4_DESIGN_UNDERSPECIFIED");
  }
  const bread = inverse(crossProduct(design));
  const coefficients = solve(crossProduct(design), crossVector(design, response));
  const residuals = design.map(
    (row, index) =>
      (response[index] ?? fail("FALCON24_Q4_RESPONSE_MISSING")) -
      row.reduce((sum, value, column) => sum + value * (coefficients[column] ?? 0), 0),
  );
  const meat = zeroMatrix(width, width);
  const addOuter = (left: readonly number[], right: readonly number[], weight: number) => {
    for (let row = 0; row < width; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const meatRow = meat[row] ?? fail("FALCON24_ORACLE_MATRIX_INVALID");
        meatRow[column] = (meatRow[column] ?? 0) + (left[row] ?? 0) * (right[column] ?? 0) * weight;
      }
    }
  };
  for (let index = 0; index < design.length; index += 1) {
    const row = design[index] ?? fail("FALCON24_Q4_DESIGN_INVALID");
    addOuter(row, row, (residuals[index] ?? 0) ** 2);
  }
  const maxLag = Math.min(input.max_lag, design.length - 1);
  for (let lag = 1; lag <= maxLag; lag += 1) {
    const kernel = 1 - lag / (maxLag + 1);
    for (let index = lag; index < design.length; index += 1) {
      const current = design[index] ?? fail("FALCON24_Q4_DESIGN_INVALID");
      const previous = design[index - lag] ?? fail("FALCON24_Q4_DESIGN_INVALID");
      const weight = kernel * (residuals[index] ?? 0) * (residuals[index - lag] ?? 0);
      addOuter(current, previous, weight);
      addOuter(previous, current, weight);
    }
  }
  const finiteSampleFactor = design.length / (design.length - width);
  for (const row of meat) {
    for (let column = 0; column < row.length; column += 1) {
      row[column] = (row[column] ?? 0) * finiteSampleFactor;
    }
  }
  const covariance = multiply(multiply(bread, meat), bread);
  const coefficient =
    coefficients[input.coefficient_index] ?? fail("FALCON24_Q4_COEFFICIENT_MISSING");
  const variance =
    covariance[input.coefficient_index]?.[input.coefficient_index] ??
    fail("FALCON24_Q4_VARIANCE_MISSING");
  return {
    coefficient,
    pValue: variance <= 0 ? 1 : twoSidedNormalP(coefficient / Math.sqrt(variance)),
  };
}

function simpleSlope(values: readonly number[]): number {
  const center = (values.length - 1) / 2;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const centered = index - center;
    numerator += centered * (values[index] ?? 0);
    denominator += centered * centered;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

const MARKETING_BUSINESS_OUTCOMES = ["order_revenue", "new_customers", "order_count"] as const;
type MarketingBusinessOutcome = (typeof MARKETING_BUSINESS_OUTCOMES)[number];

function verifyMarketing(
  rows: readonly Row[],
  output: Extract<Falcon24Output, { case_id: "falcon24-marketing-lag-effect" }>,
): void {
  const groups = new Map<string, Row[]>();
  const businessByWeek = new Map<string, Row>();
  for (const row of rows) {
    const key = `${text(row, "channel")}\u0000${text(row, "target_audience")}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
    const week = text(row, "week_start");
    const previous = businessByWeek.get(week);
    if (previous) {
      assertConstant(
        [previous, row],
        ["order_count", "active_customers", "order_revenue", "new_customers"],
        `FALCON24_Q4_BUSINESS_WEEK_CONFLICT:${week}`,
      );
    } else {
      businessByWeek.set(week, row);
    }
  }
  const weeks = [...businessByWeek.keys()].sort((left, right) => left.localeCompare(right));
  if (weeks.length !== 79) fail("FALCON24_Q4_WEEK_COVERAGE_INVALID");
  if (output.channel_audience_results.length !== groups.size)
    fail("FALCON24_Q4_GROUP_COVERAGE_MISMATCH");
  const groupStatistics = new Map<
    string,
    {
      readonly spendSlope: number;
      readonly outcomes: ReadonlyMap<
        MarketingBusinessOutcome,
        { readonly lag: number; readonly coefficient: number; readonly pValue: number }
      >;
    }
  >();
  for (const [key, selected] of groups) {
    const rowsByWeek = new Map(selected.map((row) => [text(row, "week_start"), row]));
    const spend = weeks.map((week) => number(rowsByWeek.get(week) ?? { spend: 0 }, "spend"));
    const outcomes = new Map<
      MarketingBusinessOutcome,
      { readonly lag: number; readonly coefficient: number; readonly pValue: number }
    >();
    for (const outcomeId of MARKETING_BUSINESS_OUTCOMES) {
      const outcome = weeks.map((week) =>
        number(businessByWeek.get(week) ?? fail("FALCON24_Q4_BUSINESS_WEEK_MISSING"), outcomeId),
      );
      const candidates = Array.from({ length: 5 }, (_, lag) => {
        const design = weeks.slice(lag).map((_week, offset) => {
          const weekIndex = offset + lag;
          return [
            1,
            spend[weekIndex - lag] ?? 0,
            weekIndex,
            Math.sin((2 * Math.PI * weekIndex) / 52),
            Math.cos((2 * Math.PI * weekIndex) / 52),
          ];
        });
        return {
          lag,
          ...olsHac({
            design,
            response: outcome.slice(lag),
            coefficient_index: 1,
            max_lag: 4,
          }),
        };
      }).sort((left, right) => left.pValue - right.pValue || left.lag - right.lag);
      outcomes.set(
        outcomeId,
        candidates[0] ?? fail(`FALCON24_Q4_LAG_SELECTION_EMPTY:${outcomeId}`),
      );
    }
    groupStatistics.set(key, { outcomes, spendSlope: simpleSlope(spend) });
  }
  const qValues = new Map(
    MARKETING_BUSINESS_OUTCOMES.map((outcomeId) => [
      outcomeId,
      benjaminiHochberg(
        new Map(
          [...groupStatistics].map(([key, statistic]) => [
            key,
            statistic.outcomes.get(outcomeId)?.pValue ??
              fail(`FALCON24_Q4_STATISTIC_MISSING:${outcomeId}`),
          ]),
        ),
      ),
    ]),
  );
  for (const result of output.channel_audience_results) {
    const key = `${result.channel}\u0000${result.target_audience}`;
    const selected = groups.get(key);
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
    const statistic = groupStatistics.get(key) ?? fail("FALCON24_Q4_STATISTIC_MISSING");
    if (
      result.business_outcomes.length !== MARKETING_BUSINESS_OUTCOMES.length ||
      result.business_outcomes.some(
        ({ metric }, index) => metric !== MARKETING_BUSINESS_OUTCOMES[index],
      )
    ) {
      fail("FALCON24_Q4_BUSINESS_OUTCOME_COVERAGE_MISMATCH");
    }
    const findings = result.business_outcomes.map((businessOutcome) => {
      const outcomeStatistic =
        statistic.outcomes.get(businessOutcome.metric) ??
        fail(`FALCON24_Q4_STATISTIC_MISSING:${businessOutcome.metric}`);
      if (businessOutcome.selected_lag_weeks !== outcomeStatistic.lag) {
        fail(`FALCON24_Q4_LAG_MISMATCH:${businessOutcome.metric}`);
      }
      close(
        businessOutcome.lag_coefficient,
        outcomeStatistic.coefficient,
        `FALCON24_Q4_COEFFICIENT_MISMATCH:${businessOutcome.metric}`,
        1e-6,
      );
      close(
        businessOutcome.hac_p_value,
        outcomeStatistic.pValue,
        `FALCON24_Q4_HAC_P_MISMATCH:${businessOutcome.metric}`,
        1e-6,
      );
      const qValue =
        qValues.get(businessOutcome.metric)?.get(key) ??
        fail(`FALCON24_Q4_Q_VALUE_MISSING:${businessOutcome.metric}`);
      close(
        businessOutcome.bh_q_value,
        qValue,
        `FALCON24_Q4_BH_Q_MISMATCH:${businessOutcome.metric}`,
        1e-6,
      );
      const finding =
        outcomeStatistic.coefficient > 0 && qValue <= 0.05
          ? "GROWTH_ASSOCIATION"
          : statistic.spendSlope > 0
            ? "SPEND_WITHOUT_IMPROVEMENT"
            : "NO_CLEAR_ASSOCIATION";
      if (businessOutcome.finding !== finding) {
        fail(`FALCON24_Q4_FINDING_MISMATCH:${businessOutcome.metric}`);
      }
      return finding;
    });
    const groupFinding = findings.includes("GROWTH_ASSOCIATION")
      ? "GROWTH_ASSOCIATION"
      : statistic.spendSlope > 0
        ? "SPEND_WITHOUT_IMPROVEMENT"
        : "NO_CLEAR_ASSOCIATION";
    if (result.group_finding !== groupFinding) fail("FALCON24_Q4_GROUP_FINDING_MISMATCH");
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
  if (
    output.sensitivity.excluded_pre_registration_customers !==
      anomaly.customers_first_order_before_registration ||
    output.sensitivity.retained_no_order_customers !== anomaly.no_order_customers
  ) {
    fail("FALCON24_Q5_SENSITIVITY_AUDIT_MISMATCH");
  }
  const sensitivityChanged = rows.some((row) => {
    const cohortSize = number(row, "cohort_size");
    const active = number(row, "active_customers");
    const validSize = number(row, "valid_timeline_customers");
    const validActive = number(row, "valid_active_customers");
    const primaryRetention = cohortSize === 0 ? 0 : active / cohortSize;
    const sensitivityRetention = validSize === 0 ? 0 : validActive / validSize;
    return Math.abs(primaryRetention - sensitivityRetention) >= 0.05;
  });
  if (output.sensitivity.conclusion_changed !== sensitivityChanged) {
    fail("FALCON24_Q5_SENSITIVITY_CONCLUSION_MISMATCH");
  }
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
    verifier: "falcon24-arrow-input-recompute@3.0.0",
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
  benjaminiHochberg,
  fitDeliveryGlm,
  mannKendallP,
  olsHac,
  quantile,
  shapleyThreeFactor,
  theilSen,
  verifiers,
});
