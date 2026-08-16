import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  workspace: "00000000-0000-4000-8000-00000000aa01",
  principal: "00000000-0000-4000-8000-000000001001",
  deployment: "00000000-0000-4000-8000-00000000de01",
  profile: "30000000-0000-4000-8000-000000000003",
  certification: "30000000-0000-4000-8000-000000000004",
  certificationRun: "30000000-0000-4000-8000-000000000005",
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const executionProfile = {
  model_profile_id: ids.profile,
  model_config_version: 1,
  resource_hash: hash("a"),
  profile_version: "model-profile@1",
  provider: "deepseek" as const,
  model_id: "deepseek-v4-flash",
  display_name: "DeepSeek V4 Flash",
  adapter_version: "model-provider-adapter@1.0.0",
  certification_receipt_ref: {
    artifact_id: ids.certification,
    artifact_type: "ModelCertificationReceipt" as const,
    app_id: ids.app,
    tenant_id: ids.workspace,
    environment: "test",
    run_id: ids.certificationRun,
    revision: 1,
    content_hash: hash("b"),
  },
  execution_profile_hash: hash("c"),
  recovery_capabilities: ["INVOCATION_RECONCILIATION" as const],
  connection: {
    kind: "SYSTEM_DEPLOYMENT" as const,
    deployment_id: ids.deployment,
    deployment_revision: 1,
    deployment_hash: hash("d"),
  },
  effective_context_ceiling_tokens: 16_000,
  effective_output_ceiling_tokens: 4_000,
  readiness: "AVAILABLE" as const,
  selectable: true as const,
  unavailable_reason: null,
};

const mocks = vi.hoisted(() => ({
  listExecutionProfiles: vi.fn(),
  listDatasources: vi.fn(),
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      session: { principal_id: ids.principal },
      capability: { principal: ids.principal },
    },
  }),
  workspaceErrorResponse: vi.fn(),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getProviderInvocationStore: () => ({
    listExecutionProfiles: mocks.listExecutionProfiles,
  }),
  getWorkspaceDataRepository: () => ({ listDatasources: mocks.listDatasources }),
}));

let GET: typeof import("../src/app/api/workspaces/[workspaceId]/qa/resources/route").GET;

beforeAll(async () => {
  ({ GET } = await import("../src/app/api/workspaces/[workspaceId]/qa/resources/route"));
});

beforeEach(() => {
  mocks.listExecutionProfiles.mockReset();
  mocks.listDatasources.mockReset();
  mocks.listExecutionProfiles.mockResolvedValue({ ok: true, value: [executionProfile] });
  mocks.listDatasources.mockResolvedValue({ ok: true, value: [] });
});

describe("Q&A resource route", () => {
  it("returns the pricing-free PostgreSQL execution readiness projection", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/qa/resources`),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.models).toEqual([
      expect.objectContaining({
        model_profile_id: ids.profile,
        model_id: "deepseek-v4-flash",
        readiness: "AVAILABLE",
        selectable: true,
      }),
    ]);
    expect(mocks.listExecutionProfiles).toHaveBeenCalledOnce();
    expect(JSON.stringify(payload)).not.toMatch(/credential|pricing|billing|credit/iu);
  });
});
