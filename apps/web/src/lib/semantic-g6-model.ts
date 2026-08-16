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
  readonly clustering: true;
  readonly nodeClusterBy: (node: NodeData) => string;
  readonly clusterNodeStrength: number;
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

export interface SemanticFullFocusStates {
  readonly elements: Record<string, string[]>;
  readonly focusedNodeIds: ReadonlySet<string>;
  readonly focusedEdgeIds: ReadonlySet<string>;
}

const FULL_FORCE_NODE_SIZE = 28;
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
    clustering: true,
    nodeClusterBy: (node) =>
      typeof node.data?.nodeType === "string" ? node.data.nodeType : "UNKNOWN",
    clusterNodeStrength: 28,
    nodeSize: FULL_FORCE_NODE_SIZE,
    nodeSpacing: FULL_FORCE_NODE_SPACING,
    collideStrength: 1,
    nodeStrength: 1400,
    edgeStrength: 10,
    linkDistance: 168,
    gravity: 1.5,
    factor: 1.1,
    damping: 0.88,
    maxSpeed: 220,
    maxIteration: 1100,
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

const FULL_FORCE_COMMUNITY_ANCHORS: Record<
  SemanticGraphReadNode["node"]["node_type"],
  readonly [number, number]
> = {
  BUSINESS_SUBJECT: [710, 150],
  DIMENSION: [410, 225],
  METRIC: [1010, 215],
  FORMULA: [1165, 500],
  PHYSICAL_TABLE: [810, 690],
  PHYSICAL_COLUMN: [450, 620],
  GLOSSARY_TERM: [205, 425],
};

function fullForceScore(item: SemanticGraphReadNode): number {
  return item.relation_count.total * 10 + FULL_FORCE_LABEL_PRIORITY[item.node.node_type];
}

function fullForceLabelIds(
  items: readonly SemanticGraphReadNode[],
  selectedNodeId: string | null,
): ReadonlySet<string> {
  const labelBudget = Math.max(7, Math.min(8, Math.ceil(Math.sqrt(items.length) * 0.45)));
  const ranked = [...items].sort((left, right) => {
    const leftScore = fullForceScore(left);
    const rightScore = fullForceScore(right);
    return rightScore - leftScore || left.node.name.localeCompare(right.node.name);
  });
  const ids = new Set<string>();
  for (const nodeType of Object.keys(FULL_FORCE_LABEL_PRIORITY)) {
    const representative = ranked.find((item) => item.node.node_type === nodeType);
    if (representative) ids.add(representative.node.node_id);
  }
  for (const item of ranked) {
    if (ids.size >= labelBudget) break;
    ids.add(item.node.node_id);
  }
  if (selectedNodeId) ids.add(selectedNodeId);
  return ids;
}

function fullForceSeedPositions(
  items: readonly SemanticGraphReadNode[],
): ReadonlyMap<string, readonly [number, number]> {
  const byType = new Map<SemanticGraphReadNode["node"]["node_type"], SemanticGraphReadNode[]>();
  for (const item of items) {
    const group = byType.get(item.node.node_type) ?? [];
    group.push(item);
    byType.set(item.node.node_type, group);
  }

  const positions = new Map<string, readonly [number, number]>();
  for (const [nodeType, group] of byType) {
    const [anchorX, anchorY] = FULL_FORCE_COMMUNITY_ANCHORS[nodeType];
    group
      .sort((left, right) => left.node.node_id.localeCompare(right.node.node_id))
      .forEach((item, index) => {
        const angle = index * 2.399963229728653;
        const radius = 12 * Math.sqrt(index);
        positions.set(item.node.node_id, [
          anchorX + Math.cos(angle) * radius,
          anchorY + Math.sin(angle) * radius,
        ]);
      });
  }
  return positions;
}

function forceNodeDatum(
  item: SemanticGraphReadNode,
  selectedNodeId: string | null,
  labeled: boolean,
  seed: readonly [number, number],
): NodeData {
  const selected = item.node.node_id === selectedNodeId;
  const type = SEMANTIC_NODE_PRESENTATION[item.node.node_type];
  const status = SEMANTIC_STATUS_PRESENTATION[item.status];
  const degree = item.relation_count.total;
  const prominent = selected || labeled;
  const size = selected ? 28 : Math.min(22, 8 + Math.sqrt(Math.max(1, degree)) * 2.2);
  return {
    id: item.node.node_id,
    type: "circle",
    states: selected ? ["selected"] : [],
    data: {
      kind: "semantic-node",
      sourceId: item.node.node_id,
      label: nodeLabel(item, selected),
      nodeType: item.node.node_type,
    } satisfies SemanticG6ElementData,
    style: {
      x: seed[0],
      y: seed[1],
      size,
      fill: type.fill,
      stroke: selected ? "#244f43" : item.status === "PUBLISHED" ? "#f7faf8" : status.color,
      lineWidth: selected ? 2.5 : item.status === "PUBLISHED" ? 1 : 2,
      lineDash: statusDash(item.status),
      shadowColor: selected ? "rgba(36, 79, 67, 0.22)" : "rgba(38, 54, 47, 0.11)",
      shadowBlur: selected ? 15 : 5,
      shadowOffsetY: selected ? 4 : 1.5,
      ...(prominent
        ? {
            labelText: nodeLabel(item, selected),
            labelPlacement: "bottom" as const,
            labelOffsetY: 14,
            labelFontFamily: "var(--font-geist-sans), Geist, sans-serif",
            labelFontSize: selected ? 36 : 32,
            labelFontWeight: selected ? 700 : 650,
            labelFill: "#1f2d27",
            labelBackground: true,
            labelBackgroundFill: "rgba(250, 252, 251, 0.96)",
            labelBackgroundStroke: "rgba(199, 210, 204, 0.92)",
            labelBackgroundLineWidth: 1,
            labelBackgroundRadius: 6,
            labelPadding: [4, 9] as [number, number],
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
  const seedPositions = fullForceSeedPositions(graph.nodes);
  return {
    nodes: graph.nodes.map((item) => {
      const seed = seedPositions.get(item.node.node_id) ?? [640, 400];
      return forceNodeDatum(item, selectedNodeId, labeledNodeIds.has(item.node.node_id), seed);
    }),
    edges: semanticEdges(graph.edges, selectedEdgeId, "line", true),
  };
}

export function semanticFullFocusStates(
  graph: SemanticGraphFullResult,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
): SemanticFullFocusStates {
  const focusedNodeIds = new Set<string>();
  const focusedEdgeIds = new Set<string>();

  if (selectedNodeId) {
    focusedNodeIds.add(selectedNodeId);
    for (const { edge } of graph.edges) {
      if (edge.source_node_id !== selectedNodeId && edge.target_node_id !== selectedNodeId) {
        continue;
      }
      focusedEdgeIds.add(edge.edge_id);
      focusedNodeIds.add(edge.source_node_id);
      focusedNodeIds.add(edge.target_node_id);
    }
  } else if (selectedEdgeId) {
    const selected = graph.edges.find((item) => item.edge.edge_id === selectedEdgeId);
    if (selected) {
      focusedEdgeIds.add(selected.edge.edge_id);
      focusedNodeIds.add(selected.edge.source_node_id);
      focusedNodeIds.add(selected.edge.target_node_id);
    }
  }

  const focused = focusedNodeIds.size > 0 || focusedEdgeIds.size > 0;
  const elements: Record<string, string[]> = {};
  for (const { node } of graph.nodes) {
    elements[node.node_id] =
      node.node_id === selectedNodeId
        ? ["selected"]
        : focusedNodeIds.has(node.node_id)
          ? ["related"]
          : focused
            ? ["inactive"]
            : [];
  }
  for (const { edge } of graph.edges) {
    elements[edge.edge_id] =
      edge.edge_id === selectedEdgeId
        ? ["selected"]
        : focusedEdgeIds.has(edge.edge_id)
          ? ["related"]
          : focused
            ? ["inactive"]
            : [];
  }

  return { elements, focusedNodeIds, focusedEdgeIds };
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
