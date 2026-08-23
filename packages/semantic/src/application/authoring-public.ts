import {
  redactPublicDisplayText,
  type SemanticAuthoringPublicEvent,
  type SemanticAuthoringState,
  semanticAuthoringPublicEventSchema,
} from "@data-agent/contracts";
import { z } from "zod";

export const semanticAuthoringPublicMessageSchema = z.strictObject({
  message_id: z.string().min(1).max(128),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(200_000),
});

export const semanticAuthoringPublicRunSchema = z.strictObject({
  authoring_run_id: z.uuid(),
  candidate_id: z.uuid(),
  semantic_domain: z.string().min(1).max(64),
  status: z.enum([
    "QUEUED",
    "RUNNING",
    "WAITING_CLARIFICATION",
    "READY_FOR_REVIEW",
    "FAILED",
    "CANCELLED",
  ]),
  current_turn: z.number().int().nonnegative(),
  working_revision: z.number().int().nonnegative(),
  used_tool_calls: z.number().int().nonnegative(),
  max_turns: z.number().int().positive(),
  max_tool_calls: z.number().int().positive(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  clarification: z
    .strictObject({
      clarification_id: z.uuid(),
      question: z.string().min(1).max(2_048),
      options: z.array(z.string().min(1).max(256)).min(2).max(8),
      answered: z.boolean(),
    })
    .nullable(),
});

export const semanticAuthoringPendingToolSchema = z.strictObject({
  call_id: z.string().min(1).max(256),
  tool_name: z.string().min(1).max(128),
});

export const semanticAuthoringPublicFeedSchema = z.strictObject({
  schema_version: z.literal("semantic-authoring-public-feed@1.0.0"),
  run: semanticAuthoringPublicRunSchema,
  messages: z.array(semanticAuthoringPublicMessageSchema).max(512),
  pending_tools: z.array(semanticAuthoringPendingToolSchema).max(32),
  events: z.array(semanticAuthoringPublicEventSchema).max(5_000),
});

export type SemanticAuthoringPublicFeed = z.infer<typeof semanticAuthoringPublicFeedSchema>;
export type SemanticAuthoringPublicMessage = z.infer<typeof semanticAuthoringPublicMessageSchema>;

const ORIGINAL_INTENT_MARKER = "\n\n用户原始意图：\n";
const CLARIFICATION_PREFIX = "澄清答复：";

function publicUserContent(content: string, index: number): string {
  if (index === 0) {
    const marker = content.lastIndexOf(ORIGINAL_INTENT_MARKER);
    if (marker >= 0) {
      return redactPublicDisplayText(content.slice(marker + ORIGINAL_INTENT_MARKER.length).trim());
    }
  }
  return redactPublicDisplayText(
    content.startsWith(CLARIFICATION_PREFIX)
      ? content.slice(CLARIFICATION_PREFIX.length).trim()
      : content.trim(),
  );
}

/**
 * Builds the browser-safe projection. Tool messages and arguments are excluded
 * because checkpoint tool results can contain internal graph material.
 */
export function buildSemanticAuthoringPublicFeed(
  state: SemanticAuthoringState,
  events: readonly SemanticAuthoringPublicEvent[],
): SemanticAuthoringPublicFeed {
  const messages: SemanticAuthoringPublicMessage[] = [];
  let userIndex = 0;
  state.checkpoint.messages.forEach((message, index) => {
    if (message.role === "tool") return;
    const content =
      message.role === "user"
        ? publicUserContent(message.content, userIndex++)
        : redactPublicDisplayText(message.content.trim());
    if (content.length === 0) return;
    messages.push({
      message_id: `${state.run.authoring_run_id}:message:${index}`,
      role: message.role,
      content,
    });
  });

  const status =
    state.run.status === "RUNNING" && state.run.current_turn === 0 && state.event_sequence === 0
      ? "QUEUED"
      : state.run.status;

  return semanticAuthoringPublicFeedSchema.parse({
    schema_version: "semantic-authoring-public-feed@1.0.0",
    run: {
      authoring_run_id: state.run.authoring_run_id,
      candidate_id: state.run.candidate_id,
      semantic_domain: state.run.semantic_domain,
      status,
      current_turn: state.run.current_turn,
      working_revision: state.run.working_revision,
      used_tool_calls: state.run.used_tool_calls,
      max_turns: state.run.budget.max_turns,
      max_tool_calls: state.run.budget.max_tool_calls,
      created_at: state.run.created_at,
      updated_at: state.run.updated_at,
      clarification:
        state.run.clarification === null
          ? null
          : {
              clarification_id: state.run.clarification.clarification_id,
              question: state.run.clarification.question,
              options: state.run.clarification.options,
              answered: state.run.clarification.answer !== null,
            },
    },
    messages,
    pending_tools: state.checkpoint.pending_tool_calls.map((call) => ({
      call_id: call.tool_call_id,
      tool_name: call.tool_name,
    })),
    events,
  });
}

export function mergeSemanticAuthoringPublicFeeds(
  current: SemanticAuthoringPublicFeed | null,
  incoming: SemanticAuthoringPublicFeed,
): SemanticAuthoringPublicFeed {
  if (current === null || current.run.authoring_run_id !== incoming.run.authoring_run_id) {
    return incoming;
  }
  const events = new Map(current.events.map((event) => [event.sequence, event]));
  for (const event of incoming.events) events.set(event.sequence, event);
  return {
    ...incoming,
    events: [...events.values()].sort((left, right) => left.sequence - right.sequence),
  };
}
