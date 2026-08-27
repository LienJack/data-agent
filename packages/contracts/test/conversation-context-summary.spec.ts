import { describe, expect, it } from "vitest";
import {
  buildConversationContextSummary,
  verifyConversationContextSummary,
} from "../src/artifacts/index.js";
import {
  buildProviderTaskArtifactDocument,
  computeProviderTaskContextSelectionHash,
  computeProviderTaskVisibleMessageHash,
  verifyCommitProviderTaskArtifactResult,
} from "../src/providers/provider-invocation.js";

const id = (suffix: number) => `87200000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("ConversationContextSummary", () => {
  it("binds an ordered covered frontier with a stable content hash", async () => {
    const summary = await buildConversationContextSummary({
      schema_version: "conversation-context-summary@1.0.0",
      summary_id: id(1),
      conversation_id: id(2),
      conversation_resource_version: 80,
      run_id: id(3),
      covered_through_message_id: id(5),
      covered_messages: [
        { message_id: id(4), content_hash: hash("a") },
        { message_id: id(5), content_hash: hash("b") },
      ],
      summary: "Earlier user constraints and assistant context.",
      active_terms: ["orders", "revenue"],
      user_confirmed_constraints: ["region=华东"],
    });

    await expect(verifyConversationContextSummary(summary)).resolves.toEqual(summary);
    await expect(
      verifyConversationContextSummary({ ...summary, summary: "tampered" }),
    ).rejects.toThrow("CONVERSATION_CONTEXT_SUMMARY_HASH_MISMATCH");
  });

  it("rejects duplicate coverage and a frontier that is not the last covered message", async () => {
    await expect(
      buildConversationContextSummary({
        schema_version: "conversation-context-summary@1.0.0",
        summary_id: id(1),
        conversation_id: id(2),
        conversation_resource_version: 80,
        run_id: id(3),
        covered_through_message_id: id(5),
        covered_messages: [
          { message_id: id(4), content_hash: hash("a") },
          { message_id: id(4), content_hash: hash("a") },
        ],
        summary: "Earlier context.",
        active_terms: [],
        user_confirmed_constraints: [],
      }),
    ).rejects.toThrow();
  });

  it("binds the exact summary document to the ProviderTask scope and non-overlapping frontier", async () => {
    const summary = await buildConversationContextSummary({
      schema_version: "conversation-context-summary@1.0.0",
      summary_id: id(10),
      conversation_id: id(2),
      conversation_resource_version: 80,
      run_id: id(3),
      covered_through_message_id: id(4),
      covered_messages: [{ message_id: id(4), content_hash: hash("a") }],
      summary: "Earlier context.",
      active_terms: [],
      user_confirmed_constraints: [],
    });
    const summaryRef = {
      artifact_id: summary.summary_id,
      artifact_type: "ConversationContextSummary" as const,
      app_id: id(20),
      tenant_id: id(21),
      environment: "test" as const,
      run_id: summary.run_id,
      revision: 1,
      content_hash: summary.content_hash,
    };
    const visibleDraft = {
      message_id: id(5),
      role: "user" as const,
      type: "text" as const,
      content: "只看华东",
      run_id: id(3),
    };
    const visibleMessages = [
      {
        ...visibleDraft,
        content_hash: await computeProviderTaskVisibleMessageHash(visibleDraft),
      },
    ];
    const task = await buildProviderTaskArtifactDocument({
      schema_version: "provider-task-artifact@2.0.0",
      conversation_id: id(2),
      conversation_resource_version: 80,
      current_message: { message_id: id(5), content: "只看华东" },
      visible_messages: visibleMessages,
      context_summary_ref: summaryRef,
      context_selection_hash: await computeProviderTaskContextSelectionHash({
        conversation_id: id(2),
        conversation_resource_version: 80,
        current_message_id: id(5),
        visible_messages: visibleMessages,
        context_summary_ref: summaryRef,
      }),
    });
    const command = {
      schema_version: "provider-task-artifact-commit@1.0.0",
      scope: {
        app_id: id(20),
        tenant_id: id(21),
        environment: "test",
        workspace_id: id(21),
        principal_id: id(22),
      },
      run_id: id(3),
      conversation_binding: { conversation_id: id(2), resource_version: 80 },
      context_summary_ref: null,
    } as const;
    const result = {
      schema_version: "provider-task-artifact-commit-result@1.0.0",
      disposition: "CREATED",
      reference: {
        artifact_id: id(5),
        artifact_type: "ProviderTaskArtifact",
        app_id: id(20),
        tenant_id: id(21),
        environment: "test",
        run_id: id(3),
        revision: 1,
        content_hash: task.content_hash,
      },
      document: task,
      context_summary: summary,
      committed_at: "2026-08-27T00:00:00.000Z",
    } as const;

    await expect(verifyCommitProviderTaskArtifactResult(command, result)).resolves.toEqual(result);
    await expect(
      verifyCommitProviderTaskArtifactResult(command, {
        ...result,
        context_summary: { ...summary, run_id: id(30) },
      }),
    ).rejects.toThrow();
  });
});
