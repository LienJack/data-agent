import { describe, expect, it } from "vitest";
import {
  workspaceIdFromPathname,
  workspacePath,
  workspaceStorageKey,
} from "@/lib/workspace-routes";

const workspaceId = "9e0ed5ae-7ab6-4896-b7eb-868e202f3725";

describe("workspace routes", () => {
  it("builds canonical workspace paths without duplicate slashes", () => {
    expect(workspacePath(workspaceId)).toBe(`/w/${workspaceId}`);
    expect(workspacePath(workspaceId, "/semantic/explorer/")).toBe(
      `/w/${workspaceId}/semantic/explorer`,
    );
  });

  it("only resolves workspace ids from canonical workspace routes", () => {
    expect(workspaceIdFromPathname(`/w/${workspaceId}/qa`)).toBe(workspaceId);
    expect(workspaceIdFromPathname("/qa")).toBe("");
    expect(workspaceIdFromPathname("/workspaces")).toBe("");
  });

  it("rejects invalid workspace ids", () => {
    expect(() => workspacePath("default", "qa")).toThrow("工作空间 ID 无效");
  });

  it("scopes browser state keys to a workspace", () => {
    expect(workspaceStorageKey(workspaceId, "activeRunId")).toBe(
      `data-agent.workspace.${workspaceId}.activeRunId`,
    );
  });
});
