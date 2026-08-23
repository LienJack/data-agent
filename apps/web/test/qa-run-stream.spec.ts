import { type PublicRunEvent, publicRunEventSchema } from "@data-agent/contracts/runs";
import { describe, expect, it, vi } from "vitest";
import {
  createQaRunStream,
  type QaRunStreamDependencies,
  type QaRunStreamSession,
} from "@/lib/qa-run-stream";

const runId = "10000000-0000-4000-8000-000000000041";
const workspaceId = "10000000-0000-4000-8000-000000000042";

function event(sequence: number, type: "lifecycle" | "terminal"): PublicRunEvent {
  return publicRunEventSchema.parse({
    schema_version: "public-run-event@1.0.0",
    event_id: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    run_id: runId,
    sequence,
    occurred_at: "2026-08-23T00:00:00.000Z",
    type,
    payload:
      type === "terminal"
        ? { error_code: null, status: "COMPLETED", summary: "完成" }
        : { name: "run.execute", status: "RUNNING", summary: "执行中" },
  });
}

describe("Q&A Run stream session", () => {
  it("以 sequence 回放、去重、重连并在 terminal 关闭", async () => {
    const received: number[] = [];
    const connections: string[] = [];
    const waits: number[] = [];
    let connection = 0;
    const dependencies: QaRunStreamDependencies = {
      open: vi.fn(async (input) => {
        connection += 1;
        if (connection === 1) {
          expect(input.cursor).toBe(3);
          input.onEvent(event(3, "lifecycle"));
          input.onEvent(event(4, "lifecycle"));
          return;
        }
        expect(input.cursor).toBe(4);
        input.onEvent(event(4, "lifecycle"));
        input.onEvent(event(5, "terminal"));
      }),
      wait: vi.fn(async (attempt) => {
        waits.push(attempt);
      }),
    };
    const session = createQaRunStream(
      {
        initial_cursor: 3,
        onConnection: (state) => connections.push(state),
        onEvent: (next) => received.push(next.sequence),
        run_id: runId,
        workspace_id: workspaceId,
      },
      dependencies,
    );

    await expect(session.run()).resolves.toEqual(
      expect.objectContaining({
        aborted: false,
        cursor: 5,
        exhausted: false,
        reconnect_attempt: 1,
        terminal: true,
      }),
    );
    expect(received).toEqual([4, 5]);
    expect(waits).toEqual([1]);
    expect(connections).toEqual(["connecting", "live", "reconnecting", "closed"]);
  });

  it("abort 后停止重连并保留最后游标", async () => {
    let session: QaRunStreamSession;
    const dependencies: QaRunStreamDependencies = {
      open: vi.fn(async (input) => {
        input.onEvent(event(1, "lifecycle"));
        session.abort();
      }),
      wait: vi.fn(async () => undefined),
    };
    session = createQaRunStream(
      {
        onConnection: vi.fn(),
        onEvent: vi.fn(),
        run_id: runId,
        workspace_id: workspaceId,
      },
      dependencies,
    );

    await expect(session.run()).resolves.toEqual(
      expect.objectContaining({ aborted: true, cursor: 1, exhausted: false, terminal: false }),
    );
    expect(dependencies.open).toHaveBeenCalledTimes(1);
    expect(dependencies.wait).not.toHaveBeenCalled();
  });

  it("拒绝同一 session 启动两次", async () => {
    const session = createQaRunStream(
      {
        max_reconnect_attempts: 0,
        onConnection: vi.fn(),
        onEvent: vi.fn(),
        run_id: runId,
        workspace_id: workspaceId,
      },
      { open: vi.fn(async () => undefined), wait: vi.fn(async () => undefined) },
    );
    await session.run();
    await expect(session.run()).rejects.toThrow("QA_RUN_STREAM_SESSION_ALREADY_STARTED");
  });
});
