"use client";

import { Cpu } from "@phosphor-icons/react";
import { ProcessDisclosure } from "@/components/qa/process-disclosure";
import { WorkspaceI18nProvider } from "@/i18n";
import type { ProcessRow } from "@/lib/qa-event-assembler";

const runId = "40000000-0000-4000-8000-000000000018";
const rows: readonly ProcessRow[] = [
  {
    id: `${runId}:reasoning:1`,
    runId,
    sequence: 1,
    kind: "reasoning",
    title: "制定分析路径",
    summary: "已选择已发布的收入指标、区域维度与季度过滤口径。",
    status: "COMPLETED",
    input: null,
    output: null,
    durationMs: 842,
    toolName: null,
  },
  {
    id: `${runId}:tool:2`,
    runId,
    sequence: 2,
    kind: "tool",
    title: "执行只读查询",
    summary: "PostgreSQL 查询返回 6 个区域，证据已写入 QueryReceipt。",
    status: "COMPLETED",
    input: "metric=net_revenue; dimensions=region; period=2025-Q1",
    output: "rows=6; receipt=sha256:7f1d...09ac",
    durationMs: 1264,
    toolName: "semantic.text2sql.execute",
  },
  {
    id: `${runId}:stage:3`,
    runId,
    sequence: 3,
    kind: "progress",
    title: "校验引用闭包",
    summary: "报告中的 3 条结论均绑定已接受的查询证据。",
    status: "COMPLETED",
    input: null,
    output: null,
    durationMs: 318,
    toolName: null,
  },
];

export default function AgentConversationPreviewPage() {
  return (
    <WorkspaceI18nProvider>
      <main className="min-h-full bg-[var(--color-bg-surface)]">
        <div className="mx-auto w-full max-w-[920px] px-4 py-10 sm:px-8">
          <p className="page-eyebrow">Conversation / Run 40000000</p>
          <h1 className="page-title">区域收入诊断</h1>

          <div className="mt-10 flex justify-end">
            <div className="max-w-[82%] rounded-lg bg-[var(--color-text-primary)] px-3.5 py-2.5 text-sm text-white shadow-[var(--shadow-float)]">
              对比 2025 年第一季度各区域净收入，并说明华南区下滑的主要原因。
            </div>
          </div>

          <article className="mt-7">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-text-primary)] text-white">
                <Cpu aria-hidden="true" size={15} />
              </span>
              <div>
                <p className="text-[11px] font-semibold">Data Agent</p>
                <p className="font-mono text-[9px] text-[var(--color-text-muted)]">
                  governed response
                </p>
              </div>
            </div>
            <fieldset className="agent-process-list">
              <legend className="sr-only">执行过程</legend>
              {rows.map((row) => (
                <ProcessDisclosure key={row.id} row={row} />
              ))}
            </fieldset>
            <div className="agent-answer space-y-3">
              <p>华南区净收入较上季度下降 18.2%，降幅主要来自企业客户续约减少和两笔大额退款。</p>
              <p>
                其余五个区域保持增长，其中华东区贡献最高，净收入为 8,426
                万元。结论已绑定本次只读查询回执。
              </p>
            </div>
          </article>
        </div>
      </main>
    </WorkspaceI18nProvider>
  );
}
