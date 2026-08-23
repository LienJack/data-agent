import { publicRunEventSchema, type QaInspectorTarget } from "@data-agent/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseQAInspectorTarget } from "@/lib/qa-inspector-target";
import { acceptsRunStreamFrame, useQAStore } from "@/lib/qa-store";

const workspaceId = "10000000-0000-4000-8000-000000000010";
const conversationId = "10000000-0000-4000-8000-000000000011";
const runId = "10000000-0000-4000-8000-000000000012";
const taskId = "10000000-0000-4000-8000-000000000013";
const target: QaInspectorTarget = {
  kind: "subagent",
  run_id: runId,
  profile_id: "report-writing-agent",
  task_id: taskId,
  anchor_sequence: 1,
};
const agent = publicRunEventSchema.parse({
  schema_version: "public-run-event@2.0.0",
  event_id: "10000000-0000-4000-8000-000000000014",
  run_id: runId,
  sequence: 1,
  occurred_at: "2026-08-21T00:00:00.000Z",
  type: "agent",
  payload: {
    profile_id: "report-writing-agent",
    task_id: taskId,
    status: "RUNNING",
    phase: "report.compose",
    title: "Report",
    summary: "正在撰写报告",
    duration_ms: null,
    error_code: null,
  },
});
const originalLoadMessages = useQAStore.getState().loadMessages;

beforeEach(() => {
  const location = {
    pathname: `/w/${workspaceId}/qa`,
    href: `http://localhost:3000/w/${workspaceId}/qa`,
  };
  vi.stubGlobal("window", {
    location,
    history: {
      replaceState: vi.fn((_state, _title, next: URL | string) => {
        location.href = String(next);
      }),
    },
    localStorage: { getItem: vi.fn(), setItem: vi.fn() },
  });
  useQAStore.getState().reset();
  useQAStore.setState({
    activeConversationId: conversationId,
    events: [agent],
    messages: [
      {
        id: "10000000-0000-4000-8000-000000000015",
        conversationId,
        role: "agent",
        content: "",
        type: "text",
        runId,
        createdAt: "2026-08-21T00:00:00.000Z",
      },
    ],
  });
});

afterEach(() => {
  useQAStore.setState({ loadMessages: originalLoadMessages });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QA Inspector store selection", () => {
  it("preserves the bootstrap target across StrictMode's double conversation effect", async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("conversation", conversationId);
    url.searchParams.set("inspector", JSON.stringify(target));
    window.location.href = url.href;
    const loadMessages = vi.fn(async () => {});
    useQAStore.setState({ loadMessages });

    const firstTarget = parseQAInspectorTarget(new URL(window.location.href).searchParams);
    const firstSelection = useQAStore
      .getState()
      .selectConversation(conversationId, { preserveInspectorQuery: true });
    const secondTarget = parseQAInspectorTarget(new URL(window.location.href).searchParams);
    const secondSelection = useQAStore
      .getState()
      .selectConversation(conversationId, { preserveInspectorQuery: true });
    await Promise.all([firstSelection, secondSelection]);

    expect(firstTarget).toEqual(target);
    expect(secondTarget).toEqual(target);
    expect(loadMessages).toHaveBeenCalledTimes(2);
    useQAStore.setState({ events: [agent] });
    useQAStore.getState().restoreInspector(firstTarget);
    useQAStore.getState().restoreInspector(secondTarget);
    expect(parseQAInspectorTarget(new URL(window.location.href).searchParams)).toEqual(target);
    expect(useQAStore.getState().inspectorTarget).toEqual(target);
  });

  it("restores the same target and conversation across two reload round-trips", () => {
    useQAStore.getState().selectInspector(target, "trigger-report");
    const firstUrl = new URL(window.location.href);
    expect(firstUrl.searchParams.get("conversation")).toBe(conversationId);
    expect(parseQAInspectorTarget(firstUrl.searchParams)).toEqual(target);

    useQAStore.setState({ inspectorTarget: null });
    useQAStore.getState().restoreInspector(parseQAInspectorTarget(firstUrl.searchParams));
    const secondUrl = new URL(window.location.href);
    expect(parseQAInspectorTarget(secondUrl.searchParams)).toEqual(target);
    expect(secondUrl.searchParams.get("conversation")).toBe(conversationId);

    useQAStore.setState({ inspectorTarget: null });
    useQAStore.getState().restoreInspector(parseQAInspectorTarget(secondUrl.searchParams));
    expect(useQAStore.getState().inspectorTarget).toEqual(target);
    expect(parseQAInspectorTarget(new URL(window.location.href).searchParams)).toEqual(target);
  });

  it("rejects a target whose Run is outside the active conversation replay", () => {
    useQAStore
      .getState()
      .selectInspector(
        { ...target, run_id: "10000000-0000-4000-8000-000000000099" },
        "foreign-trigger",
      );
    expect(useQAStore.getState()).toMatchObject({
      inspectorTarget: null,
      error: "INSPECTOR_RUN_NOT_IN_ACTIVE_CONVERSATION",
    });
  });

  it("rejects late SSE frames after a conversation or Run generation changes", () => {
    expect(acceptsRunStreamFrame(conversationId, runId, conversationId, runId)).toBe(true);
    expect(
      acceptsRunStreamFrame("10000000-0000-4000-8000-000000000099", runId, conversationId, runId),
    ).toBe(false);
    expect(
      acceptsRunStreamFrame(
        conversationId,
        "10000000-0000-4000-8000-000000000099",
        conversationId,
        runId,
      ),
    ).toBe(false);
  });
});
