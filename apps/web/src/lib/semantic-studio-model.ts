import type {
  SemanticAuthoringPublicEvent,
  SemanticGraphCluster,
  SemanticGraphEntryStatus,
  SemanticGraphNode,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
  SemanticNodeType,
} from "@data-agent/contracts";

export type SemanticStudioView = "nodes" | "local" | "full";

export const SEMANTIC_NODE_PRESENTATION: Record<
  SemanticNodeType,
  { readonly label: string; readonly short: string; readonly fill: string; readonly text: string }
> = {
  BUSINESS_SUBJECT: { label: "业务主体", short: "主体", fill: "#b94b37", text: "#ffffff" },
  DIMENSION: { label: "维度", short: "维度", fill: "#2f7f9f", text: "#ffffff" },
  METRIC: { label: "指标", short: "指标", fill: "#d19a2d", text: "#2c2414" },
  FORMULA: { label: "公式", short: "公式", fill: "#815716", text: "#ffffff" },
  PHYSICAL_TABLE: { label: "物理表", short: "表", fill: "#66736d", text: "#ffffff" },
  PHYSICAL_COLUMN: { label: "物理列", short: "列", fill: "#88918d", text: "#ffffff" },
};

export const SEMANTIC_STATUS_PRESENTATION: Record<
  SemanticGraphEntryStatus,
  {
    readonly label: string;
    readonly color: string;
    readonly surface: string;
    readonly lineDash: string;
  }
> = {
  PUBLISHED: { label: "已发布", color: "#555e59", surface: "#eef0ee", lineDash: "0" },
  ADDED: { label: "新增", color: "#2f6b58", surface: "#eaf5ef", lineDash: "0" },
  MODIFIED: { label: "已修改", color: "#80530c", surface: "#fff4df", lineDash: "0" },
  RETIRED: { label: "待退役", color: "#b64b3c", surface: "#fcece9", lineDash: "6 5" },
};

export function semanticNodeSearchText(item: SemanticGraphReadNode): string {
  const { node } = item;
  return [
    node.node_id,
    node.name,
    node.description ?? "",
    node.owner_ref,
    ...node.aliases,
    ...node.tags,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function filterSemanticNodes(
  nodes: readonly SemanticGraphReadNode[],
  input: {
    readonly search: string;
    readonly nodeType: SemanticNodeType | "ALL";
    readonly status: SemanticGraphEntryStatus | "ALL";
    readonly owner?: string;
    readonly lifecycle?: SemanticGraphNode["lifecycle"] | "ALL";
    readonly domain?: string;
  },
): readonly SemanticGraphReadNode[] {
  const search = input.search.trim().toLocaleLowerCase();
  const owner = input.owner?.trim().toLocaleLowerCase() ?? "";
  const domain = input.domain?.trim().toLocaleLowerCase() ?? "";
  return nodes.filter(
    (item) =>
      (search.length === 0 || semanticNodeSearchText(item).includes(search)) &&
      (input.nodeType === "ALL" || item.node.node_type === input.nodeType) &&
      (input.status === "ALL" || item.status === input.status) &&
      (owner.length === 0 || item.node.owner_ref.toLocaleLowerCase().includes(owner)) &&
      (!input.lifecycle || input.lifecycle === "ALL" || item.node.lifecycle === input.lifecycle) &&
      (domain.length === 0 || semanticNodeSearchText(item).includes(domain)),
  );
}

export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

export function localGraphLayout(
  nodes: readonly SemanticGraphReadNode[],
  centerNodeId: string,
): ReadonlyMap<string, GraphPoint> {
  const result = new Map<string, GraphPoint>();
  result.set(centerNodeId, { x: 500, y: 310 });
  const outer = nodes.filter(({ node }) => node.node_id !== centerNodeId);
  const rings = Math.max(1, Math.ceil(outer.length / 14));
  outer.forEach(({ node }, index) => {
    const ring = Math.floor(index / 14);
    const ringStart = ring * 14;
    const ringCount = Math.min(14, outer.length - ringStart);
    const angle = ((index - ringStart) / Math.max(1, ringCount)) * Math.PI * 2 - Math.PI / 2;
    const radius = 175 + (ring / Math.max(1, rings - 1)) * 105;
    result.set(node.node_id, {
      x: 500 + Math.cos(angle) * radius,
      y: 310 + Math.sin(angle) * radius,
    });
  });
  return result;
}

export function fullGraphClusterPoint(cluster: SemanticGraphCluster): GraphPoint {
  return {
    x: 500 + cluster.position.x * 390,
    y: 310 + cluster.position.y * 245,
  };
}

export function edgeLabel(item: SemanticGraphReadEdge): string {
  const attributes = item.edge.attributes;
  return attributes.kind === "BUSINESS_RELATION"
    ? attributes.relationship_name
    : item.edge.edge_type.replaceAll("_", " ");
}

export function mergeAuthoringEvents(
  current: readonly SemanticAuthoringPublicEvent[],
  incoming: readonly SemanticAuthoringPublicEvent[],
): readonly SemanticAuthoringPublicEvent[] {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export function publicEventSummary(event: SemanticAuthoringPublicEvent): string {
  switch (event.type) {
    case "stage":
      return event.payload.summary;
    case "tool":
      return `${event.payload.tool_name} · ${event.payload.status}`;
    case "graph_patch":
      return `候选图更新至 revision ${event.payload.to_working_revision}`;
    case "validation":
      return event.payload.valid
        ? "确定性校验通过"
        : `发现 ${event.payload.issues.length} 个校验问题`;
    case "clarification":
      return event.payload.question;
    case "authoring_terminal":
      return event.payload.summary;
  }
}
