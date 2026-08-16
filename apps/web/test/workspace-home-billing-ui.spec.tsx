import { Children, isValidElement, type ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  workspaces: vi.fn(),
  capability: vi.fn(),
  navigation: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  AccountControls: function AccountControls() {
    return null;
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/workspaces/account-controls", () => ({
  AccountControls: mocks.AccountControls,
}));
vi.mock("@/lib/workspace-identity", () => ({
  getCurrentWorkspaceSession: mocks.session,
  listSessionWorkspaces: mocks.workspaces,
  resolveSessionWorkspaceCapability: mocks.capability,
}));
vi.mock("@/lib/workspace-navigation", () => ({
  navigationForWorkspace: mocks.navigation,
}));

let WorkspaceHomePage: typeof import("../src/app/w/[workspaceId]/page").default;

function textContent(node: ReactNode): string {
  const values: string[] = [];
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      values.push(String(child));
      return;
    }
    if (isValidElement<{ readonly children?: ReactNode }>(child)) {
      values.push(textContent(child.props.children));
    }
  });
  return values.join("");
}

beforeAll(async () => {
  ({ default: WorkspaceHomePage } = await import("../src/app/w/[workspaceId]/page"));
});

beforeEach(() => {
  vi.unstubAllEnvs();
  const access = {
    role: "WORKSPACE_ADMIN",
    workspace: {
      workspace_id: "9e0ed5ae-7ab6-4896-b7eb-868e202f3725",
      slug: "main-workspace",
      display_name: "Main workspace",
    },
  };
  mocks.session.mockResolvedValue({ ok: true, value: { principal_id: "principal-1" } });
  mocks.workspaces.mockResolvedValue({ ok: true, value: [access] });
  mocks.capability.mockResolvedValue({ ok: true, value: {} });
  mocks.navigation.mockReturnValue([
    {
      key: "platform-settings",
      label: "模型配置",
      description: "管理模型、价格、汇率和账务复核",
      href: "/w/9e0ed5ae-7ab6-4896-b7eb-868e202f3725/platform-settings",
      phase: "PHASE_2",
    },
  ]);
});

describe("workspace home billing UI", () => {
  it("does not advertise billing controls while the UI is paused", async () => {
    const page = await WorkspaceHomePage({
      params: Promise.resolve({ workspaceId: "9e0ed5ae-7ab6-4896-b7eb-868e202f3725" }),
    });
    const copy = textContent(page);

    expect(copy).toContain("管理账户、工作空间与语义资产");
    expect(copy).toContain("平台级扩展能力将在后续阶段继续接入");
    expect(copy).not.toContain("计费");
    expect(copy).not.toContain("价格、汇率");
  });

  it("restores the existing billing copy after an explicit server opt-in", async () => {
    vi.stubEnv("BILLING_UI_ENABLED", "1");

    const page = await WorkspaceHomePage({
      params: Promise.resolve({ workspaceId: "9e0ed5ae-7ab6-4896-b7eb-868e202f3725" }),
    });
    const copy = textContent(page);

    expect(copy).toContain("管理模型、价格、汇率和账务复核");
    expect(copy).toContain("平台模型与计费控制面将在后续阶段继续接入");
  });
});
