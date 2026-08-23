"use client";

import { useMemo, useState } from "react";
import type { RunConnectionState, RunProjection } from "@/lib/run-projection";

type ConsoleTab = "overview" | "trace" | "artifacts" | "contract";

interface TaskConsoleProps {
  projection: RunProjection | null;
  currentAction: string;
  authorityState: "LOADING" | "ACTIVE" | "STALE" | "ERROR" | "PERMISSION_DENIED";
  connection: RunConnectionState;
  projectionVersion: number;
  coreL2Verdict: "HOLD";
  attributionF9Status: "NOT_REGISTERED";
  fixtureEvidenceVerdict: "HOLD";
  onClose: () => void;
}

interface TraceNode {
  id: string;
  title: string;
  description: string;
  countLabel: string;
  state: "complete" | "running" | "hold";
}

function buildTrace(projection: RunProjection | null): TraceNode[] {
  if (!projection) return [];
  const hypotheses = projection.hypothesis ?? [];
  const gateReceipts = hypotheses.flatMap((item) => item.gateReceipts ?? []);
  const executionReceipts = hypotheses.flatMap((item) => item.executionReceipts ?? []);
  const claims = projection.reports?.flatMap((report) => report.claims) ?? [];

  return [
    {
      id: "scope",
      title: "业务问题与分析范围",
      description: projection.scope
        ? `工作区 ${projection.scope.workspace ?? "未指定"}，数据集 ${projection.scope.dataset ?? "未指定"}，SQL 方言 ${projection.scope.dialect ?? "未指定"}。`
        : "当前投影尚未绑定可验证的数据范围。",
      countLabel: projection.scope
        ? `${Object.values(projection.scope).filter(Boolean).length} 项范围`
        : "未绑定",
      state: projection.scope ? "complete" : "hold",
    },
    {
      id: "hypotheses",
      title: "有限假设集",
      description: `共记录 ${hypotheses.length} 个候选解释：${hypotheses.filter((item) => item.status === "SUPPORTED").length} 个获支持，${hypotheses.filter((item) => item.status === "REFUTED").length} 个被排除，${hypotheses.filter((item) => item.status === "INCONCLUSIVE").length} 个证据不足。`,
      countLabel: `${hypotheses.length} 个假设`,
      state: hypotheses.length > 0 ? "complete" : "running",
    },
    {
      id: "gates",
      title: "语义、权限与资源门控",
      description: `后端已返回 ${gateReceipts.length} 份门控回执，其中 ${gateReceipts.filter((receipt) => !receipt.passed).length} 份未通过。门控失败只影响对应验证路径，不由界面自行改写。`,
      countLabel: `${gateReceipts.length} 份回执`,
      state: gateReceipts.length === 0 ? "running" : "complete",
    },
    {
      id: "execution",
      title: "SQL 执行回执",
      description: `已记录 ${executionReceipts.length} 次查询执行，共返回 ${executionReceipts.reduce((count, receipt) => count + receipt.rowCount, 0)} 行。SQL、Query ID、耗时与 AST Hash 保持可追溯。`,
      countLabel: `${executionReceipts.length} 次执行`,
      state: executionReceipts.length > 0 ? "complete" : "running",
    },
    {
      id: "report",
      title: "声明—证据与报告候选",
      description: `已形成 ${projection.reports?.length ?? 0} 份 L2 报告候选、${claims.length} 条声明。报告只表达描述、比较或诊断结论，不自动成为发布事实。`,
      countLabel: `${claims.length} 条声明`,
      state: projection.reports?.length ? "complete" : "running",
    },
    {
      id: "delivery",
      title: "评测与治理交付",
      description: projection.eval
        ? `${projection.eval.suite} 评测为 ${projection.eval.verdict}；但 Published F9 尚未注册，治理交付继续 HOLD。`
        : "评测尚未返回；治理交付保持 HOLD。",
      countLabel: "交付 HOLD",
      state: "hold",
    },
  ];
}

const connectionLabels: Record<RunConnectionState, string> = {
  idle: "未连接",
  connecting: "连接中",
  live: "实时同步",
  reconnecting: "重新连接",
  closed: "投影已关闭",
};

/**
 * 运行与证据面板：仅由同一个 Run Projection 和 Workbench authority 派生。
 * 它展示可验证的业务工件序列，不把客户端整理结果伪装成后端 DAG。
 */
export function TaskConsole({
  projection,
  currentAction,
  authorityState,
  connection,
  projectionVersion,
  coreL2Verdict,
  attributionF9Status,
  fixtureEvidenceVerdict,
  onClose,
}: TaskConsoleProps) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>("trace");
  const [expandedNode, setExpandedNode] = useState<string | null>("gates");
  const trace = useMemo(() => buildTrace(projection), [projection]);
  const hypotheses = projection?.hypothesis ?? [];
  const receipts = hypotheses.reduce(
    (count, hypothesis) =>
      count + (hypothesis.gateReceipts?.length ?? 0) + (hypothesis.executionReceipts?.length ?? 0),
    0,
  );

  const tabs: Array<{ id: ConsoleTab; label: string; count?: number }> = [
    { id: "overview", label: "概览" },
    { id: "trace", label: "分析轨迹", count: trace.length },
    { id: "artifacts", label: "工件", count: projection?.reports?.length ?? 0 },
    { id: "contract", label: "权威边界" },
  ];

  return (
    <aside
      className="flex h-full w-[392px] shrink-0 flex-col border-l border-[var(--color-border-default)] bg-white 2xl:w-[448px]"
      aria-label="运行与证据"
    >
      <header className="flex h-[72px] shrink-0 items-start justify-between border-b border-[var(--color-border-default)] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">运行与证据</h2>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span
              className={[
                "size-1.5 rounded-full",
                connection === "live" ? "bg-[var(--color-success)]" : "bg-[var(--color-warning)]",
              ].join(" ")}
            />
            <span>{projection?.status === "COMPLETED" ? "工作流已完成" : currentAction}</span>
            <span>· {connectionLabels[connection]}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-md text-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)]"
          aria-label="关闭运行与证据面板"
        >
          ×
        </button>
      </header>

      <div
        className="flex h-[52px] shrink-0 items-center gap-1 border-b border-[var(--color-border-default)] px-3"
        role="tablist"
        aria-label="运行与证据视图"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              "rounded-lg px-3 py-2 text-[11px] font-medium",
              activeTab === tab.id
                ? "bg-[#171a18] text-white"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]",
            ].join(" ")}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={[
                  "ml-1.5 rounded-full px-1.5 py-0.5 text-[9px]",
                  activeTab === tab.id ? "bg-white/20" : "bg-[var(--color-bg-tertiary)]",
                ].join(" ")}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "trace" && (
          <section className="rounded-xl border border-[var(--color-border-default)] p-4">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold">可审计分析轨迹</h3>
              <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
                按后端投影中已存在的范围、假设、回执、报告与治理状态组织。
              </p>
            </div>
            {trace.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--color-text-muted)]">
                尚无运行轨迹
              </p>
            ) : (
              <div className="relative ml-2 border-l border-[var(--color-border-default)] pl-5">
                {trace.map((node) => (
                  <div key={node.id} className="relative pb-3 last:pb-0">
                    <span
                      className={[
                        "absolute -left-[29px] top-3 flex size-[18px] items-center justify-center rounded-full border-2 bg-white",
                        node.state === "complete"
                          ? "border-[var(--color-success)]"
                          : node.state === "hold"
                            ? "border-[var(--color-warning)]"
                            : "border-[var(--color-text-muted)]",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "size-1.5 rounded-full",
                          node.state === "complete"
                            ? "bg-[var(--color-success)]"
                            : node.state === "hold"
                              ? "bg-[var(--color-warning)]"
                              : "bg-[var(--color-text-muted)]",
                        ].join(" ")}
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedNode(expandedNode === node.id ? null : node.id)}
                      className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3 py-3 text-left hover:border-[var(--color-border-overlay)] hover:bg-white"
                      aria-expanded={expandedNode === node.id}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="text-[12px] font-semibold leading-5">{node.title}</span>
                        <span className="shrink-0 rounded bg-white px-2 py-1 text-[9px] text-[var(--color-text-muted)] shadow-sm">
                          {node.countLabel}
                        </span>
                      </span>
                      {expandedNode === node.id && (
                        <span className="mt-1.5 block text-[11px] leading-5 text-[var(--color-text-secondary)]">
                          {node.description}
                        </span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "overview" && (
          <section className="space-y-5 p-1">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                当前业务问题
              </p>
              <p className="mt-2 text-sm leading-6">{projection?.question ?? "尚无任务"}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="有限假设" value={String(hypotheses.length)} />
              <Metric label="门控与执行回执" value={String(receipts)} />
              <Metric label="评测结果" value={projection?.eval?.verdict ?? "未运行"} />
              <Metric label="治理交付" value={coreL2Verdict} tone="hold" />
            </div>
            <dl className="divide-y divide-[var(--color-border-default)] text-[12px]">
              <Detail label="工作流状态" value={projection?.status ?? "—"} />
              <Detail label="投影权威" value={authorityState} />
              <Detail label="投影版本" value={String(projectionVersion)} />
            </dl>
          </section>
        )}

        {activeTab === "artifacts" && (
          <section className="space-y-3">
            {projection?.reports?.map((report) => (
              <div
                key={report.id}
                className="rounded-xl border border-[var(--color-border-default)] p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-tertiary)] text-[11px] font-bold">
                    L2
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold leading-5">{report.title}</p>
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                      {report.claims.length} 条声明 · v{report.version} ·{" "}
                      {report.isDemo ? "演示来源" : "运行来源"}
                    </p>
                    <p className="mt-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
                      {report.summary}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {!projection?.reports?.length && (
              <p className="py-8 text-center text-xs text-[var(--color-text-muted)]">
                暂无报告候选
              </p>
            )}
          </section>
        )}

        {activeTab === "contract" && (
          <section className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-[12px] font-semibold text-amber-900">运行完成 ≠ 治理可交付</p>
              <p className="mt-2 text-[11px] leading-5 text-amber-900/75">
                后端运行事件的 COMPLETED 表示
                WORKFLOW_EXECUTION_ONLY。报告候选与评测结果不能覆盖发布、安全与证据权威。
              </p>
            </div>
            <dl className="divide-y divide-[var(--color-border-default)] rounded-xl border border-[var(--color-border-default)] px-4 text-[12px]">
              <Detail label="Core L2" value={coreL2Verdict} />
              <Detail label="Published F9" value={attributionF9Status} />
              <Detail label="Fixture Evidence" value={fixtureEvidenceVerdict} />
              <Detail label="能力范围" value={projection?.l2Only ? "仅 L2" : "由后端声明"} />
            </dl>
            <p className="px-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
              当前 UI 不把 fixture 可行性、评测 PASS 或客户端展示状态解释为 Published
              F9、因果结论或行动授权。
            </p>
          </section>
        )}

        {projection && (
          <section className="mt-4 rounded-xl border border-[var(--color-border-default)] p-4">
            <h3 className="text-[13px] font-semibold">运行标识</h3>
            <dl className="mt-2 divide-y divide-[var(--color-border-default)] text-[11px]">
              <Detail label="Run ID" value={projection.runId} />
              <Detail label="数据集" value={projection.scope?.dataset ?? "—"} />
              <Detail
                label="创建时间"
                value={new Date(projection.createdAt).toLocaleString("zh-CN")}
              />
              <Detail
                label="更新时间"
                value={new Date(projection.updatedAt).toLocaleString("zh-CN")}
              />
            </dl>
          </section>
        )}
      </div>
    </aside>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "hold" }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-default)] p-3">
      <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
      <p
        className={["mt-1 text-sm font-semibold", tone === "hold" ? "text-amber-700" : ""].join(
          " ",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-3">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="break-all text-right font-medium">{value}</dd>
    </div>
  );
}
