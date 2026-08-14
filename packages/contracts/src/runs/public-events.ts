import { z } from "zod";
import { immutableIdSchema, timestampSchema, versionIdentifierSchema } from "../common/index.js";
import { runRuntimeEventSchema } from "./runtime.js";

const publicEventBase = {
  schema_version: z.literal("public-run-event@1.0.0"),
  event_id: immutableIdSchema,
  run_id: immutableIdSchema,
  sequence: z.number().int().positive().safe(),
  occurred_at: timestampSchema,
} as const;

const publicTextSchema = z.string().max(200_000);

export const publicRunEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...publicEventBase,
    type: z.literal("lifecycle"),
    payload: z.strictObject({
      name: z.string().min(1).max(128),
      status: z.enum(["QUEUED", "RUNNING", "WAITING"]),
      summary: z.string().min(1).max(512),
    }),
  }),
  z.strictObject({
    ...publicEventBase,
    type: z.literal("progress"),
    payload: z.strictObject({
      phase: versionIdentifierSchema,
      title: z.string().min(1).max(128),
      summary: publicTextSchema,
      status: z.enum(["RUNNING", "COMPLETED"]),
    }),
  }),
  z.strictObject({
    ...publicEventBase,
    type: z.literal("tool"),
    payload: z.strictObject({
      call_id: z.string().min(1).max(256),
      tool_name: versionIdentifierSchema,
      title: z.string().min(1).max(128),
      summary: publicTextSchema,
      status: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
      input: publicTextSchema.nullable(),
      output: publicTextSchema.nullable(),
      duration_ms: z.number().int().nonnegative().safe().nullable(),
      error_code: versionIdentifierSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...publicEventBase,
    type: z.literal("answer"),
    payload: z.strictObject({ delta: z.string().min(1).max(100_000) }),
  }),
  z.strictObject({
    ...publicEventBase,
    type: z.literal("terminal"),
    payload: z.strictObject({
      status: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
      summary: z.string().min(1).max(512),
      error_code: versionIdentifierSchema.nullable(),
    }),
  }),
]);

export const conversationTrajectorySchema = z.strictObject({
  schema_version: z.literal("conversation-trajectory@1.0.0"),
  conversation_id: immutableIdSchema,
  events: z.array(publicRunEventSchema).max(10_000),
});

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi,
  /\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)["']\s*:\s*["'][^"']+["']/gi,
  /\b(?:postgres(?:ql)?|mysql|clickhouse):\/\/[^\s/@:]+:[^\s/@]+@/gi,
  /\b(?:sk|as_sk|pk)_[a-z0-9_-]{12,}\b/gi,
  /(?:^|\n)\s*(?:system prompt|internal prompt|系统提示词|内部系统提示)\s*[:：].*(?=\n|$)/gi,
];

/** Redact display text before it can enter a durable Run event. */
export function redactPublicDisplayText(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "[REDACTED]");
  return output;
}

function base(event: z.infer<typeof runRuntimeEventSchema>) {
  return {
    schema_version: "public-run-event@1.0.0" as const,
    event_id: event.event_id,
    run_id: event.run_id,
    sequence: event.sequence,
    occurred_at: event.occurred_at,
  };
}

/** Convert the authoritative event into the only DTO exposed to Web consumers. */
export function toPublicRunEvent(input: unknown): PublicRunEvent {
  const event = runRuntimeEventSchema.parse(input);
  const common = base(event);
  switch (event.event_type) {
    case "run.accepted":
      return publicRunEventSchema.parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "QUEUED", summary: "任务已进入执行队列" },
      });
    case "run.leased":
      return publicRunEventSchema.parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "RUNNING", summary: "Worker 已开始执行" },
      });
    case "run.checkpointed":
      return publicRunEventSchema.parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "RUNNING", summary: "执行检查点已持久化" },
      });
    case "run.side_effect_committed":
      return publicRunEventSchema.parse({
        ...common,
        type: "lifecycle",
        payload: {
          name: event.event_type,
          status: "RUNNING",
          summary: `${event.payload.effect_kind} 执行回执已提交`,
        },
      });
    case "run.progress":
      return publicRunEventSchema.parse({ ...common, type: "progress", payload: event.payload });
    case "run.tool_started":
      return publicRunEventSchema.parse({
        ...common,
        type: "tool",
        payload: {
          ...event.payload,
          status: "RUNNING",
          output: null,
          duration_ms: null,
          error_code: null,
        },
      });
    case "run.tool_completed":
      return publicRunEventSchema.parse({
        ...common,
        type: "tool",
        payload: {
          ...event.payload,
          title: event.payload.tool_name,
          status: "COMPLETED",
          input: null,
          error_code: null,
        },
      });
    case "run.tool_failed":
      return publicRunEventSchema.parse({
        ...common,
        type: "tool",
        payload: {
          ...event.payload,
          title: event.payload.tool_name,
          status: "FAILED",
          input: null,
        },
      });
    case "run.answer_delta":
      return publicRunEventSchema.parse({ ...common, type: "answer", payload: event.payload });
    case "run.suspended":
      return publicRunEventSchema.parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "WAITING", summary: "任务等待后续处理" },
      });
    case "run.resumed":
    case "run.retry_scheduled":
      return publicRunEventSchema.parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "QUEUED", summary: "任务已重新进入队列" },
      });
    case "run.cancel_requested":
      return publicRunEventSchema.parse({
        ...common,
        type: "terminal",
        payload: { status: "CANCELLED", summary: "任务已取消", error_code: null },
      });
    case "run.completed":
      return publicRunEventSchema.parse({
        ...common,
        type: "terminal",
        payload: { status: "COMPLETED", summary: "分析已完成", error_code: null },
      });
    case "run.failed":
      return publicRunEventSchema.parse({
        ...common,
        type: "terminal",
        payload: {
          status: "FAILED",
          summary: "分析执行失败",
          error_code: event.payload.error_code,
        },
      });
  }
}

export type PublicRunEvent = z.infer<typeof publicRunEventSchema>;
export type ConversationTrajectory = z.infer<typeof conversationTrajectorySchema>;
