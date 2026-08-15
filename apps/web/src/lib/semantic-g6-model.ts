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
  readonly label?: string;
}

const NODE_SURFACES = {
  BUSINESS_SUBJECT: "#fff7f4",
  DIMENSION: "#f3fafc",
  METRIC: "#fff9ec",
  FORMULA: "#fff9ef",
  PHYSICAL_TABLE: "#f5f7f6",
  PHYSICAL_COLUMN: "#fafbfa",
  GLOSSARY_TERM: "#f4f9f6",
} as const;

const CLUSTER_DONUT_ORDER = [
  "BUSINESS_SUBJECT",
  "DIMENSION",
  "METRIC",
  "FORMULA",
  "PHYSICAL_TABLE",
  "PHYSICAL_COLUMN",
  "GLOSSARY_TERM",
] as const;

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function nodeLabel(item: SemanticGraphReadNode, selected: boolean): string {
  const parts = item.node.name.split(" / ").map((part) => part.trim());
  if (parts.length < 2) return truncate(item.node.name, selected ? 21 : 18);
  const technicalName = truncate(parts[0] ?? item.node.name, selected ? 18 : 15);
  const businessName = truncate(parts.slice(1).join(" / "), selected ? 16 : 13);
  return `${businessName}\n${technicalName}`;
}

function statusDash(status: SemanticGraphReadNode["status"]): number[] | undefined {
  return status === "RETIRED" ? [7, 5] : undefined;
}

function nodeSize(item: SemanticGraphReadNode, selected: boolean): [number, number] {
  if (selected) return [164, 64];
  if (item.node.node_type === "BUSINESS_SUBJECT") return [142, 54];
  if (item.node.node_type === "PHYSICAL_TABLE") return [138, 52];
  if (item.node.node_type === "PHYSICAL_COLUMN") return [132, 42];
  return [136, 50];
}

function semanticNodeDatum(item: SemanticGraphReadNode, selectedNodeId: string | null): NodeData {
  const selected = item.node.node_id === selectedNodeId;
  const type = SEMANTIC_NODE_PRESENTATION[item.node.node_type];
  const status = SEMANTIC_STATUS_PRESENTATION[item.status];
  return {
    id: item.node.node_id,
    type: "rect",
    states: selected ? ["selected"] : [],
    data: {
      kind: "semantic-node",
      sourceId: item.node.node_id,
      label: item.node.name,
    } satisfies SemanticG6ElementData,
    style: {
      size: nodeSize(item, selected),
      radius: selected ? 14 : 11,
      fill: NODE_SURFACES[item.node.node_type],
      stroke: selected ? "#244f43" : item.status === "PUBLISHED" ? type.fill : status.color,
      lineWidth: selected ? 3 : item.status === "PUBLISHED" ? 1.5 : 2.5,
      lineDash: statusDash(item.status),
      shadowColor: selected ? "rgba(36, 79, 67, 0.18)" : "rgba(36, 49, 43, 0.08)",
      shadowBlur: selected ? 18 : 8,
      shadowOffsetY: selected ? 6 : 3,
      labelText: nodeLabel(item, selected),
      labelPlacement: "center",
      labelFontFamily: "var(--font-geist-sans), Geist, sans-serif",
      labelFontSize: selected ? 11.5 : 10.5,
      labelFontWeight: selected ? 650 : 580,
      labelFill: "#26332e",
      labelWordWrap: true,
      labelMaxWidth: selected ? 124 : 106,
      badges: [
        {
          text: type.short,
          placement: "left-top",
          offsetX: 7,
          offsetY: 5,
          fontFamily: "var(--font-geist-sans), Geist, sans-serif",
          fontSize: 8,
          fontWeight: 700,
          fill: type.fill,
          backgroundFill: "#ffffff",
          backgroundStroke: `${type.fill}66`,
          backgroundLineWidth: 1,
          backgroundRadius: 4,
          padding: [2, 4],
        },
        ...(item.status === "PUBLISHED"
          ? []
          : [
              {
                text: status.label,
                placement: "right-top" as const,
                offsetX: -7,
                offsetY: 5,
                fontFamily: "var(--font-geist-sans), Geist, sans-serif",
                fontSize: 8,
                fontWeight: 650,
                fill: status.color,
                backgroundFill: status.surface,
                backgroundStroke: `${status.color}55`,
                backgroundLineWidth: 1,
                backgroundRadius: 4,
                padding: [2, 4],
              },
            ]),
      ],
    },
  };
}

function semanticEdgeDatum(
  item: SemanticGraphReadEdge,
  selectedEdgeId: string | null,
  curveOffset: number,
  edgeType: "quadratic" | "cubic-horizontal",
): EdgeData {
  const selected = item.edge.edge_id === selectedEdgeId;
  const status = SEMANTIC_STATUS_PRESENTATION[item.status];
  const family = SEMANTIC_EDGE_FAMILY_PRESENTATION[item.edge.family];
  const stroke = item.status === "PUBLISHED" ? family.color : status.color;
  const label = truncate(edgeLabel(item), 22);
  return {
    id: item.edge.edge_id,
    source: item.edge.source_node_id,
    target: item.edge.target_node_id,
    type: edgeType,
    states: selected ? ["selected"] : [],
    data: {
      kind: "semantic-edge",
      sourceId: item.edge.edge_id,
      label,
    } satisfies SemanticG6ElementData,
    style: {
      stroke: selected ? "#244f43" : stroke,
      lineWidth: selected ? 2.8 : 1.25,
      lineDash: statusDash(item.status),
      opacity: selected ? 1 : 0.48,
      curveOffset,
      endArrow: true,
      endArrowFill: selected ? "#244f43" : stroke,
      endArrowSize: 5,
    },
  };
}

function semanticEdges(
  items: readonly SemanticGraphReadEdge[],
  selectedEdgeId: string | null,
  edgeType: "quadratic" | "cubic-horizontal",
): EdgeData[] {
  const byPair = new Map<string, SemanticGraphReadEdge[]>();
  for (const item of items) {
    const key = [item.edge.source_node_id, item.edge.target_node_id].sort().join("\u0000");
    const group = byPair.get(key) ?? [];
    group.push(item);
    byPair.set(key, group);
  }
  return items.map((item) => {
    const key = [item.edge.source_node_id, item.edge.target_node_id].sort().join("\u0000");
    const group = byPair.get(key) ?? [item];
    const index = group.findIndex((candidate) => candidate.edge.edge_id === item.edge.edge_id);
    const curveOffset = group.length === 1 ? 0 : (index - (group.length - 1) / 2) * 22;
    return semanticEdgeDatum(item, selectedEdgeId, curveOffset, edgeType);
  });
}

function clusterDatum(cluster: SemanticGraphCluster): NodeData {
  const point = fullGraphClusterPoint(cluster);
  const size = Math.min(148, 70 + Math.sqrt(cluster.node_count) * 6.8);
  return {
    id: cluster.cluster_id,
    type: "donut",
    data: {
      kind: "cluster",
      sourceId: cluster.cluster_id,
      label: cluster.label,
    } satisfies SemanticG6ElementData,
    style: {
      x: point.x,
      y: point.y,
      size,
      innerR: "72%",
      donuts: CLUSTER_DONUT_ORDER.map((nodeType) => ({
        value: cluster.node_type_counts[nodeType] ?? 0,
        color: SEMANTIC_NODE_PRESENTATION[nodeType].fill,
      })).filter((segment) => segment.value > 0),
      fill: "#ffffff",
      stroke: cluster.candidate_count > 0 ? "#a76b16" : "#d7dfda",
      lineWidth: cluster.candidate_count > 0 ? 2.5 : 1.5,
      shadowColor: "rgba(38, 54, 47, 0.12)",
      shadowBlur: 20,
      shadowOffsetY: 8,
      labelText: `${truncate(cluster.label, 24)}\n${cluster.node_count} 节点 · ${cluster.edge_count} 关系`,
      labelPlacement: "bottom",
      labelOffsetY: 12,
      labelFontFamily: "var(--font-geist-sans), Geist, sans-serif",
      labelFontSize: 11.5,
      labelFontWeight: 650,
      labelFill: "#263a33",
      labelBackground: true,
      labelBackgroundFill: "rgba(255, 255, 255, 0.96)",
      labelBackgroundStroke: "#e1e6e3",
      labelBackgroundLineWidth: 1,
      labelBackgroundRadius: 7,
      labelPadding: [5, 8],
      iconText: String(cluster.node_count),
      iconFontFamily: "var(--font-geist-mono), monospace",
      iconFontSize: Math.min(20, 12 + Math.sqrt(cluster.node_count)),
      iconFontWeight: 700,
      iconFill: "#2e4f45",
      badges:
        cluster.candidate_count > 0
          ? [
              {
                text: `${cluster.candidate_count} 候选`,
                placement: "right-top",
                fontSize: 8,
                fontWeight: 650,
                fill: "#8a570d",
                backgroundFill: "#fff4df",
                backgroundStroke: "#e8c98d",
                backgroundRadius: 5,
                padding: [2, 5],
              },
            ]
          : [],
    },
  };
}

export function buildLocalG6Data(
  graph: SemanticGraphNeighborhoodResult,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
): GraphData {
  return {
    nodes: graph.nodes.map((item) => semanticNodeDatum(item, selectedNodeId)),
    edges: semanticEdges(graph.edges, selectedEdgeId, "cubic-horizontal"),
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
    edges: semanticEdges(graph.edges, selectedEdgeId, "quadratic"),
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
