import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  workspaces: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  CreditLedgerPanel: function CreditLedgerPanel() {
    return null;
  },
  ModelBillingPanel: function ModelBillingPanel() {
    return null;
  },
  ModelProvidersPanel: function ModelProvidersPanel() {
    return null;
  },
  OperationsAdminPanel: function OperationsAdminPanel() {
    return null;
  },
  PricingControlPanel: function PricingControlPanel() {
    return null;
  },
  PlatformSettingsTabs: function PlatformSettingsTabs() {
    return null;
  },
  SemanticPortabilityPanel: function SemanticPortabilityPanel() {
    return null;
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/workspace-identity", () => ({
  getCurrentWorkspaceSession: mocks.session,
  listSessionWorkspaces: mocks.workspaces,
}));
vi.mock("@/components/settings/credit-ledger-panel", () => ({
  CreditLedgerPanel: mocks.CreditLedgerPanel,
}));
vi.mock("@/components/settings/model-billing-panel", () => ({
  ModelBillingPanel: mocks.ModelBillingPanel,
}));
vi.mock("@/components/settings/model-providers-panel", () => ({
  ModelProvidersPanel: mocks.ModelProvidersPanel,
}));
vi.mock("@/components/settings/operations-admin-panel", () => ({
  OperationsAdminPanel: mocks.OperationsAdminPanel,
}));
vi.mock("@/components/settings/pricing-control-panel", () => ({
  PricingControlPanel: mocks.PricingControlPanel,
}));
vi.mock("@/components/settings/platform-settings-tabs", () => ({
  PlatformSettingsTabs: mocks.PlatformSettingsTabs,
}));
vi.mock("@/components/settings/semantic-portability-panel", () => ({
  SemanticPortabilityPanel: mocks.SemanticPortabilityPanel,
}));

let SettingsPage: typeof import("../src/app/settings/page").default;
let WorkspaceSettingsPage: typeof import("../src/app/w/[workspaceId]/platform-settings/page").default;

function collectElements(node: ReactNode): ReactElement[] {
  const elements: ReactElement[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<{ readonly children?: ReactNode }>(child)) return;
    elements.push(child);
    elements.push(...collectElements(child.props.children));
  });
  return elements;
}

beforeAll(async () => {
  ({ default: SettingsPage } = await import("../src/app/settings/page"));
  ({ default: WorkspaceSettingsPage } = await import(
    "../src/app/w/[workspaceId]/platform-settings/page"
  ));
});

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.redirect.mockClear();
  mocks.session.mockResolvedValue({
    ok: true,
    value: {
      principal_id: "00000000-0000-4000-8000-000000000001",
      system_role: "SUPER_ADMIN",
    },
  });
  mocks.workspaces.mockResolvedValue({ ok: true, value: [] });
});

describe("platform settings billing UI", () => {
  it("uses the same guarded page for every workspace-scoped platform settings route", () => {
    expect(WorkspaceSettingsPage).toBe(SettingsPage);
  });

  it("keeps non-billing settings but does not mount billing controls by default", async () => {
    const pageElements = collectElements(await SettingsPage());
    const tabs = pageElements.find((element) => element.type === mocks.PlatformSettingsTabs) as
      | ReactElement<{
          readonly model: ReactNode;
          readonly operations: ReactNode;
          readonly semantic: ReactNode;
        }>
      | undefined;
    const elements = collectElements([
      tabs?.props.model,
      tabs?.props.operations,
      tabs?.props.semantic,
    ]);
    const types = new Set(elements.map((element) => element.type));
    const operations = elements.find((element) => element.type === mocks.OperationsAdminPanel) as
      | ReactElement<{ readonly billingUiEnabled: boolean }>
      | undefined;

    expect(tabs).toBeDefined();
    expect(types).toContain(mocks.ModelProvidersPanel);
    expect(types).toContain(mocks.OperationsAdminPanel);
    expect(types).toContain(mocks.SemanticPortabilityPanel);
    expect(types).not.toContain(mocks.CreditLedgerPanel);
    expect(types).not.toContain(mocks.ModelBillingPanel);
    expect(types).not.toContain(mocks.PricingControlPanel);
    expect(operations?.props.billingUiEnabled).toBe(false);
  });

  it("restores the existing controls after an explicit server opt-in", async () => {
    vi.stubEnv("BILLING_UI_ENABLED", "true");

    const pageElements = collectElements(await SettingsPage());
    const tabs = pageElements.find((element) => element.type === mocks.PlatformSettingsTabs) as
      | ReactElement<{ readonly operations: ReactNode }>
      | undefined;
    const elements = collectElements(tabs?.props.operations);
    const types = new Set(elements.map((element) => element.type));
    const operations = elements.find((element) => element.type === mocks.OperationsAdminPanel) as
      | ReactElement<{ readonly billingUiEnabled: boolean }>
      | undefined;

    expect(types).toContain(mocks.CreditLedgerPanel);
    expect(types).toContain(mocks.ModelBillingPanel);
    expect(types).toContain(mocks.PricingControlPanel);
    expect(operations?.props.billingUiEnabled).toBe(true);
  });
});
