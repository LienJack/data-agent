import { describe, expect, it } from "vitest";
import { rootAgentToolResultSchema } from "../src/agents/subagent-harness.js";
import {
  buildProviderTaskArtifactDocument,
  computeProviderTaskContextSelectionHash,
  computeProviderTaskVisibleMessageHash,
  verifyProviderTaskArtifactDocument,
} from "../src/providers/provider-invocation.js";
import { DEFAULT_RUN_EXECUTION_POLICY, runExecutionPolicySchema } from "../src/runs/runtime.js";

const id = (suffix: number) => `87000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("Conversational Root Harness gaps", () => {
  it("represents the frozen conversation snapshot in ProviderTaskArtifact v2", async () => {
    const messageDrafts = [
      {
        message_id: id(2),
        role: "user" as const,
        type: "text" as const,
        content: "最近 12 个完整月订单收入趋势如何？",
        run_id: id(3),
      },
      {
        message_id: id(4),
        role: "agent" as const,
        type: "text" as const,
        content: "订单收入按月趋势已经生成。",
        run_id: id(3),
      },
      {
        message_id: id(5),
        role: "user" as const,
        type: "text" as const,
        content: "只看华东呢？",
        run_id: id(6),
      },
    ];
    const visibleMessages = await Promise.all(
      messageDrafts.map(async (message) => ({
        ...message,
        content_hash: await computeProviderTaskVisibleMessageHash(message),
      })),
    );
    const contextSelectionHash = await computeProviderTaskContextSelectionHash({
      conversation_id: id(1),
      conversation_resource_version: 7,
      current_message_id: id(5),
      visible_messages: visibleMessages,
      context_summary_ref: null,
    });
    const document = await buildProviderTaskArtifactDocument({
      schema_version: "provider-task-artifact@2.0.0",
      conversation_id: id(1),
      conversation_resource_version: 7,
      current_message: {
        message_id: id(5),
        content: "只看华东呢？",
      },
      visible_messages: visibleMessages,
      context_summary_ref: null,
      context_selection_hash: contextSelectionHash,
    });

    expect(document).toMatchObject({
      schema_version: "provider-task-artifact@2.0.0",
      conversation_id: id(1),
      conversation_resource_version: 7,
      current_message: { message_id: id(5), content: "只看华东呢？" },
    });
    if (document.schema_version !== "provider-task-artifact@2.0.0") {
      throw new Error("expected ProviderTaskArtifact v2");
    }
    expect(document.visible_messages.map(({ message_id: messageId }) => messageId)).toEqual([
      id(2),
      id(4),
      id(5),
    ]);
    await expect(
      verifyProviderTaskArtifactDocument({
        ...document,
        visible_messages: document.visible_messages.map((message, index) =>
          index === 0 ? { ...message, content: "tampered" } : message,
        ),
      }),
    ).rejects.toThrow("PROVIDER_TASK_VISIBLE_MESSAGE_HASH_MISMATCH");
    const { content_hash: _contentHash, ...documentDraft } = document;
    await expect(
      buildProviderTaskArtifactDocument({
        ...documentDraft,
        visible_messages: [...document.visible_messages, document.visible_messages.at(-1)],
      }),
    ).rejects.toThrow();
  });

  it("treats four Root turns as normal execution rather than provider retry", () => {
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

  it("accepts only correlated safe Root tool observations", () => {
    const outputRef = {
      artifact_id: id(20),
      artifact_type: "QueryEvidence" as const,
      app_id: id(21),
      tenant_id: id(22),
      environment: "test",
      run_id: id(23),
      revision: 1,
      content_hash: `sha256:${"a".repeat(64)}`,
    };
    const observation = {
      schema_version: "root-tool-observation@1.0.0",
      tool_call_id: "call-1",
      profile_id: "governed-text2sql-agent",
      status: "COMPLETED",
      output_ref: outputRef,
      safe_projection: {
        schema_version: "root-tool-safe-projection@1.0.0",
        artifact_ref: outputRef,
        projection_kind: "TABLE",
        title: "订单收入趋势",
        summary: "12 rows of governed evidence are available.",
        column_keys: ["month", "revenue"],
        total_rows: 12,
        source_artifact_refs: [],
      },
      error_code: null,
    } as const;

    expect(rootAgentToolResultSchema.safeParse(observation).success).toBe(true);
    expect(
      rootAgentToolResultSchema.safeParse({
        ...observation,
        safe_projection: {
          ...observation.safe_projection,
          artifact_ref: { ...outputRef, artifact_id: id(24) },
        },
      }).success,
    ).toBe(false);
    expect(
      rootAgentToolResultSchema.safeParse({
        ...observation,
        safe_projection: { ...observation.safe_projection, rows: [{ revenue: 10 }] },
      }).success,
    ).toBe(false);
  });
});
