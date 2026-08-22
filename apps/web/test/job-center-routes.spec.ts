import { RUNTIME_BUILD_IDENTITY_VERSION } from "@data-agent/contracts";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWebRuntimeBuildIdentityForTest } from "../src/lib/runtime-build-identity.js";

const ids = {
  workspace: "00000000-0000-4000-8000-000000007402",
  job: "00000000-0000-4000-8000-000000007403",
} as const;
const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: ids.workspace,
  environment: "test",
} as const;

const state = vi.hoisted(() => ({
  accesses: [] as string[],
  listInputs: [] as unknown[],
  cancelInputs: [] as unknown[],
  readinessInputs: [] as unknown[],
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (_request: unknown, _workspaceId: string, access: string) => {
    state.accesses.push(access);
    return { ok: true, value: { capability: { scope } } };
  },
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 400 }),
}));

vi.mock("@/lib/job-center", () => ({
  projectCapabilityReadiness: (receipt: Record<string, unknown>) => ({
    capability: receipt.capability,
    status: receipt.status,
    reason_code: receipt.reason_code,
    evaluated_at: receipt.evaluated_at,
    valid_until: receipt.valid_until,
  }),
  getWorkspaceJobQueue: () => ({
    list: async (input: unknown) => {
      state.listInputs.push(input);
      return { ok: true, value: [{ job_id: ids.job, status: "QUEUED" }] };
    },
    requestCancel: async (input: unknown) => {
      state.cancelInputs.push(input);
      return { ok: true, value: { job_id: ids.job, status: "CANCELLED" } };
    },
    listReadiness: async (input: unknown) => {
      state.readinessInputs.push(input);
      return {
        ok: true,
        value: [
          {
            capability: "ARTIFACT_EXPORT",
            status: "READY",
            reason_code: "CAPABILITY_READY",
            evaluated_at: "2026-08-17T12:00:00.000Z",
            valid_until: "2026-08-17T12:01:00.000Z",
            receipt_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            handler_revision: "artifact-export@1.0.0",
          },
        ],
      };
    },
  }),
}));

describe("Job Center routes", () => {
  beforeEach(() => {
    setWebRuntimeBuildIdentityForTest({
      schema_version: RUNTIME_BUILD_IDENTITY_VERSION,
      consumer_role: "web",
      generation_id: `sha256:${"a".repeat(64)}`,
      build_id: `sha256:${"b".repeat(64)}`,
      built_at: "2026-08-22T00:00:00.000Z",
      git_commit: "c".repeat(40),
      git_dirty: true,
    });
    state.accesses = [];
    state.listInputs = [];
    state.cancelInputs = [];
    state.readinessInputs = [];
  });

  it("lists authorized workspace jobs without caching", async () => {
    const { GET } = await import("../src/app/api/workspaces/[workspaceId]/jobs/route");
    const response = await GET(new NextRequest("http://localhost/jobs?limit=25"), {
      params: Promise.resolve({ workspaceId: ids.workspace }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.accesses).toEqual(["READ"]);
    expect(state.listInputs).toEqual([{ scope, limit: 25 }]);
  });

  it("forwards a strict cancellation identity under WRITE authority", async () => {
    const { DELETE } = await import("../src/app/api/workspaces/[workspaceId]/jobs/[jobId]/route");
    const response = await DELETE(
      new NextRequest("http://localhost/jobs/cancel", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotency_key: "job-cancel-route-0001" }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace, jobId: ids.job }) },
    );

    expect(response.status).toBe(200);
    expect(state.accesses).toEqual(["WRITE"]);
    expect(state.cancelInputs).toEqual([
      { scope, job_id: ids.job, idempotency_key: "job-cancel-route-0001" },
    ]);
  });

  it("exposes detailed readiness only through an authorized route", async () => {
    const { GET } = await import("../src/app/api/workspaces/[workspaceId]/jobs/readiness/route");
    const response = await GET(new NextRequest("http://localhost/jobs/readiness"), {
      params: Promise.resolve({ workspaceId: ids.workspace }),
    });

    expect(response.status).toBe(200);
    expect(state.accesses).toEqual(["READ"]);
    expect(state.readinessInputs).toEqual([{ scope }]);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("receipt_hash");
    expect(body).not.toContain("handler_revision");
  });

  it("keeps public readiness minimal and only projects authorized details", async () => {
    const { GET } = await import("../src/app/api/ready/route");
    const publicResponse = await GET(new NextRequest("http://localhost/api/ready"));
    const publicBody = await publicResponse.json();
    expect(publicBody).toEqual({
      live: true,
      ready: true,
      build_id: `sha256:${"b".repeat(64)}`,
      generation_id: `sha256:${"a".repeat(64)}`,
    });
    expect(JSON.stringify(publicBody)).not.toContain("git_commit");
    expect(JSON.stringify(publicBody)).not.toContain("git_dirty");
    expect(JSON.stringify(publicBody)).not.toContain("package_tasks");
    expect(publicResponse.headers.get("cache-control")).toBe("no-store");
    expect(state.accesses).toEqual([]);
    expect(state.readinessInputs).toEqual([]);

    const detailedResponse = await GET(
      new NextRequest(`http://localhost/api/ready?workspace_id=${ids.workspace}`),
    );
    const detailed = await detailedResponse.json();
    expect(detailed).toMatchObject({
      live: true,
      ready: true,
      capabilities: [{ capability: "ARTIFACT_EXPORT", status: "READY" }],
    });
    expect(JSON.stringify(detailed)).not.toContain("receipt_hash");
    expect(state.accesses).toEqual(["READ"]);
    expect(state.readinessInputs).toEqual([{ scope }]);
  });
});
