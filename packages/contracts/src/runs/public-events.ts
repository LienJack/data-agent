import { z } from "zod";
import { agentSpecialistProfileIdSchema } from "../agents/profile-registry.js";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import { immutableIdSchema, timestampSchema, versionIdentifierSchema } from "../common/index.js";
import { modelProviderSchema } from "../providers/index.js";
import { runAgentStatusSchema, runRuntimeEventSchema } from "./runtime.js";

export const MODEL_REQUEST_TOOL_NAME = "model.request@1.0.0" as const;
export const MODEL_REQUEST_PERFORMANCE_SCHEMA_VERSION = "model-request-performance@1.0.0" as const;

const modelRequestUsageSchema = z.discriminatedUnion("availability", [
  z
    .strictObject({
      availability: z.literal("AVAILABLE"),
      source: z.literal("PROVIDER_REPORTED"),
      input_tokens: z.number().int().nonnegative().safe(),
      output_tokens: z.number().int().nonnegative().safe(),
      total_tokens: z.number().int().nonnegative().safe(),
      tool_calls: z.number().int().nonnegative().safe(),
      unavailable_reason: z.null(),
    })
    .superRefine((usage, ctx) => {
      if (usage.total_tokens !== usage.input_tokens + usage.output_tokens) {
        ctx.addIssue({
          code: "custom",
          message: "Model Request total_tokens 必须等于 input_tokens + output_tokens。",
          path: ["total_tokens"],
        });
      }
    }),
  z.strictObject({
    availability: z.literal("UNAVAILABLE"),
    source: z.literal("UNAVAILABLE"),
    input_tokens: z.null(),
    output_tokens: z.null(),
    total_tokens: z.null(),
    tool_calls: z.null(),
    unavailable_reason: z.literal("PROVIDER_DID_NOT_REPORT_USAGE"),
  }),
]);

/** Safe, bounded performance projection for one logical production model request. */
export const modelRequestPerformanceSchema = z.strictObject({
  schema_version: z.literal(MODEL_REQUEST_PERFORMANCE_SCHEMA_VERSION),
  request_id: immutableIdSchema,
  provider: modelProviderSchema,
  profile_id: immutableIdSchema,
  model_id: z.string().trim().min(1).max(256),
  status: z.literal("COMPLETED"),
  attempt_count: z.number().int().positive().max(2),
  duration_ms: z.number().int().nonnegative().safe(),
  context_window_tokens: z.number().int().positive().safe(),
  reserved_output_tokens: z.number().int().positive().safe(),
  usage: modelRequestUsageSchema,
});

export type ModelRequestPerformance = z.infer<typeof modelRequestPerformanceSchema>;

const publicEventV1Base = {
  schema_version: z.literal("public-run-event@1.0.0"),
  event_id: immutableIdSchema,
  run_id: immutableIdSchema,
  sequence: z.number().int().positive().safe(),
  occurred_at: timestampSchema,
} as const;
const publicEventV2Base = {
  ...publicEventV1Base,
  schema_version: z.literal("public-run-event@2.0.0"),
} as const;
const publicTextSchema = z.string().max(200_000);

const publicAnalysisEventBase = {
  schema_version: z.literal("public-analysis-event@1.0.0"),
  event_id: immutableIdSchema,
  run_id: immutableIdSchema,
  sequence: z.number().int().positive().safe(),
  occurred_at: timestampSchema,
} as const;

/**
 * Safe, replayable analysis progress projection. It intentionally contains no
 * Python source, stdout/stderr, SQL parameters, raw rows, or model reasoning.
 */
export const publicAnalysisRunEventV1Schema = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...publicAnalysisEventBase,
      type: z.literal("analysis.plan"),
      payload: z.strictObject({
        plan_ref: artifactReferenceSchema,
        status: z.enum(["ADMITTED", "HOLD"]),
        node_count: z.number().int().nonnegative().max(64),
        summary: z.string().min(1).max(512),
        reason_code: versionIdentifierSchema.nullable(),
      }),
    }),
    z.strictObject({
      ...publicAnalysisEventBase,
      type: z.literal("analysis.node"),
      payload: z.strictObject({
        plan_ref: artifactReferenceSchema,
        node_id: versionIdentifierSchema,
        skill_id: versionIdentifierSchema,
        status: z.enum(["QUEUED", "RUNNING", "SKIPPED", "SUCCEEDED", "FAILED", "CANCELLED"]),
        summary: z.string().min(1).max(512),
        artifact_refs: z.array(artifactReferenceSchema).max(16),
        reason_code: versionIdentifierSchema.nullable(),
      }),
    }),
    z.strictObject({
      ...publicAnalysisEventBase,
      type: z.literal("analysis.evidence"),
      payload: z.strictObject({
        evidence_ref: artifactReferenceSchema,
        status: z.literal("ACCEPTED"),
        method: versionIdentifierSchema,
        disclosures: z.array(versionIdentifierSchema).max(32),
        summary: z.string().min(1).max(512),
      }),
    }),
    z.strictObject({
      ...publicAnalysisEventBase,
      type: z.literal("analysis.terminal"),
      payload: z.strictObject({
        completion_receipt_ref: artifactReferenceSchema,
        status: z.enum(["READY", "PARTIAL", "HOLD"]),
        summary: z.string().min(1).max(512),
        reason_codes: z.array(versionIdentifierSchema).max(32),
      }),
    }),
  ])
  .superRefine((event, ctx) => {
    const references = (() => {
      switch (event.type) {
        case "analysis.plan":
          return [event.payload.plan_ref];
        case "analysis.node":
          return [event.payload.plan_ref, ...event.payload.artifact_refs];
        case "analysis.evidence":
          return [event.payload.evidence_ref];
        case "analysis.terminal":
          return [event.payload.completion_receipt_ref];
      }
    })();
    for (const [index, reference] of references.entries()) {
      if (reference.run_id !== event.run_id) {
        ctx.addIssue({
          code: "custom",
          message: "Public Analysis Event Reference 必须绑定同一 Run。",
          path: ["payload", "artifact_refs", index],
        });
      }
    }
  });

const lifecyclePayload = z.strictObject({
  name: z.string().min(1).max(128),
  status: z.enum(["QUEUED", "RUNNING", "WAITING"]),
  summary: z.string().min(1).max(512),
});
const progressPayload = z.strictObject({
  phase: versionIdentifierSchema,
  title: z.string().min(1).max(128),
  summary: publicTextSchema,
  status: z.enum(["RUNNING", "COMPLETED"]),
});
const answerPayload = z.strictObject({ delta: z.string().min(1).max(100_000) });
const reasoningPayload = z.discriminatedUnion("phase", [
  z.strictObject({
    phase: z.literal("START"),
    block_id: z.string().min(1).max(256),
    title: z.string().min(1).max(128),
  }),
  z.strictObject({
    phase: z.literal("DELTA"),
    block_id: z.string().min(1).max(256),
    delta: z.string().min(1).max(4_096),
  }),
  z.strictObject({
    phase: z.literal("END"),
    block_id: z.string().min(1).max(256),
    summary: publicTextSchema,
    duration_ms: z.number().int().nonnegative().safe(),
  }),
]);
const terminalPayload = z.strictObject({
  status: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
  summary: z.string().min(1).max(512),
  error_code: versionIdentifierSchema.nullable(),
});
const toolV1Payload = z.strictObject({
  call_id: z.string().min(1).max(256),
  tool_name: versionIdentifierSchema,
  title: z.string().min(1).max(128),
  summary: publicTextSchema,
  status: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
  input: publicTextSchema.nullable(),
  output: publicTextSchema.nullable(),
  duration_ms: z.number().int().nonnegative().safe().nullable(),
  error_code: versionIdentifierSchema.nullable(),
});
const toolV2Payload = toolV1Payload.extend({
  profile_id: agentSpecialistProfileIdSchema.nullable(),
  task_id: immutableIdSchema.nullable(),
  artifact_refs: z.array(artifactReferenceSchema).max(32),
});
const agentPayload = z.strictObject({
  profile_id: agentSpecialistProfileIdSchema,
  task_id: immutableIdSchema.nullable(),
  status: runAgentStatusSchema,
  phase: versionIdentifierSchema,
  title: z.string().min(1).max(128),
  summary: publicTextSchema,
  duration_ms: z.number().int().nonnegative().safe().nullable(),
  error_code: versionIdentifierSchema.nullable(),
});

export const publicRunEventV1Schema = z.discriminatedUnion("type", [
  z.strictObject({ ...publicEventV1Base, type: z.literal("lifecycle"), payload: lifecyclePayload }),
  z.strictObject({ ...publicEventV1Base, type: z.literal("progress"), payload: progressPayload }),
  z.strictObject({ ...publicEventV1Base, type: z.literal("tool"), payload: toolV1Payload }),
  z.strictObject({ ...publicEventV1Base, type: z.literal("answer"), payload: answerPayload }),
  z.strictObject({ ...publicEventV1Base, type: z.literal("reasoning"), payload: reasoningPayload }),
  z.strictObject({ ...publicEventV1Base, type: z.literal("terminal"), payload: terminalPayload }),
]);

export const publicRunEventV2Schema = z.discriminatedUnion("type", [
  z.strictObject({ ...publicEventV2Base, type: z.literal("lifecycle"), payload: lifecyclePayload }),
  z.strictObject({ ...publicEventV2Base, type: z.literal("progress"), payload: progressPayload }),
  z.strictObject({ ...publicEventV2Base, type: z.literal("tool"), payload: toolV2Payload }),
  z.strictObject({ ...publicEventV2Base, type: z.literal("agent"), payload: agentPayload }),
  z.strictObject({ ...publicEventV2Base, type: z.literal("answer"), payload: answerPayload }),
  z.strictObject({ ...publicEventV2Base, type: z.literal("reasoning"), payload: reasoningPayload }),
  z.strictObject({ ...publicEventV2Base, type: z.literal("terminal"), payload: terminalPayload }),
]);

/** Reads retained v1 history and current v2 public events without rewriting either. */
export const publicRunEventSchema = z.union([publicRunEventV1Schema, publicRunEventV2Schema]);
export const conversationTrajectorySchema = z.union([
  z.strictObject({
    schema_version: z.literal("conversation-trajectory@1.0.0"),
    conversation_id: immutableIdSchema,
    events: z.array(publicRunEventV1Schema).max(10_000),
  }),
  z.strictObject({
    schema_version: z.literal("conversation-trajectory@2.0.0"),
    conversation_id: immutableIdSchema,
    events: z.array(publicRunEventV2Schema).max(10_000),
  }),
]);
export const qaInspectorTargetSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("artifact"),
      run_id: immutableIdSchema,
      reference: artifactReferenceSchema,
      anchor_sequence: z.number().int().positive().safe(),
    }),
    z.strictObject({
      kind: z.literal("subagent"),
      run_id: immutableIdSchema,
      profile_id: agentSpecialistProfileIdSchema,
      task_id: immutableIdSchema,
      anchor_sequence: z.number().int().positive().safe(),
    }),
  ])
  .superRefine((target, ctx) => {
    if (target.kind === "artifact" && target.reference.run_id !== target.run_id) {
      ctx.addIssue({
        code: "custom",
        message: "Artifact Inspector target 的 Run identity 必须与引用一致。",
        path: ["reference", "run_id"],
      });
    }
  });

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi,
  /\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)["']\s*:\s*["'][^"']+["']/gi,
  /\b(?:postgres(?:ql)?|mysql|clickhouse):\/\/[^\s/@:]+:[^\s/@]+@/gi,
  /\b(?:sk|as_sk|pk)_[a-z0-9_-]{12,}\b/gi,
  /(?:^|\n)\s*(?:system prompt|internal prompt|系统提示词|内部系统提示)\s*[:：].*(?=\n|$)/gi,
];

export function redactPublicDisplayText(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "[REDACTED]");
  return output;
}

function base(event: z.infer<typeof runRuntimeEventSchema>) {
  return {
    schema_version: "public-run-event@2.0.0" as const,
    event_id: event.event_id,
    run_id: event.run_id,
    sequence: event.sequence,
    occurred_at: event.occurred_at,
  };
}
function toolIdentity(event: z.infer<typeof runRuntimeEventSchema>) {
  if (
    event.schema_version === "run-runtime-event@2.0.0" &&
    (event.event_type === "run.tool_started" ||
      event.event_type === "run.tool_completed" ||
      event.event_type === "run.tool_failed")
  ) {
    return {
      profile_id: event.payload.profile_id,
      task_id: event.payload.task_id,
      artifact_refs: event.payload.artifact_refs,
    };
  }
  return { profile_id: null, task_id: null, artifact_refs: [] };
}

/** Convert an authoritative v1/v2 event into the current public v2 projection. */
export function toPublicRunEvent(input: unknown): PublicRunEventV2 {
  const event = runRuntimeEventSchema.parse(input);
  const common = base(event);
  const parse = (value: unknown) => publicRunEventV2Schema.parse(value);
  switch (event.event_type) {
    case "run.accepted":
      return parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "QUEUED", summary: "任务已进入执行队列" },
      });
    case "run.leased":
      return parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "RUNNING", summary: "Worker 已开始执行" },
      });
    case "run.checkpointed":
      return parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "RUNNING", summary: "执行检查点已持久化" },
      });
    case "run.side_effect_committed":
      return parse({
        ...common,
        type: "lifecycle",
        payload: {
          name: event.event_type,
          status: "RUNNING",
          summary: `${event.payload.effect_kind} 执行回执已提交`,
        },
      });
    case "run.progress":
      return parse({ ...common, type: "progress", payload: event.payload });
    case "run.tool_started":
      return parse({
        ...common,
        type: "tool",
        payload: {
          ...event.payload,
          ...toolIdentity(event),
          status: "RUNNING",
          output: null,
          duration_ms: null,
          error_code: null,
        },
      });
    case "run.tool_completed":
      return parse({
        ...common,
        type: "tool",
        payload: {
          ...event.payload,
          ...toolIdentity(event),
          title: event.payload.tool_name,
          status: "COMPLETED",
          input: null,
          error_code: null,
        },
      });
    case "run.tool_failed":
      return parse({
        ...common,
        type: "tool",
        payload: {
          ...event.payload,
          ...toolIdentity(event),
          title: event.payload.tool_name,
          status: "FAILED",
          input: null,
        },
      });
    case "run.agent_status":
      return parse({ ...common, type: "agent", payload: event.payload });
    case "run.answer_delta":
      return parse({ ...common, type: "answer", payload: event.payload });
    case "run.reasoning_started":
      return parse({ ...common, type: "reasoning", payload: { phase: "START", ...event.payload } });
    case "run.reasoning_delta":
      return parse({ ...common, type: "reasoning", payload: { phase: "DELTA", ...event.payload } });
    case "run.reasoning_completed":
      return parse({ ...common, type: "reasoning", payload: { phase: "END", ...event.payload } });
    case "run.suspended":
      return parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "WAITING", summary: "任务等待后续处理" },
      });
    case "run.resumed":
    case "run.retry_scheduled":
      return parse({
        ...common,
        type: "lifecycle",
        payload: { name: event.event_type, status: "QUEUED", summary: "任务已重新进入队列" },
      });
    case "run.cancel_requested":
      return parse({
        ...common,
        type: "terminal",
        payload: { status: "CANCELLED", summary: "任务已取消", error_code: null },
      });
    case "run.completed":
      return parse({
        ...common,
        type: "terminal",
        payload: { status: "COMPLETED", summary: "分析已完成", error_code: null },
      });
    case "run.failed":
      return parse({
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

/** Validate a complete durable replay before a surface renders or derives inspector state. */
export function projectPublicRunEventStream(
  eventsInput: readonly unknown[],
): readonly PublicRunEventV2[] {
  const events = eventsInput.map((input) => publicRunEventV2Schema.parse(input));
  const openCalls = new Map<string, Extract<PublicRunEventV2, { type: "tool" }>["payload"]>();
  let previousSequence = 0;
  let runId: string | null = null;
  for (const event of events) {
    if (runId !== null && event.run_id !== runId) throw new Error("PUBLIC_RUN_EVENT_RUN_MISMATCH");
    if (event.sequence <= previousSequence) throw new Error("PUBLIC_RUN_EVENT_SEQUENCE_INVALID");
    runId = event.run_id;
    previousSequence = event.sequence;
    if (event.type !== "tool") continue;
    if (event.payload.status === "RUNNING") {
      if (openCalls.has(event.payload.call_id)) throw new Error("PUBLIC_TOOL_CALL_DUPLICATE_START");
      openCalls.set(event.payload.call_id, event.payload);
      continue;
    }
    const started = openCalls.get(event.payload.call_id);
    if (!started) throw new Error("PUBLIC_TOOL_CALL_MISSING_START");
    if (
      started.tool_name !== event.payload.tool_name ||
      started.profile_id !== event.payload.profile_id ||
      started.task_id !== event.payload.task_id
    ) {
      throw new Error("PUBLIC_TOOL_CALL_IDENTITY_MISMATCH");
    }
    openCalls.delete(event.payload.call_id);
  }
  return events;
}

export const publicRunEventPageSchema = z.strictObject({
  events: z.array(publicRunEventV2Schema).max(500),
  cursor: z.number().int().nonnegative().safe(),
  terminal: z.boolean(),
});

/** Shared cursor/terminal projection used by Web SSE and headless/Desktop/TUI adapters. */
export function projectPublicRunEventPage(
  runtimeEvents: readonly unknown[],
  afterSequence: number,
): PublicRunEventPage {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new Error("PUBLIC_RUN_EVENT_CURSOR_INVALID");
  }
  const events = runtimeEvents
    .map(toPublicRunEvent)
    .filter((event) => event.sequence > afterSequence);
  let previous = afterSequence;
  for (const event of events) {
    if (event.sequence <= previous) throw new Error("PUBLIC_RUN_EVENT_SEQUENCE_INVALID");
    previous = event.sequence;
  }
  return publicRunEventPageSchema.parse({
    events,
    cursor: events.at(-1)?.sequence ?? afterSequence,
    terminal: events.some((event) => event.type === "terminal"),
  });
}

/** Derive a Subagent inspector feed from the same public log, never a private side channel. */
export function selectSubagentPublicEvents(
  eventsInput: readonly unknown[],
  targetInput: unknown,
): readonly PublicRunEventV2[] {
  const target = qaInspectorTargetSchema.parse(targetInput);
  if (target.kind !== "subagent") throw new Error("PUBLIC_INSPECTOR_TARGET_KIND_INVALID");
  return eventsInput
    .map((event) => publicRunEventV2Schema.parse(event))
    .filter((event) => {
      if (event.run_id !== target.run_id || (event.type !== "agent" && event.type !== "tool"))
        return false;
      return (
        event.payload.profile_id === target.profile_id && event.payload.task_id === target.task_id
      );
    })
    .sort((left, right) => left.sequence - right.sequence);
}

export type PublicRunEventV1 = z.infer<typeof publicRunEventV1Schema>;
export type PublicAnalysisRunEventV1 = z.infer<typeof publicAnalysisRunEventV1Schema>;
export type PublicRunEventV2 = z.infer<typeof publicRunEventV2Schema>;
export type PublicRunEvent = z.infer<typeof publicRunEventSchema>;
export type ConversationTrajectory = z.infer<typeof conversationTrajectorySchema>;
export type QaInspectorTarget = z.infer<typeof qaInspectorTargetSchema>;
export type PublicRunEventPage = z.infer<typeof publicRunEventPageSchema>;
