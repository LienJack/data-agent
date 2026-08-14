import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  deployment: "00000000-0000-4000-8000-00000000de01",
  principal: "00000000-0000-4000-8000-000000001001",
  target: "00000000-0000-4000-8000-000000001002",
  attacker: "00000000-0000-4000-8000-000000001099",
  operation: "00000000-0000-4000-8000-00000000c401",
} as const;

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  repository: {
    adjust: vi.fn(),
    getOwnAccount: vi.fn(),
  },
}));

vi.mock("@/lib/workspace-identity", () => ({
  getCreditLedgerRepository: () => mocks.repository,
  getWorkspaceDeploymentId: () => "00000000-0000-4000-8000-00000000de01",
  getWorkspaceSessionFromHeaders: mocks.session,
}));

let authorizeCreditAdminRequest: typeof import("../src/lib/credit-admin").authorizeCreditAdminRequest;
let adjustmentPost: typeof import("../src/app/api/admin/credits/[principalId]/adjust/route").POST;

beforeAll(async () => {
  ({ authorizeCreditAdminRequest } = await import("../src/lib/credit-admin"));
  ({ POST: adjustmentPost } = await import(
    "../src/app/api/admin/credits/[principalId]/adjust/route"
  ));
});

beforeEach(() => {
  mocks.session.mockReset();
  mocks.repository.adjust.mockReset();
  mocks.repository.getOwnAccount.mockReset();
});

describe("credit request guards", () => {
  it("rejects a database-resolved non-super-admin before global account access", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: { principal_id: ids.principal, system_role: "USER" },
    });
    const result = await authorizeCreditAdminRequest(
      new NextRequest("http://localhost/api/admin/credits"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({
        error: { code: "SUPER_ADMIN_REQUIRED" },
      });
    }
  });

  it("derives repository context only from the server session", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: { principal_id: ids.principal, system_role: "SUPER_ADMIN" },
    });
    const result = await authorizeCreditAdminRequest(
      new NextRequest("http://localhost/api/admin/credits", {
        headers: { "x-system-role": "USER", "x-principal-id": ids.attacker },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        context: { deployment_id: ids.deployment, principal_id: ids.principal },
      },
    });
  });

  it("overwrites a client-supplied adjustment target with the route principal", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: { principal_id: ids.principal, system_role: "SUPER_ADMIN" },
    });
    mocks.repository.adjust.mockResolvedValue({ ok: true, value: { operation_id: ids.operation } });
    const response = await adjustmentPost(
      new NextRequest(`http://localhost/api/admin/credits/${ids.target}/adjust`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "credit-adjustment@1.0.0",
          operation_id: ids.operation,
          idempotency_key: "credit-adjust-route",
          target_principal_id: ids.attacker,
          signed_microcredits: "1000000",
          reason: "manual grant",
          expected_account_version: 1,
        }),
      }),
      { params: Promise.resolve({ principalId: ids.target }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.repository.adjust).toHaveBeenCalledWith(
      { deployment_id: ids.deployment, principal_id: ids.principal },
      expect.objectContaining({ target_principal_id: ids.target }),
    );
  });
});
