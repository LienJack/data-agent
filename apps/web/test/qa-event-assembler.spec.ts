import { type PublicRunEvent, publicRunEventSchema } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { parseEventBlock } from "../src/lib/api-client";
import {
  answerText,
  assembleProcessRows,
  groupTrajectoryEvents,
  mergePublicRunEvents,
} from "../src/lib/qa-event-assembler";
import { selectSseCursor } from "../src/lib/sse-cursor";

const runId = "10000000-0000-4000-8000-000000000001";

function event(
  sequence: number,
  value:
    | { type: "answer"; payload: { delta: string } }
    | {
        type: "progress";
        payload: {
          phase: string;
          title: string;
          summary: string;
          status: "RUNNING" | "COMPLETED";
        };
      }
    | {
        type: "tool";
        payload: {
          call_id: string;
          tool_name: string;
          title: string;
          summary: string;
          status: "RUNNING" | "COMPLETED" | "FAILED";
          input: string | null;
          output: string | null;
          duration_ms: number | null;
          error_code: string | null;
        };
      }
    | {
        type: "lifecycle";
        payload: {
          name: string;
          status: "QUEUED" | "RUNNING" | "WAITING";
          summary: string;
        };
      }
    | {
        type: "terminal";
        payload: {
          status: "COMPLETED" | "FAILED" | "CANCELLED";
          summary: string;
          error_code: string | null;
        };
      },
): PublicRunEvent {
  return publicRunEventSchema.parse({
    schema_version: "public-run-event@1.0.0",
    event_id: `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    run_id: runId,
    sequence,
    occurred_at: `2026-08-14T00:00:0${sequence}.000Z`,
    ...value,
  });
}

describe("Q&A public event assembly", () => {
  it("prefers a valid Last-Event-ID and safely falls back to the query cursor", () => {
    expect(selectSseCursor("12", "4")).toBe(12);
    expect(selectSseCursor("invalid", "4")).toBe(4);
    expect(selectSseCursor("-1", "NaN")).toBe(0);
  });

  it("parses the public SSE contract and rejects unknown event shapes", () => {
    const input = event(1, { type: "answer", payload: { delta: "第一段" } });
    expect(parseEventBlock(`id: 1\ndata: ${JSON.stringify(input)}`)).toEqual(input);
    expect(() =>
      parseEventBlock(
        `data: ${JSON.stringify({ ...input, type: "hidden_reasoning", payload: {} })}`,
      ),
    ).toThrow();
  });

  it("deduplicates replayed sequences and assembles answer deltas in order", () => {
    const first = event(1, { type: "answer", payload: { delta: "A" } });
    const second = event(2, { type: "answer", payload: { delta: "B" } });
    const merged = mergePublicRunEvents([second], [first, second]);
    expect(merged).toHaveLength(2);
    expect(answerText(merged, runId)).toBe("AB");
  });
  it("keeps a replayed WAITING lifecycle event as one durable trajectory record", () => {
    const waiting = event(3, {
      type: "lifecycle",
      payload: { name: "run.suspended", status: "WAITING", summary: "任务等待后续处理" },
    });
    const merged = mergePublicRunEvents([waiting], [waiting]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: "lifecycle",
      payload: {
        status: "WAITING",
        summary: "任务等待后续处理",
      },
    });
  });

  it("merges tool start and completion without losing the safe input", () => {
    const start = event(2, {
      type: "tool",
      payload: {
        call_id: "call-1",
        tool_name: "research_kernel",
        title: "执行研究内核",
        summary: "查询中",
        status: "RUNNING",
        input: "dataset=orders",
        output: null,
        duration_ms: null,
        error_code: null,
      },
    });
    const complete = event(3, {
      type: "tool",
      payload: {
        call_id: "call-1",
        tool_name: "research_kernel",
        title: "research_kernel",
        summary: "完成",
        status: "COMPLETED",
        input: null,
        output: "2 artifacts",
        duration_ms: 42,
        error_code: null,
      },
    });
    expect(assembleProcessRows([start, complete], runId)).toEqual([
      expect.objectContaining({
        sequence: 2,
        status: "COMPLETED",
        input: "dataset=orders",
        output: "2 artifacts",
        durationMs: 42,
      }),
    ]);
  });

  it("groups the entire conversation by run and counts unique tool calls", () => {
    const progress = event(1, {
      type: "progress",
      payload: {
        phase: "research",
        title: "分析数据",
        summary: "开始",
        status: "RUNNING",
      },
    });
    const tool = event(2, {
      type: "tool",
      payload: {
        call_id: "call-1",
        tool_name: "research_kernel",
        title: "执行研究内核",
        summary: "查询中",
        status: "RUNNING",
        input: null,
        output: null,
        duration_ms: null,
        error_code: null,
      },
    });
    const terminal = event(4, {
      type: "terminal",
      payload: { status: "COMPLETED", summary: "完成", error_code: null },
    });
    expect(groupTrajectoryEvents([terminal, tool, progress])).toEqual([
      expect.objectContaining({ runId, toolCalls: 1, durationMs: 3000 }),
    ]);
  });

  it("marks an unfinished tool as interrupted when the Run is cancelled", () => {
    const tool = event(2, {
      type: "tool",
      payload: {
        call_id: "call-cancelled",
        tool_name: "research.kernel",
        title: "Research Kernel",
        summary: "执行中",
        status: "RUNNING",
        input: null,
        output: null,
        duration_ms: null,
        error_code: null,
      },
    });
    const cancelled = event(3, {
      type: "terminal",
      payload: { status: "CANCELLED", summary: "任务已取消", error_code: null },
    });

    expect(assembleProcessRows([tool, cancelled], runId)[0]).toMatchObject({
      status: "INTERRUPTED",
      summary: "工具调用已随 Run 中断",
    });
  });
});
