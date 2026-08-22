import { type DerivedAnalysisEvidencePayload, sha256ContentHash } from "@data-agent/contracts";

export const DETERMINISTIC_ANALYSIS_ORACLE_VERSION =
  "deterministic-analysis-independent-oracle@1.0.0";

export type DeterministicAnalysisFixture =
  | {
      readonly fixture_id: string;
      readonly skill_id: "trend-change@1";
      readonly algorithm_version: string;
      readonly periods: readonly { readonly period_start: string; readonly value: number | null }[];
    }
  | {
      readonly fixture_id: string;
      readonly skill_id: "contribution-concentration@1";
      readonly algorithm_version: string;
      readonly groups: readonly {
        readonly group_key_hash: `sha256:${string}`;
        readonly baseline: number;
        readonly current: number;
      }[];
      readonly total_baseline: number;
      readonly total_current: number;
      readonly closure_tolerance: number;
    }
  | {
      readonly fixture_id: string;
      readonly skill_id: "robust-anomaly@1";
      readonly algorithm_version: string;
      readonly periods: readonly { readonly period_start: string; readonly value: number }[];
      readonly threshold: number;
      readonly minimum_samples: number;
    }
  | {
      readonly fixture_id: string;
      readonly skill_id: "association-outlier-completeness@1";
      readonly algorithm_version: string;
      readonly pairs: readonly {
        readonly left: number | null;
        readonly right: number | null;
      }[];
      readonly outlier_threshold: number;
    }
  | {
      readonly fixture_id: string;
      readonly skill_id: "baseline-forecast-backtest@1";
      readonly algorithm_version: string;
      readonly values: readonly number[];
      readonly horizon: number;
      readonly minimum_train: number;
      readonly backtest_hash: `sha256:${string}`;
    };

export interface DeterministicAnalysisOracleVerdict {
  readonly oracle_version: typeof DETERMINISTIC_ANALYSIS_ORACLE_VERSION;
  readonly fixture_id: string;
  readonly verdict: "PASS" | "FAIL";
  readonly score: number;
  readonly hard_failures: readonly string[];
  readonly expected_result_hash: `sha256:${string}`;
  readonly observed_result_hash: `sha256:${string}`;
  readonly oracle_receipt_hash: `sha256:${string}`;
}

export interface DeterministicAnalysisGateScore {
  readonly schema_version: "deterministic-analysis-gate-score@1.0.0";
  readonly verdict: "PASS" | "FAIL";
  readonly score: number;
  readonly required_case_count: number;
  readonly passed_case_count: number;
  readonly hard_failures: readonly string[];
  readonly scorecard_hash: `sha256:${string}`;
}

export async function scoreDeterministicAnalysisGate(input: {
  readonly required_case_ids: readonly string[];
  readonly verdicts: readonly {
    readonly fixture_id: string;
    readonly verdict: "PASS" | "FAIL";
    readonly score: number;
    readonly hard_failures: readonly string[];
  }[];
}): Promise<DeterministicAnalysisGateScore> {
  const byId = new Map(input.verdicts.map((verdict) => [verdict.fixture_id, verdict]));
  const failures = input.required_case_ids.flatMap((caseId) => {
    const verdict = byId.get(caseId);
    if (!verdict) return [`MISSING_REQUIRED_CASE:${caseId}`];
    if (verdict.verdict !== "PASS" || verdict.score !== 100) {
      return verdict.hard_failures.length > 0
        ? verdict.hard_failures.map((failure) => `${caseId}:${failure}`)
        : [`${caseId}:SCORE_BELOW_HARD_THRESHOLD`];
    }
    return [];
  });
  const passed = input.required_case_ids.filter((caseId) => {
    const verdict = byId.get(caseId);
    return verdict?.verdict === "PASS" && verdict.score === 100;
  }).length;
  const material = {
    schema_version: "deterministic-analysis-gate-score@1.0.0" as const,
    verdict: failures.length === 0 ? ("PASS" as const) : ("FAIL" as const),
    score:
      input.required_case_ids.length === 0 ? 0 : (passed / input.required_case_ids.length) * 100,
    required_case_count: input.required_case_ids.length,
    passed_case_count: passed,
    hard_failures: failures.sort(),
  };
  return { ...material, scorecard_hash: await sha256ContentHash(material) };
}

function finite(value: number) {
  if (!Number.isFinite(value)) throw new TypeError("ANALYSIS_ORACLE_NON_FINITE_INPUT");
  return value;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : (ordered[middle] ?? 0);
}

function averageRanks(values: readonly number[]) {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) =>
      left.value === right.value ? left.index - right.index : left.value - right.value,
    );
  const ranks = Array<number>(values.length);
  let cursor = 0;
  while (cursor < ordered.length) {
    let end = cursor + 1;
    while (end < ordered.length && ordered[end]?.value === ordered[cursor]?.value) end += 1;
    const rank = (cursor + 1 + end) / 2;
    for (let index = cursor; index < end; index += 1) {
      const source = ordered[index];
      if (source) ranks[source.index] = rank;
    }
    cursor = end;
  }
  return ranks;
}

function correlation(left: readonly number[], right: readonly number[]) {
  if (left.length < 2 || left.length !== right.length) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = (left[index] ?? 0) - leftMean;
    const rightDelta = (right[index] ?? 0) - rightMean;
    covariance += leftDelta * rightDelta;
    leftSquare += leftDelta ** 2;
    rightSquare += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquare * rightSquare);
  return denominator === 0 ? null : covariance / denominator;
}

export function computeDeterministicAnalysisGolden(
  fixture: DeterministicAnalysisFixture,
): DerivedAnalysisEvidencePayload["result"] {
  if (fixture.skill_id === "trend-change@1") {
    const byPeriod = new Map<string, number>();
    for (const { period_start, value } of fixture.periods) {
      if (value !== null) byPeriod.set(period_start, (byPeriod.get(period_start) ?? 0) + value);
    }
    const ordered = [...byPeriod].sort(([left], [right]) => left.localeCompare(right));
    let previous: number | null = null;
    const points = ordered.map(([period_start, value]) => {
      const prior = previous;
      const absolute = value === null || prior === null ? null : finite(value - prior);
      const relative =
        absolute === null || prior === null || prior === 0 ? null : finite(absolute / prior);
      if (value !== null) previous = value;
      return {
        period_start,
        value,
        absolute_delta: absolute,
        relative_delta: relative,
      };
    });
    const populated = ordered.map(([, value]) => value);
    return {
      result_kind: "TREND_CHANGE",
      points,
      first_value: populated[0] ?? null,
      last_value: populated.at(-1) ?? null,
    };
  }
  if (fixture.skill_id === "contribution-concentration@1") {
    const totalDelta = fixture.total_current - fixture.total_baseline;
    const groups = [...fixture.groups]
      .map((group) => {
        const signedDelta = group.current - group.baseline;
        return {
          ...group,
          signed_delta: finite(signedDelta),
          change_share: totalDelta === 0 ? null : finite(signedDelta / totalDelta),
        };
      })
      .sort(
        (left, right) =>
          Math.abs(right.signed_delta) - Math.abs(left.signed_delta) ||
          left.group_key_hash.localeCompare(right.group_key_hash),
      );
    const explained = groups.reduce((sum, group) => sum + group.signed_delta, 0);
    const mass = groups.reduce((sum, group) => sum + Math.abs(group.signed_delta), 0);
    return {
      result_kind: "CONTRIBUTION_CONCENTRATION",
      groups,
      residual: finite(totalDelta - explained),
      closure_tolerance: fixture.closure_tolerance,
      hhi:
        mass === 0
          ? null
          : finite(
              groups.reduce((sum, group) => sum + (Math.abs(group.signed_delta) / mass) ** 2, 0),
            ),
    };
  }
  if (fixture.skill_id === "robust-anomaly@1") {
    const periods = [...fixture.periods].sort((left, right) =>
      left.period_start.localeCompare(right.period_start),
    );
    const values = periods.map(({ value }) => value);
    const center = median(values);
    const mad = median(values.map((value) => Math.abs(value - center)));
    const scale = 1.4826 * mad;
    const anomalies = periods
      .map(({ period_start, value }) => ({
        period_start,
        observed: value,
        expected: center,
        robust_score: scale === 0 ? 0 : finite((value - center) / scale),
        direction: value >= center ? ("HIGH" as const) : ("LOW" as const),
      }))
      .filter(
        ({ robust_score }) =>
          values.length >= fixture.minimum_samples && Math.abs(robust_score) >= fixture.threshold,
      );
    return { result_kind: "ROBUST_ANOMALY", anomalies, sample_size: values.length };
  }
  if (fixture.skill_id === "association-outlier-completeness@1") {
    const complete = fixture.pairs.filter(
      (pair): pair is { readonly left: number; readonly right: number } =>
        pair.left !== null && pair.right !== null,
    );
    const left = complete.map((pair) => pair.left);
    const right = complete.map((pair) => pair.right);
    const leftCenter = median(left);
    const rightCenter = median(right);
    const leftMad = median(left.map((value) => Math.abs(value - leftCenter)));
    const rightMad = median(right.map((value) => Math.abs(value - rightCenter)));
    const outlierCount = complete.filter(
      ({ left: leftValue, right: rightValue }) =>
        (leftMad > 0 &&
          Math.abs((0.67448975 * (leftValue - leftCenter)) / leftMad) >=
            fixture.outlier_threshold) ||
        (rightMad > 0 &&
          Math.abs((0.67448975 * (rightValue - rightCenter)) / rightMad) >=
            fixture.outlier_threshold),
    ).length;
    return {
      result_kind: "ASSOCIATION_OUTLIER_COMPLETENESS",
      pearson_r: correlation(left, right),
      spearman_rho: correlation(averageRanks(left), averageRanks(right)),
      q_value: null,
      paired_sample_size: complete.length,
      missing_pair_count: fixture.pairs.length - complete.length,
      outlier_count: outlierCount,
      completeness_ratio: fixture.pairs.length === 0 ? 0 : complete.length / fixture.pairs.length,
    };
  }
  if (fixture.values.length < fixture.minimum_train + fixture.horizon || fixture.horizon < 1) {
    return {
      result_kind: "BASELINE_FORECAST_BACKTEST",
      selected_model: null,
      baseline_model: "last-value@1.0.0",
      horizon: fixture.horizon,
      mae: null,
      mase: null,
      useful: false,
      forecast_rows_ref: null,
      backtest_hash: fixture.backtest_hash,
    };
  }
  const errors: number[] = [];
  const baselineErrors: number[] = [];
  for (let index = fixture.minimum_train; index < fixture.values.length; index += 1) {
    const history = fixture.values.slice(0, index);
    const prediction = history.reduce((sum, value) => sum + value, 0) / history.length;
    const actual = fixture.values[index] ?? prediction;
    errors.push(Math.abs(actual - prediction));
    baselineErrors.push(Math.abs(actual - (fixture.values[index - 1] ?? actual)));
  }
  const mae = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const baselineMae = baselineErrors.reduce((sum, value) => sum + value, 0) / baselineErrors.length;
  const mase = baselineMae === 0 ? null : mae / baselineMae;
  const useful = mase !== null && mase < 1;
  return {
    result_kind: "BASELINE_FORECAST_BACKTEST",
    selected_model: useful ? "expanding-mean@1.0.0" : null,
    baseline_model: "last-value@1.0.0",
    horizon: fixture.horizon,
    mae,
    mase,
    useful,
    forecast_rows_ref: null,
    backtest_hash: fixture.backtest_hash,
  };
}

function equivalent(left: unknown, right: unknown, tolerance = 1e-9): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equivalent(value, right[index], tolerance))
    );
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord).sort();
    return (
      equivalent(keys, Object.keys(rightRecord).sort()) &&
      keys.every((key) => equivalent(leftRecord[key], rightRecord[key], tolerance))
    );
  }
  return Object.is(left, right);
}

export async function evaluateDeterministicAnalysis(input: {
  readonly fixture: DeterministicAnalysisFixture;
  readonly evidence: DerivedAnalysisEvidencePayload;
}): Promise<DeterministicAnalysisOracleVerdict> {
  const expected = computeDeterministicAnalysisGolden(input.fixture);
  const failures: string[] = [];
  if (input.evidence.skill_id !== input.fixture.skill_id) failures.push("SKILL_MISMATCH");
  if (input.evidence.algorithm_version !== input.fixture.algorithm_version) {
    failures.push("ALGORITHM_VERSION_MISMATCH");
  }
  if (!equivalent(expected, input.evidence.result)) failures.push("NUMERIC_OR_STRUCTURE_MISMATCH");
  if (
    input.evidence.quality.oracle_verdict !== "PASS" ||
    input.evidence.quality.deterministic_replay !== "PASS"
  ) {
    failures.push("EVIDENCE_QUALITY_NOT_PASS");
  }
  const material = {
    oracle_version:
      DETERMINISTIC_ANALYSIS_ORACLE_VERSION as typeof DETERMINISTIC_ANALYSIS_ORACLE_VERSION,
    fixture_id: input.fixture.fixture_id,
    verdict: failures.length === 0 ? ("PASS" as const) : ("FAIL" as const),
    score: failures.length === 0 ? 100 : 0,
    hard_failures: failures.sort(),
    expected_result_hash: await sha256ContentHash(expected),
    observed_result_hash: await sha256ContentHash(input.evidence.result),
  };
  return { ...material, oracle_receipt_hash: await sha256ContentHash(material) };
}
