import { describe, expect, it } from "vitest";
import { buildProviderTaskArtifactDocument } from "../src/providers/provider-invocation.js";
import {
  DEFAULT_RUN_EXECUTION_POLICY,
  runExecutionPolicySchema,
} from "../src/runs/runtime.js";

const id = (suffix: number) => `87000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("Conversational Root Harness gaps", () => {
  it.fails("represents the frozen conversation snapshot in ProviderTaskArtifact v2", async () => {
    const document = await buildProviderTaskArtifactDocument({
      schema_version: "provider-task-artifact@2.0.0",
      conversation_id: id(1),
      conversation_resource_version: 7,
      current_message: {
        message_id: id(5),
        content: "只看华东呢？",
      },
      visible_messages: [
        {
          message_id: id(2),
          role: "user",
          type: "text",
          content: "最近 12 个完整月订单收入趋势如何？",
          run_id: id(3),
          content_hash: `sha256:${"1".repeat(64)}`,
        },
        {
          message_id: id(4),
          role: "agent",
          type: "text",
          content: "订单收入按月趋势已经生成。",
          run_id: id(3),
          content_hash: `sha256:${"2".repeat(64)}`,
        },
        {
          message_id: id(5),
          role: "user",
          type: "text",
          content: "只看华东呢？",
          run_id: id(6),
          content_hash: `sha256:${"3".repeat(64)}`,
        },
      ],
      context_summary_ref: null,
      context_selection_hash: `sha256:${"4".repeat(64)}`,
    });

    expect(document).toMatchObject({
      schema_version: "provider-task-artifact@2.0.0",
      conversation_id: id(1),
      conversation_resource_version: 7,
      current_message: { message_id: id(5), content: "只看华东呢？" },
    });
    expect(document.visible_messages.map(({ message_id: messageId }) => messageId)).toEqual([
      id(2),
      id(4),
      id(5),
    ]);
  });

  it.fails("treats four Root turns as normal execution rather than provider retry", () => {
    const parsed = runExecutionPolicySchema.safeParse({
      ...DEFAULT_RUN_EXECUTION_POLICY,
      max_root_turns: 4,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.max_provider_attempts_per_call).toBe(2);
      expect(parsed.data.max_root_turns).toBe(4);
    }
  });
});
