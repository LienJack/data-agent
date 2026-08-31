import {
  type AnalysisResultContract,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import type { AnalysisContext } from "@data-agent/contracts/context";
import { z } from "zod";
import type { GovernedAnalysisInput } from "./governed-analysis-input.js";
import { evaluateMonthlyMeasure } from "./monthly-comparison-oracle.js";
import {
  compileMonthlyComparisonPlan,
  MONTHLY_COMPARISON_CONTRACT_ID,
  monthlyComparisonMeasureSchema,
} from "./monthly-comparison-planning.js";
import {
  evaluatePanelPeriodComparison,
  panelPeriodComparisonSchema,
  resolvePanelPeriodComparison,
} from "./monthly-panel-period-comparison.js";
import { compileMonthlyPanelPlan, MONTHLY_PANEL_CONTRACT_ID } from "./monthly-panel-planning.js";

const resultSchema = z.object({
  schema_version: z.literal("analysis-published-result@1.0.0"),
  contract_id: z.string(),
  contract_hash: z.string(),
  data: z.record(z.string(), z.unknown()),
});
const numberText = (value: number | null) =>
  value === null
    ? "缺失"
    : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rateText = (value: number | null, suffix = "%") => {
  if (value === null) return "未定义";
  if (!Number.isFinite(value * 100)) throw new TypeError("ANALYSIS_FINAL_NUMERIC_RANGE_INVALID");
  return `${(value * 100).toFixed(2)}${suffix}`;
};
const monthText = (value: string) => value.slice(0, 7);
const same = (left: unknown, right: unknown) => {
  if (canonicalizeJson(left) !== canonicalizeJson(right)) {
    throw new TypeError("ANALYSIS_FINAL_SOURCE_MISMATCH");
  }
};

/** Called after the stage's original FULL Oracle PASS. No question/name-based routing. */
export async function buildVerifiedMonthlySummary(input: {
  readonly result_document: unknown;
  readonly result_contract: AnalysisResultContract;
  readonly governed_inputs: readonly GovernedAnalysisInput[];
  readonly context: AnalysisContext;
  readonly run_id: string;
  readonly limitation_codes: readonly string[];
}): Promise<string | undefined> {
  const contractId = input.result_contract.contract_id;
  if (![MONTHLY_COMPARISON_CONTRACT_ID, MONTHLY_PANEL_CONTRACT_ID].includes(contractId)) {
    return undefined;
  }
  const source = input.governed_inputs[0];
  if (
    input.governed_inputs.length !== 1 ||
    !source ||
    source.query_evidence_ref.run_id !== input.run_id
  ) {
    throw new TypeError("ANALYSIS_FINAL_SOURCE_MISMATCH");
  }
  const planningInput = {
    context: input.context,
    query_evidence_ref: source.query_evidence_ref,
    query_evidence_document: await verifyProductTeamArtifactDocument(
      source.query_evidence_document,
    ),
  };
  const plan =
    contractId === MONTHLY_COMPARISON_CONTRACT_ID
      ? await compileMonthlyComparisonPlan(planningInput)
      : await compileMonthlyPanelPlan(planningInput);
  const rates = plan.shape.binding.columns.filter(
    (column) =>
      column.request_derivation?.interpretation.operator.kind === "PERIOD_COMPARISON_RATE",
  );
  // Other multi-measure analyses retain their existing explanation contract.
  if (!rates.length) return undefined;
  const rate = rates[0];
  const comparison = rate?.request_derivation?.period_comparison;
  const operator = rate?.request_derivation?.interpretation.operator;
  if (rates.length !== 1 || !rate || !comparison || operator?.kind !== "PERIOD_COMPARISON_RATE") {
    throw new TypeError("ANALYSIS_FINAL_SOURCE_MISMATCH");
  }
  const result = resultSchema.parse(input.result_document);
  same(result.contract_id, contractId);
  same(result.contract_hash, input.result_contract.contract_hash);
  same(result.contract_hash, plan.result_contract.contract_hash);
  same(result.data.observations, plan.shape.ordered_rows);
  same(result.data.claim_strength, "DESCRIPTIVE");
  const lines: string[] = [];
  if (contractId === MONTHLY_COMPARISON_CONTRACT_ID) {
    if (comparison.category_output !== null || comparison.time_output !== plan.shape.time_column) {
      throw new TypeError("ANALYSIS_FINAL_SOURCE_MISMATCH");
    }
    const field = plan.execution_contract.measure_fields.find(
      (measure) => measure.source_column === comparison.current_output,
    );
    if (!field) throw new TypeError("ANALYSIS_FINAL_SOURCE_MISMATCH");
    const measure = monthlyComparisonMeasureSchema.parse(result.data[field.field]);
    same(
      measure,
      evaluateMonthlyMeasure(
        plan.shape.ordered_rows,
        comparison.time_output,
        comparison.current_output,
      ),
    );
    lines.push(
      `月度同比：${monthText(measure.first_period)}至${monthText(measure.last_period)}，共12个完整月。`,
    );
    lines.push(
      `本期值从${monthText(measure.first_period)}的${numberText(measure.first_value)}变为${monthText(measure.last_period)}的${numberText(measure.last_value)}；首尾相对变化为${rateText(measure.relative_change)}。首尾变化不代表期间持续上升或下降。`,
    );
    const high = measure.highest[0],
      low = measure.lowest[0];
    if (high && low)
      lines.push(
        `已观测本期值的一个最高点为${monthText(high.period)}（${numberText(high.value)}），一个最低点为${monthText(low.period)}（${numberText(low.value)}）。`,
      );
    lines.push("逐月口径为本期值、上年同期值、同比增速；缺失值和未定义增速分别保留：");
    for (const row of plan.shape.ordered_rows) {
      lines.push(
        `${monthText(String(row[comparison.time_output]))}：${numberText(row[comparison.current_output] as number | null)}；${numberText(row[comparison.comparison_output] as number | null)}；${rateText(row[rate.output_name] as number | null)}。`,
      );
    }
  } else {
    const mapping = resolvePanelPeriodComparison(plan.shape.binding);
    if (!mapping) throw new TypeError("ANALYSIS_FINAL_SOURCE_MISMATCH");
    const totals = panelPeriodComparisonSchema.parse(result.data.period_comparison);
    same(totals, evaluatePanelPeriodComparison(mapping, plan.shape.ordered_rows));
    const first = totals.months[0],
      last = totals.months[11];
    if (!first || !last) throw new TypeError("ANALYSIS_FINAL_SOURCE_MISMATCH");
    lines.push(`分组同比：${monthText(first.period)}至${monthText(last.period)}，共12个完整月。`);
    lines.push(
      `按整体同比增速由低到高，列出至多3个下降月份（本期/同期整体值均可用且同期为正），本轮符合条件并入选${totals.largest_declines.length}个月。`,
    );
    for (const month of totals.largest_declines) {
      lines.push(
        `${monthText(month.period)}：本期${numberText(month.current_value)}，上年同期${numberText(month.comparison_value)}，同比${rateText(month.yoy_rate)}，绝对变化${numberText(month.absolute_change)}。`,
      );
      const negative = month.groups
        .filter((group) => group.contribution_to_total_growth < 0)
        .sort((a, b) => a.contribution_to_total_growth - b.contribution_to_total_growth)
        .slice(0, 3);
      lines.push("负向贡献最大的至多3类（完整分组见附表）：");
      for (const group of negative) {
        lines.push(
          `${JSON.stringify(group.group)}：本期${numberText(group.current_value)}，上年同期${numberText(group.comparison_value)}，绝对变化${numberText(group.absolute_change)}，组内同比${rateText(group.yoy_rate)}，对整体同比贡献${rateText(group.contribution_to_total_growth, "个百分点")}。`,
        );
      }
    }
    lines.push(
      "贡献为该组绝对变化除以整体同期值，按百分点展示，不是损失占比；月份按整体同比排序，不是环比或组内增速排序。",
    );
  }
  const unit = input.context.metrics.find(
    ({ metric_ref }) => metric_ref.node_id === operator.metric_id,
  )?.unit;
  lines.push(
    unit
      ? `数值保留发布单位标识${JSON.stringify(unit.unit_id)}、基准单位${JSON.stringify(unit.base_unit)}，不做换算；通用currency单位不确定具体币种。`
      : "数值单位未明确，不推断币种或换算。",
  );
  lines.push(
    "同比按（本期值－上年同期值）/上年同期值计算；一侧缺失或同期为0时未定义，不能把空值当0。完整数据表和图表为本轮来源附件。以上为描述性事实，不能证明因果。",
  );
  if (input.limitation_codes.length)
    lines.push(
      `本轮限制标识：${input.limitation_codes.join("、")}；限制按对应字段判断，不据此推断所有字段均缺失。`,
    );
  const summary = lines.join("\n\n");
  if (summary.length > 6_000 || new TextEncoder().encode(summary).byteLength > 18_000) {
    throw new TypeError("ANALYSIS_FINAL_SUMMARY_BUDGET_EXCEEDED");
  }
  return summary;
}
