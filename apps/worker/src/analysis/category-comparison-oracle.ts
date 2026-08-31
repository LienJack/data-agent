import {
  artifactReferenceFor,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisContext } from "@data-agent/contracts/context";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { createAnalysisOracleOutputClosure } from "./analysis-oracle-output-closure.js";
import {
  CATEGORY_COMPARISON_METHOD_ID,
  type CategoryComparisonPlan,
  categoryComparisonMeasureSchema,
  compileCategoryComparisonPlan,
} from "./category-comparison-planning.js";
import type { AnalysisOraclePort } from "./executor.js";
import { verifyProductTeamQueryEvidenceInput } from "./governed-analysis-input.js";

const IMPLEMENTATION_ID = "category-multi-measure-comparison-oracle@1.0.0";
const { fail, same, sameScopeRun, outputOf, readJson, implementationCodeDigest } =
  createAnalysisOracleOutputClosure("CATEGORY_COMPARISON_ORACLE", import.meta.url);

/** Independent descriptive arithmetic on source rows, never on the model's result/table/chart. */
function expectedMeasure(plan: CategoryComparisonPlan, column: string) {
  const observed = plan.shape.rows.flatMap((row, index) => {
    const value = row[column];
    if (value === null) return [];
    if (typeof value !== "number" || !Number.isFinite(value)) return fail("INPUT_INVALID");
    return [
      {
        source_row_index: index,
        value,
        group: Object.fromEntries(plan.shape.dimension_columns.map((name) => [name, row[name]])),
      },
    ];
  });
  const lowest = [...observed].sort(
    (a, b) => a.value - b.value || a.source_row_index - b.source_row_index,
  );
  const highest = [...observed].sort(
    (a, b) => b.value - a.value || a.source_row_index - b.source_row_index,
  );
  return categoryComparisonMeasureSchema.parse({
    source_column: column,
    observed_count: observed.length,
    missing_count: plan.shape.rows.length - observed.length,
    minimum: lowest[0]?.value,
    maximum: highest[0]?.value,
    lowest: lowest.slice(0, 3),
    highest: highest.slice(0, 3),
  });
}

export function createCategoryComparisonOracle(context: AnalysisContext): AnalysisOraclePort {
  return Object.freeze({
    async evaluate(input: Parameters<AnalysisOraclePort["evaluate"]>[0]) {
      if (
        input.governed_inputs.length !== 1 ||
        input.sandbox_outputs.length !== 3 ||
        input.node.skill_id !== "open-python-analysis@1" ||
        !same(input.node.method_registry_entry_ids, [CATEGORY_COMPARISON_METHOD_ID]) ||
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
      const plan = await compileCategoryComparisonPlan({
        context,
        query_evidence_ref: governed.query_evidence_ref,
        query_evidence_document: document,
      });
      await verifyProductTeamQueryEvidenceInput({
        query_evidence_ref: governed.query_evidence_ref,
        query_evidence_document: document,
        arrow_content: governed.content,
        expected_row_count: plan.shape.rows.length,
        expected_ordered_columns: plan.shape.binding.columns.map((column) => column.output_name),
      });
      const contract = plan.result_contract;
      if (
        !same(input.node.result_contract, contract) ||
        input.sandbox_receipt.result_contract_hash !== contract.contract_hash ||
        !same(input.node.time_window, plan.shape.time_window) ||
        !same(input.node.dimension_refs, plan.shape.dimension_ids) ||
        !same(
          [...input.node.metric_refs].sort((a, b) => a.node_id.localeCompare(b.node_id)),
          context.metrics
            .map((metric) => metric.metric_ref)
            .sort((a, b) => a.node_id.localeCompare(b.node_id)),
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
      const tableContract = contract.tables[0],
        chartContract = contract.charts[0];
      if (!tableContract || !chartContract) return fail("CONTRACT_CLOSURE_INVALID");
      const result = outputOf(
        input.sandbox_outputs,
        "result",
        "RESULT",
        governed.query_evidence_ref,
      );
      const table = outputOf(
        input.sandbox_outputs,
        `table:${tableContract.table_id}`,
        "TABLE",
        governed.query_evidence_ref,
      );
      const chart = outputOf(
        input.sandbox_outputs,
        `chart:${chartContract.chart_id}`,
        "CHART",
        governed.query_evidence_ref,
      );
      const measures = plan.execution_contract.measure_fields.map(
        ({ field, source_column }) => [field, expectedMeasure(plan, source_column)] as const,
      );
      const rows = plan.shape.rows;
      const data = {
        observations: rows,
        ...Object.fromEntries(measures),
        claim_strength: "DESCRIPTIVE",
      };
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
          data,
        })
      )
        return fail("RESULT_MISMATCH");
      if (
        !same(readJson(table), {
          schema_version: "analysis-published-table@1.0.0",
          table_id: tableContract.table_id,
          title_zh: tableContract.title_zh,
          columns: tableContract.columns,
          rows,
          total_rows: rows.length,
        })
      )
        return fail("TABLE_MISMATCH");
      if (
        !same(readJson(chart), {
          schema_version: "analysis-published-chart@1.0.0",
          chart_id: chartContract.chart_id,
          title_zh: chartContract.title_zh,
          intent: "COMPARISON",
          template_id: "bar.grouped@1",
          bindings: plan.execution_contract.chart_bindings,
          dataset: {
            table_id: tableContract.table_id,
            columns: tableContract.columns,
            rows,
            total_rows: rows.length,
          },
        })
      )
        return fail("CHART_MISMATCH");
      return {
        result: {
          result_kind: "GENERATED_ANALYSIS" as const,
          declared_method: CATEGORY_COMPARISON_METHOD_ID,
          structured_output_refs: [result.reference, table.reference, chart.reference],
          oracle_scope: "FULL" as const,
        },
        sample_size: rows.length,
        coverage_ratio:
          measures.reduce((total, [, measure]) => total + measure.observed_count, 0) /
          (rows.length * measures.length),
        limitation_codes: [],
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
          table_hash: table.content_sha256,
          chart_hash: chart.content_sha256,
          claim_strength: "DESCRIPTIVE",
          no_inferential_or_causal_claim: true,
        },
      };
    },
  });
}
