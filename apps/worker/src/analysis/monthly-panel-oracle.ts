import {
  artifactReferenceFor,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisContext } from "@data-agent/contracts/context";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { resolveAnalysisEvidenceTimeWindow } from "./analysis-evidence-time-window.js";
import { createAnalysisOracleOutputClosure } from "./analysis-oracle-output-closure.js";
import type { AnalysisOraclePort } from "./executor.js";
import { verifyProductTeamQueryEvidenceInput } from "./governed-analysis-input.js";
import {
  evaluateMonthlyMeasure,
  MONTHLY_COMPARISON_ORACLE_MODULE_URL,
} from "./monthly-comparison-oracle.js";
import {
  evaluatePanelPeriodComparison,
  PANEL_PERIOD_COMPARISON_MODULE_URL,
  projectPanelPeriodComparisonCharts,
} from "./monthly-panel-period-comparison.js";
import {
  compileMonthlyPanelPlan,
  MONTHLY_PANEL_DECLINE_TABLE_ID,
  MONTHLY_PANEL_METHOD_ID,
  MONTHLY_PANEL_OVERALL_TABLE_ID,
  type MonthlyPanelPlan,
  monthlyPanelMeasureSchema,
  monthlyPanelOpposedChangesSchema,
} from "./monthly-panel-planning.js";
import {
  evaluatePanelRatioRollup,
  PANEL_RATIO_ROLLUP_MODULE_URL,
} from "./monthly-panel-ratio-rollup.js";

const IMPLEMENTATION_ID = "monthly-group-panel-oracle@2.0.0";
const { fail, same, sameScopeRun, outputOf, readJson, implementationCodeDigest } =
  createAnalysisOracleOutputClosure("MONTHLY_PANEL_ORACLE", import.meta.url, [
    MONTHLY_COMPARISON_ORACLE_MODULE_URL,
    PANEL_PERIOD_COMPARISON_MODULE_URL,
    PANEL_RATIO_ROLLUP_MODULE_URL,
  ]);

/** Only accepted source rows enter the arithmetic. Model results never supply expected values. */
function expectedPanelData(plan: MonthlyPanelPlan) {
  const fields = plan.execution_contract.measure_fields.map(
    ({ field, source_column }) =>
      [
        field,
        monthlyPanelMeasureSchema.parse({
          groups: plan.shape.groups.map(({ group, rows }) => ({
            group,
            ...evaluateMonthlyMeasure(rows, plan.shape.time_column, source_column),
          })),
        }),
      ] as const,
  );
  const pairs = plan.shape.groups.flatMap((_, groupIndex) =>
    fields.flatMap(([, increasing]) => {
      const up = increasing.groups[groupIndex];
      if (!up || up.absolute_change === null || up.absolute_change <= 0) return [];
      return fields.flatMap(([, decreasing]) => {
        const down = decreasing.groups[groupIndex];
        if (!down || down.absolute_change === null || down.absolute_change >= 0) return [];
        return [
          {
            group: up.group,
            increasing_column: up.source_column,
            decreasing_column: down.source_column,
            from_period: up.first_period,
            to_period: up.last_period,
            increasing_absolute_change: up.absolute_change,
            decreasing_absolute_change: down.absolute_change,
            increasing_relative_change: up.relative_change,
            decreasing_relative_change: down.relative_change,
          },
        ];
      });
    }),
  );
  const comparison = plan.execution_contract.period_comparison
    ? evaluatePanelPeriodComparison(
        plan.execution_contract.period_comparison,
        plan.shape.ordered_rows,
      )
    : null;
  const comparisonCharts =
    comparison && plan.execution_contract.period_comparison
      ? projectPanelPeriodComparisonCharts(plan.execution_contract.period_comparison, comparison)
      : null;
  return {
    data: {
      observations: plan.shape.ordered_rows,
      ...Object.fromEntries(fields),
      opposed_changes: monthlyPanelOpposedChangesSchema.parse({ pairs }),
      ...(plan.execution_contract.ratio_rollup_mapping
        ? {
            ratio_rollup: evaluatePanelRatioRollup(
              plan.execution_contract.ratio_rollup_mapping,
              plan.shape.ordered_rows,
            ),
          }
        : {}),
      ...(comparison
        ? {
            period_comparison: comparison,
            ...comparisonCharts,
          }
        : {}),
      claim_strength: "DESCRIPTIVE",
    },
    measures: fields.flatMap(([, measure]) => measure.groups),
  };
}

export function createMonthlyPanelOracle(context: AnalysisContext): AnalysisOraclePort {
  return Object.freeze({
    async evaluate(input: Parameters<AnalysisOraclePort["evaluate"]>[0]) {
      if (
        input.governed_inputs.length !== 1 ||
        input.node.skill_id !== "open-python-analysis@1" ||
        !same(input.node.method_registry_entry_ids, [MONTHLY_PANEL_METHOD_ID]) ||
        input.node.execution_mode !== "MODEL_GENERATED" ||
        input.node.generated_source_policy !== "OPEN_ANALYSIS" ||
        input.node.comparison_window !== null ||
        input.node.operator_obligations.length !== 0 ||
        input.sandbox_receipt.operator_registry_digest !== STATISTICAL_OPERATOR_REGISTRY_DIGEST ||
        input.sandbox_receipt.operator_obligations.length !== 0 ||
        input.sandbox_receipt.operator_receipts.length !== 0
      )
        return fail("SCOPE_INVALID");
      const governed = input.governed_inputs[0];
      if (governed?.name !== "query_evidence" || governed.format !== "ARROW")
        return fail("INPUT_INVALID");
      const document = await verifyProductTeamArtifactDocument(governed.query_evidence_document);
      const plan = await compileMonthlyPanelPlan({
        context,
        query_evidence_ref: governed.query_evidence_ref,
        query_evidence_document: document,
      });
      await verifyProductTeamQueryEvidenceInput({
        query_evidence_ref: governed.query_evidence_ref,
        query_evidence_document: document,
        arrow_content: governed.content,
        expected_row_count: plan.shape.ordered_rows.length,
        expected_ordered_columns: plan.shape.binding.columns.map((column) => column.output_name),
      });
      const contract = plan.result_contract;
      const expectedOutputCount = plan.execution_contract.period_comparison ? 6 : 3;
      if (
        input.sandbox_outputs.length !== expectedOutputCount ||
        !same(input.node.result_contract, contract) ||
        input.sandbox_receipt.result_contract_hash !== contract.contract_hash ||
        !same(
          input.node.time_window,
          resolveAnalysisEvidenceTimeWindow(plan.shape.binding, context),
        ) ||
        !same(input.node.dimension_refs, plan.shape.dimension_ids) ||
        !same(
          [...input.node.metric_refs].sort((a, b) => a.node_id.localeCompare(b.node_id)),
          [...context.metrics.map((metric) => metric.metric_ref)].sort((a, b) =>
            a.node_id.localeCompare(b.node_id),
          ),
        )
      )
        return fail("CONTRACT_CLOSURE_INVALID");
      for (const reference of [
        artifactReferenceFor("SensitiveExecutionArtifact").parse(governed.input_ref),
        artifactReferenceFor("AnalysisInputMaterializationReceipt").parse(
          governed.materialization_receipt_ref,
        ),
      ]) {
        if (!sameScopeRun(reference, governed.query_evidence_ref)) return fail("INPUT_INVALID");
      }
      const tableContract = contract.tables[0];
      if (!tableContract || contract.charts.length < 1) return fail("CONTRACT_CLOSURE_INVALID");
      const result = outputOf(
        input.sandbox_outputs,
        "result",
        "RESULT",
        governed.query_evidence_ref,
      );
      const expected = expectedPanelData(plan);
      if (
        !same(readJson(result), {
          schema_version: "analysis-published-result@1.0.0",
          contract_id: contract.contract_id,
          contract_hash: contract.contract_hash,
          semantic_context_hash: contract.semantic_context_hash,
          metrics: contract.metric_bindings,
          dimensions: contract.dimension_bindings,
          grain: contract.grain,
          lineage: contract.lineage,
          data: expected.data,
        })
      )
        return fail("RESULT_MISMATCH");
      const rowsByTableId = new Map<string, readonly Readonly<Record<string, unknown>>[]>([
        [tableContract.table_id, plan.shape.ordered_rows],
      ]);
      if (plan.execution_contract.period_comparison) {
        const overall = expected.data.overall_trend_rows;
        const declines = expected.data.largest_decline_group_rows;
        if (!overall || !declines) return fail("CONTRACT_CLOSURE_INVALID");
        rowsByTableId.set(MONTHLY_PANEL_OVERALL_TABLE_ID, overall);
        rowsByTableId.set(MONTHLY_PANEL_DECLINE_TABLE_ID, declines);
      }
      const tables = contract.tables.map((declared) => {
        const rows = rowsByTableId.get(declared.table_id);
        if (!rows) return fail("CONTRACT_CLOSURE_INVALID");
        const table = outputOf(
          input.sandbox_outputs,
          `table:${declared.table_id}`,
          "TABLE",
          governed.query_evidence_ref,
        );
        if (
          !same(readJson(table), {
            schema_version: "analysis-published-table@1.0.0",
            table_id: declared.table_id,
            title_zh: declared.title_zh,
            columns: declared.columns,
            rows,
            total_rows: rows.length,
          })
        )
          return fail("TABLE_MISMATCH");
        return { output: table, contract: declared, rows };
      });
      const declaredBindings = Array.isArray(plan.execution_contract.chart_bindings)
        ? plan.execution_contract.chart_bindings
        : [
            {
              chart_id: contract.charts[0]?.chart_id ?? fail("CONTRACT_CLOSURE_INVALID"),
              ...plan.execution_contract.chart_bindings,
            },
          ];
      const charts = contract.charts.map((declared) => {
        const table = tables.find((candidate) => candidate.contract.table_id === declared.table_id);
        const rawBinding = declaredBindings.find(
          (candidate) => candidate.chart_id === declared.chart_id,
        );
        const template = declared.allowed_template_ids[0];
        if (!table || !rawBinding || !template) return fail("CONTRACT_CLOSURE_INVALID");
        const { chart_id: _chartId, ...bindings } = rawBinding;
        const chart = outputOf(
          input.sandbox_outputs,
          `chart:${declared.chart_id}`,
          "CHART",
          governed.query_evidence_ref,
        );
        if (
          !same(readJson(chart), {
            schema_version:
              !("facet_field" in bindings) || bindings.facet_field === undefined
                ? "analysis-published-chart@1.0.0"
                : "analysis-published-chart@1.1.0",
            chart_id: declared.chart_id,
            title_zh: declared.title_zh,
            intent: declared.intent,
            template_id: template,
            bindings,
            dataset: {
              table_id: table.contract.table_id,
              columns: table.contract.columns,
              rows: table.rows,
              total_rows: table.rows.length,
            },
          })
        )
          return fail("CHART_MISMATCH");
        return chart;
      });
      const undefinedChange = expected.measures.some(
        (measure) =>
          measure.missing_count > 0 ||
          measure.relative_change === null ||
          measure.largest_drops.some((drop) => drop.relative_change === null),
      );
      return {
        result: {
          result_kind: "GENERATED_ANALYSIS" as const,
          declared_method: MONTHLY_PANEL_METHOD_ID,
          structured_output_refs: [
            result.reference,
            ...tables.map(({ output: table }) => table.reference),
            ...charts.map((chart) => chart.reference),
          ],
          oracle_scope: "FULL" as const,
        },
        sample_size: plan.shape.ordered_rows.length,
        coverage_ratio:
          expected.measures.reduce((sum, measure) => sum + measure.observed_count, 0) /
          (plan.shape.ordered_rows.length * plan.shape.measures.length),
        limitation_codes: undefinedChange ? ["RELATIVE_DELTA_UNDEFINED" as const] : [],
        material_change: false,
        implementation_id: IMPLEMENTATION_ID,
        implementation_hash: await sha256ContentHash({
          implementation_id: IMPLEMENTATION_ID,
          code_digest: await implementationCodeDigest(),
          execution_contract: plan.execution_contract,
        }),
        oracle_receipt: {
          schema_version: IMPLEMENTATION_ID,
          verdict: "PASS",
          query_evidence_ref: governed.query_evidence_ref,
          source_binding_hash: plan.shape.binding.binding_hash,
          contract_hash: contract.contract_hash,
          result_hash: result.content_sha256,
          table_hashes: tables.map(({ output: table }) => table.content_sha256),
          chart_hashes: charts.map((chart) => chart.content_sha256),
          claim_strength: "DESCRIPTIVE",
          no_inferential_or_causal_claim: true,
        },
      };
    },
  });
}

export const monthlyPanelOracleInternals = Object.freeze({ expectedPanelData });
