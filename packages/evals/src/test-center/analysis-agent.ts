import { performance } from "node:perf_hooks";
import {
  type BenchmarkAgentDescriptor,
  type BenchmarkAnalysisReport,
  type BenchmarkOracleFeedback,
  type BenchmarkUsage,
  benchmarkAnalysisReportSchema,
  PROFILE_ANALYSIS_AGENT_ID,
  type PublicBenchmarkCase,
} from "@data-agent/contracts";
import { parseBenchmarkCsv } from "./csv.js";

/** Benchmark-only profiler. It has no governed QueryEvidence/Sandbox/Oracle closure. */
export const DETERMINISTIC_PROFILE_ANALYSIS_PRODUCTION_ELIGIBLE = false;

export interface BenchmarkAnalysisAgentAnswer {
  readonly report: BenchmarkAnalysisReport;
  readonly usage: BenchmarkUsage;
  readonly latency_ms: number;
}

export interface BenchmarkAnalysisAgentReflection {
  readonly diagnosis_summary: string;
  readonly proposed_actions: readonly string[];
  readonly confidence: number;
  readonly retry_recommendation: "APPROVED" | "REJECTED";
  readonly revised_answer: BenchmarkAnalysisAgentAnswer | null;
}

export interface BenchmarkAnalysisAgentInvocationContext {
  readonly run_id: string;
  readonly attempt_id: string;
  readonly attempt_index: 0 | 1;
  readonly timeout_ms: number;
  readonly max_output_tokens: number;
}

export interface BenchmarkAnalysisAgent {
  readonly descriptor: BenchmarkAgentDescriptor;
  answer(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly csv_text: string;
    readonly seed: number;
    readonly invocation: BenchmarkAnalysisAgentInvocationContext;
  }): Promise<BenchmarkAnalysisAgentAnswer>;
  reflect(input: {
    readonly test_case: PublicBenchmarkCase;
    readonly csv_text: string;
    readonly prior_report: BenchmarkAnalysisReport;
    readonly feedback: BenchmarkOracleFeedback;
    readonly seed: number;
    readonly invocation: BenchmarkAnalysisAgentInvocationContext;
  }): Promise<BenchmarkAnalysisAgentReflection>;
}

const zeroUsage: BenchmarkUsage = {
  availability: "UNAVAILABLE",
  input_tokens: null,
  output_tokens: null,
  tool_calls: null,
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function finiteNumbers(values: readonly string[]): readonly number[] {
  return values
    .filter((value) => value.trim().length > 0)
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function categoricalInsight(
  column: string,
  values: readonly string[],
): BenchmarkAnalysisReport["insights"][number] | null {
  const nonEmpty = values.filter((value) => value.trim().length > 0);
  const counts = new Map<string, number>();
  for (const value of nonEmpty) counts.set(value, (counts.get(value) ?? 0) + 1);
  if (counts.size < 2 || counts.size > 30 || nonEmpty.length === 0) return null;
  const ranked = [...counts.entries()].sort(
    ([leftValue, leftCount], [rightValue, rightCount]) =>
      rightCount - leftCount || leftValue.localeCompare(rightValue),
  );
  const [topValue, topCount] = ranked[0] ?? [];
  if (topValue === undefined || topCount === undefined) return null;
  const share = topCount / nonEmpty.length;
  return {
    title: `${column} distribution`,
    finding: `${column} is led by ${topValue}, representing ${topCount} of ${nonEmpty.length} rows (${percent(share)}).`,
    evidence: ranked
      .slice(0, 5)
      .map(([value, count]) => `${value}: ${count}`)
      .join("; "),
    recommendation:
      share >= 0.5
        ? `Investigate the operational cause of the concentration in ${topValue} and rebalance resources if it is undesirable.`
        : `Monitor the leading ${column} groups and compare their downstream outcomes.`,
  };
}

function numericInsight(
  column: string,
  values: readonly string[],
): BenchmarkAnalysisReport["insights"][number] | null {
  const numbers = finiteNumbers(values);
  if (numbers.length < Math.max(3, values.length * 0.9)) return null;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  return {
    title: `${column} numeric range`,
    finding: `${column} ranges from ${min} to ${max}, with a mean of ${mean.toFixed(2)} across ${numbers.length} rows.`,
    evidence: `min=${min}; mean=${mean.toFixed(2)}; max=${max}; count=${numbers.length}`,
    recommendation: `Review extreme ${column} values and segment them by the most relevant categorical fields.`,
  };
}

function dateInsight(
  column: string,
  values: readonly string[],
): BenchmarkAnalysisReport["insights"][number] | null {
  if (!/(?:^|_)(?:date|time|at|on)$/i.test(column)) return null;
  const dates = values
    .filter((value) => value.trim().length > 0)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  if (dates.length < Math.max(3, values.length * 0.8)) return null;
  const earliest = new Date(Math.min(...dates)).toISOString();
  const latest = new Date(Math.max(...dates)).toISOString();
  return {
    title: `${column} time coverage`,
    finding: `${column} spans from ${earliest} to ${latest} across ${dates.length} populated rows.`,
    evidence: `earliest=${earliest}; latest=${latest}; populated=${dates.length}`,
    recommendation: `Compare changes over this time window and inspect periods with unusual volume.`,
  };
}

function crossTabInsights(
  rows: readonly Readonly<Record<string, string>>[],
  columns: readonly string[],
): BenchmarkAnalysisReport["insights"] {
  const results: BenchmarkAnalysisReport["insights"] = [];
  for (let leftIndex = 0; leftIndex < columns.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < columns.length; rightIndex += 1) {
      const left = columns[leftIndex];
      const right = columns[rightIndex];
      if (!left || !right) continue;
      const counts = new Map<string, number>();
      for (const row of rows) {
        const leftValue = row[left]?.trim();
        const rightValue = row[right]?.trim();
        if (!leftValue || !rightValue) continue;
        const key = `${leftValue} ⇢ ${rightValue}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top || top[1] < Math.max(3, rows.length * 0.1)) continue;
      results.push({
        title: `${left} by ${right}`,
        finding: `The most common ${left}/${right} combination is ${top[0]} with ${top[1]} rows (${percent(top[1] / rows.length)}).`,
        evidence: `${top[0]}: ${top[1]} of ${rows.length}`,
        recommendation: `Investigate why this ${left}/${right} segment is concentrated and compare it with neighboring segments.`,
      });
      if (results.length >= 12) return results;
    }
  }
  return results;
}

function buildReport(csvText: string, extended: boolean): BenchmarkAnalysisReport {
  const csv = parseBenchmarkCsv(csvText);
  const categoricalColumns: string[] = [];
  const insights: BenchmarkAnalysisReport["insights"] = [];
  for (const header of csv.headers) {
    const values = csv.rows.map((row) => row[header] ?? "");
    const uniqueCount = new Set(values.filter(Boolean)).size;
    if (uniqueCount >= 2 && uniqueCount <= 30) categoricalColumns.push(header);
    const categorical = categoricalInsight(header, values);
    if (categorical) insights.push(categorical);
    const numeric = numericInsight(header, values);
    if (numeric) insights.push(numeric);
    const date = dateInsight(header, values);
    if (date) insights.push(date);
  }
  if (extended) insights.push(...crossTabInsights(csv.rows, categoricalColumns.slice(0, 8)));
  const selected = insights.slice(0, extended ? 48 : 20);
  if (selected.length === 0) {
    selected.push({
      title: "Dataset coverage",
      finding: `The dataset contains ${csv.rows.length} rows and ${csv.headers.length} columns.`,
      evidence: `rows=${csv.rows.length}; columns=${csv.headers.length}`,
      recommendation: "Add domain-specific transformations before drawing operational conclusions.",
    });
  }
  return benchmarkAnalysisReportSchema.parse({
    answer_type: "ANALYSIS_REPORT",
    summary: `Profiled ${csv.rows.length} rows across ${csv.headers.length} columns and produced ${selected.length} evidence-backed findings${extended ? ", including cross-segment checks" : ""}.`,
    insights: selected,
  });
}

export class DeterministicProfileAnalysisAgent implements BenchmarkAnalysisAgent {
  readonly descriptor: BenchmarkAgentDescriptor = {
    agent_id: PROFILE_ANALYSIS_AGENT_ID,
    agent_version: "deterministic-profile-analysis@1.0.0",
    display_name: "Local profiling analysis agent",
    kind: "DETERMINISTIC_ANALYSIS_BASELINE",
    provider: "local",
    model_id: null,
    available: true,
    unavailable_reason: null,
    supports_reflection: true,
  };

  async answer(input: { readonly csv_text: string }): Promise<BenchmarkAnalysisAgentAnswer> {
    const started = performance.now();
    return {
      report: buildReport(input.csv_text, false),
      usage: zeroUsage,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  async reflect(input: {
    readonly csv_text: string;
    readonly feedback: BenchmarkOracleFeedback;
  }): Promise<BenchmarkAnalysisAgentReflection> {
    const started = performance.now();
    const report = buildReport(input.csv_text, true);
    return {
      diagnosis_summary: `首答未达到冻结阈值；基于 Oracle 的非泄漏指标反馈（${input.feedback.public_message}）扩大了分群与交叉分析覆盖。`,
      proposed_actions: ["保留原始数据与问题不变。", "增加低基数维度的交叉分群检查。"],
      confidence: 0.8,
      retry_recommendation: "APPROVED",
      revised_answer: {
        report,
        usage: zeroUsage,
        latency_ms: Math.max(0, Math.round(performance.now() - started)),
      },
    };
  }
}
