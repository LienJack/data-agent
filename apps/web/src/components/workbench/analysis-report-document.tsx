import type { RunProjection } from "@/lib/run-projection";

interface AnalysisReportDocumentProps {
  projection: RunProjection | null;
  coreL2Verdict: "HOLD";
  attributionF9Status: "NOT_REGISTERED";
  fixtureEvidenceVerdict: "HOLD";
}

const hypothesisLabels = {
  PROPOSED: "待验证",
  TESTING: "验证中",
  SUPPORTED: "已支持",
  REFUTED: "已排除",
  INCONCLUSIVE: "无结论",
} as const;

/**
 * 将权威 Run Projection 排版成可审阅的分析文档。
 *
 * 组件只格式化已解析的投影，不读取 SSE/API 原始 payload，也不自行推导发布成功。
 */
export function AnalysisReportDocument({
  projection,
  coreL2Verdict,
  attributionF9Status,
  fixtureEvidenceVerdict,
}: AnalysisReportDocumentProps) {
  if (!projection) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div>
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full border border-[var(--color-border-default)] bg-white text-[var(--color-text-muted)]">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="size-5"
            >
              <path d="M4 3.5h12v13H4zM7 7h6M7 10h6M7 13h3" />
            </svg>
          </div>
          <h2 className="text-base font-semibold">开始一项数据分析</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--color-text-secondary)]">
            在下方输入业务问题。结果、证据和运行轨迹会在同一工作区内持续更新。
          </p>
        </div>
      </div>
    );
  }

  const primaryReport = projection.reports?.[0];
  const hypotheses = projection.hypothesis ?? [];
  const supported = hypotheses.filter((item) => item.status === "SUPPORTED");
  const receiptCount = hypotheses.reduce(
    (count, item) =>
      count + (item.gateReceipts?.length ?? 0) + (item.executionReceipts?.length ?? 0),
    0,
  );

  return (
    <article className="mx-auto w-full max-w-[940px] px-8 py-8 lg:px-12 lg:py-10">
      <header className="border-b border-[var(--color-border-default)] pb-7">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
          <span className="font-medium uppercase tracking-[0.14em]">L2 分析报告候选</span>
          {primaryReport?.isDemo && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
              Demo · 仅体验
            </span>
          )}
          <span>v{primaryReport?.version ?? projection.demoVersion ?? "—"}</span>
        </div>
        <h1 className="max-w-[760px] text-[28px] font-semibold leading-[1.35] tracking-[-0.025em] text-[var(--color-text-primary)]">
          {primaryReport?.title ?? projection.question}
        </h1>
        <p className="mt-4 max-w-[800px] text-[15px] leading-7 text-[var(--color-text-secondary)]">
          {primaryReport?.summary ?? "分析正在生成，当前暂无可交付报告。"}
        </p>
      </header>

      <section
        className="grid gap-px overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-[var(--color-border-default)] sm:grid-cols-2 lg:grid-cols-4"
        aria-label="分析范围"
      >
        <ScopeItem label="工作区" value={projection.scope?.workspace ?? "未指定"} />
        <ScopeItem label="数据集" value={projection.scope?.dataset ?? "未指定"} />
        <ScopeItem label="SQL 方言" value={projection.scope?.dialect ?? "未指定"} />
        <ScopeItem
          label="结论模式"
          value={projection.l2Only ? "描述 / 比较 / 诊断" : "以后端策略为准"}
        />
      </section>

      <section className="py-7" aria-labelledby="report-key-findings">
        <h2 id="report-key-findings" className="text-lg font-semibold tracking-[-0.01em]">
          业务结论与证据
        </h2>
        {primaryReport?.claims.length ? (
          <div className="mt-4 overflow-hidden border-y border-[var(--color-border-default)]">
            {primaryReport.claims.map((claim, index) => (
              <div
                key={`${claim.statement}:${claim.evidence}`}
                className="grid gap-2 border-b border-[var(--color-border-default)] py-4 last:border-b-0 md:grid-cols-[28px_minmax(0,1fr)_110px] md:items-start"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] text-[11px] font-semibold text-[var(--color-text-secondary)]">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold leading-6">{claim.statement}</p>
                  <p className="mt-1 text-[13px] leading-6 text-[var(--color-text-secondary)]">
                    {claim.evidence}
                  </p>
                </div>
                <span className="w-fit rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 md:justify-self-end">
                  置信度 {claim.confidence}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">尚无已封存的声明与证据。</p>
        )}
      </section>

      <section
        className="border-t border-[var(--color-border-default)] py-7"
        aria-labelledby="report-validation"
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="report-validation" className="text-lg font-semibold tracking-[-0.01em]">
              归因假设与验证
            </h2>
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              有限假设集 · {hypotheses.length} 个假设 · {receiptCount} 份门控与执行回执
            </p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
          {hypotheses.map((hypothesis) => (
            <details key={hypothesis.id} className="group py-4">
              <summary className="flex cursor-pointer list-none items-start gap-3">
                <span
                  className={[
                    "mt-1 size-2.5 shrink-0 rounded-full border-2 bg-white",
                    hypothesis.status === "SUPPORTED"
                      ? "border-[var(--color-success)]"
                      : hypothesis.status === "REFUTED"
                        ? "border-[var(--color-error)]"
                        : "border-[var(--color-warning)]",
                  ].join(" ")}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-6">
                    {hypothesis.statement}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">
                    {hypothesisLabels[hypothesis.status]}
                    {hypothesis.executionReceipts?.[0] &&
                      ` · ${hypothesis.executionReceipts[0].rowCount} rows · ${hypothesis.executionReceipts[0].durationMs} ms`}
                  </span>
                </span>
                <span className="text-xs text-[var(--color-text-muted)] group-open:rotate-180">
                  ⌄
                </span>
              </summary>
              <div className="ml-5 mt-3 space-y-4 border-l border-[var(--color-border-default)] pl-4 text-[12px] leading-6 text-[var(--color-text-secondary)]">
                {!!hypothesis.gateReceipts?.length && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      门控回执
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {hypothesis.gateReceipts.map((receipt) => (
                        <span
                          key={`${hypothesis.id}-${receipt.gate}-${receipt.issuer ?? "unknown"}`}
                          className={[
                            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                            receipt.passed
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-red-200 bg-red-50 text-red-700",
                          ].join(" ")}
                          title={[receipt.reason, receipt.issuer].filter(Boolean).join(" · ")}
                        >
                          {receipt.gate} · {receipt.passed ? "通过" : "未通过"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {!!hypothesis.executionReceipts?.length && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      SQL 执行回执
                    </p>
                    {hypothesis.executionReceipts.map((receipt) => (
                      <div
                        key={receipt.queryId}
                        className="rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-x-3 text-[10px] text-[var(--color-text-muted)]">
                          <span>Query {receipt.queryId}</span>
                          <span>{receipt.rowCount} 行</span>
                          <span>{receipt.durationMs} ms</span>
                          {receipt.astHash && <span>AST {receipt.astHash}</span>}
                        </div>
                        <code className="mt-1 block max-h-20 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[var(--color-text-secondary)]">
                          {receipt.sql}
                        </code>
                      </div>
                    ))}
                  </div>
                )}

                {!!hypothesis.evidence?.length && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      声明—证据
                    </p>
                    {hypothesis.evidence.map((evidence) => (
                      <p key={`${hypothesis.id}-${evidence.claim}`}>
                        <span className="font-medium text-[var(--color-text-primary)]">
                          {evidence.claim}：
                        </span>
                        {evidence.evidence}
                        <span className="text-[var(--color-text-muted)]"> · {evidence.source}</span>
                      </p>
                    ))}
                  </div>
                )}

                {!!hypothesis.limitations?.length && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      限制条件
                    </p>
                    {hypothesis.limitations.map((limitation) => (
                      <p
                        key={`${hypothesis.id}-${limitation}`}
                        className="text-[var(--color-text-muted)]"
                      >
                        {limitation}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section
        className="border-t border-[var(--color-border-default)] py-7"
        aria-labelledby="report-evaluation"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="report-evaluation" className="text-lg font-semibold tracking-[-0.01em]">
              评测结果
            </h2>
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              质量评测只评价当前候选，不签发发布权限。
            </p>
          </div>
          <span
            className={[
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              projection.eval?.verdict === "PASS"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700",
            ].join(" ")}
          >
            {projection.eval ? `${projection.eval.suite} · ${projection.eval.verdict}` : "尚未评测"}
          </span>
        </div>
        {projection.eval?.scoreCard && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <EvalMetric label="通过" value={projection.eval.scoreCard.passed} />
            <EvalMetric label="失败" value={projection.eval.scoreCard.failed} />
            <EvalMetric label="总计" value={projection.eval.scoreCard.total} />
          </div>
        )}
      </section>

      <section
        className="border-t border-[var(--color-border-default)] py-7"
        aria-labelledby="report-decision"
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-amber-300 text-sm text-amber-700">
              !
            </span>
            <div>
              <h2 id="report-decision" className="text-lg font-semibold">
                当前交付决定：HOLD
              </h2>
              <p className="mt-2 text-[13px] leading-6 text-amber-900/75">
                工作流完成或分析评测通过，都不等于报告已经发布。当前 Core L2={coreL2Verdict}
                、Published F9=
                {attributionF9Status}、Fixture Evidence={fixtureEvidenceVerdict}
                ，因此只能保留为可审阅的 L2 分析候选，不能显示为因果归因、已发布事实或可执行行动。
              </p>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-[var(--color-text-secondary)]">
          已支持的解释方向：
          {supported.length > 0 ? supported.map((item) => item.statement).join("；") : "暂无"}。
        </p>
      </section>

      <footer className="border-t border-[var(--color-border-default)] pt-5 text-[11px] text-[var(--color-text-muted)]">
        Run {projection.runId} · 更新于 {new Date(projection.updatedAt).toLocaleString("zh-CN")}
      </footer>
    </article>
  );
}

function ScopeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-bg-canvas)] px-4 py-3">
      <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 truncate text-[12px] font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

function EvalMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-default)] px-3 py-2">
      <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
