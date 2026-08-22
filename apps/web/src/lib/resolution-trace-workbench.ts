import type { ResolutionTrace, ResolutionTraceNode } from "@data-agent/contracts";

export type ResolutionTraceLane = "RUN" | "AGENT" | "TOOL" | "EVIDENCE";

const laneByKind: Record<ResolutionTraceNode["kind"], ResolutionTraceLane> = {
  LIFECYCLE: "RUN",
  PROGRESS: "RUN",
  TERMINAL: "RUN",
  AGENT: "AGENT",
  REASONING: "AGENT",
  ANSWER: "AGENT",
  TOOL: "TOOL",
  SQL: "TOOL",
  CONTEXT: "EVIDENCE",
  ARTIFACT: "EVIDENCE",
};

export interface ResolutionTraceWorkbenchRecord {
  readonly node: ResolutionTraceNode;
  readonly node_id: string;
  readonly lane: ResolutionTraceLane;
  readonly start_ms: number;
  readonly end_ms: number;
  readonly sequence_position: number;
  readonly parent_node_ids: readonly string[];
  readonly child_node_ids: readonly string[];
  readonly search_text: string;
}

export interface ResolutionTraceWorkbenchModel {
  readonly records: readonly ResolutionTraceWorkbenchRecord[];
  readonly stats: {
    readonly nodes: number;
    readonly calls: number;
    readonly failed_or_waiting: number;
    readonly duration_ms: number;
  };
  readonly real_time_domain: {
    readonly start_ms: number;
    readonly end_ms: number;
    readonly duration_ms: number;
  };
  readonly sequence_domain: { readonly start: number; readonly end: number };
  search(query: string): readonly ResolutionTraceWorkbenchRecord[];
}

const priorityStatuses = new Set(["FAILED", "CANCELLED", "WAITING", "BLOCKED", "INTERRUPTED"]);

export function projectTimelineRecords(
  records: readonly ResolutionTraceWorkbenchRecord[],
  options: {
    readonly maxPerLane?: number;
    readonly selectedNodeId?: string | null;
    readonly matchNodeIds?: ReadonlySet<string>;
  } = {},
): readonly ResolutionTraceWorkbenchRecord[] {
  const maxPerLane = Math.max(1, options.maxPerLane ?? 300);
  const included = new Set<string>();
  const lanes: readonly ResolutionTraceLane[] = ["RUN", "AGENT", "TOOL", "EVIDENCE"];

  for (const lane of lanes) {
    const laneRecords = records.filter((record) => record.lane === lane);
    if (laneRecords.length <= maxPerLane) {
      for (const record of laneRecords) included.add(record.node_id);
      continue;
    }

    const priority = laneRecords.filter(
      (record) =>
        record.node_id === options.selectedNodeId ||
        priorityStatuses.has(record.node.status) ||
        options.matchNodeIds?.has(record.node_id),
    );
    for (const record of priority.slice(0, maxPerLane)) included.add(record.node_id);

    const remaining = maxPerLane - Math.min(priority.length, maxPerLane);
    if (remaining <= 0) continue;
    const candidates = laneRecords.filter((record) => !included.has(record.node_id));
    for (let index = 0; index < remaining; index += 1) {
      const candidate = candidates[Math.floor((index * candidates.length) / remaining)];
      if (candidate) included.add(candidate.node_id);
    }
  }

  return records.filter((record) => included.has(record.node_id));
}

function normalizedSearchText(node: ResolutionTraceNode): string {
  return [node.title, node.summary, node.kind, node.status, node.sequence ?? "derived"]
    .join("\n")
    .toLocaleLowerCase("zh-CN");
}

export function buildResolutionTraceWorkbenchModel(
  trace: ResolutionTrace,
): ResolutionTraceWorkbenchModel {
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  for (const edge of trace.edges) {
    const parentSet = parents.get(edge.to_node_id) ?? new Set<string>();
    parentSet.add(edge.from_node_id);
    parents.set(edge.to_node_id, parentSet);
    const childSet = children.get(edge.from_node_id) ?? new Set<string>();
    childSet.add(edge.to_node_id);
    children.set(edge.from_node_id, childSet);
  }
  const parsedTimes = trace.nodes.map((node) => Date.parse(node.occurred_at));
  const domainStart = parsedTimes.length > 0 ? Math.min(...parsedTimes) : 0;
  const records = trace.nodes.map((node, index): ResolutionTraceWorkbenchRecord => {
    const start = parsedTimes[index] ?? domainStart;
    return {
      node,
      node_id: node.node_id,
      lane: laneByKind[node.kind],
      start_ms: start,
      end_ms: start + (node.duration_ms ?? 0),
      sequence_position: node.sequence ?? trace.nodes.length + index + 1,
      parent_node_ids: [...(parents.get(node.node_id) ?? [])].sort(),
      child_node_ids: [...(children.get(node.node_id) ?? [])].sort(),
      search_text: normalizedSearchText(node),
    };
  });
  const rawEnd =
    records.length > 0 ? Math.max(...records.map(({ end_ms }) => end_ms)) : domainStart;
  const domainEnd = Math.max(domainStart, rawEnd);
  const duration = domainEnd - domainStart;
  const stats = {
    nodes: records.length,
    calls: records.filter(({ node }) => node.kind === "TOOL" || node.kind === "SQL").length,
    failed_or_waiting: records.filter(({ node }) =>
      ["FAILED", "CANCELLED", "WAITING", "BLOCKED", "INTERRUPTED"].includes(node.status),
    ).length,
    duration_ms: duration,
  };
  return {
    records,
    stats,
    real_time_domain: { start_ms: domainStart, end_ms: domainEnd, duration_ms: duration },
    sequence_domain: { start: 1, end: Math.max(1, records.length) },
    search(query) {
      const normalized = query.trim().toLocaleLowerCase("zh-CN");
      return normalized.length === 0
        ? records
        : records.filter(({ search_text }) => search_text.includes(normalized));
    },
  };
}
