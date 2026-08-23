import { describe, expect, it } from "vitest";
import {
  qaAdminArtifactAccessQuerySchema,
  qaAdminConversationQuerySchema,
  qaAdminDirectoryPageSchema,
  qaAdminDirectoryQuerySchema,
  qaAdminReasonForOperation,
  qaAdminRunEventsQuerySchema,
} from "../src/index.js";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("Q&A admin audit contracts", () => {
  it("strictly validates bounded workspace directory queries", () => {
    const query = {
      schema_version: "qa-admin-directory-query@1.0.0",
      workspace_id: id("1"),
      owner_principal_id: null,
      folder_id: null,
      lifecycle: "ACTIVE",
      live_state: null,
      query: "订单",
      cursor: null,
      limit: 25,
    };
    expect(qaAdminDirectoryQuerySchema.parse(query)).toEqual(query);
    expect(qaAdminDirectoryQuerySchema.safeParse({ ...query, role: "SUPER_ADMIN" }).success).toBe(
      false,
    );
    expect(qaAdminDirectoryQuerySchema.safeParse({ ...query, limit: 51 }).success).toBe(false);
  });

  it("requires exact run and subagent identity closure", () => {
    const base = {
      schema_version: "qa-admin-run-events-query@1.0.0",
      workspace_id: id("1"),
      owner_principal_id: id("2"),
      conversation_id: id("3"),
      run_id: id("4"),
      profile_id: null,
      task_id: null,
      after_sequence: 0,
      limit: 100,
    };
    expect(
      qaAdminRunEventsQuerySchema.safeParse({ ...base, operation: "RUN_REPLAY" }).success,
    ).toBe(true);
    expect(
      qaAdminRunEventsQuerySchema.safeParse({
        ...base,
        operation: "SUBAGENT_READ",
        profile_id: "TEXT2SQL",
      }).success,
    ).toBe(false);
    expect(
      qaAdminRunEventsQuerySchema.safeParse({
        ...base,
        operation: "SUBAGENT_READ",
        profile_id: "TEXT2SQL",
        task_id: id("5"),
      }).success,
    ).toBe(true);
  });

  it("does not accept mismatched artifact and run references", () => {
    const query = {
      schema_version: "qa-admin-artifact-access-query@1.0.0",
      operation: "ARTIFACT_PREVIEW",
      workspace_id: id("1"),
      owner_principal_id: id("2"),
      conversation_id: id("3"),
      run_id: id("4"),
      reference: {
        app_id: id("9"),
        tenant_id: id("1"),
        environment: "dev",
        run_id: id("6"),
        artifact_id: id("7"),
        artifact_type: "AnalysisReport",
        revision: 1,
        content_hash: `sha256:${"a".repeat(64)}`,
      },
    };
    expect(qaAdminArtifactAccessQuerySchema.safeParse(query).success).toBe(false);
  });

  it("binds operation to a server-owned reason code", () => {
    expect(qaAdminReasonForOperation("RUN_REPLAY")).toBe("QA_ADMIN_RUN_REPLAY");
    expect(qaAdminReasonForOperation("ARTIFACT_EXPORT")).toBe("QA_ADMIN_ARTIFACT_EXPORT");
  });

  it("rejects a directory projection whose receipt is for another operation", () => {
    expect(
      qaAdminDirectoryPageSchema.safeParse({
        schema_version: "qa-admin-directory-page@1.0.0",
        workspace_id: id("1"),
        read_only: true,
        folders: [],
        conversations: [],
        next_cursor: null,
        receipt: {
          schema_version: "qa-admin-audit-receipt-ref@1.0.0",
          receipt_id: id("8"),
          operation: "MESSAGES_READ",
          reason_code: "QA_ADMIN_MESSAGE_REVIEW",
          request_digest: `sha256:${"b".repeat(64)}`,
          occurred_at: "2026-08-22T00:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("requires explicit conversation operation", () => {
    expect(
      qaAdminConversationQuerySchema.safeParse({
        schema_version: "qa-admin-conversation-query@1.0.0",
        operation: "MESSAGES_READ",
        workspace_id: id("1"),
        owner_principal_id: id("2"),
        conversation_id: id("3"),
        cursor: null,
        limit: 50,
      }).success,
    ).toBe(true);
  });
});
