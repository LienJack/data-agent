"use client";

import type {
  SemanticAuthoringPublicEvent,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import type { SemanticStudioAuthoringState } from "@data-agent/semantic/application";
import { ArrowSquareOut, PaperPlaneTilt, Pulse, Sparkle, X } from "@phosphor-icons/react";
import { motion } from "framer-motion";

const EXAMPLES = [
  "新增“成交商品数”，按订单明细的 product_id 去重计算，单位是件。",
  "把成交商品数改成只统计已支付订单，仍按商品去重。",
  "给订单明细增加商品维度，并绑定商品 ID。",
] as const;

export function SemanticAgentComposer({
  domain,
  releaseLabel,
  selectedNode,
  selectedEdge,
  evidenceSelectionId,
  draft,
  state,
  events,
  busy,
  error,
  onDraftChange,
  onClearSelection,
  onClearEvidenceSelection,
  onSubmit,
  onResume,
  onOpenTrajectory,
}: {
  readonly domain: string;
  readonly releaseLabel: string;
  readonly selectedNode: SemanticGraphReadNode | null;
  readonly selectedEdge: SemanticGraphReadEdge | null;
  readonly evidenceSelectionId: string | null;
  readonly draft: string;
  readonly state: SemanticStudioAuthoringState | null;
  readonly events: readonly SemanticAuthoringPublicEvent[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onDraftChange: (value: string) => void;
  readonly onClearSelection: () => void;
  readonly onClearEvidenceSelection: () => void;
  readonly onSubmit: () => void;
  readonly onResume: (answer: string) => void;
  readonly onOpenTrajectory: () => void;
}) {
  const clarification = state?.run.clarification;
  const running = state?.run.status === "RUNNING";
  return (
    <section className="mt-4" aria-label="Agent 语义编辑器">
      <motion.div
        layout
        className="surface-floating-strong rounded-[var(--radius-panel)] border px-3 py-3 sm:px-4"
      >
        {state ? (
          <motion.div
            layout
            className="mb-3 flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
              <Pulse
                className={`size-4 ${running ? "animate-pulse text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}`}
                aria-hidden="true"
              />
              <span className="font-semibold">
                {running ? "Agent 任务仍在执行" : "这次 Agent 任务已有执行记录"}
              </span>
              <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                {events.length} 个公开事件
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenTrajectory}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
            >
              打开全屏轨迹
              <ArrowSquareOut className="size-3.5" aria-hidden="true" />
            </button>
          </motion.div>
        ) : null}

        {clarification && clarification.answer === null ? (
          <div className="mb-3 rounded-[var(--radius-control)] border border-sky-200 bg-sky-50 px-3 py-3">
            <p className="text-xs font-semibold text-sky-900">Agent 需要确认</p>
            <p className="mt-1 text-xs leading-5 text-sky-800">{clarification.question}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {clarification.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy}
                  onClick={() => onResume(option)}
                  className="control-pressable rounded-[var(--radius-control)] border border-sky-300 bg-white px-3 py-1.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2 text-[10px] text-[var(--color-text-secondary)]">
          <span className="border-r border-[var(--color-border-default)] pr-3 font-mono">
            Domain · {domain}
          </span>
          <span className="font-mono">{releaseLabel}</span>
          {selectedNode || selectedEdge ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="inline-flex items-center gap-1.5 border-l border-[var(--color-border-default)] pl-3 font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
            >
              选区 · {selectedNode?.node.name ?? selectedEdge?.edge.edge_type}
              <X className="size-3" aria-hidden="true" />
            </button>
          ) : null}
          {evidenceSelectionId ? (
            <button
              type="button"
              onClick={onClearEvidenceSelection}
              className="inline-flex items-center gap-1.5 border-l border-[var(--color-border-default)] pl-3 font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
              title={evidenceSelectionId}
            >
              精确知识证据 · {evidenceSelectionId.slice(0, 8)}
              <X className="size-3" aria-hidden="true" />
            </button>
          ) : null}
          <span className="ml-auto hidden text-[var(--color-text-secondary)] sm:inline">
            所有变更只写入 Candidate，审核发布前不影响活动语义
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-[var(--radius-item)] border border-[var(--color-border-overlay)] bg-white p-2 transition-shadow focus-within:shadow-[0_0_0_3px_rgb(63_99_232_/_0.12)] sm:flex-row sm:items-end">
          <textarea
            value={draft}
            rows={2}
            disabled={busy || clarification?.answer === null}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder="告诉 Agent 要新增或修改什么。可以直接输入业务口径、公式或关系，例如：把成交商品数改成只统计已支付订单……"
            className="min-h-[52px] flex-1 resize-none border-0 bg-transparent px-2 py-1 text-[13px] leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] disabled:opacity-60"
          />
          <button
            type="button"
            disabled={
              busy || (!running && draft.trim().length === 0) || clarification?.answer === null
            }
            onClick={running ? onOpenTrajectory : onSubmit}
            className="control-pressable inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
          >
            {busy ? (
              <Sparkle className="size-4 animate-pulse" aria-hidden="true" />
            ) : running ? (
              <ArrowSquareOut className="size-4" aria-hidden="true" />
            ) : (
              <PaperPlaneTilt className="size-4" weight="fill" aria-hidden="true" />
            )}
            {busy ? "正在提交…" : running ? "查看执行轨迹" : "交给 Agent"}
          </button>
        </div>
        {error ? <p className="mt-2 text-[11px] text-[var(--color-error)]">{error}</p> : null}
        {events.length === 0 && draft.length === 0 && !selectedNode && !selectedEdge ? (
          <div className="mt-2 hidden gap-2 overflow-x-auto pb-1 sm:flex">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onDraftChange(example)}
                className="control-pressable whitespace-nowrap rounded-full border border-[var(--color-border-default)] px-3 py-1.5 text-[10px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-overlay)] hover:text-[var(--color-accent-hover)]"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </motion.div>
    </section>
  );
}
