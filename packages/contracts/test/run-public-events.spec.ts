import { describe, expect, it } from "vitest";
import {
  modelRequestPerformanceSchema,
  projectPublicRunEventPage,
  projectPublicRunEventStream,
  publicRunEventSchema,
  redactPublicDisplayText,
  reduceRunProjection,
  runRuntimeEventSchema,
  selectSubagentPublicEvents,
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

function v2Event(event_type: string, sequence: number, payload: unknown) {
  return runRuntimeEventSchema.parse({
    schema_version: "run-runtime-event@2.0.0",
    event_id: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    scope,
    run_id: "00000000-0000-4000-8000-000000000010",
    sequence,
    worker_fence: 1,
    idempotency_key: `v2-event:${sequence}`,
    occurred_at: `2026-08-14T00:01:0${sequence}.000Z`,
    event_type,
    payload,
  });
}

describe("public Run events", () => {
  it("validates exact model request performance without accepting private fields or false token totals", () => {
    const performance = {
      schema_version: "model-request-performance@1.0.0",
      request_id: "00000000-0000-4000-8000-000000000090",
      provider: "deepseek",
      profile_id: "00000000-0000-4000-8000-000000000091",
      model_id: "deepseek-v4-flash",
      status: "COMPLETED",
      attempt_count: 2,
      duration_ms: 1_240,
      context_window_tokens: 262_144,
      reserved_output_tokens: 2_048,
      usage: {
        availability: "AVAILABLE",
        source: "PROVIDER_REPORTED",
        input_tokens: 162_000,
        output_tokens: 800,
        total_tokens: 162_800,
        tool_calls: 0,
        unavailable_reason: null,
      },
    } as const;
    expect(modelRequestPerformanceSchema.parse(performance)).toEqual(performance);
    expect(
      modelRequestPerformanceSchema.safeParse({
        ...performance,
        usage: { ...performance.usage, total_tokens: 162_799 },
      }).success,
    ).toBe(false);
    expect(
      modelRequestPerformanceSchema.safeParse({ ...performance, prompt: "private" }).success,
    ).toBe(false);
  });

  it("keeps unavailable model usage explicit instead of coercing missing counts to zero", () => {
    const parsed = modelRequestPerformanceSchema.parse({
      schema_version: "model-request-performance@1.0.0",
      request_id: "00000000-0000-4000-8000-000000000090",
      provider: "deepseek",
      profile_id: "00000000-0000-4000-8000-000000000091",
      model_id: "deepseek-v4-flash",
      status: "COMPLETED",
      attempt_count: 1,
      duration_ms: 240,
      context_window_tokens: 262_144,
      reserved_output_tokens: 2_048,
      usage: {
        availability: "UNAVAILABLE",
        source: "UNAVAILABLE",
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        tool_calls: null,
        unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE",
      },
    });
    expect(parsed.usage.input_tokens).toBeNull();
  });

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

  it("projects v2 Agent status and rejects private or invalid task state", () => {
    const status = v2Event("run.agent_status", 3, {
      profile_id: "governed-text2sql-agent",
      task_id: "00000000-0000-4000-8000-000000000030",
      status: "RUNNING",
      phase: "compile.query",
      title: "Text2SQL",
      summary: "正在编译查询",
      duration_ms: null,
      error_code: null,
    });
    expect(toPublicRunEvent(status)).toMatchObject({
      schema_version: "public-run-event@2.0.0",
      type: "agent",
      payload: { profile_id: "governed-text2sql-agent", status: "RUNNING" },
    });
    expect(() =>
      v2Event("run.agent_status", 4, {
        ...status.payload,
        private_prompt: "hidden",
      }),
    ).toThrow();
    expect(() =>
      v2Event("run.agent_status", 4, {
        ...status.payload,
        task_id: null,
      }),
    ).toThrow();
  });

  it("normalizes legacy Tool identity and validates v2 Tool replay identity", () => {
    const legacy = event("run.tool_started", 3, {
      call_id: "legacy-call",
      tool_name: "semantic.release.read",
      title: "读取语义发布",
      summary: "正在读取",
      input: null,
    });
    expect(toPublicRunEvent(legacy)).toMatchObject({
      schema_version: "public-run-event@2.0.0",
      payload: { profile_id: null, task_id: null, artifact_refs: [] },
    });

    const identity = {
      profile_id: "governed-text2sql-agent" as const,
      task_id: "00000000-0000-4000-8000-000000000030",
      artifact_refs: [],
    };
    const runtimeStarted = v2Event("run.tool_started", 4, {
      call_id: "team-call",
      tool_name: "sql.compiler.compile",
      title: "编译查询",
      summary: "正在编译",
      input: null,
      ...identity,
    });
    const runtimeCompleted = v2Event("run.tool_completed", 5, {
      call_id: "team-call",
      tool_name: "sql.compiler.compile",
      summary: "编译完成",
      output: null,
      duration_ms: 19,
      ...identity,
    });
    const started = toPublicRunEvent(runtimeStarted);
    const completed = toPublicRunEvent(runtimeCompleted);
    expect(projectPublicRunEventStream([started, completed])).toEqual([started, completed]);
    const page = projectPublicRunEventPage([runtimeStarted, runtimeCompleted], 3);
    expect(JSON.stringify(page.events)).toBe(JSON.stringify([started, completed]));
    expect(page).toMatchObject({ cursor: 5, terminal: false });
    expect(() => projectPublicRunEventPage([runtimeCompleted, runtimeStarted], 3)).toThrow(
      "PUBLIC_RUN_EVENT_SEQUENCE_INVALID",
    );
    expect(
      selectSubagentPublicEvents(page.events, {
        kind: "subagent",
        run_id: started.run_id,
        profile_id: identity.profile_id,
        task_id: identity.task_id,
        anchor_sequence: started.sequence,
      }),
    ).toEqual([started, completed]);
    expect(() =>
      projectPublicRunEventStream([
        started,
        publicRunEventSchema.parse({
          ...completed,
          payload: { ...completed.payload, task_id: "00000000-0000-4000-8000-000000000031" },
        }),
      ]),
    ).toThrow("PUBLIC_TOOL_CALL_IDENTITY_MISMATCH");
  });

  it("requires empty START refs and same-run ArtifactReferences", () => {
    const reference = {
      artifact_id: "00000000-0000-4000-8000-000000000040",
      artifact_type: "SqlArtifact",
      ...scope,
      run_id: "00000000-0000-4000-8000-000000000099",
      revision: 1,
      content_hash: `sha256:${"1".repeat(64)}`,
    };
    const basePayload = {
      call_id: "team-call",
      tool_name: "sql.compiler.compile",
      title: "编译查询",
      summary: "正在编译",
      input: null,
      profile_id: "governed-text2sql-agent",
      task_id: "00000000-0000-4000-8000-000000000030",
    };
    expect(() =>
      v2Event("run.tool_started", 4, { ...basePayload, artifact_refs: [reference] }),
    ).toThrow();
    expect(() =>
      v2Event("run.tool_completed", 5, {
        call_id: basePayload.call_id,
        tool_name: basePayload.tool_name,
        summary: "完成",
        output: null,
        duration_ms: 1,
        profile_id: basePayload.profile_id,
        task_id: basePayload.task_id,
        artifact_refs: [reference],
      }),
    ).toThrow();
  });
});
