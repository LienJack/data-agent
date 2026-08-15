"use client";

import type { Graph as G6Graph, IElementEvent } from "@antv/g6";
import type {
  SemanticGraphCluster,
  SemanticGraphFullResult,
  SemanticGraphNeighborhoodResult,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildFullG6Data, buildLocalG6Data, semanticG6SourceId } from "@/lib/semantic-g6-model";
import {
  edgeLabel,
  SEMANTIC_NODE_PRESENTATION,
  SEMANTIC_STATUS_PRESENTATION,
} from "@/lib/semantic-studio-model";

interface SemanticGraphCanvasProps {
  readonly mode: "local" | "full";
  readonly local: SemanticGraphNeighborhoodResult | null;
  readonly full: SemanticGraphFullResult;
  readonly selectedNodeId: string | null;
  readonly selectedEdgeId: string | null;
  readonly onSelectNode: (node: SemanticGraphReadNode) => void;
  readonly onSelectEdge: (edge: SemanticGraphReadEdge) => void;
  readonly onExpandCluster: (cluster: SemanticGraphCluster) => void;
}

type GraphCallbacks = Pick<
  SemanticGraphCanvasProps,
  "onSelectNode" | "onSelectEdge" | "onExpandCluster"
>;

export function SemanticGraphCanvas(props: SemanticGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const callbacksRef = useRef<GraphCallbacks>(props);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const graph = props.mode === "local" ? props.local : props.full;
  const empty =
    props.mode === "local"
      ? !props.local || props.local.nodes.length === 0
      : props.full.clusters.length + props.full.nodes.length === 0;
  const g6Data = useMemo(() => {
    if (props.mode === "local") {
      return props.local
        ? buildLocalG6Data(props.local, props.selectedNodeId, props.selectedEdgeId)
        : { nodes: [], edges: [] };
    }
    return buildFullG6Data(props.full, props.selectedNodeId, props.selectedEdgeId);
  }, [props.full, props.local, props.mode, props.selectedEdgeId, props.selectedNodeId]);
  const nodeById = useMemo(
    () =>
      new Map(
        (graph?.nodes ?? []).map(
          (item) => [item.node.node_id, item] satisfies readonly [string, SemanticGraphReadNode],
        ),
      ),
    [graph],
  );
  const edgeById = useMemo(
    () =>
      new Map(
        (graph?.edges ?? []).map(
          (item) => [item.edge.edge_id, item] satisfies readonly [string, SemanticGraphReadEdge],
        ),
      ),
    [graph],
  );
  const clusterById = useMemo(
    () =>
      new Map(
        props.full.clusters.map(
          (item) => [item.cluster_id, item] satisfies readonly [string, SemanticGraphCluster],
        ),
      ),
    [props.full.clusters],
  );

  useEffect(() => {
    callbacksRef.current = props;
  }, [props]);

  useEffect(() => {
    if (empty || !containerRef.current) return;
    let cancelled = false;
    let mountedGraph: G6Graph | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let renderSettled = false;
    let destroyed = false;
    setReady(false);
    setRenderError(null);

    function destroyMountedGraph() {
      if (destroyed) return;
      destroyed = true;
      if (graphRef.current === mountedGraph) graphRef.current = null;
      mountedGraph?.destroy();
    }

    async function mountGraph() {
      const container = containerRef.current;
      if (!container) return;
      const { EdgeEvent, Graph, NodeEvent } = await import("@antv/g6");
      if (cancelled) return;
      const instance = new Graph({
        container,
        data: g6Data,
        autoFit: "view",
        animation: false,
        behaviors: [
          "drag-canvas",
          "zoom-canvas",
          { type: "click-select", multiple: false },
          "drag-element",
          { type: "hover-activate", degree: 1 },
        ],
        plugins: [
          {
            key: "semantic-minimap",
            type: "minimap",
            size: [150, 96],
            position: "right-bottom",
            delay: 80,
            containerStyle: {
              background: "rgba(251, 252, 251, 0.94)",
              border: "1px solid #d8dedb",
              borderRadius: "6px",
              overflow: "hidden",
            },
            maskStyle: { border: "1px solid #507d70" },
          },
        ],
        node: {
          state: {
            selected: { lineWidth: 5, stroke: "#244f43", shadowBlur: 18 },
            active: { opacity: 1 },
            inactive: { opacity: 0.24 },
          },
          animation: false,
        },
        edge: {
          state: {
            selected: { lineWidth: 3.5, stroke: "#244f43", opacity: 1 },
            active: { opacity: 1 },
            inactive: { opacity: 0.14 },
          },
          animation: false,
        },
        ...(props.mode === "local"
          ? {
              layout: {
                type: "d3-force",
                animation: false,
                link: { distance: 150, strength: 0.8 },
                manyBody: { strength: -520 },
                collide: { radius: 52, strength: 0.9 },
                x: { strength: 0.08 },
                y: { strength: 0.08 },
              },
            }
          : {}),
      });
      mountedGraph = instance;
      graphRef.current = instance;

      instance.on(NodeEvent.CLICK, (event: IElementEvent) => {
        const datum = instance.getElementData(String(event.target.id));
        const source = semanticG6SourceId(datum.data);
        if (!source) return;
        if (source.kind === "cluster") {
          const cluster = clusterById.get(source.sourceId);
          if (cluster) callbacksRef.current.onExpandCluster(cluster);
          return;
        }
        const node = nodeById.get(source.sourceId);
        if (node) callbacksRef.current.onSelectNode(node);
      });
      instance.on(EdgeEvent.CLICK, (event: IElementEvent) => {
        const datum = instance.getElementData(String(event.target.id));
        const source = semanticG6SourceId(datum.data);
        if (source?.kind !== "semantic-edge") return;
        const edge = edgeById.get(source.sourceId);
        if (edge) callbacksRef.current.onSelectEdge(edge);
      });

      await instance.render();
      renderSettled = true;
      if (cancelled) {
        destroyMountedGraph();
        return;
      }
      for (const canvas of container.querySelectorAll("canvas")) {
        canvas.tabIndex = -1;
        canvas.setAttribute("aria-hidden", "true");
      }
      setReady(true);
      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) instance.resize();
      });
      resizeObserver.observe(container);
    }

    void mountGraph().catch((error: unknown) => {
      renderSettled = true;
      destroyMountedGraph();
      if (cancelled) return;
      setRenderError(error instanceof Error ? error.message : "G6 图谱渲染失败");
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (renderSettled) destroyMountedGraph();
    };
  }, [clusterById, edgeById, empty, g6Data, nodeById, props.mode]);

  return (
    <section
      id={props.mode === "full" ? "semantic-full-graph" : undefined}
      className="relative min-h-[560px] overflow-hidden rounded-lg border border-[var(--color-border-default)] bg-[#fbfcfb]"
      aria-label={props.mode === "local" ? "节点局部关系图" : "语义全图"}
    >
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap gap-2 text-[10px] text-[var(--color-text-secondary)]">
        {Object.entries(SEMANTIC_STATUS_PRESENTATION).map(([status, item]) => (
          <span
            key={status}
            className="inline-flex items-center gap-1.5 rounded bg-white/90 px-2 py-1 shadow-sm"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded border border-[var(--color-border-default)] bg-white/92 p-1 shadow-sm">
        <button
          type="button"
          aria-label="放大关系图"
          onClick={() => void graphRef.current?.zoomBy(1.2)}
          className="grid size-7 place-items-center rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
        >
          +
        </button>
        <button
          type="button"
          aria-label="缩小关系图"
          onClick={() => void graphRef.current?.zoomBy(0.8)}
          className="grid size-7 place-items-center rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
        >
          −
        </button>
        <button
          type="button"
          aria-label="适应关系图视图"
          onClick={() => void graphRef.current?.fitView()}
          className="rounded px-2 py-1.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
        >
          适应
        </button>
      </div>
      {props.mode === "local" && props.local?.truncated ? (
        <div className="absolute right-32 top-4 z-10 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          已按预算截断：省略 {props.local.omitted_node_count} 节点 /{" "}
          {props.local.omitted_edge_count} 关系
        </div>
      ) : null}
      {empty ? (
        <div className="flex min-h-[560px] items-center justify-center text-sm text-[var(--color-text-secondary)]">
          当前范围没有可见节点
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            role="img"
            aria-label={
              props.mode === "local"
                ? "AntV G6 绘制的选中节点局部关系图"
                : "AntV G6 绘制的 GraphRAG 风格分群语义全图"
            }
            className="h-[min(68vh,720px)] min-h-[560px] w-full bg-[radial-gradient(circle_at_1px_1px,#dfe4e1_1px,transparent_0)] bg-[length:24px_24px]"
          />
          {!ready && !renderError ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-[var(--color-text-secondary)]">
              正在初始化 AntV G6 图谱…
            </div>
          ) : null}
          {renderError ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white/80 px-6 text-center text-xs text-red-700">
              {renderError}。请使用下方无障碍表格继续浏览。
            </div>
          ) : null}
        </>
      )}
      {graph ? (
        <details className="border-t border-[var(--color-border-default)] bg-white px-4 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-[var(--color-text-secondary)]">
            键盘与读屏表格视图
          </summary>
          <div className="mt-3 max-h-56 overflow-auto">
            {"clusters" in graph && graph.clusters.length > 0 ? (
              <div className="mb-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                  社区分群
                </p>
                <div className="flex flex-wrap gap-2">
                  {graph.clusters.map((cluster) => (
                    <button
                      key={cluster.cluster_id}
                      type="button"
                      onClick={() => props.onExpandCluster(cluster)}
                      className="rounded border border-[var(--color-border-default)] px-2 py-1.5 text-left hover:bg-[var(--color-bg-secondary)]"
                    >
                      {cluster.label} · {cluster.node_count} 节点 · {cluster.edge_count} 关系
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <table className="w-full text-left">
              <thead className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th className="pb-2">名称</th>
                  <th>类型</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {graph.nodes.map((item) => (
                  <tr
                    key={item.node.node_id}
                    className="border-t border-[var(--color-border-default)]"
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => props.onSelectNode(item)}
                        className="text-left font-medium hover:underline"
                      >
                        {item.node.name}
                      </button>
                    </td>
                    <td>{SEMANTIC_NODE_PRESENTATION[item.node.node_type].label}</td>
                    <td>{SEMANTIC_STATUS_PRESENTATION[item.status].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {graph.edges.length > 0 ? (
              <div className="mt-4 border-t border-[var(--color-border-default)] pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                  关系
                </p>
                <div className="flex flex-wrap gap-2">
                  {graph.edges.map((item) => (
                    <button
                      key={item.edge.edge_id}
                      type="button"
                      onClick={() => props.onSelectEdge(item)}
                      className="rounded border border-[var(--color-border-default)] px-2 py-1.5 hover:bg-[var(--color-bg-secondary)]"
                    >
                      {edgeLabel(item)} · {SEMANTIC_STATUS_PRESENTATION[item.status].label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
