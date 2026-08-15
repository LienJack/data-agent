"use client";

import type {
  SemanticAuthoringPublicEvent,
  SemanticAuthoringState,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import { useState } from "react";
import { publicEventSummary } from "@/lib/semantic-studio-model";

const EXAMPLES = [
  "新增“成交商品数”，按订单明细的 product_id 去重计算，单位是件。",
  "把成交商品数改成只统计已支付订单，仍按商品去重。",
  "给订单明细增加商品维度，并绑定商品 ID。",
] as const;

function eventTone(event: SemanticAuthoringPublicEvent): string {
  if (event.type === "authoring_terminal")
    return event.payload.status === "FAILED" ? "#b64b3c" : "#3f806b";
  if (event.type === "validation") return event.payload.valid ? "#3f806b" : "#a56f20";
  if (event.type === "clarification") return "#2f7f9f";
  return "#527c70";
}

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
}: {
  readonly domain: string;
  readonly releaseLabel: string;
  readonly selectedNode: SemanticGraphReadNode | null;
  readonly selectedEdge: SemanticGraphReadEdge | null;
  readonly draft: string;
  readonly state: SemanticAuthoringState | null;
  readonly events: readonly SemanticAuthoringPublicEvent[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onDraftChange: (value: string) => void;
  readonly onClearSelection: () => void;
  readonly onSubmit: () => void;
  readonly onResume: (answer: string) => void;
}) {
  const [timelineOpen, setTimelineOpen] = useState(true);
  const clarification = state?.run.clarification;
  const running = state?.run.status === "RUNNING";
  return (
    <section
      className="sticky bottom-5 z-20 border-t border-[var(--color-border-default)] bg-white/95 px-4 py-3 shadow-[0_-12px_30px_rgba(32,45,39,0.08)] backdrop-blur"
      aria-label="Agent 语义编辑器"
    >
      <div className="mx-auto max-w-[1500px]">
        {events.length > 0 ? (
          <div className="mb-2 overflow-hidden rounded-md border border-[var(--color-border-default)] bg-[#fafbfa]">
            <button
              type="button"
              onClick={() => setTimelineOpen((value) => !value)}
              className="flex w-full items-center justify-between px-3 py-2 text-left"
            >
              <span className="flex items-center gap-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                <span
                  className={`h-2 w-2 rounded-full ${running ? "animate-pulse" : ""}`}
                  style={{ backgroundColor: running ? "#527c70" : "#8d9691" }}
                />
                Agent 执行轨迹 · {events.length} 个公开事件
              </span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">
                {timelineOpen ? "收起" : "展开"}
              </span>
            </button>
            {timelineOpen ? (
              <ol className="max-h-32 overflow-auto border-t border-[var(--color-border-default)] px-3 py-2">
                {events.slice(-8).map((event) => (
                  <li
                    key={event.event_id}
                    className="flex items-start gap-2 py-1 text-[11px] text-[var(--color-text-secondary)]"
                  >
                    <span
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: eventTone(event) }}
                    />
                    <span className="w-7 shrink-0 font-mono text-[10px] text-[var(--color-text-secondary)]">
                      #{event.sequence}
                    </span>
                    <span>{publicEventSummary(event)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}

        {clarification && clarification.answer === null ? (
          <div className="mb-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-3">
            <p className="text-xs font-semibold text-sky-900">Agent 需要确认</p>
            <p className="mt-1 text-xs leading-5 text-sky-800">{clarification.question}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {clarification.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy}
                  onClick={() => onResume(option)}
                  className="rounded border border-sky-300 bg-white px-3 py-1.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 pb-2 text-[10px] text-[var(--color-text-secondary)]">
          <span className="rounded bg-[var(--color-bg-overlay)] px-2 py-1">Domain · {domain}</span>
          <span className="rounded bg-[var(--color-bg-overlay)] px-2 py-1">{releaseLabel}</span>
          {selectedNode || selectedEdge ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded border border-[var(--color-border-default)] bg-white px-2 py-1 hover:border-[var(--color-border-focused)]"
            >
              选区 · {selectedNode?.node.name ?? selectedEdge?.edge.edge_type}{" "}
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
          <span className="ml-auto hidden text-[var(--color-text-secondary)] sm:inline">
            所有变更只写入 Candidate，审核发布前不影响活动语义
          </span>
        </div>

        <div className="flex items-end gap-2 rounded-lg border border-[var(--color-border-focused)] bg-white p-2 shadow-[0_4px_16px_rgba(46,70,60,0.08)] focus-within:ring-2 focus-within:ring-[#527c7022]">
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
              busy || running || draft.trim().length === 0 || clarification?.answer === null
            }
            onClick={onSubmit}
            className="h-10 shrink-0 rounded-md bg-[var(--color-accent)] px-4 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy || running ? "Agent 执行中…" : "交给 Agent"}
          </button>
        </div>
        {error ? <p className="mt-2 text-[11px] text-[var(--color-error)]">{error}</p> : null}
        {events.length === 0 && draft.length === 0 ? (
          <div className="mt-2 hidden gap-2 overflow-x-auto pb-1 sm:flex">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onDraftChange(example)}
                className="whitespace-nowrap rounded-full border border-[var(--color-border-default)] px-3 py-1 text-[10px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focused)] hover:text-[var(--color-accent)]"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
