"use client";

import type { SemanticGraphReadEdge, SemanticGraphReadNode } from "@data-agent/contracts";
import {
  edgeLabel,
  SEMANTIC_NODE_PRESENTATION,
  SEMANTIC_STATUS_PRESENTATION,
} from "@/lib/semantic-studio-model";

export function SemanticInspector({
  node,
  edge,
  onAskAgent,
  onClose,
}: {
  readonly node: SemanticGraphReadNode | null;
  readonly edge: SemanticGraphReadEdge | null;
  readonly onAskAgent: (draft: string) => void;
  readonly onClose: () => void;
}) {
  if (!node && !edge) return null;
  const selected = node ?? edge;
  if (!selected) return null;
  const status = SEMANTIC_STATUS_PRESENTATION[selected.status];
  return (
    <aside
      id="semantic-studio-inspector"
      className="w-full shrink-0 rounded-lg border border-[var(--color-border-default)] bg-white p-4 lg:w-[320px]"
      aria-label="节点或关系详情"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--color-text-secondary)]">
            {node ? "Node" : "Edge"} · {status.label}
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
            {node?.node.name ?? (edge ? edgeLabel(edge) : "")}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)]"
          aria-label="关闭详情"
        >
          ×
        </button>
      </div>
      {node ? (
        <dl className="mt-5 space-y-3 text-xs">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              节点类型
            </dt>
            <dd className="mt-1 text-[var(--color-text-secondary)]">
              {SEMANTIC_NODE_PRESENTATION[node.node.node_type].label}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              定义
            </dt>
            <dd className="mt-1 leading-5 text-[var(--color-text-secondary)]">
              {node.node.description || "尚未补充定义"}
            </dd>
          </div>
          <div className="inline-block w-1/2 align-top">
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              版本
            </dt>
            <dd className="mt-1 font-mono text-[var(--color-text-secondary)]">
              v{node.node.node_version}
            </dd>
          </div>
          <div className="inline-block w-1/2 align-top">
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              关系
            </dt>
            <dd className="mt-1 font-mono text-[var(--color-text-secondary)]">
              {node.relation_count.incoming} 入 / {node.relation_count.outgoing} 出
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              Owner
            </dt>
            <dd className="mt-1 font-mono text-[11px] text-[var(--color-text-secondary)]">
              {node.node.owner_ref}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              稳定 ID
            </dt>
            <dd className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-secondary)]">
              {node.node.node_id}
            </dd>
          </div>
        </dl>
      ) : edge ? (
        <dl className="mt-5 space-y-3 text-xs">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              类型 / 家族
            </dt>
            <dd className="mt-1 text-[var(--color-text-secondary)]">
              {edge.edge.edge_type} · {edge.edge.family}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              方向
            </dt>
            <dd className="mt-1 break-all font-mono text-[10px] leading-5 text-[var(--color-text-secondary)]">
              {edge.edge.source_node_id}
              <br />→ {edge.edge.target_node_id}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
              关系属性
            </dt>
            <dd className="mt-1 rounded bg-[var(--color-bg-overlay)] p-2 font-mono text-[10px] leading-4 text-[var(--color-text-secondary)]">
              {JSON.stringify(edge.edge.attributes)}
            </dd>
          </div>
        </dl>
      ) : null}
      <button
        type="button"
        onClick={() =>
          onAskAgent(
            node ? `修改「${node.node.name}」：` : `修改关系「${edge ? edgeLabel(edge) : ""}」：`,
          )
        }
        className="mt-6 w-full rounded-md bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
      >
        让 Agent 修改
      </button>
      <p className="mt-2 text-[10px] leading-4 text-[var(--color-text-secondary)]">
        此入口只向 Agent 提交意图，不直接修改 Node/Edge。
      </p>
    </aside>
  );
}
