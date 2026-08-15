"use client";

import type { SemanticGraphReadNode } from "@data-agent/contracts";
import { ArrowRight, CaretLeft, CaretRight, CirclesThree } from "@phosphor-icons/react";
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
  const rowHeight = 72;
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
    <div className="overflow-hidden bg-white">
      <div
        ref={viewportRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="max-h-[min(70vh,760px)] overflow-auto"
      >
        <table className="w-full table-fixed text-left sm:min-w-[760px]">
          <thead className="sticky top-0 z-10 border-b border-[#d7ddd9] bg-[#f8faf8] text-[9px] uppercase tracking-[0.15em] text-[#76817c]">
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
                  className={`border-b border-[#e1e6e3] last:border-b-0 transition-colors ${selected ? "bg-[#eaf1ed] shadow-[inset_2px_0_0_#356b5a]" : "hover:bg-[#fafbfa]"}`}
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
                        <span className="block truncate text-[13px] font-semibold tracking-[-0.01em] text-[#28332e]">
                          {item.node.name}
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-[#77827d]">
                          {item.node.description || item.node.node_id}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-[11px] text-[#5e6b65]">{type.label}</td>
                  <td className="hidden px-3 py-3 sm:table-cell">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium"
                      style={{ color: status.color, backgroundColor: status.surface }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: status.color }}
                      />
                      {status.label}
                    </span>
                  </td>
                  <td className="hidden px-3 py-3 text-right md:table-cell">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#5e6b65]">
                      <CirclesThree className="size-3.5 text-[#82908a]" aria-hidden="true" />
                      {item.relation_count.total}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-right sm:table-cell">
                    <button
                      type="button"
                      onClick={() => onOpenGraph(item)}
                      className="inline-flex items-center gap-1.5 border border-[#d2dad5] px-2.5 py-1.5 text-[10px] font-medium text-[#59665f] transition-colors hover:border-[#7fa293] hover:text-[#285b4b]"
                    >
                      查看关系 <ArrowRight className="size-3" aria-hidden="true" />
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
        <div className="px-4 py-20 text-center">
          <CirclesThree className="mx-auto size-6 text-[#99a39e]" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-[#3d4943]">没有符合当前筛选的节点</p>
          <p className="mt-1 text-[10px] text-[#7b8781]">调整类型、状态或关键词后重试</p>
        </div>
      ) : null}
      <div className="flex items-center justify-between border-t border-[#d7ddd9] bg-[#f8faf8] px-4 py-2 text-[10px] text-[#6e7a74]">
        <span>
          {from}–{to} / {total} · 可视窗口仅渲染当前行
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={cursor === 0}
            onClick={() => onPage(Math.max(0, cursor - 250))}
            className="inline-flex h-7 items-center gap-1 border border-[#d2dad5] bg-white px-2 text-[10px] transition-colors hover:border-[#9aaba3] disabled:opacity-40"
          >
            <CaretLeft className="size-3" aria-hidden="true" />
            上一页
          </button>
          <button
            type="button"
            disabled={nextCursor === null}
            onClick={() => nextCursor !== null && onPage(nextCursor)}
            className="inline-flex h-7 items-center gap-1 border border-[#d2dad5] bg-white px-2 text-[10px] transition-colors hover:border-[#9aaba3] disabled:opacity-40"
          >
            下一页
            <CaretRight className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
