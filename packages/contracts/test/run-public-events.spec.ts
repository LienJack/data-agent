import { describe, expect, it } from "vitest";
import {
  redactPublicDisplayText,
  reduceRunProjection,
  runRuntimeEventSchema,
  toPublicRunEvent,
} from "../src/index.js";

const scope = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
};

function event(event_type: string, sequence: number, payload: unknown) {
  return runRuntimeEventSchema.parse({
    schema_version: "1.0.0",
    event_id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    scope,
    run_id: "00000000-0000-4000-8000-000000000010",
    sequence,
    worker_fence: sequence === 1 ? 0 : 1,
    idempotency_key: `event:${sequence}`,
    occurred_at: `2026-08-14T00:00:0${sequence}.000Z`,
    event_type,
    payload,
  });
}

describe("public Run events", () => {
  it("advances the projection without changing authority state for display events", () => {
    const accepted = event("run.accepted", 1, {
      command_id: "00000000-0000-4000-8000-000000000020",
      payload_hash: `sha256:${"0".repeat(64)}`,
    });
    const leased = event("run.leased", 2, {
      command_id: "00000000-0000-4000-8000-000000000020",
      lease_id: "lease-1",
      worker_id: "worker-1",
      attempt: 1,
    });
    const progress = event("run.progress", 3, {
      phase: "research.kernel",
      title: "分析问题",
      summary: "正在执行研究内核",
      status: "RUNNING",
    });
    const running = reduceRunProjection(reduceRunProjection(null, accepted), leased);
    const next = reduceRunProjection(running, progress);
    expect(next).toMatchObject({ status: "RUNNING", version: 3, worker_fence: 1 });
    expect(toPublicRunEvent(progress)).toMatchObject({
      type: "progress",
      sequence: 3,
      payload: { phase: "research.kernel", status: "RUNNING" },
    });
  });

  it("redacts credentials from durable display strings", () => {
    expect(
      redactPublicDisplayText(
        "Authorization: Bearer abc.def.ghi password=hunter2 postgresql://user:pass@db/app",
      ),
    ).not.toContain("hunter2");
    expect(redactPublicDisplayText("api_key=sk_abcdefghijklmnop")).toBe("[REDACTED]");
    expect(redactPublicDisplayText('{"apiKey":"sk_123456789012345"}')).toBe("{[REDACTED]}");
    expect(redactPublicDisplayText("系统提示词：不要公开\n安全摘要")).toBe("[REDACTED]\n安全摘要");
  });

  it("maps public reasoning summaries without accepting private chain-of-thought fields", () => {
    const started = event("run.reasoning_started", 3, {
      block_id: "reasoning-1",
      title: "规划执行路径",
    });
    const delta = event("run.reasoning_delta", 4, {
      block_id: "reasoning-1",
      delta: "先确认语义口径，再执行受治理查询。",
    });
    const completed = event("run.reasoning_completed", 5, {
      block_id: "reasoning-1",
      summary: "已确认语义口径与查询边界。",
      duration_ms: 28,
    });

    expect([started, delta, completed].map(toPublicRunEvent)).toEqual([
      expect.objectContaining({
        type: "reasoning",
        payload: { phase: "START", block_id: "reasoning-1", title: "规划执行路径" },
      }),
      expect.objectContaining({
        type: "reasoning",
        payload: {
          phase: "DELTA",
          block_id: "reasoning-1",
          delta: "先确认语义口径，再执行受治理查询。",
        },
      }),
      expect.objectContaining({
        type: "reasoning",
        payload: {
          phase: "END",
          block_id: "reasoning-1",
          summary: "已确认语义口径与查询边界。",
          duration_ms: 28,
        },
      }),
    ]);
    expect(() =>
      event("run.reasoning_delta", 6, {
        block_id: "reasoning-1",
        delta: "公开摘要",
        reasoning_content: "private chain of thought",
      }),
    ).toThrow();
  });

  it("fails closed for unknown public event kinds", () => {
    expect(() => event("run.private_reasoning", 2, { text: "hidden" })).toThrow();
  });
});
