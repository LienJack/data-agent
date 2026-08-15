"use client";

import type {
  SemanticGraphCluster,
  SemanticGraphFullResult,
  SemanticGraphNeighborhoodResult,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import { useMemo } from "react";
import {
  edgeLabel,
  fullGraphClusterPoint,
  localGraphLayout,
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

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function nodeRadius(item: SemanticGraphReadNode, selected: boolean): number {
  if (selected) return 38;
  return item.node.node_type === "BUSINESS_SUBJECT"
    ? 34
    : item.node.node_type === "PHYSICAL_TABLE"
      ? 30
      : 27;
}

function LocalGraph({
  graph,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
}: {
  readonly graph: SemanticGraphNeighborhoodResult;
  readonly selectedNodeId: string | null;
  readonly selectedEdgeId: string | null;
  readonly onSelectNode: (node: SemanticGraphReadNode) => void;
  readonly onSelectEdge: (edge: SemanticGraphReadEdge) => void;
}) {
  const points = useMemo(
    () => localGraphLayout(graph.nodes, graph.center_node_id),
    [graph.center_node_id, graph.nodes],
  );
  return (
    <>
      {graph.edges.map((item) => {
        const source = points.get(item.edge.source_node_id);
        const target = points.get(item.edge.target_node_id);
        if (!source || !target) return null;
        const selected = selectedEdgeId === item.edge.edge_id;
        const status = SEMANTIC_STATUS_PRESENTATION[item.status];
        const midpoint = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
        return (
          // biome-ignore lint/a11y/useSemanticElements: SVG graph controls cannot use HTML button elements; the keyboard table below mirrors selection.
          <g
            key={item.edge.edge_id}
            role="button"
            tabIndex={0}
            aria-label={`${truncate(edgeLabel(item), 17)}，关系 ${edgeLabel(item)}`}
            className="cursor-pointer outline-none"
            onClick={() => onSelectEdge(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelectEdge(item);
            }}
          >
            <line
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={selected ? "#355f54" : status.color}
              strokeWidth={selected ? 2.8 : 1.5}
              strokeDasharray={status.lineDash}
              markerEnd="url(#semantic-arrow)"
              opacity={selected ? 1 : 0.72}
            />
            <rect
              x={midpoint.x - 46}
              y={midpoint.y - 9}
              width={92}
              height={18}
              rx={4}
              fill="#fbfcfb"
              stroke={selected ? "#86a398" : "#e3e6e4"}
            />
            <text
              x={midpoint.x}
              y={midpoint.y + 3.5}
              textAnchor="middle"
              fontSize="9"
              fill="#626965"
            >
              {truncate(edgeLabel(item), 17)}
            </text>
          </g>
        );
      })}
      {graph.nodes.map((item) => {
        const point = points.get(item.node.node_id);
        if (!point) return null;
        const selected = selectedNodeId === item.node.node_id;
        const type = SEMANTIC_NODE_PRESENTATION[item.node.node_type];
        const status = SEMANTIC_STATUS_PRESENTATION[item.status];
        const radius = nodeRadius(item, selected);
        return (
          // biome-ignore lint/a11y/useSemanticElements: SVG graph controls cannot use HTML button elements; the keyboard table below mirrors selection.
          <g
            key={item.node.node_id}
            role="button"
            tabIndex={0}
            aria-label={`${truncate(item.node.name.split(" / ")[0] ?? item.node.name, 13)} ${type.short} · ${item.relation_count.total}，${type.label} ${item.node.name}，${status.label}`}
            className="cursor-pointer outline-none"
            onClick={() => onSelectNode(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelectNode(item);
            }}
          >
            {item.status !== "PUBLISHED" ? (
              <circle
                cx={point.x}
                cy={point.y}
                r={radius + 6}
                fill="none"
                stroke={status.color}
                strokeWidth={3}
                strokeDasharray={status.lineDash}
              />
            ) : null}
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill={type.fill}
              stroke={selected ? "#ebc653" : "#f4d467"}
              strokeWidth={selected ? 5 : 3}
            />
            <text
              x={point.x}
              y={point.y - 3}
              textAnchor="middle"
              fontSize="10"
              fontWeight="700"
              fill={type.text}
            >
              {truncate(item.node.name.split(" / ")[0] ?? item.node.name, 13)}
            </text>
            <text
              x={point.x}
              y={point.y + 11}
              textAnchor="middle"
              fontSize="9"
              fill={type.text}
              opacity="0.9"
            >
              {type.short} · {item.relation_count.total}
            </text>
          </g>
        );
      })}
    </>
  );
}

function FullGraph({
  graph,
  onExpandCluster,
  onSelectNode,
  selectedNodeId,
}: {
  readonly graph: SemanticGraphFullResult;
  readonly onExpandCluster: (cluster: SemanticGraphCluster) => void;
  readonly onSelectNode: (node: SemanticGraphReadNode) => void;
  readonly selectedNodeId: string | null;
}) {
  const expandedPoints = useMemo(
    () => localGraphLayout(graph.nodes, graph.nodes[0]?.node.node_id ?? ""),
    [graph.nodes],
  );
  return (
    <>
      {graph.clusters.map((cluster) => {
        const point = fullGraphClusterPoint(cluster);
        const radius = Math.min(74, 35 + Math.sqrt(cluster.node_count) * 3.4);
        return (
          // biome-ignore lint/a11y/useSemanticElements: SVG graph controls cannot use HTML button elements; the keyboard table below mirrors selection.
          <g
            key={cluster.cluster_id}
            role="button"
            tabIndex={0}
            aria-label={`${truncate(cluster.label, 24)}，${cluster.node_count} 个节点，${cluster.edge_count} 关系`}
            className="cursor-pointer outline-none"
            onClick={() => onExpandCluster(cluster)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onExpandCluster(cluster);
            }}
          >
            <circle cx={point.x} cy={point.y} r={radius + 9} fill="#dfece6" opacity="0.65" />
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill="#f8fbf9"
              stroke="#6f9a8d"
              strokeWidth="2.2"
            />
            <circle cx={point.x} cy={point.y} r={Math.max(9, radius * 0.24)} fill="#527c70" />
            <text
              x={point.x}
              y={point.y - radius - 17}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="#26302c"
            >
              {truncate(cluster.label, 24)}
            </text>
            <text
              x={point.x}
              y={point.y + 4}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="#ffffff"
            >
              {cluster.node_count}
            </text>
            <text
              x={point.x}
              y={point.y + radius + 22}
              textAnchor="middle"
              fontSize="10"
              fill="#68736e"
            >
              {cluster.edge_count} 关系
              {cluster.candidate_count > 0 ? ` · ${cluster.candidate_count} 候选` : ""}
            </text>
          </g>
        );
      })}
      {graph.nodes.map((item) => {
        const point = expandedPoints.get(item.node.node_id);
        if (!point) return null;
        const type = SEMANTIC_NODE_PRESENTATION[item.node.node_type];
        const selected = selectedNodeId === item.node.node_id;
        return (
          // biome-ignore lint/a11y/useSemanticElements: SVG graph controls cannot use HTML button elements; the keyboard table below mirrors selection.
          <g
            key={item.node.node_id}
            role="button"
            tabIndex={0}
            aria-label={`${truncate(item.node.name, 14)}，${type.label} ${item.node.name}`}
            className="cursor-pointer"
            onClick={() => onSelectNode(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelectNode(item);
            }}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={selected ? 22 : 17}
              fill={type.fill}
              stroke="#f4d467"
              strokeWidth={selected ? 4 : 2}
            />
            <text x={point.x} y={point.y + 31} textAnchor="middle" fontSize="9" fill="#4e5954">
              {truncate(item.node.name, 14)}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function SemanticGraphCanvas(props: SemanticGraphCanvasProps) {
  const graph = props.mode === "local" ? props.local : props.full;
  const empty =
    props.mode === "local"
      ? !props.local || props.local.nodes.length === 0
      : props.full.clusters.length + props.full.nodes.length === 0;
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
      {props.mode === "local" && props.local?.truncated ? (
        <div className="absolute right-4 top-4 z-10 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          已按预算截断：省略 {props.local.omitted_node_count} 节点 /{" "}
          {props.local.omitted_edge_count} 关系
        </div>
      ) : null}
      {empty ? (
        <div className="flex min-h-[560px] items-center justify-center text-sm text-[var(--color-text-secondary)]">
          当前范围没有可见节点
        </div>
      ) : (
        <svg viewBox="0 0 1000 620" className="h-[min(68vh,720px)] min-h-[560px] w-full" role="img">
          <title>
            {props.mode === "local" ? "以选中节点为中心的关系图" : "按领域分群的语义全图"}
          </title>
          <defs>
            <pattern id="semantic-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="#dfe4e1" />
            </pattern>
            <marker
              id="semantic-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#66736d" />
            </marker>
          </defs>
          <rect width="1000" height="620" fill="url(#semantic-grid)" />
          {props.mode === "local" && props.local ? (
            <LocalGraph
              graph={props.local}
              selectedNodeId={props.selectedNodeId}
              selectedEdgeId={props.selectedEdgeId}
              onSelectNode={props.onSelectNode}
              onSelectEdge={props.onSelectEdge}
            />
          ) : (
            <FullGraph
              graph={props.full}
              onExpandCluster={props.onExpandCluster}
              onSelectNode={props.onSelectNode}
              selectedNodeId={props.selectedNodeId}
            />
          )}
        </svg>
      )}
      {graph ? (
        <details className="border-t border-[var(--color-border-default)] bg-white px-4 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-[var(--color-text-secondary)]">
            无障碍表格视图
          </summary>
          <div className="mt-3 max-h-48 overflow-auto">
            <table className="w-full text-left">
              <thead className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th className="pb-2">名称</th>
                  <th>类型</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {("nodes" in graph ? graph.nodes : []).map((item) => (
                  <tr
                    key={item.node.node_id}
                    className="border-t border-[var(--color-border-default)]"
                  >
                    <td className="py-2">{item.node.name}</td>
                    <td>{SEMANTIC_NODE_PRESENTATION[item.node.node_type].label}</td>
                    <td>{SEMANTIC_STATUS_PRESENTATION[item.status].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
