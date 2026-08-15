"use client";

import type { SemanticGraphReadNode } from "@data-agent/contracts";
import { useMemo, useRef, useState } from "react";
import {
  SEMANTIC_NODE_PRESENTATION,
  SEMANTIC_STATUS_PRESENTATION,
} from "@/lib/semantic-studio-model";

export function SemanticNodeList({
  nodes,
  selectedNodeId,
  onSelect,
  onOpenGraph,
  total,
  cursor,
  nextCursor,
  onPage,
}: {
  readonly nodes: readonly SemanticGraphReadNode[];
  readonly selectedNodeId: string | null;
  readonly onSelect: (node: SemanticGraphReadNode) => void;
  readonly onOpenGraph: (node: SemanticGraphReadNode) => void;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly onPage: (cursor: number) => void;
}) {
  const rowHeight = 65;
  const overscan = 6;
  const viewportRows = 11;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const window = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(nodes.length, start + viewportRows + overscan * 2);
    return { start, end, items: nodes.slice(start, end) };
  }, [nodes, scrollTop]);
  const from = total === 0 ? 0 : cursor + 1;
  const to = Math.min(total, cursor + nodes.length);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border-default)] bg-white">
      <div
        ref={viewportRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="max-h-[min(68vh,720px)] overflow-auto"
      >
        <table className="w-full table-fixed text-left sm:min-w-[760px]">
          <thead className="sticky top-0 z-10 border-b border-[var(--color-border-default)] bg-[#f7f9f7] text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
            <tr>
              <th className="w-[64%] px-4 py-3 font-semibold sm:w-[38%]">节点</th>
              <th className="w-[36%] px-3 py-3 font-semibold sm:w-[14%]">类型</th>
              <th className="hidden w-[14%] px-3 py-3 font-semibold sm:table-cell">状态</th>
              <th className="hidden w-[12%] px-3 py-3 text-right font-semibold md:table-cell">
                关系
              </th>
              <th className="hidden px-4 py-3 text-right font-semibold sm:table-cell">操作</th>
            </tr>
          </thead>
          <tbody>
            {window.start > 0 ? (
              <tr>
                <td colSpan={5} style={{ height: window.start * rowHeight }} />
              </tr>
            ) : null}
            {window.items.map((item) => {
              const type = SEMANTIC_NODE_PRESENTATION[item.node.node_type];
              const status = SEMANTIC_STATUS_PRESENTATION[item.status];
              const selected = selectedNodeId === item.node.node_id;
              return (
                <tr
                  key={item.node.node_id}
                  className={`border-b border-[var(--color-border-default)] last:border-b-0 ${selected ? "bg-[#edf2ef]" : "hover:bg-[#fafbfa]"}`}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      className="flex w-full items-center gap-3 text-left"
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
                        style={{ backgroundColor: type.fill, color: type.text }}
                      >
                        {type.short}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {item.node.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--color-text-secondary)]">
                          {item.node.description || item.node.node_id}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-xs text-[var(--color-text-secondary)]">
                    {type.label}
                  </td>
                  <td className="hidden px-3 py-3 sm:table-cell">
                    <span
                      className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium"
                      style={{ color: status.color, backgroundColor: status.surface }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: status.color }}
                      />
                      {status.label}
                    </span>
                  </td>
                  <td className="hidden px-3 py-3 text-right font-mono text-xs text-[var(--color-text-secondary)] md:table-cell">
                    {item.relation_count.total}
                  </td>
                  <td className="hidden px-4 py-3 text-right sm:table-cell">
                    <button
                      type="button"
                      onClick={() => onOpenGraph(item)}
                      className="rounded border border-[var(--color-border-default)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-border-focused)] hover:text-[var(--color-accent)]"
                    >
                      查看关系
                    </button>
                  </td>
                </tr>
              );
            })}
            {window.end < nodes.length ? (
              <tr>
                <td colSpan={5} style={{ height: (nodes.length - window.end) * rowHeight }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {nodes.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-[var(--color-text-secondary)]">
          没有符合当前筛选的节点
        </div>
      ) : null}
      <div className="flex items-center justify-between border-t border-[var(--color-border-default)] bg-[#fafbfa] px-4 py-2 text-[11px] text-[var(--color-text-secondary)]">
        <span>
          {from}–{to} / {total} · 可视窗口仅渲染当前行
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={cursor === 0}
            onClick={() => onPage(Math.max(0, cursor - 250))}
            className="rounded border border-[var(--color-border-default)] bg-white px-2.5 py-1 disabled:opacity-40"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={nextCursor === null}
            onClick={() => nextCursor !== null && onPage(nextCursor)}
            className="rounded border border-[var(--color-border-default)] bg-white px-2.5 py-1 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
