"use client";

import type {
  SemanticAuthoringPublicEvent,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import { ArrowSquareOut, PaperPlaneTilt, Pulse, Sparkle, X } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import type { SemanticStudioAuthoringState } from "@/lib/semantic-studio-api";

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
  draft,
  state,
  events,
  busy,
  error,
  onDraftChange,
  onClearSelection,
  onSubmit,
  onResume,
  onOpenTrajectory,
}: {
  readonly domain: string;
  readonly releaseLabel: string;
  readonly selectedNode: SemanticGraphReadNode | null;
  readonly selectedEdge: SemanticGraphReadEdge | null;
  readonly draft: string;
  readonly state: SemanticStudioAuthoringState | null;
  readonly events: readonly SemanticAuthoringPublicEvent[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onDraftChange: (value: string) => void;
  readonly onClearSelection: () => void;
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
        className="border border-[#bfcac4] bg-white/96 px-3 py-3 shadow-[0_18px_50px_rgba(32,45,39,0.14)] backdrop-blur-md sm:px-4"
      >
        {state ? (
          <motion.div
            layout
            className="mb-3 flex flex-col gap-2 border border-[#d7ddd9] bg-[#f8faf8] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-2 text-[11px] text-[#59665f]">
              <Pulse
                className={`size-4 ${running ? "animate-pulse text-[#356b5a]" : "text-[#89938e]"}`}
                aria-hidden="true"
              />
              <span className="font-semibold">
                {running ? "Agent 任务仍在执行" : "这次 Agent 任务已有执行记录"}
              </span>
              <span className="font-mono text-[10px] text-[#89938e]">
                {events.length} 个公开事件
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenTrajectory}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#356b5a] hover:text-[#285b4b]"
            >
              打开全屏轨迹
              <ArrowSquareOut className="size-3.5" aria-hidden="true" />
            </button>
          </motion.div>
        ) : null}

        {clarification && clarification.answer === null ? (
          <div className="mb-3 border-l-2 border-sky-500 bg-sky-50 px-3 py-3">
            <p className="text-xs font-semibold text-sky-900">Agent 需要确认</p>
            <p className="mt-1 text-xs leading-5 text-sky-800">{clarification.question}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {clarification.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy}
                  onClick={() => onResume(option)}
                  className="border border-sky-300 bg-white px-3 py-1.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2 text-[10px] text-[#65716b]">
          <span className="border-r border-[#d7ddd9] pr-3 font-mono">Domain · {domain}</span>
          <span className="font-mono">{releaseLabel}</span>
          {selectedNode || selectedEdge ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="inline-flex items-center gap-1.5 border-l border-[#d7ddd9] pl-3 font-medium text-[#356b5a] hover:text-[#285b4b]"
            >
              选区 · {selectedNode?.node.name ?? selectedEdge?.edge.edge_type}
              <X className="size-3" aria-hidden="true" />
            </button>
          ) : null}
          <span className="ml-auto hidden text-[var(--color-text-secondary)] sm:inline">
            所有变更只写入 Candidate，审核发布前不影响活动语义
          </span>
        </div>

        <div className="flex flex-col gap-2 border border-[#7fa293] bg-white p-2 transition-shadow focus-within:shadow-[0_0_0_3px_rgba(53,107,90,0.12)] sm:flex-row sm:items-end">
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
            className="min-h-[52px] flex-1 resize-none border-0 bg-transparent px-2 py-1 text-[13px] leading-5 text-[#26312d] outline-none placeholder:text-[#929d97] disabled:opacity-60"
          />
          <button
            type="button"
            disabled={
              busy || (!running && draft.trim().length === 0) || clarification?.answer === null
            }
            onClick={running ? onOpenTrajectory : onSubmit}
            className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 bg-[#356b5a] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#285b4b] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
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
                className="whitespace-nowrap border border-[#d4dbd7] px-3 py-1.5 text-[10px] text-[#65716b] transition-colors hover:border-[#7fa293] hover:text-[#285b4b]"
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
