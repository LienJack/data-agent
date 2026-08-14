import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  deployment: "00000000-0000-4000-8000-00000000de01",
  principal: "00000000-0000-4000-8000-000000001001",
  bill: "00000000-0000-4000-8000-000000007001",
  attackerBill: "00000000-0000-4000-8000-000000007099",
  operation: "00000000-0000-4000-8000-000000007002",
} as const;

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  repository: {
    review: vi.fn(),
    getRuntimeState: vi.fn(),
  },
}));

vi.mock("@/lib/workspace-identity", () => ({
  getModelBillingRepository: () => mocks.repository,
  getWorkspaceDeploymentId: () => "00000000-0000-4000-8000-00000000de01",
  getWorkspaceSessionFromHeaders: mocks.session,
}));

let authorizeAdmin: typeof import("../src/lib/model-billing-admin").authorizeModelBillingAdminRequest;
let reviewPost: typeof import("../src/app/api/admin/billing/reviews/[billId]/route").POST;

beforeAll(async () => {
  ({ authorizeModelBillingAdminRequest: authorizeAdmin } = await import(
    "../src/lib/model-billing-admin"
  ));
  ({ POST: reviewPost } = await import("../src/app/api/admin/billing/reviews/[billId]/route"));
});

beforeEach(() => {
  mocks.session.mockReset();
  mocks.repository.review.mockReset();
  mocks.repository.getRuntimeState.mockReset();
});

describe("model billing request guards", () => {
  it("blocks non-super-admin users from runtime mode and review authority", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: { principal_id: ids.principal, system_role: "USER" },
    });
    const result = await authorizeAdmin(
      new NextRequest("http://localhost/api/admin/billing/state"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({
        error: { code: "SUPER_ADMIN_REQUIRED" },
      });
    }
  });

  it("derives principal and deployment only from the verified server session", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: { principal_id: ids.principal, system_role: "SUPER_ADMIN" },
    });
    const result = await authorizeAdmin(
      new NextRequest("http://localhost/api/admin/billing/state", {
        headers: { "x-principal-id": "00000000-0000-4000-8000-000000001099" },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        context: { deployment_id: ids.deployment, principal_id: ids.principal },
      },
    });
  });

  it("overwrites a client-supplied review bill with the route bill", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: { principal_id: ids.principal, system_role: "SUPER_ADMIN" },
    });
    mocks.repository.review.mockResolvedValue({ ok: true, value: { operation_id: ids.operation } });
    const response = await reviewPost(
      new NextRequest(`http://localhost/api/admin/billing/reviews/${ids.bill}`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "model-billing-review@1.0.0",
          operation_id: ids.operation,
          idempotency_key: "model-billing-review-route",
          bill_id: ids.attackerBill,
          decision: "RELEASE",
          verified_usage: null,
          reason: "provider confirmed no charge",
        }),
      }),
      { params: Promise.resolve({ billId: ids.bill }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.repository.review).toHaveBeenCalledWith(
      { deployment_id: ids.deployment, principal_id: ids.principal },
      expect.objectContaining({ bill_id: ids.bill }),
    );
  });
});
