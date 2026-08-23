import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceId = "00000000-0000-4000-8000-00000000aa11";

vi.mock("../src/lib/api-client", () => ({
  resolveWorkspaceId: () => workspaceId,
}));

import { createDataSource, fetchDataSources } from "../src/lib/datasource-api";

const datasource = {
  schema_version: "workspace-datasource@1.0.0",
  workspace_id: workspaceId,
  datasource_id: "00000000-0000-4000-8000-00000000d001",
  resource_version: 23,
  name: "Warehouse",
  type: "sqlite",
  host: null,
  port: null,
  database: null,
  username: null,
  credential_ref: null,
  ssl: "disable",
  path: "/tmp/warehouse.db",
  catalog: null,
  schema: null,
  status: "ACTIVE",
  last_tested_at: null,
  created_by_principal_id: "00000000-0000-4000-8000-000000001001",
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-16T00:00:00.000Z",
} as const;

describe("datasource API version projection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves the database-owned resource version when listing selected datasources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [datasource] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(fetchDataSources()).resolves.toEqual([
      expect.objectContaining({ id: datasource.datasource_id, resourceVersion: 23 }),
    ]);
  });

  it("preserves the exact created datasource resource version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { ...datasource, resource_version: 41 } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(
      createDataSource({ name: "Warehouse", type: "sqlite", path: "/tmp/warehouse.db" }),
    ).resolves.toEqual(expect.objectContaining({ resourceVersion: 41 }));
  });

  it.each([
    ["missing", (({ resource_version: _resourceVersion, ...value }) => value)(datasource)],
    ["zero", { ...datasource, resource_version: 0 }],
    ["unsafe", { ...datasource, resource_version: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects a %s datasource resource version at the API boundary", async (_case, value) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [value] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(fetchDataSources()).rejects.toThrow();
  });
});
