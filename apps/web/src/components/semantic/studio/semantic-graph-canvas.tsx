"use client";

import type { Graph as G6Graph, IElementEvent } from "@antv/g6";
import type {
  SemanticEdgeFamily,
  SemanticGraphCluster,
  SemanticGraphFullResult,
  SemanticGraphNeighborhoodResult,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import { CornersOut, Minus, Plus } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildFullG6Data, buildLocalG6Data, semanticG6SourceId } from "@/lib/semantic-g6-model";
import {
  edgeLabel,
  SEMANTIC_NODE_PRESENTATION,
  SEMANTIC_STATUS_PRESENTATION,
} from "@/lib/semantic-studio-model";

interface SemanticGraphCanvasProps {
  readonly mode: "local" | "full";
  readonly families: readonly SemanticEdgeFamily[];
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

  const localGraph = useMemo(() => {
    if (props.local === null || props.families.length === 0) return props.local;
    const edges = props.local.edges.filter((item) => props.families.includes(item.edge.family));
    const visibleNodeIds = new Set<string>([props.local.center_node_id]);
    for (const { edge } of edges) {
      visibleNodeIds.add(edge.source_node_id);
      visibleNodeIds.add(edge.target_node_id);
    }
    return {
      ...props.local,
      nodes: props.local.nodes.filter((item) => visibleNodeIds.has(item.node.node_id)),
      edges,
    };
  }, [props.families, props.local]);
  const fullGraph = useMemo(() => {
    if (props.families.length === 0) return props.full;
    const edges = props.full.edges.filter((item) => props.families.includes(item.edge.family));
    const visibleNodeIds = new Set<string>();
    for (const { edge } of edges) {
      visibleNodeIds.add(edge.source_node_id);
      visibleNodeIds.add(edge.target_node_id);
    }
    return {
      ...props.full,
      nodes: props.full.nodes.filter((item) => visibleNodeIds.has(item.node.node_id)),
      edges,
    };
  }, [props.families, props.full]);
  const graph = props.mode === "local" ? localGraph : fullGraph;
  const empty =
    props.mode === "local"
      ? !localGraph || localGraph.nodes.length === 0
      : fullGraph.clusters.length + fullGraph.nodes.length === 0;
  const g6Data = useMemo(() => {
    if (props.mode === "local") {
      return localGraph
        ? buildLocalG6Data(localGraph, props.selectedNodeId, props.selectedEdgeId)
        : { nodes: [], edges: [] };
    }
    return buildFullG6Data(fullGraph, props.selectedNodeId, props.selectedEdgeId);
  }, [fullGraph, localGraph, props.mode, props.selectedEdgeId, props.selectedNodeId]);
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
        autoFit:
          props.mode === "local"
            ? { type: "center" }
            : { type: "view", options: { when: "always", direction: "both" } },
        padding: props.mode === "local" ? [80, 44, 58, 44] : [92, 82, 82, 82],
        zoom: props.mode === "local" ? 0.72 : 1,
        zoomRange: [0.18, 1.8],
        animation: false,
        behaviors: [
          "drag-canvas",
          "zoom-canvas",
          { type: "click-select", multiple: false },
          "drag-element",
          { type: "hover-activate", degree: 1 },
        ],
        plugins:
          props.mode === "full"
            ? [
                {
                  key: "semantic-minimap",
                  type: "minimap",
                  size: [144, 92],
                  position: "right-bottom",
                  delay: 80,
                  containerStyle: {
                    background: "rgba(255, 255, 255, 0.94)",
                    border: "1px solid #d8dedb",
                    borderRadius: "10px",
                    overflow: "hidden",
                    boxShadow: "0 10px 30px rgba(38, 52, 45, 0.08)",
                  },
                  maskStyle: { border: "1px solid #507d70" },
                },
              ]
            : [],
        node: {
          state: {
            selected: {
              lineWidth: 3,
              stroke: "#244f43",
              shadowColor: "rgba(36, 79, 67, 0.2)",
              shadowBlur: 20,
              shadowOffsetY: 7,
            },
            active: {
              opacity: 1,
              lineWidth: 2.5,
              shadowColor: "rgba(36, 79, 67, 0.14)",
              shadowBlur: 14,
            },
            inactive: { opacity: 0.16 },
          },
          animation: false,
        },
        edge: {
          state: {
            selected: (datum) => ({
              lineWidth: 3,
              stroke: "#244f43",
              opacity: 1,
              labelText: typeof datum.data?.label === "string" ? datum.data.label : "关系",
              labelFontFamily: "var(--font-geist-mono), monospace",
              labelFontSize: 9,
              labelFontWeight: 650,
              labelFill: "#2c3b35",
              labelBackground: true,
              labelBackgroundFill: "rgba(255, 255, 255, 0.97)",
              labelBackgroundStroke: "#87a49a",
              labelBackgroundLineWidth: 1,
              labelBackgroundRadius: 6,
              labelPadding: [3, 6],
            }),
            active: (datum) => ({
              opacity: 0.94,
              lineWidth: 2,
              labelText: typeof datum.data?.label === "string" ? datum.data.label : "关系",
              labelFontFamily: "var(--font-geist-mono), monospace",
              labelFontSize: 8.5,
              labelFill: "#4c5b55",
              labelBackground: true,
              labelBackgroundFill: "rgba(255, 255, 255, 0.96)",
              labelBackgroundStroke: "#d8dfdb",
              labelBackgroundLineWidth: 1,
              labelBackgroundRadius: 5,
              labelPadding: [2, 5],
            }),
            inactive: { opacity: 0.07 },
          },
          animation: false,
        },
        ...(props.mode === "local"
          ? {
              layout: {
                type: "antv-dagre",
                animation: false,
                rankdir: "LR",
                align: "UL",
                nodesep: 26,
                ranksep: 38,
                nodeSize: [150, 58],
                ranker: "network-simplex",
                controlPoints: false,
                edgeLabelSpace: false,
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
      className="relative min-h-[560px] overflow-hidden bg-[#f7f9f7]"
      aria-label={props.mode === "local" ? "节点局部关系图" : "语义全图"}
    >
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-136px)] rounded-[10px] border border-white/80 bg-white/88 px-3 py-2 shadow-[0_8px_24px_rgba(38,52,45,0.06)] backdrop-blur-sm sm:left-4 sm:top-4">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#356b5a]">
          {props.mode === "local" ? "Ontology flow" : "Community map"}
        </p>
        <p className="mt-0.5 text-[9px] text-[#74807a]">
          {props.mode === "local"
            ? "按语义方向分层 · 悬停显示关系名"
            : "环形占比表示 Node 类型构成 · 点击社区展开"}
        </p>
      </div>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-[10px] border border-white/80 bg-white/90 p-1 shadow-[0_8px_24px_rgba(38,52,45,0.08)] backdrop-blur-sm sm:right-4 sm:top-4">
        <button
          type="button"
          aria-label="放大关系图"
          onClick={() => void graphRef.current?.zoomBy(1.2)}
          className="grid size-7 place-items-center rounded-[7px] text-[#627069] transition-[background-color,color,transform] duration-200 hover:bg-[#edf1ee] hover:text-[#285b4b] active:scale-[0.96]"
          title="放大"
        >
          <Plus className="size-3.5" weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="缩小关系图"
          onClick={() => void graphRef.current?.zoomBy(0.8)}
          className="grid size-7 place-items-center rounded-[7px] text-[#627069] transition-[background-color,color,transform] duration-200 hover:bg-[#edf1ee] hover:text-[#285b4b] active:scale-[0.96]"
          title="缩小"
        >
          <Minus className="size-3.5" weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="适应关系图视图"
          onClick={() => void graphRef.current?.fitView()}
          className="grid size-7 place-items-center rounded-[7px] text-[#627069] transition-[background-color,color,transform] duration-200 hover:bg-[#edf1ee] hover:text-[#285b4b] active:scale-[0.96]"
          title="适应视图"
        >
          <CornersOut className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {props.mode === "local" && props.local?.truncated ? (
        <div className="absolute right-32 top-4 z-10 border-l-2 border-amber-500 bg-amber-50 px-3 py-1.5 text-[10px] text-amber-800">
          已按预算截断：省略 {props.local.omitted_node_count} 节点 /{" "}
          {props.local.omitted_edge_count} 关系
        </div>
      ) : null}
      {empty ? (
        <div className="flex min-h-[560px] items-center justify-center text-sm text-[#6d7973]">
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
            className="h-[calc(100dvh-402px)] min-h-[560px] max-h-[780px] w-full bg-[radial-gradient(circle_at_50%_44%,rgba(214,231,223,0.42),transparent_42%),linear-gradient(rgba(245,248,246,0.94),rgba(250,251,250,0.98))]"
          />
          {!ready && !renderError ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-[#6d7973]">
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
        <details className="border-t border-[#d7ddd9] bg-white px-4 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-[#65716b]">
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
