import { verifyDatasourceAdapterRegistrySnapshot } from "@data-agent/contracts";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: vi.fn().mockResolvedValue({
    ok: true,
    value: { capability: { scope: {}, principal: "test" } },
  }),
  workspaceErrorResponse: (error: unknown) => Response.json({ error }, { status: 400 }),
}));

let get: typeof import("../src/app/api/workspaces/[workspaceId]/datasource-adapters/route").GET;

beforeAll(async () => {
  ({ GET: get } = await import(
    "../src/app/api/workspaces/[workspaceId]/datasource-adapters/route"
  ));
});

describe("Datasource Adapter Registry route", () => {
  it("returns the strict five-adapter deployment snapshot", async () => {
    const response = await get(new NextRequest("http://localhost/datasource-adapters"), {
      params: Promise.resolve({ workspaceId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    const snapshot = await verifyDatasourceAdapterRegistrySnapshot(body.data);
    expect(snapshot.platform_ready).toBe(true);
    expect(snapshot.items.map(({ descriptor }) => descriptor.adapter_id)).toEqual([
      "clickhouse",
      "duckdb",
      "mysql",
      "postgresql",
      "sqlite",
    ]);
  });
});
