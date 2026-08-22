import { buildResolutionTrace } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  buildResolutionTraceWorkbenchModel,
  projectTimelineRecords,
  resolveResolutionTraceRefresh,
} from "@/lib/resolution-trace-workbench";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

describe("Resolution Trace workbench model", () => {
  it("preserves historical focus on same-Run append and follows only an existing tail", () => {
    expect(
      resolveResolutionTraceRefresh({
        runChanged: false,
        focusedNodeId: null,
        selectedNodeId: "event:2",
        selectedNodeStillExists: true,
        previousLastNodeId: "event:3",
        nextLastNodeId: "event:5",
        previousCount: 3,
        nextCount: 5,
      }),
    ).toEqual({
      selectedNodeId: "event:2",
      appendedCount: 2,
      resetView: false,
      followedTail: false,
    });
    expect(
      resolveResolutionTraceRefresh({
        runChanged: false,
        focusedNodeId: null,
        selectedNodeId: "event:3",
        selectedNodeStillExists: true,
        previousLastNodeId: "event:3",
        nextLastNodeId: "event:5",
        previousCount: 3,
        nextCount: 5,
      }),
    ).toEqual({
      selectedNodeId: "event:5",
      appendedCount: 2,
      resetView: false,
      followedTail: true,
    });
  });

  it("resets view state and selects the new tail when the Run changes", () => {
    expect(
      resolveResolutionTraceRefresh({
        runChanged: true,
        focusedNodeId: null,
        selectedNodeId: "event:old",
        selectedNodeStillExists: false,
        previousLastNodeId: "event:old",
        nextLastNodeId: "event:new",
        previousCount: 20,
        nextCount: 1,
      }),
    ).toEqual({
      selectedNodeId: "event:new",
      appendedCount: 0,
      resetView: true,
      followedTail: true,
    });
  });

  it("maps all ten public node kinds to exactly one semantic lane", async () => {
    const expected = {
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
    } as const;
    const kinds = Object.keys(expected) as (keyof typeof expected)[];
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: null,
      config_ref: null,
      nodes: kinds.map((kind, index) => ({
        node_id: `event:${id(index + 100)}`,
        kind,
        source_event_id: id(index + 100),
        sequence: index + 1,
        occurred_at: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
        status: ["RUNNING", "WAITING", "FAILED", "COMPLETED"][index % 4] as
          | "RUNNING"
          | "WAITING"
          | "FAILED"
          | "COMPLETED",
        title: kind,
        summary: `${kind} 公开摘要`,
        duration_ms: index % 2 === 0 ? null : 20,
        artifact_refs: [],
      })),
      edges: [],
    });

    const model = buildResolutionTraceWorkbenchModel(trace);
    expect(Object.fromEntries(model.records.map(({ node, lane }) => [node.kind, lane]))).toEqual(
      expected,
    );
    expect(new Set(model.records.map(({ node_id }) => node_id)).size).toBe(10);
  });

  it("maps public nodes to one lane and derives stable searchable statistics", async () => {
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: id(4),
      config_ref: null,
      nodes: [
        {
          node_id: `event:${id(5)}`,
          kind: "LIFECYCLE",
          source_event_id: id(5),
          sequence: 1,
          occurred_at: "2026-08-22T00:00:00.000Z",
          status: "RUNNING",
          title: "run.leased",
          summary: "Worker 已开始执行",
          duration_ms: null,
          artifact_refs: [],
        },
        {
          node_id: `event:${id(6)}`,
          kind: "TOOL",
          source_event_id: id(6),
          sequence: 2,
          occurred_at: "2026-08-22T00:00:01.000Z",
          status: "FAILED",
          title: "sql.sandbox.execute",
          summary: "执行失败 SQL_TIMEOUT",
          duration_ms: 250,
          artifact_refs: [],
        },
      ],
      edges: [
        {
          from_node_id: `event:${id(5)}`,
          to_node_id: `event:${id(6)}`,
          kind: "SEQUENCE",
        },
      ],
    });

    const model = buildResolutionTraceWorkbenchModel(trace);
    expect(model.records.map(({ lane }) => lane)).toEqual(["RUN", "TOOL"]);
    expect(model.stats).toMatchObject({ nodes: 2, calls: 1, failed_or_waiting: 1 });
    expect(model.real_time_domain.duration_ms).toBe(1_250);
    expect(model.search("sql_timeout").map(({ node_id }) => node_id)).toEqual([`event:${id(6)}`]);
    expect(model.records[1]?.parent_node_ids).toEqual([`event:${id(5)}`]);
  });

  it("keeps a 10,000-node projection bounded and deterministic", async () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({
      node_id: `event:${id(index + 10)}`,
      kind: "PROGRESS" as const,
      source_event_id: id(index + 10),
      sequence: index + 1,
      occurred_at: new Date(Date.UTC(2026, 7, 22, 0, 0, 0, index)).toISOString(),
      status: "COMPLETED" as const,
      title: `Step ${index + 1}`,
      summary: `公开步骤 ${index + 1}`,
      duration_ms: null,
      artifact_refs: [],
    }));
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: null,
      config_ref: null,
      nodes,
      edges: [],
    });
    const model = buildResolutionTraceWorkbenchModel(trace);
    expect(model.records).toHaveLength(10_000);
    expect(model.search("Step 10000")).toHaveLength(1);
    const projected = projectTimelineRecords(model.records, {
      selectedNodeId: model.records[9_999]?.node_id,
      matchNodeIds: new Set([model.records[9_998]?.node_id ?? ""]),
    });
    expect(projected).toHaveLength(300);
    expect(projected.at(-1)?.node_id).toBe(model.records.at(-1)?.node_id);
    expect(projected.some(({ node_id }) => node_id === model.records[9_998]?.node_id)).toBe(true);
  });

  it("never drops a selected or matched tail behind more than 300 problem nodes", async () => {
    const nodes = Array.from({ length: 1_000 }, (_, index) => ({
      node_id: `event:${id(index + 10)}`,
      kind: "PROGRESS" as const,
      source_event_id: id(index + 10),
      sequence: index + 1,
      occurred_at: new Date(Date.UTC(2026, 7, 22, 0, 0, 0, index)).toISOString(),
      status: index < 900 ? ("FAILED" as const) : ("COMPLETED" as const),
      title: `Step ${index + 1}`,
      summary: `公开步骤 ${index + 1}`,
      duration_ms: null,
      artifact_refs: [],
    }));
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: null,
      config_ref: null,
      nodes,
      edges: [],
    });
    const model = buildResolutionTraceWorkbenchModel(trace);
    const selectedNodeId = model.records[998]?.node_id ?? null;
    const matchedNodeId = model.records[999]?.node_id ?? "";
    const projected = projectTimelineRecords(model.records, {
      selectedNodeId,
      matchNodeIds: new Set([matchedNodeId]),
    });
    expect(projected).toHaveLength(300);
    expect(projected.some(({ node_id }) => node_id === selectedNodeId)).toBe(true);
    expect(projected.some(({ node_id }) => node_id === matchedNodeId)).toBe(true);
  });
});
