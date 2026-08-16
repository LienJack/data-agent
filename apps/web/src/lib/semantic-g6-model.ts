import type { EdgeData, GraphData, NodeData } from "@antv/g6";
import type {
  SemanticGraphFullResult,
  SemanticGraphNeighborhoodResult,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import {
  edgeLabel,
  SEMANTIC_EDGE_FAMILY_PRESENTATION,
  SEMANTIC_NODE_PRESENTATION,
  SEMANTIC_STATUS_PRESENTATION,
} from "./semantic-studio-model";

export type SemanticG6ElementKind = "semantic-node" | "semantic-edge";

export interface SemanticG6ElementData extends Record<string, unknown> {
  readonly kind: SemanticG6ElementKind;
  readonly sourceId: string;
  readonly label?: string;
  readonly nodeType?: SemanticGraphReadNode["node"]["node_type"];
}

export interface SemanticFullForceLayout {
  readonly [key: string]: unknown;
  readonly type: "force";
  readonly preLayout: true;
  readonly animation: false;
  readonly width: number;
  readonly height: number;
  readonly preventOverlap: true;
  readonly nodeSize: number;
  readonly nodeSpacing: number;
  readonly collideStrength: number;
  readonly nodeStrength: number;
  readonly edgeStrength: number;
  readonly linkDistance: number;
  readonly gravity: number;
  readonly factor: number;
  readonly damping: number;
  readonly maxSpeed: number;
  readonly maxIteration: number;
  readonly minMovement: number;
  readonly distanceThresholdMode: "max";
}

const FULL_FORCE_NODE_SIZE = 44;
const FULL_FORCE_NODE_SPACING = 34;
const FULL_FORCE_NODE_PITCH = FULL_FORCE_NODE_SIZE + FULL_FORCE_NODE_SPACING;

/**
 * Give dense ontologies a layout area that grows with their node count.
 * G6 still fits the result into the viewport, but collision is calculated in
 * this larger coordinate space so nodes receive independent positions instead
 * of being compressed into a stack.
 */
export function semanticFullForceLayout(nodeCount: number): SemanticFullForceLayout {
  const safeNodeCount = Math.max(1, Math.floor(nodeCount));
  const columns = Math.ceil(Math.sqrt(safeNodeCount * 1.6));
  const rows = Math.ceil(safeNodeCount / columns);

  return {
    type: "force",
    preLayout: true,
    animation: false,
    width: Math.max(1280, columns * FULL_FORCE_NODE_PITCH),
    height: Math.max(800, rows * FULL_FORCE_NODE_PITCH),
    preventOverlap: true,
    nodeSize: FULL_FORCE_NODE_SIZE,
    nodeSpacing: FULL_FORCE_NODE_SPACING,
    collideStrength: 1,
    nodeStrength: 1600,
    edgeStrength: 36,
    linkDistance: 152,
    gravity: 2,
    factor: 1.15,
    damping: 0.88,
    maxSpeed: 220,
    maxIteration: 900,
    minMovement: 0.18,
    distanceThresholdMode: "max",
  };
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
      nodeType: item.node.node_type,
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

const FULL_FORCE_LABEL_PRIORITY: Record<SemanticGraphReadNode["node"]["node_type"], number> = {
  BUSINESS_SUBJECT: 36,
  METRIC: 28,
  FORMULA: 22,
  DIMENSION: 16,
  PHYSICAL_TABLE: 12,
  GLOSSARY_TERM: 8,
  PHYSICAL_COLUMN: 0,
};

function fullForceLabelIds(
  items: readonly SemanticGraphReadNode[],
  selectedNodeId: string | null,
): ReadonlySet<string> {
  const labelBudget = Math.max(10, Math.min(24, Math.ceil(Math.sqrt(items.length) * 1.25)));
  const ranked = [...items].sort((left, right) => {
    const leftScore =
      left.relation_count.total * 10 + FULL_FORCE_LABEL_PRIORITY[left.node.node_type];
    const rightScore =
      right.relation_count.total * 10 + FULL_FORCE_LABEL_PRIORITY[right.node.node_type];
    return rightScore - leftScore || left.node.name.localeCompare(right.node.name);
  });
  const ids = new Set(ranked.slice(0, labelBudget).map((item) => item.node.node_id));
  if (selectedNodeId) ids.add(selectedNodeId);
  return ids;
}

function forceNodeDatum(
  item: SemanticGraphReadNode,
  selectedNodeId: string | null,
  labeled: boolean,
): NodeData {
  const selected = item.node.node_id === selectedNodeId;
  const type = SEMANTIC_NODE_PRESENTATION[item.node.node_type];
  const status = SEMANTIC_STATUS_PRESENTATION[item.status];
  const degree = item.relation_count.total;
  const prominent = selected || labeled;
  const size = Math.min(38, 16 + Math.sqrt(Math.max(1, degree)) * 4);
  return {
    id: item.node.node_id,
    type: "circle",
    states: selected ? ["selected"] : [],
    data: {
      kind: "semantic-node",
      sourceId: item.node.node_id,
      label: item.node.name,
      nodeType: item.node.node_type,
    } satisfies SemanticG6ElementData,
    style: {
      size,
      fill: type.fill,
      stroke: selected ? "#244f43" : item.status === "PUBLISHED" ? "#f7faf8" : status.color,
      lineWidth: selected ? 3.5 : item.status === "PUBLISHED" ? 1.5 : 3,
      lineDash: statusDash(item.status),
      shadowColor: selected ? "rgba(36, 79, 67, 0.22)" : "rgba(38, 54, 47, 0.11)",
      shadowBlur: selected ? 18 : 7,
      shadowOffsetY: selected ? 5 : 2,
      ...(prominent
        ? {
            labelText: nodeLabel(item, selected),
            labelPlacement: "bottom" as const,
            labelOffsetY: 7,
            labelFontFamily: "var(--font-geist-sans), Geist, sans-serif",
            labelFontSize: selected ? 10.5 : 8.5,
            labelFontWeight: selected ? 650 : 560,
            labelFill: "#33413b",
            labelBackground: true,
            labelBackgroundFill: "rgba(249, 251, 250, 0.9)",
            labelBackgroundStroke: "rgba(215, 222, 218, 0.8)",
            labelBackgroundLineWidth: 1,
            labelBackgroundRadius: 5,
            labelPadding: [2, 5] as [number, number],
          }
        : {}),
    },
  };
}

function semanticEdgeDatum(
  item: SemanticGraphReadEdge,
  selectedEdgeId: string | null,
  curveOffset: number,
  edgeType: "line" | "quadratic" | "cubic-horizontal",
  compact: boolean,
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
      lineWidth: selected ? 2.8 : compact ? 0.8 : 1.25,
      lineDash: statusDash(item.status),
      opacity: selected ? 1 : compact ? 0.22 : 0.48,
      ...(edgeType === "line" ? {} : { curveOffset }),
      endArrow: true,
      endArrowFill: selected ? "#244f43" : stroke,
      endArrowSize: compact ? 3 : 5,
    },
  };
}

function semanticEdges(
  items: readonly SemanticGraphReadEdge[],
  selectedEdgeId: string | null,
  edgeType: "line" | "quadratic" | "cubic-horizontal",
  compact = false,
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
    return semanticEdgeDatum(item, selectedEdgeId, curveOffset, edgeType, compact);
  });
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
  const labeledNodeIds = fullForceLabelIds(graph.nodes, selectedNodeId);
  return {
    nodes: graph.nodes.map((item) =>
      forceNodeDatum(item, selectedNodeId, labeledNodeIds.has(item.node.node_id)),
    ),
    edges: semanticEdges(graph.edges, selectedEdgeId, "line", true),
  };
}

export function semanticG6SourceId(data: unknown): SemanticG6ElementData | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as Partial<SemanticG6ElementData>;
  if (
    (candidate.kind === "semantic-node" || candidate.kind === "semantic-edge") &&
    typeof candidate.sourceId === "string"
  ) {
    return candidate as SemanticG6ElementData;
  }
  return null;
}
