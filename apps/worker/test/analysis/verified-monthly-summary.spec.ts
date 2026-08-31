import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { describe, expect, it } from "vitest";
import {
  analysisFinalResponseSchema,
  assertAnalysisFinalSummary,
} from "../../src/analysis/analysis-final-response.js";
import type { GovernedAnalysisInput } from "../../src/analysis/governed-analysis-input.js";
import { evaluateMonthlyMeasure } from "../../src/analysis/monthly-comparison-oracle.js";
import { compileMonthlyComparisonPlan } from "../../src/analysis/monthly-comparison-planning.js";
import {
  evaluatePanelPeriodComparison,
  resolvePanelPeriodComparison,
} from "../../src/analysis/monthly-panel-period-comparison.js";
import { compileMonthlyPanelPlan } from "../../src/analysis/monthly-panel-planning.js";
import { buildVerifiedMonthlySummary } from "../../src/analysis/verified-monthly-summary.js";
import { monthlyComparisonFixture } from "./support/monthly-comparison-fixture.js";
import { monthlyPeriodPanelFixture } from "./support/monthly-panel-fixture.js";

async function fixture(variant = "default") {
  const source = await monthlyComparisonFixture();
  const draft = structuredClone(source.document);
  if (draft.provenance?.kind !== "GOVERNED_QUERY_RESULT") throw new Error("QUERY_REQUIRED");
  const binding = draft.provenance.semantic_binding;
  const rate = binding.columns.find((column) => column.output_name === "rate");
  if (!rate?.request_derivation) throw new Error("RATE_REQUIRED");
  rate.request_derivation.period_comparison = {
    time_output: "month",
    current_output: "current",
    comparison_output: "prior",
    category_output: null,
    group_coverage: "CURRENT_PERIOD_GROUPS",
  };
  if (variant === "aliases") {
    const rename: Record<string, string> = {
      current: "prior_label",
      prior: "current_label",
      rate: "speed",
    };
    rate.request_derivation.period_comparison.current_output = "prior_label";
    rate.request_derivation.period_comparison.comparison_output = "current_label";
    binding.columns = binding.columns.map((column) => ({
      ...column,
      output_name: rename[column.output_name] ?? column.output_name,
    }));
    if (draft.projection.kind !== "TABLE") throw new Error("TABLE_REQUIRED");
    draft.projection.columns = draft.projection.columns.map((column) => ({
      ...column,
      key: rename[column.key] ?? column.key,
    }));
    draft.projection.rows = draft.projection.rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [rename[key] ?? key, value])),
    );
  }
  if (variant === "datetime") {
    binding.columns = binding.columns.map((column) =>
      column.output_name === "month" ? { ...column, logical_type: "DATETIME" } : column,
    );
    if (draft.projection.kind !== "TABLE") throw new Error("TABLE_REQUIRED");
    draft.projection.rows = draft.projection.rows.map((row) => ({
      ...row,
      month: new Date(`${row.month}T00:00:00+08:00`).toISOString(),
    }));
  }
  if (variant.startsWith("unit-")) {
    const { context_hash: _contextHash, ...context } = source.context;
    source.context = await buildAnalysisContext({
      ...context,
      metrics: context.metrics.map((metric) => ({
        ...metric,
        unit:
          variant === "unit-null"
            ? null
            : {
                unit_id: "unit.currency",
                dimension: "currency",
                base_unit: "currency",
                conversion_factor: 1,
              },
      })),
    });
  }
  const { binding_hash: _bindingHash, ...material } = binding;
  draft.provenance.semantic_binding = await buildQueryEvidenceSemanticBinding(material);
  source.document = await buildProductTeamArtifactDocument(draft);
  source.reference = { ...source.document.artifact_ref, artifact_type: "QueryEvidence" };
  const plan = await compileMonthlyComparisonPlan({
    context: source.context,
    query_evidence_ref: source.reference,
    query_evidence_document: source.document,
  });
  return {
    context: source.context,
    run_id: source.reference.run_id,
    result_contract: plan.result_contract,
    governed_inputs: [
      {
        query_evidence_ref: source.reference,
        query_evidence_document: source.document,
      } as GovernedAnalysisInput,
    ],
    limitation_codes: ["RELATIVE_DELTA_UNDEFINED"],
    result_document: {
      schema_version: "analysis-published-result@1.0.0",
      contract_id: plan.result_contract.contract_id,
      contract_hash: plan.result_contract.contract_hash,
      data: {
        observations: plan.shape.ordered_rows,
        claim_strength: "DESCRIPTIVE",
        ...Object.fromEntries(
          plan.execution_contract.measure_fields.map(({ field, source_column }) => [
            field,
            evaluateMonthlyMeasure(plan.shape.ordered_rows, plan.shape.time_column, source_column),
          ]),
        ),
      },
    },
  };
}

describe("verified monthly factual summary", () => {
  it("uses accepted overall YoY and contribution roles even when source aliases resemble spend/revenue", async () => {
    const source = await monthlyPeriodPanelFixture();
    const draft = structuredClone(source.document);
    if (draft.projection.kind !== "TABLE") throw new Error("TABLE_REQUIRED");
    draft.projection.rows = draft.projection.rows.map((row) => {
      const month = Number(String(row.month).slice(5, 7));
      const prior = 300,
        current = [8, 9, 10].includes(month) ? 100 + (month - 8) * 20 : 400;
      return { ...row, spend: prior, revenue: current, return_rate: (current - prior) / prior };
    });
    const document = await buildProductTeamArtifactDocument(draft);
    if (document.artifact_ref.artifact_type !== "QueryEvidence") throw new Error("QUERY_REQUIRED");
    const plan = await compileMonthlyPanelPlan({
      context: source.context,
      query_evidence_ref: document.artifact_ref,
      query_evidence_document: document,
    });
    const mapping = resolvePanelPeriodComparison(plan.shape.binding);
    if (!mapping) throw new Error("COMPARISON_REQUIRED");
    const data = {
      observations: plan.shape.ordered_rows,
      claim_strength: "DESCRIPTIVE",
      period_comparison: evaluatePanelPeriodComparison(mapping, plan.shape.ordered_rows),
    };
    const input = {
      context: source.context,
      run_id: document.artifact_ref.run_id,
      result_contract: plan.result_contract,
      limitation_codes: [],
      governed_inputs: [
        {
          query_evidence_ref: document.artifact_ref,
          query_evidence_document: document,
        } as GovernedAnalysisInput,
      ],
      result_document: {
        schema_version: "analysis-published-result@1.0.0",
        contract_id: plan.result_contract.contract_id,
        contract_hash: plan.result_contract.contract_hash,
        data,
      },
    };
    const text = await buildVerifiedMonthlySummary(input);
    expect(text).toContain("2024-08：本期200.00，上年同期600.00，同比-66.67%");
    expect(text).toContain("对整体同比贡献-33.33个百分点");
    expect(text).toContain("不是损失占比");
    expect(text).toContain("本轮符合条件并入选3个月");
    data.period_comparison.largest_declines.reverse();
    await expect(buildVerifiedMonthlySummary(input)).rejects.toThrow(
      "ANALYSIS_FINAL_SOURCE_MISMATCH",
    );
  });
  it("keeps explicit calendar/value pairs, missing prior, observed zero and source unit", async () => {
    const input = await fixture(),
      before = structuredClone(input);
    const text = await buildVerifiedMonthlySummary(input);
    expect(text).toContain("2024-01至2024-12");
    expect(text).toContain("2024-01：120.00；缺失；未定义");
    expect(text).toContain("2024-07：0.00；100.00；-100.00%");
    expect(text).toContain("2024-12：140.00；100.00；40.00%");
    expect(text).toContain("首尾变化不代表期间持续上升或下降");
    expect(text).toContain('基准单位"CNY"');
    expect(text).toContain("RELATIVE_DELTA_UNDEFINED");
    expect(text).not.toContain("持续为负");
    expect(input).toEqual(before);
  });

  it.each(["aliases", "datetime", "unit-null", "unit-generic"])(
    "preserves source meaning for %s",
    async (variant) => {
      const input = await fixture(variant),
        original = structuredClone(input);
      const text = await buildVerifiedMonthlySummary(input);
      expect(text).toContain("2024-07：0.00；100.00；-100.00%");
      expect(text).toContain("2024-12：140.00；100.00；40.00%");
      if (variant === "unit-null") expect(text).toContain("数值单位未明确");
      if (variant === "unit-generic") {
        expect(text).toContain("不确定具体币种");
        expect(text).not.toContain("CNY");
      }
      expect(input).toEqual(original);
    },
  );

  it.each(["contract", "run", "observations", "measure"])(
    "rejects %s drift before a final response",
    async (kind) => {
      const input = await fixture();
      if (kind === "contract") input.result_document.contract_hash = `sha256:${"f".repeat(64)}`;
      if (kind === "run") input.run_id = "other-run";
      if (kind === "observations") input.result_document.data.observations = [];
      if (kind === "measure") Object.assign(input.result_document.data, { measure_1: {} });
      await expect(buildVerifiedMonthlySummary(input)).rejects.toThrow();
    },
  );

  it("does not add an alternate summary path to unrelated contracts", async () => {
    const input = await fixture();
    input.result_contract = { ...input.result_contract, contract_id: "other.result" };
    await expect(buildVerifiedMonthlySummary(input)).resolves.toBeUndefined();
  });

  it("narrows the original two-field final schema per request without replacing provider text", async () => {
    const text = await buildVerifiedMonthlySummary(await fixture());
    if (!text) throw new Error("SUMMARY_REQUIRED");
    const response = { schema_version: "analysis-agent-final@1.0.0", summary_zh: text };
    expect(analysisFinalResponseSchema(text).parse(response)).toEqual(response);
    expect(
      analysisFinalResponseSchema(text).safeParse({ ...response, summary_zh: "下半年同比持续为负" })
        .success,
    ).toBe(false);
    expect(() => assertAnalysisFinalSummary("下半年同比持续为负", text)).toThrow(
      "ANALYSIS_FINAL_SUMMARY_CONSTRAINT_MISMATCH",
    );
    expect(() => assertAnalysisFinalSummary(text, text)).not.toThrow();
    expect(
      analysisFinalResponseSchema().safeParse({ ...response, summary_zh: "旧协议仍可解释。" })
        .success,
    ).toBe(true);
    expect(
      analysisFinalResponseSchema(text).safeParse({ ...response, limitations: [] }).success,
    ).toBe(false);
    expect(() => analysisFinalResponseSchema(" ")).toThrow();
  });
});
