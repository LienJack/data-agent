import { analysisResultSchema } from "@data-agent/contracts";

export type AnalysisResult = ReturnType<typeof analysisResultSchema.parse>;
export type OracleFailure =
  | "RESULT_SCHEMA_INVALID"
  | "TREND_ORDER_INVALID"
  | "TREND_DELTA_MISMATCH"
  | "TREND_ENDPOINT_MISMATCH"
  | "TREND_RELATIVE_DELTA_MISMATCH"
  | "CONTRIBUTION_CLOSURE_FAILED"
  | "CONTRIBUTION_ORDER_INVALID"
  | "CONTRIBUTION_SHARE_MISMATCH"
  | "ANOMALY_ORDER_INVALID"
  | "ASSOCIATION_COMPLETENESS_MISMATCH"
  | "FORECAST_USEFULNESS_INVALID"
  | "GENERATED_ORACLE_INSUFFICIENT";

export interface ResultOracleVerdict {
  verdict: "PASS" | "FAIL" | "CANDIDATE_ONLY";
  failures: readonly OracleFailure[];
}

const near = (left: number, right: number, tolerance = 1e-9): boolean =>
  Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));

export function verifyAnalysisResult(result: unknown): ResultOracleVerdict {
  const parsed = analysisResultSchema.safeParse(result);
  if (!parsed.success) return { verdict: "FAIL", failures: ["RESULT_SCHEMA_INVALID"] };
  const value = parsed.data;
  const failures: OracleFailure[] = [];
  if (value.result_kind === "TREND_CHANGE") {
    const periods = value.points.map(({ period_start }) => period_start);
    if (periods.some((period, index) => index > 0 && period <= (periods[index - 1] ?? ""))) {
      failures.push("TREND_ORDER_INVALID");
    }
    const firstPoint = value.points[0];
    const lastPoint = value.points.at(-1);
    if (
      (firstPoint?.value ?? null) !== value.first_value ||
      (lastPoint?.value ?? null) !== value.last_value
    ) {
      failures.push("TREND_ENDPOINT_MISMATCH");
    }
    if (firstPoint && (firstPoint.absolute_delta !== null || firstPoint.relative_delta !== null)) {
      failures.push("TREND_DELTA_MISMATCH");
    }
    for (let index = 1; index < value.points.length; index += 1) {
      const point = value.points[index];
      const previous = value.points[index - 1];
      if (!point || !previous || point.value === null || previous.value === null) continue;
      const expected = point.value - previous.value;
      if (point.absolute_delta === null || !near(point.absolute_delta, expected)) {
        failures.push("TREND_DELTA_MISMATCH");
        break;
      }
      const expectedRelative = previous.value === 0 ? null : expected / previous.value;
      if (
        (expectedRelative === null && point.relative_delta !== null) ||
        (expectedRelative !== null &&
          (point.relative_delta === null || !near(point.relative_delta, expectedRelative)))
      ) {
        failures.push("TREND_RELATIVE_DELTA_MISMATCH");
        break;
      }
    }
  } else if (value.result_kind === "CONTRIBUTION_CONCENTRATION") {
    if (Math.abs(value.residual) > value.closure_tolerance) {
      failures.push("CONTRIBUTION_CLOSURE_FAILED");
    }
    for (let index = 1; index < value.groups.length; index += 1) {
      const previous = value.groups[index - 1];
      const current = value.groups[index];
      if (
        previous &&
        current &&
        (Math.abs(previous.signed_delta) < Math.abs(current.signed_delta) ||
          (Math.abs(previous.signed_delta) === Math.abs(current.signed_delta) &&
            previous.group_key_hash > current.group_key_hash))
      ) {
        failures.push("CONTRIBUTION_ORDER_INVALID");
        break;
      }
    }
    const totalDelta = value.groups.reduce((sum, group) => sum + group.signed_delta, 0);
    if (
      value.groups.some((group) => {
        const expected = totalDelta === 0 ? null : group.signed_delta / totalDelta;
        return expected === null
          ? group.change_share !== null
          : group.change_share === null || !near(group.change_share, expected);
      })
    ) {
      failures.push("CONTRIBUTION_SHARE_MISMATCH");
    }
  } else if (value.result_kind === "ROBUST_ANOMALY") {
    if (
      value.anomalies.some(
        ({ period_start }, index) =>
          index > 0 && period_start <= (value.anomalies[index - 1]?.period_start ?? ""),
      )
    ) {
      failures.push("ANOMALY_ORDER_INVALID");
    }
  } else if (value.result_kind === "ASSOCIATION_OUTLIER_COMPLETENESS") {
    const total = value.paired_sample_size + value.missing_pair_count;
    const expected = total === 0 ? 0 : value.paired_sample_size / total;
    if (!near(value.completeness_ratio, expected)) {
      failures.push("ASSOCIATION_COMPLETENESS_MISMATCH");
    }
  } else if (value.result_kind === "BASELINE_FORECAST_BACKTEST") {
    if (value.useful && (value.selected_model === null || value.mase === null || value.mase >= 1)) {
      failures.push("FORECAST_USEFULNESS_INVALID");
    }
  } else if (value.result_kind === "GENERATED_ANALYSIS" && value.oracle_scope !== "FULL") {
    return { verdict: "CANDIDATE_ONLY", failures: ["GENERATED_ORACLE_INSUFFICIENT"] };
  }
  return failures.length === 0 ? { verdict: "PASS", failures } : { verdict: "FAIL", failures };
}

export function verifyScaleMetamorphism(input: {
  baseline: unknown;
  scaled: unknown;
  factor: number;
}): boolean {
  const baseline = analysisResultSchema.safeParse(input.baseline);
  const scaled = analysisResultSchema.safeParse(input.scaled);
  if (
    !baseline.success ||
    !scaled.success ||
    baseline.data.result_kind !== "TREND_CHANGE" ||
    scaled.data.result_kind !== "TREND_CHANGE" ||
    baseline.data.points.length !== scaled.data.points.length
  ) {
    return false;
  }
  const baselineTrend = baseline.data;
  const scaledTrend = scaled.data;
  const endpointsScale =
    (baselineTrend.first_value === null
      ? scaledTrend.first_value === null
      : scaledTrend.first_value !== null &&
        near(scaledTrend.first_value, baselineTrend.first_value * input.factor)) &&
    (baselineTrend.last_value === null
      ? scaledTrend.last_value === null
      : scaledTrend.last_value !== null &&
        near(scaledTrend.last_value, baselineTrend.last_value * input.factor));
  return (
    endpointsScale &&
    baselineTrend.points.every((point, index) => {
      const transformed = scaledTrend.points[index];
      return (
        transformed?.period_start === point.period_start &&
        (point.value === null
          ? transformed.value === null
          : transformed.value !== null && near(transformed.value, point.value * input.factor)) &&
        (point.absolute_delta === null
          ? transformed.absolute_delta === null
          : transformed.absolute_delta !== null &&
            near(transformed.absolute_delta, point.absolute_delta * input.factor)) &&
        (point.relative_delta === null
          ? transformed.relative_delta === null
          : transformed.relative_delta !== null &&
            near(transformed.relative_delta, point.relative_delta))
      );
    })
  );
}
