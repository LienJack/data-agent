import type { WorkspaceAction } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { navigationForWorkspace } from "@/lib/workspace-navigation";

function access(
  role: "WORKSPACE_ADMIN" | "ANALYST" | "VIEWER",
  allowed_actions: WorkspaceAction[],
) {
  return {
    schema_version: "workspace-access@1.0.0" as const,
    workspace: {
      schema_version: "workspace@1.0.0" as const,
      app_id: "00000000-0000-4000-8000-00000000da01",
      environment: "test",
      workspace_id: "00000000-0000-4000-8000-00000000aa11",
      slug: "main-workspace",
      display_name: "Main workspace",
      lifecycle: "ACTIVE" as const,
      lifecycle_version: 1,
      created_at: "2026-08-14T00:00:00.000Z",
      archived_at: null,
    },
    principal_id: "00000000-0000-4000-8000-000000001001",
    system_role: "USER" as const,
    role,
    allowed_actions,
  };
}

describe("workspace role navigation", () => {
  it("hides management entries from viewers", () => {
    const items = navigationForWorkspace(access("VIEWER", ["WORKSPACE_RESULT_READ"]));
    expect(items.map((item) => item.label)).toEqual(["结果浏览"]);
  });

  it("shows workspace administration only when the parsed projection allows it", () => {
    const items = navigationForWorkspace(
      access("WORKSPACE_ADMIN", ["MEMBER_MANAGE", "DATASOURCE_MANAGE", "WORKSPACE_RESULT_READ"]),
    );
    expect(items.map((item) => item.label)).toEqual(["结果浏览", "数据源", "成员管理"]);
  });
});
