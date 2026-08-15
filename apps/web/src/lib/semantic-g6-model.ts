import type { EdgeData, GraphData, NodeData } from "@antv/g6";
import type {
  SemanticGraphCluster,
  SemanticGraphFullResult,
  SemanticGraphNeighborhoodResult,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import {
  edgeLabel,
  fullGraphClusterPoint,
  localGraphLayout,
  SEMANTIC_EDGE_FAMILY_PRESENTATION,
  SEMANTIC_NODE_PRESENTATION,
  SEMANTIC_STATUS_PRESENTATION,
} from "./semantic-studio-model";

export type SemanticG6ElementKind = "semantic-node" | "semantic-edge" | "cluster";

export interface SemanticG6ElementData extends Record<string, unknown> {
  readonly kind: SemanticG6ElementKind;
  readonly sourceId: string;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function statusDash(status: SemanticGraphReadNode["status"]): number[] | undefined {
  return status === "RETIRED" ? [7, 5] : undefined;
}

function nodeSize(item: SemanticGraphReadNode, selected: boolean): number {
  if (selected) return 74;
  if (item.node.node_type === "BUSINESS_SUBJECT") return 66;
  if (item.node.node_type === "PHYSICAL_TABLE") return 58;
  return 52;
}

function semanticNodeDatum(item: SemanticGraphReadNode, selectedNodeId: string | null): NodeData {
  const selected = item.node.node_id === selectedNodeId;
  const type = SEMANTIC_NODE_PRESENTATION[item.node.node_type];
  const status = SEMANTIC_STATUS_PRESENTATION[item.status];
  return {
    id: item.node.node_id,
    type: "circle",
    states: selected ? ["selected"] : [],
    data: {
      kind: "semantic-node",
      sourceId: item.node.node_id,
    } satisfies SemanticG6ElementData,
    style: {
      size: nodeSize(item, selected),
      fill: type.fill,
      stroke: item.status === "PUBLISHED" ? "#f4d467" : status.color,
      lineWidth: selected ? 5 : item.status === "PUBLISHED" ? 3 : 4,
      lineDash: statusDash(item.status),
      shadowColor: selected ? "rgba(38, 66, 58, 0.24)" : "transparent",
      shadowBlur: selected ? 14 : 0,
      labelText: truncate(item.node.name.split(" / ")[0] ?? item.node.name, 17),
      labelPlacement: "bottom",
      labelFontSize: 11,
      labelFontWeight: 600,
      labelFill: "#34413c",
      labelBackground: true,
      labelBackgroundFill: "rgba(251, 252, 251, 0.9)",
      labelBackgroundRadius: 4,
      labelPadding: [2, 4],
      iconText: type.short.slice(0, 2),
      iconFontSize: 10,
      iconFontWeight: 700,
      iconFill: type.text,
    },
  };
}

function semanticEdgeDatum(item: SemanticGraphReadEdge, selectedEdgeId: string | null): EdgeData {
  const selected = item.edge.edge_id === selectedEdgeId;
  const status = SEMANTIC_STATUS_PRESENTATION[item.status];
  const family = SEMANTIC_EDGE_FAMILY_PRESENTATION[item.edge.family];
  const stroke = item.status === "PUBLISHED" ? family.color : status.color;
  return {
    id: item.edge.edge_id,
    source: item.edge.source_node_id,
    target: item.edge.target_node_id,
    type: "line",
    states: selected ? ["selected"] : [],
    data: {
      kind: "semantic-edge",
      sourceId: item.edge.edge_id,
    } satisfies SemanticG6ElementData,
    style: {
      stroke: selected ? "#294f45" : stroke,
      lineWidth: selected ? 3 : 1.6,
      lineDash: statusDash(item.status),
      opacity: selected ? 1 : 0.76,
      endArrow: true,
      endArrowFill: selected ? "#294f45" : stroke,
      labelText: truncate(edgeLabel(item), 20),
      labelFontSize: 9,
      labelFill: "#5f6964",
      labelBackground: true,
      labelBackgroundFill: "rgba(251, 252, 251, 0.94)",
      labelBackgroundStroke: selected ? "#86a398" : "#e3e6e4",
      labelBackgroundLineWidth: 1,
      labelBackgroundRadius: 4,
      labelPadding: [2, 4],
    },
  };
}

function clusterDatum(cluster: SemanticGraphCluster): NodeData {
  const point = fullGraphClusterPoint(cluster);
  const size = Math.min(148, 70 + Math.sqrt(cluster.node_count) * 6.8);
  return {
    id: cluster.cluster_id,
    type: "circle",
    data: {
      kind: "cluster",
      sourceId: cluster.cluster_id,
    } satisfies SemanticG6ElementData,
    style: {
      x: point.x,
      y: point.y,
      size,
      fill: "#f4faf7",
      stroke: cluster.candidate_count > 0 ? "#b06b13" : "#5d8b7d",
      lineWidth: cluster.candidate_count > 0 ? 4 : 3,
      shadowColor: "rgba(47, 95, 80, 0.18)",
      shadowBlur: 22,
      halo: true,
      haloStroke: "#d8ebe3",
      haloLineWidth: 10,
      labelText: `${truncate(cluster.label, 24)}\n${cluster.node_count} 节点 · ${cluster.edge_count} 关系`,
      labelPlacement: "bottom",
      labelFontSize: 11,
      labelFontWeight: 650,
      labelFill: "#263a33",
      labelBackground: true,
      labelBackgroundFill: "rgba(251, 252, 251, 0.92)",
      labelBackgroundRadius: 5,
      labelPadding: [3, 6],
      iconText: String(cluster.node_count),
      iconFontSize: Math.min(18, 11 + Math.sqrt(cluster.node_count)),
      iconFontWeight: 700,
      iconFill: "#315f52",
    },
  };
}

export function buildLocalG6Data(
  graph: SemanticGraphNeighborhoodResult,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
): GraphData {
  const points = localGraphLayout(graph.nodes, graph.center_node_id);
  return {
    nodes: graph.nodes.map((item) => {
      const datum = semanticNodeDatum(item, selectedNodeId);
      const point = points.get(item.node.node_id);
      return {
        ...datum,
        style: { ...datum.style, x: point?.x ?? 500, y: point?.y ?? 310 },
      };
    }),
    edges: graph.edges.map((item) => semanticEdgeDatum(item, selectedEdgeId)),
  };
}

export function buildFullG6Data(
  graph: SemanticGraphFullResult,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
): GraphData {
  const expandedPoints = localGraphLayout(graph.nodes, graph.nodes[0]?.node.node_id ?? "");
  return {
    nodes: [
      ...graph.clusters.map(clusterDatum),
      ...graph.nodes.map((item) => {
        const datum = semanticNodeDatum(item, selectedNodeId);
        const point = expandedPoints.get(item.node.node_id);
        return {
          ...datum,
          style: { ...datum.style, x: point?.x ?? 500, y: point?.y ?? 310 },
        };
      }),
    ],
    edges: graph.edges.map((item) => semanticEdgeDatum(item, selectedEdgeId)),
  };
}

export function semanticG6SourceId(data: unknown): SemanticG6ElementData | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as Partial<SemanticG6ElementData>;
  if (
    (candidate.kind === "semantic-node" ||
      candidate.kind === "semantic-edge" ||
      candidate.kind === "cluster") &&
    typeof candidate.sourceId === "string"
  ) {
    return candidate as SemanticG6ElementData;
  }
  return null;
}
