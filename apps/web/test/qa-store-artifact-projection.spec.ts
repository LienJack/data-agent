import { publicRunEventSchema } from "@data-agent/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQAStore } from "@/lib/qa-store";

const ids = {
  workspace: "51000000-0000-4000-8000-000000000001",
  conversation: "51000000-0000-4000-8000-000000000002",
  datasource: "51000000-0000-4000-8000-000000000003",
  model: "51000000-0000-4000-8000-000000000004",
  run: "51000000-0000-4000-8000-000000000005",
  task: "51000000-0000-4000-8000-000000000006",
} as const;

const queryEvidenceRef = {
  artifact_id: "51000000-0000-4000-8000-000000000007",
  artifact_type: "QueryEvidence" as const,
  app_id: "51000000-0000-4000-8000-000000000008",
  tenant_id: ids.workspace,
  environment: "test" as const,
  run_id: ids.run,
  revision: 1,
  content_hash: `sha256:${"a".repeat(64)}` as const,
};
const chartRef = {
  ...queryEvidenceRef,
  artifact_id: "51000000-0000-4000-8000-000000000009",
  artifact_type: "ArtifactWorkspaceDocument" as const,
  content_hash: `sha256:${"b".repeat(64)}` as const,
};

function runEvent(
  sequence: number,
  type: "tool" | "agent" | "answer" | "terminal",
  payload: Record<string, unknown>,
) {
  return publicRunEventSchema.parse({
    schema_version: "public-run-event@2.0.0",
    event_id: `52000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    run_id: ids.run,
    sequence,
    occurred_at: `2026-08-27T12:00:0${sequence}.000Z`,
    type,
    payload,
  });
}

const events = [
  runEvent(1, "tool", {
    call_id: "text2sql-1",
    tool_name: "text2sql.execute",
    profile_id: "governed-text2sql-agent",
    task_id: ids.task,
    title: "执行查询",
    summary: "查询和图表已提交",
    status: "COMPLETED",
    input: null,
    output: "12 rows",
    duration_ms: 42,
    error_code: null,
    artifact_refs: [chartRef, queryEvidenceRef],
  }),
  runEvent(2, "agent", {
    profile_id: "governed-text2sql-agent",
    task_id: ids.task,
    status: "COMPLETED",
    phase: "query.accepted",
    title: "Text2SQL",
    summary: "查询结果已验收",
    duration_ms: 48,
    error_code: null,
  }),
  runEvent(3, "answer", { delta: "收入趋势已完成。" }),
  runEvent(4, "terminal", { status: "COMPLETED", summary: "完成", error_code: null }),
];

function projection(status: "QUEUED" | "COMPLETED") {
  return {
    runId: ids.run,
    status,
    question: "最近 12 个月收入趋势",
    reports: [],
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:04.000Z",
    l2Only: false,
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {
    location: {
      pathname: `/w/${ids.workspace}/qa`,
      href: `http://localhost:3000/w/${ids.workspace}/qa`,
    },
    history: { replaceState: vi.fn() },
    sessionStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
  });
  useQAStore.getState().reset();
  useQAStore.setState({
    activeConversationId: ids.conversation,
    conversations: [
      {
        id: ids.conversation,
        title: "收入分析",
        dataSourceId: ids.datasource,
        modelProfileId: ids.model,
        resourceVersion: 1,
        messageCount: 0,
        sortOrder: 0,
        lifecycle: "ACTIVE",
        liveState: "IDLE",
        unreadCompleted: false,
        createdAt: "2026-08-27T12:00:00.000Z",
        updatedAt: "2026-08-27T12:00:00.000Z",
      },
    ],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Conversation accepted Artifact projection", () => {
  it("persists only accepted current-Run table and chart refs with the final answer", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/events/stream")) {
        const body = events
          .map((event) => `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`)
          .join("");
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (url.endsWith(`/qa/conversations/${ids.conversation}/runs`)) {
        return Response.json(projection("QUEUED"), { status: 202 });
      }
      if (url.endsWith(`/runs/${ids.run}`)) {
        return Response.json(projection("COMPLETED"));
      }
      if (url.endsWith(`/qa/conversations/${ids.conversation}/trajectory`)) {
        return Response.json({
          data: {
            schema_version: "conversation-trajectory@2.0.0",
            conversation_id: ids.conversation,
            events,
          },
        });
      }
      if (
        url.endsWith(`/qa/conversations/${ids.conversation}/messages`) &&
        init?.method === "POST"
      ) {
        return Response.json({ data: null }, { status: 201 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(useQAStore.getState().sendMessage("最近 12 个月收入趋势")).resolves.toBe(true);

    const persistedCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/messages") && init?.method === "POST",
    );
    const persisted = JSON.parse(String(persistedCall?.[1]?.body));
    expect(persisted).toMatchObject({
      role: "agent",
      run_id: ids.run,
      content: "收入趋势已完成。",
      metadata: {
        event_sequence: 4,
        accepted_artifact_refs: [queryEvidenceRef, chartRef],
      },
    });
    expect(
      useQAStore.getState().messages.find((message) => message.runId === ids.run),
    ).toMatchObject({
      metadata: {
        event_sequence: 4,
        accepted_artifact_refs: [queryEvidenceRef, chartRef],
      },
    });
  });
});
