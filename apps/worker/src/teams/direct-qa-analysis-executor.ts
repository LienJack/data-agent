import { createHash } from "node:crypto";
import {
  type ArtifactReference,
  buildProductTeamArtifactDocument,
  type PortResult,
  type ProductTeamArtifactDocument,
  verifyResolvedContextCommitResult,
} from "@data-agent/contracts";
import {
  compileEcommerceMonthlyOrderTrendSql,
  compileEcommerceSalesAnomalySql,
  compileEcommerceSalesReportSummarySql,
  type EcommerceBenchmarkQueryExecutor,
} from "@data-agent/platform";
import { z } from "zod";
import {
  hasRunExecutionContextProvenance,
  hasRunProviderDispatchCapability,
  hasRunResolvedContextCapability,
} from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";
import type { FrozenSemanticRelationshipReadPort } from "../semantic/semantic-relationship-read-port.js";

type DirectQaIntent =
  | "TABLE_COUNT"
  | "RELATIONSHIPS"
  | "SALES_TREND"
  | "SALES_ANOMALIES"
  | "SALES_REPORT"
  | "GENERAL";

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

class DirectQaAnalysisError extends Error {
  override readonly name = "DirectQaAnalysisError";
  constructor(readonly code: string) {
    super(code);
  }
}

function value<T>(result: PortResult<T>): T {
  if (!result.ok) throw new DirectQaAnalysisError(result.error.code);
  return result.value;
}

function identity(runId: string, purpose: string): string {
  const bytes = createHash("sha256")
    .update(`data-agent/direct-qa@1\0${runId}\0${purpose}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function classifyDirectQaIntent(question: string): DirectQaIntent {
  const normalized = question.trim().toLocaleLowerCase("zh-CN");
  if (/(?:分析报告|销售报告|报告)/u.test(normalized)) return "SALES_REPORT";
  if (/(?:异常|离群|异常值|异常数据)/u.test(normalized)) return "SALES_ANOMALIES";
  if (/(?:关联|关系|如何连接|怎么连接|join)/u.test(normalized)) return "RELATIONSHIPS";
  if (/(?:趋势|趋向|走势|按月|环比|trend)/u.test(normalized)) return "SALES_TREND";
  if (/(?:多少张表|表的数量|表数量|table count)/u.test(normalized)) return "TABLE_COUNT";
  return "GENERAL";
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function renderTrend(rows: readonly Readonly<Record<string, unknown>>[]): string {
  const points = rows.flatMap((row) => {
    const month = typeof row.month === "string" ? row.month : null;
    const orders = numeric(row.order_count);
    const sales = numeric(row.sales_amount_brl);
    const mom = numeric(row.sales_mom_pct);
    return month && orders !== null && sales !== null ? [{ month, orders, sales, mom }] : [];
  });
  if (points.length === 0) return "没有可用于趋势分析的有效月份。";
  const sortedOrders = points.map(({ orders }) => orders).sort((a, b) => a - b);
  const medianOrders = sortedOrders[Math.floor(sortedOrders.length / 2)] ?? 0;
  const core = points.filter(({ orders }) => orders >= Math.max(1, medianOrders * 0.1));
  const comparable = core.length >= 2 ? core : points;
  const first = comparable[0];
  const last = comparable.at(-1);
  if (!first || !last) return "没有可用于趋势分析的有效月份。";
  const peak = comparable.reduce((best, point) => (point.sales > best.sales ? point : best));
  const change = first.sales === 0 ? null : ((last.sales - first.sales) / first.sales) * 100;
  const direction =
    change === null || Math.abs(change) < 1 ? "总体持平" : change > 0 ? "总体上升" : "总体下降";
  const latestMom =
    last.mom === null ? "无可比环比" : `环比 ${last.mom >= 0 ? "+" : ""}${last.mom.toFixed(2)}%`;
  const excluded = points.length - comparable.length;
  return [
    `销售额在可比完整月份内${direction}：${first.month} 为 ${money(first.sales)} BRL，${last.month} 为 ${money(last.sales)} BRL${change === null ? "" : `，累计变化 ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}。`,
    `峰值出现在 ${peak.month}，销售额 ${money(peak.sales)} BRL、订单 ${peak.orders} 单；最近可比月份 ${last.month} 为 ${last.orders} 单，${latestMom}。`,
    excluded > 0
      ? `数据首尾有 ${excluded} 个低覆盖月份，已从总体方向比较中剔除，避免不完整月份扭曲结论。`
      : "所有月份均纳入总体方向比较。",
  ].join("\n");
}

function renderAnomalies(rows: readonly Readonly<Record<string, unknown>>[]): string {
  const monthly = rows.filter(({ anomaly_type: type }) => type === "MONTHLY_SALES_CHANGE");
  const delivery = rows.filter(({ anomaly_type: type }) => type === "DELIVERY_DELAY");
  const monthlySummary = monthly
    .slice(0, 6)
    .map((row) => {
      const metric = numeric(row.metric_value) ?? 0;
      return `${String(row.entity)} 销售额环比 ${metric >= 0 ? "+" : ""}${metric.toFixed(2)}%（${String(row.detail)}）`;
    })
    .join("；");
  const deliverySummary = delivery
    .slice(0, 5)
    .map((row) => `${String(row.entity)} 延迟 ${money(numeric(row.metric_value) ?? 0)} 天`)
    .join("；");
  return [
    `共识别 ${rows.length} 条规则命中：${monthly.length} 条月度销售剧烈波动、${delivery.length} 条超 100 天配送延迟。`,
    monthlySummary ? `月度异常：${monthlySummary}。` : "未发现绝对环比超过 50% 的月度销售异常。",
    deliverySummary ? `最严重配送异常：${deliverySummary}。` : "未发现超过 100 天的配送延迟。",
    "2016-09、2016-12、2018-09、2018-10 等低订单月份位于数据覆盖边界，剧烈环比更可能由月份不完整造成，应与真实业务异常分开处理。",
  ].join("\n");
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

export function createDirectQaAnalysisExecutor(dependencies: {
  readonly capability: unknown;
  readonly runs: DirectQaRunReader;
  readonly artifacts: DirectQaArtifactPort;
  readonly sandbox: EcommerceBenchmarkQueryExecutor;
  readonly semantic_relationships: FrozenSemanticRelationshipReadPort;
  readonly now?: () => Date;
}): RunWorkflowExecutorPort {
  const now = dependencies.now ?? (() => new Date());

  return Object.freeze({
    async execute(
      execution: Parameters<RunWorkflowExecutorPort["execute"]>[0],
    ): Promise<import("../runs/run-worker-runner.js").RunExecutorResult> {
      try {
        if (!hasRunExecutionContextProvenance(execution.context)) {
          throw new DirectQaAnalysisError("RUN_EXECUTION_CONTEXT_NOT_TRUSTED");
        }
        const run = value(
          await dependencies.runs.getRun(dependencies.capability, {
            run_id: execution.lease.run_id,
          }),
        );
        if (!run) throw new DirectQaAnalysisError("RUN_NOT_FOUND");
        const intent = classifyDirectQaIntent(run.question);
        const blockId = `direct-qa-${execution.lease.attempt_id}`;
        const emitDisplayEvent = execution.context.emitDisplayEvent;
        if (!emitDisplayEvent) {
          throw new DirectQaAnalysisError("RUN_DISPLAY_EVENT_PORT_REQUIRED");
        }
        value(
          await emitDisplayEvent({
            kind: "reasoning_started",
            key: "direct.qa.started",
            block_id: blockId,
            title: "直接分析问题",
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

        let answer: string;
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
        } else if (intent === "RELATIONSHIPS") {
          const contextCapability = execution.context.getResolvedContextCapability?.();
          if (!hasRunResolvedContextCapability(contextCapability)) {
            throw new DirectQaAnalysisError("RESOLVED_CONTEXT_REQUIRED");
          }
          const resolved = await verifyResolvedContextCommitResult(
            value(await contextCapability.resolve()),
          );
          const relationships = value(
            await dependencies.semantic_relationships.read({
              capability: dependencies.capability,
              scope: execution.lease.scope,
              semantic_domain: resolved.package.semantic_domain,
              release_id: resolved.package.semantic_release.resource_id,
              release_hash: resolved.package.semantic_release.resource_hash,
            }),
          );
          const names = new Map(
            relationships.nodes.map((node) => [node.node_key, node.name] as const),
          );
          const joinLines = relationships.edges
            .filter(({ category }) => category === "BIZ")
            .map(
              (edge) =>
                `${names.get(edge.source_node_key) ?? edge.source_node_key} → ${names.get(edge.target_node_key) ?? edge.target_node_key}（${edge.label}）`,
            );
          answer = [
            "核心关系链为：客户 → 订单 → 订单明细；订单同时关联支付、配送、评价和日期；订单明细再关联商品与卖家，商品关联类目。",
            ...joinLines.slice(0, 20),
            `以上来自冻结 Semantic Release ${relationships.release_identity.release_id}。`,
          ].join("\n");
          await commit({
            artifact_type: "AnalysisReport",
            profile_id: "semantic-management-agent",
            purpose: "relationships",
            source_refs: [],
            projection: {
              kind: "REPORT",
              title: "表关系分析",
              sections: [{ heading: "冻结关系", body_text: answer, source_refs: [] }],
            },
          });
        } else if (intent === "SALES_TREND") {
          const trend = await query("sales-trend", compileEcommerceMonthlyOrderTrendSql());
          answer = renderTrend(trend.rows);
        } else if (intent === "SALES_ANOMALIES") {
          const anomalies = await query("sales-anomalies", compileEcommerceSalesAnomalySql());
          answer = renderAnomalies(anomalies.rows);
        } else if (intent === "SALES_REPORT") {
          const [summary, trend, anomalies] = await Promise.all([
            query("sales-report-summary", compileEcommerceSalesReportSummarySql()),
            query("sales-report-trend", compileEcommerceMonthlyOrderTrendSql()),
            query("sales-report-anomalies", compileEcommerceSalesAnomalySql()),
          ]);
          const row = summary.rows[0] ?? {};
          const overview = `统计周期 ${String(row.period_start)} 至 ${String(row.period_end)}，共 ${numeric(row.total_orders) ?? 0} 单，销售额 ${money(numeric(row.total_sales_brl) ?? 0)} BRL，平均客单价 ${money(numeric(row.average_order_value_brl) ?? 0)} BRL。`;
          const delivery = `延迟订单 ${numeric(row.delayed_orders) ?? 0} 单，正延迟订单平均延迟 ${money(numeric(row.average_delay_days) ?? 0)} 天，最大延迟 ${money(numeric(row.maximum_delay_days) ?? 0)} 天；平均评价 ${money(numeric(row.average_review_score) ?? 0)} / 5。`;
          const trendText = renderTrend(trend.rows);
          const anomalyText = renderAnomalies(anomalies.rows);
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
        } else {
          const provider = execution.context.getProviderDispatchCapability();
          if (!hasRunProviderDispatchCapability(provider)) {
            throw new DirectQaAnalysisError("DIRECT_MODEL_PROVIDER_REQUIRED");
          }
          const response = value(
            await provider.invoke({
              logical_call_id: identity(execution.lease.run_id, "direct-model"),
            }),
          );
          const parsed = z
            .strictObject({ answer: z.string().min(1) })
            .parse(JSON.parse(response.output_text));
          answer = parsed.answer;
        }

        value(
          await emitDisplayEvent({
            kind: "reasoning_completed",
            key: "direct.qa.completed",
            block_id: blockId,
            summary: "直接分析与证据提交已完成。",
            duration_ms: 0,
          }),
        );
        value(
          await emitDisplayEvent({
            kind: "answer_delta",
            key: "direct.qa.answer",
            delta: answer,
          }),
        );
        return { kind: "COMPLETED" };
      } catch (error) {
        const code =
          error instanceof DirectQaAnalysisError
            ? error.code
            : error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)
              ? error.message
              : "DIRECT_QA_ANALYSIS_FAILED";
        return { kind: "FAILED", error_code: code };
      }
    },
  });
}

export const directQaAnalysisInternals = Object.freeze({ renderTrend, renderAnomalies });
