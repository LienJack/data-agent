import { createHash } from "node:crypto";
import {
  type ArtifactReference,
  buildProductTeamArtifactDocument,
  type ProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  classifyEcommerceDirectQaIntent,
  compileEcommerceMonthlyOrderTrendSql,
  compileEcommerceSalesAnomalySql,
  compileEcommerceSalesReportSummarySql,
  ecommerceDirectQaInternals,
  renderEcommerceAnomalies,
  renderEcommerceTrend,
} from "@data-agent/evals/ecommerce-direct-qa";
import type { PostgresReadOnlyBenchmarkQueryExecutor } from "@data-agent/platform/sandbox";
import { hasRunExecutionContextProvenance } from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";

const { decimal: money, numeric } = ecommerceDirectQaInternals;

interface DirectQaRunReader {
  getRun(
    capability: unknown,
    input: { readonly run_id: string },
  ): Promise<PortResult<{ readonly question: string } | null>>;
}

interface DirectQaArtifactPort {
  commit(
    capability: unknown,
    lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"],
    document: ProductTeamArtifactDocument,
  ): Promise<PortResult<ArtifactReference>>;
}

class EcommerceDirectQaError extends Error {
  override readonly name = "EcommerceDirectQaError";
  constructor(readonly code: string) {
    super(code);
  }
}

function value<T>(result: PortResult<T>): T {
  if (!result.ok) throw new EcommerceDirectQaError(result.error.code);
  return result.value;
}

function identity(runId: string, purpose: string): string {
  const bytes = createHash("sha256")
    .update(`data-agent/ecommerce-direct-qa@1\0${runId}\0${purpose}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function resultRows(result: {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (null | string | number)[])[];
}): Record<string, null | string | number>[] {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column, index) => [column, row[index] ?? null])),
  );
}

function columnsFor(result: {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (null | string | number)[])[];
}) {
  return result.columns.map((key, index) => ({
    key,
    label: key,
    data_type: result.rows.some(
      (row) => numeric(row[index]) !== null && typeof row[index] !== "string",
    )
      ? ("NUMBER" as const)
      : ("STRING" as const),
  }));
}

export function createEcommerceDirectQaAdapter(dependencies: {
  readonly capability: unknown;
  readonly fallback: RunWorkflowExecutorPort;
  readonly runs: DirectQaRunReader;
  readonly artifacts: DirectQaArtifactPort;
  readonly sandbox: PostgresReadOnlyBenchmarkQueryExecutor;
  readonly now?: () => Date;
}): RunWorkflowExecutorPort {
  const now = dependencies.now ?? (() => new Date());

  return Object.freeze({
    async execute(
      execution: Parameters<RunWorkflowExecutorPort["execute"]>[0],
    ): Promise<import("../runs/run-worker-runner.js").RunExecutorResult> {
      try {
        if (!hasRunExecutionContextProvenance(execution.context)) {
          throw new EcommerceDirectQaError("RUN_EXECUTION_CONTEXT_NOT_TRUSTED");
        }
        const run = value(
          await dependencies.runs.getRun(dependencies.capability, {
            run_id: execution.lease.run_id,
          }),
        );
        if (!run) throw new EcommerceDirectQaError("RUN_NOT_FOUND");
        const intent = classifyEcommerceDirectQaIntent(run.question);
        if (!intent) {
          return dependencies.fallback.execute(execution);
        }
        const blockId = `ecommerce-direct-qa-${execution.lease.attempt_id}`;
        const emitDisplayEvent = execution.context.emitDisplayEvent;
        if (!emitDisplayEvent) {
          throw new EcommerceDirectQaError("RUN_DISPLAY_EVENT_PORT_REQUIRED");
        }
        value(
          await emitDisplayEvent({
            kind: "reasoning_started",
            key: "ecommerce.direct.qa.started",
            block_id: blockId,
            title: "电商基准分析",
          }),
        );

        const commit = async (input: {
          readonly artifact_type: "SqlArtifact" | "QueryEvidence" | "AnalysisReport";
          readonly profile_id:
            | "governed-text2sql-agent"
            | "semantic-management-agent"
            | "report-writing-agent";
          readonly purpose: string;
          readonly source_refs: readonly ArtifactReference[];
          readonly projection: ProductTeamArtifactDocument["projection"];
        }) => {
          const document = await buildProductTeamArtifactDocument({
            schema_version: "product-team-artifact@1.0.0",
            artifact_ref: {
              artifact_id: identity(
                execution.lease.run_id,
                `${input.purpose}:${input.artifact_type}`,
              ),
              artifact_type: input.artifact_type,
              ...execution.lease.scope,
              run_id: execution.lease.run_id,
              revision: 1,
              content_hash: `sha256:${"0".repeat(64)}`,
            },
            profile_id: input.profile_id,
            task_id: identity(execution.lease.run_id, `task:${input.purpose}`),
            source_refs: input.source_refs,
            projection: input.projection,
            committed_at: now().toISOString(),
          });
          return value(
            await dependencies.artifacts.commit(dependencies.capability, execution.lease, document),
          );
        };

        const query = async (purpose: string, sql: string) => {
          const sqlRef = await commit({
            artifact_type: "SqlArtifact",
            profile_id: "governed-text2sql-agent",
            purpose,
            source_refs: [],
            projection: { kind: "SQL", dialect: "postgresql", sql },
          });
          const result = await dependencies.sandbox.execute({
            sql,
            timeout_ms: 30_000,
            max_rows: 1_000,
          });
          const rows = resultRows(result);
          const evidenceRef = await commit({
            artifact_type: "QueryEvidence",
            profile_id: "governed-text2sql-agent",
            purpose,
            source_refs: [sqlRef],
            projection: {
              kind: "TABLE",
              columns: columnsFor(result),
              rows,
              total_rows: rows.length,
            },
          });
          return { evidenceRef, rows } as const;
        };

        let answer: string | null = null;
        if (intent === "TABLE_COUNT") {
          const result = await dependencies.sandbox.executeTableCount({ timeout_ms: 30_000 });
          const rows = resultRows(result);
          await commit({
            artifact_type: "QueryEvidence",
            profile_id: "governed-text2sql-agent",
            purpose: "table-count",
            source_refs: [],
            projection: {
              kind: "TABLE",
              columns: columnsFor(result),
              rows,
              total_rows: rows.length,
            },
          });
          answer = `当前受治理数据库共有 ${numeric(rows[0]?.table_count) ?? 0} 张已批准业务表。`;
        } else if (intent === "SALES_TREND") {
          const trend = await query("sales-trend", compileEcommerceMonthlyOrderTrendSql());
          answer = renderEcommerceTrend(trend.rows);
        } else if (intent === "SALES_ANOMALIES") {
          const anomalies = await query("sales-anomalies", compileEcommerceSalesAnomalySql());
          answer = renderEcommerceAnomalies(anomalies.rows);
        } else if (intent === "SALES_REPORT") {
          const [summary, trend, anomalies] = await Promise.all([
            query("sales-report-summary", compileEcommerceSalesReportSummarySql()),
            query("sales-report-trend", compileEcommerceMonthlyOrderTrendSql()),
            query("sales-report-anomalies", compileEcommerceSalesAnomalySql()),
          ]);
          const row = summary.rows[0] ?? {};
          const overview = `统计周期 ${String(row.period_start)} 至 ${String(row.period_end)}，共 ${numeric(row.total_orders) ?? 0} 单，销售额 ${money(numeric(row.total_sales_brl) ?? 0)} BRL，平均客单价 ${money(numeric(row.average_order_value_brl) ?? 0)} BRL。`;
          const delivery = `延迟订单 ${numeric(row.delayed_orders) ?? 0} 单，正延迟订单平均延迟 ${money(numeric(row.average_delay_days) ?? 0)} 天，最大延迟 ${money(numeric(row.maximum_delay_days) ?? 0)} 天；平均评价 ${money(numeric(row.average_review_score) ?? 0)} / 5。`;
          const trendText = renderEcommerceTrend(trend.rows);
          const anomalyText = renderEcommerceAnomalies(anomalies.rows);
          const sections = [
            { heading: "经营概览", body_text: overview, source_refs: [summary.evidenceRef] },
            { heading: "销售趋势", body_text: trendText, source_refs: [trend.evidenceRef] },
            {
              heading: "异常与质量",
              body_text: `${anomalyText}\n${delivery}`,
              source_refs: [anomalies.evidenceRef, summary.evidenceRef],
            },
            {
              heading: "建议",
              body_text:
                "优先核查超长配送订单；在趋势看板中标注不完整月份；对销售额绝对环比超过 50% 的月份结合促销、供给与数据覆盖进行复核。",
              source_refs: [trend.evidenceRef, anomalies.evidenceRef],
            },
          ];
          const reportRef = await commit({
            artifact_type: "AnalysisReport",
            profile_id: "report-writing-agent",
            purpose: "sales-report",
            source_refs: [summary.evidenceRef, trend.evidenceRef, anomalies.evidenceRef],
            projection: { kind: "REPORT", title: "销售数据分析报告", sections },
          });
          answer = [
            `# 销售数据分析报告`,
            ...sections.map((section) => `## ${section.heading}\n${section.body_text}`),
            `报告证据：${reportRef.artifact_id}`,
          ].join("\n\n");
        }

        if (answer === null) throw new EcommerceDirectQaError("ECOMMERCE_DIRECT_QA_UNSUPPORTED");
        value(
          await emitDisplayEvent({
            kind: "reasoning_completed",
            key: "ecommerce.direct.qa.completed",
            block_id: blockId,
            summary: "直接分析与证据提交已完成。",
            duration_ms: 0,
          }),
        );
        value(
          await emitDisplayEvent({
            kind: "answer_delta",
            key: "ecommerce.direct.qa.answer",
            delta: answer,
          }),
        );
        return { kind: "COMPLETED" };
      } catch (error) {
        const code =
          error instanceof EcommerceDirectQaError
            ? error.code
            : error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)
              ? error.message
              : "ECOMMERCE_DIRECT_QA_FAILED";
        return { kind: "FAILED", error_code: code };
      }
    },
  });
}
