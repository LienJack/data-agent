import {
  type BenchmarkAnalysisReport,
  type BenchmarkOracleFeedback,
  type SealedInsightBenchmarkCase,
  sha256ContentHash,
} from "@data-agent/contracts";

export const INSIGHTBENCH_ORACLE_VERSION = "insightbench-lexical-grounding@1.0.0";
export const INSIGHTBENCH_PASS_THRESHOLD = 0.225;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

function normalizedText(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizedText(value)
      .match(/[\p{L}\p{N}.%-]+/gu)
      ?.filter((token) => token.length > 1 && !STOPWORDS.has(token)) ?? [],
  );
}

function recall(expected: Set<string>, observed: Set<string>): number {
  if (expected.size === 0) return 1;
  let matches = 0;
  for (const token of expected) if (observed.has(token)) matches += 1;
  return matches / expected.size;
}

function reportText(report: BenchmarkAnalysisReport): string {
  return [
    report.summary,
    ...report.insights.flatMap((insight) => [
      insight.title,
      insight.finding,
      insight.evidence,
      insight.recommendation,
    ]),
  ].join("\n");
}

export interface InsightBenchOracleResult {
  readonly verdict: "PASS" | "FAIL";
  readonly normalized_score: number;
  readonly feedback: BenchmarkOracleFeedback;
}

export class InsightBenchRuleOracle {
  async evaluate(input: {
    readonly report: BenchmarkAnalysisReport;
    readonly sealed_case: SealedInsightBenchmarkCase;
  }): Promise<InsightBenchOracleResult> {
    const candidateText = reportText(input.report);
    const candidateTokens = tokens(candidateText);
    const summaryRecall = recall(tokens(input.sealed_case.reference_summary), candidateTokens);
    const insightMatches = input.sealed_case.reference_insights.filter(
      (insight) => recall(tokens(insight), candidateTokens) >= 0.5,
    ).length;
    const insightCoverage = insightMatches / input.sealed_case.reference_insights.length;
    const comparableValues = input.sealed_case.reference_values
      .map(normalizedText)
      .filter((value) => value.length > 0 && value.length <= 64);
    const normalizedCandidate = normalizedText(candidateText);
    const valueCoverage =
      comparableValues.length === 0
        ? 1
        : comparableValues.filter((value) => normalizedCandidate.includes(value)).length /
          comparableValues.length;
    const score = 0.45 * summaryRecall + 0.4 * insightCoverage + 0.15 * valueCoverage;
    const verdict = score >= INSIGHTBENCH_PASS_THRESHOLD ? "PASS" : "FAIL";
    const metricScores = {
      summary_lexical_recall: summaryRecall,
      planted_insight_coverage: insightCoverage,
      reference_value_coverage: valueCoverage,
      composite: score,
    };
    const feedbackDraft = {
      oracle_version: INSIGHTBENCH_ORACLE_VERSION,
      failure_type: verdict === "PASS" ? null : ("METRIC_BELOW_THRESHOLD" as const),
      public_message:
        verdict === "PASS"
          ? `规则评分 ${(score * 100).toFixed(1)}，达到冻结阈值 ${(INSIGHTBENCH_PASS_THRESHOLD * 100).toFixed(0)}。`
          : `规则评分 ${(score * 100).toFixed(1)}，低于冻结阈值 ${(INSIGHTBENCH_PASS_THRESHOLD * 100).toFixed(0)}；请扩大分群、交叉维度与数值证据覆盖。`,
      candidate_row_count: null,
      gold_row_count: null,
      candidate_column_count: null,
      gold_column_count: null,
      metric_scores: metricScores,
    };
    return {
      verdict,
      normalized_score: Math.round(score * 10_000) / 100,
      feedback: {
        ...feedbackDraft,
        oracle_receipt_hash: await sha256ContentHash(feedbackDraft),
      },
    };
  }
}
