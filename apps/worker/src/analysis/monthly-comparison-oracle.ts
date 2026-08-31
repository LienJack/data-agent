import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type ArtifactReference,
  artifactReferenceFor,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisContext } from "@data-agent/contracts/context";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { resolveAnalysisEvidenceTimeWindow } from "./analysis-evidence-time-window.js";
import type { AnalysisBoundOutput, AnalysisOraclePort } from "./executor.js";
import { verifyProductTeamQueryEvidenceInput } from "./governed-analysis-input.js";
import {
  compileMonthlyComparisonPlan,
  MONTHLY_COMPARISON_METHOD_ID,
  type MonthlyComparisonPlan,
  monthlyComparisonMeasureSchema,
} from "./monthly-comparison-planning.js";

const IMPLEMENTATION_ID = "monthly-multi-measure-comparison-oracle@1.0.0";
let codeDigest: Promise<string> | undefined;
function implementationCodeDigest() {
  codeDigest ??= readFile(new URL(import.meta.url)).then(
    (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  );
  return codeDigest;
}

function fail(kind: string): never {
  throw new TypeError(`MONTHLY_COMPARISON_ORACLE_${kind}`);
}
function same(left: unknown, right: unknown) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}
function sameScopeRun(left: ArtifactReference, right: ArtifactReference) {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

function outputOf(
  outputs: readonly AnalysisBoundOutput[],
  name: string,
  kind: AnalysisBoundOutput["artifact_kind"],
  source: ArtifactReference,
) {
  const matches = outputs.filter(
    (item) => item.artifact_name === name && item.artifact_kind === kind,
  );
  const output = matches[0];
  if (
    matches.length !== 1 ||
    !output ||
    output.media_type !== "application/json" ||
    output.reference.artifact_type !== "SandboxResult" ||
    !sameScopeRun(output.reference, source) ||
    output.bytes !== output.content.byteLength ||
    output.reference.content_hash !== output.content_sha256 ||
    `sha256:${createHash("sha256").update(output.content).digest("hex")}` !== output.content_sha256
  )
    return fail("OUTPUT_CLOSURE_INVALID");
  return output;
}
function readJson(output: AnalysisBoundOutput): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output.content));
  } catch {
    return fail("OUTPUT_CLOSURE_INVALID");
  }
}

/** Independent Host arithmetic; no model output, result table, or chart is an input to this computation. */
function expectedMeasure(plan: MonthlyComparisonPlan, column: string) {
  const points = plan.shape.ordered_rows.map((row) => ({
    period: String(row[plan.shape.time_column]),
    value: typeof row[column] === "number" ? row[column] : null,
  }));
  const observed = points.filter(
    (point): point is { period: string; value: number } => point.value !== null,
  );
  const lowest = [...observed].sort(
    (left, right) => left.value - right.value || left.period.localeCompare(right.period),
  );
  const highest = [...observed].sort(
    (left, right) => right.value - left.value || left.period.localeCompare(right.period),
  );
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || observed.length === 0) return fail("INPUT_INVALID");
  const absoluteChange =
    first.value === null || last.value === null ? null : last.value - first.value;
  const changes = points
    .flatMap((point, index) => {
      const previous = points[index - 1];
      if (
        !previous ||
        previous.value === null ||
        point.value === null ||
        point.value >= previous.value
      )
        return [];
      const change = point.value - previous.value;
      return [
        {
          from_period: previous.period,
          to_period: point.period,
          absolute_change: change,
          relative_change: previous.value === 0 ? null : change / previous.value,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.absolute_change - right.absolute_change ||
        left.to_period.localeCompare(right.to_period),
    );
  const parsed = monthlyComparisonMeasureSchema.safeParse({
    source_column: column,
    observed_count: observed.length,
    missing_count: points.length - observed.length,
    minimum: lowest[0]?.value,
    maximum: highest[0]?.value,
    lowest: lowest.slice(0, 3),
    highest: highest.slice(0, 3),
    first_period: first.period,
    last_period: last.period,
    first_value: first.value,
    last_value: last.value,
    absolute_change: absoluteChange,
    relative_change:
      absoluteChange === null || first.value === null || first.value === 0
        ? null
        : absoluteChange / first.value,
    largest_drops: changes.slice(0, 3),
  });
  return parsed.success ? parsed.data : fail("NUMERIC_RANGE_INVALID");
}

export function createMonthlyComparisonOracle(context: AnalysisContext): AnalysisOraclePort {
  return Object.freeze({
    async evaluate(input: Parameters<AnalysisOraclePort["evaluate"]>[0]) {
      if (
        input.governed_inputs.length !== 1 ||
        input.sandbox_outputs.length !== 3 ||
        input.node.skill_id !== "open-python-analysis@1" ||
        !same(input.node.method_registry_entry_ids, [MONTHLY_COMPARISON_METHOD_ID]) ||
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
      const plan = await compileMonthlyComparisonPlan({
        context,
        query_evidence_ref: governed.query_evidence_ref,
        query_evidence_document: document,
      });
      await verifyProductTeamQueryEvidenceInput({
        query_evidence_ref: governed.query_evidence_ref,
        query_evidence_document: document,
        arrow_content: governed.content,
        expected_row_count: 12,
        expected_ordered_columns: plan.shape.binding.columns.map((column) => column.output_name),
      });
      const contract = plan.result_contract;
      if (
        !same(input.node.result_contract, contract) ||
        input.sandbox_receipt.result_contract_hash !== contract.contract_hash ||
        !same(
          input.node.time_window,
          resolveAnalysisEvidenceTimeWindow(plan.shape.binding, context),
        ) ||
        !same(input.node.dimension_refs, [plan.shape.time_dimension_id]) ||
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
      const chartContract = contract.charts[0];
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
      const data = {
        observations: plan.shape.ordered_rows,
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
          rows: plan.shape.ordered_rows,
          total_rows: 12,
        })
      )
        return fail("TABLE_MISMATCH");
      if (
        !same(readJson(chart), {
          schema_version: "analysis-published-chart@1.0.0",
          chart_id: chartContract.chart_id,
          title_zh: chartContract.title_zh,
          intent: "TREND",
          template_id: "line.multi-series@1",
          bindings: {
            x_field: plan.shape.time_column,
            y_fields: plan.shape.measures.map((column) => column.output_name),
            series_field: null,
            lower_bound_field: null,
            upper_bound_field: null,
          },
          dataset: {
            table_id: tableContract.table_id,
            columns: tableContract.columns,
            rows: plan.shape.ordered_rows,
            total_rows: 12,
          },
        })
      )
        return fail("CHART_MISMATCH");
      const undefinedChange = measures.some(
        ([, measure]) =>
          measure.relative_change === null ||
          measure.missing_count > 0 ||
          measure.largest_drops.some((drop) => drop.relative_change === null),
      );
      return {
        result: {
          result_kind: "GENERATED_ANALYSIS" as const,
          declared_method: MONTHLY_COMPARISON_METHOD_ID,
          structured_output_refs: [result.reference, table.reference, chart.reference],
          oracle_scope: "FULL" as const,
        },
        sample_size: 12,
        coverage_ratio:
          measures.reduce((total, [, measure]) => total + measure.observed_count, 0) /
          (12 * measures.length),
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
          table_hash: table.content_sha256,
          chart_hash: chart.content_sha256,
          claim_strength: "DESCRIPTIVE",
          no_inferential_or_causal_claim: true,
        },
      };
    },
  });
}

export const monthlyComparisonOracleInternals = Object.freeze({ expectedMeasure });
