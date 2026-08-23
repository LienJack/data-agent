import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminConversationAudit } from "@/components/qa/admin-conversation-audit";
import { mergeAdminRunEventsPage } from "@/lib/qa-admin-event-stream";

describe("AdminConversationAudit", () => {
  it("renders a separate read-only audit plane without conversation mutations", () => {
    const html = renderToStaticMarkup(
      <AdminConversationAudit initialWorkspaceId="20000000-0000-4000-8000-000000000001" />,
    );
    expect(html).toContain("对话审计");
    expect(html).toContain("管理员只读");
    expect(html).toContain("所有访问可追溯");
    expect(html).toContain("Inspector");
    expect(html).not.toContain("发送消息");
    expect(html).not.toContain("重命名对话");
    expect(html).not.toContain("删除对话");
  });

  it("lets a super admin select a workspace without weakening the read-only banner", () => {
    const html = renderToStaticMarkup(
      <AdminConversationAudit
        globalMode
        initialWorkspaceId="20000000-0000-4000-8000-000000000001"
        workspaces={[
          {
            workspace_id: "20000000-0000-4000-8000-000000000001",
            name: "商业分析",
          },
        ]}
      />,
    );
    expect(html).toContain("商业分析");
    expect(html).toContain("工作空间");
    expect(html).toContain("此页面没有发送、重命名、归档、删除或运行控制能力");
  });
});

describe("mergeAdminRunEventsPage", () => {
  it("deduplicates replayed events and preserves sequence order", () => {
    const event = (eventId: string, sequence: number) => ({
      schema_version: "public-run-event@2.0.0",
      event_id: eventId,
      run_id: "20000000-0000-4000-8000-000000000004",
      sequence,
    });
    const base = {
      schema_version: "qa-admin-run-events-page@1.0.0",
      events: [event("b", 2), event("a", 1)],
      receipt: { operation: "TRAJECTORY_READ" },
    } as never;
    const replay = {
      schema_version: "qa-admin-run-events-page@1.0.0",
      events: [event("b", 2), event("c", 3)],
      receipt: { operation: "RUN_REPLAY" },
    } as never;
    const merged = mergeAdminRunEventsPage(base, replay);
    expect(merged.events.map((item) => item.event_id)).toEqual(["a", "b", "c"]);
    expect(merged.receipt.operation).toBe("RUN_REPLAY");
  });
});
