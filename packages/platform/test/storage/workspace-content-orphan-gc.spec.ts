import { describe, expect, it, vi } from "vitest";
import { createWorkspaceContentOrphanGc } from "../../src/storage/workspace-content-orphan-gc.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  workspace_id: "10000000-0000-4000-8000-000000000001",
  environment: "local",
} as const;
const digest = "a".repeat(64);
const object = {
  key: `workspace-content/v1/${scope.app_id}/${scope.workspace_id}/local/aa/${digest}`,
  byte_size: 4,
  modified_at: "2026-08-16T00:00:00.000Z",
} as const;

describe("Workspace Content orphan GC", () => {
  it("double-checks an old unreferenced object and conditionally removes the same observation", async () => {
    const classifyOrphan = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        schema_version: "workspace-content-orphan-check-result@1.0.0",
        storage_key: object.key,
        blob_hash: `sha256:${digest}`,
        authorized: false,
        orphan_ttl_seconds: 86_400,
        observed_at: object.modified_at,
        checked_at: "2026-08-18T00:00:00.000Z",
      },
    });
    const removeObserved = vi.fn().mockResolvedValue(true);
    const service = createWorkspaceContentOrphanGc({
      authority: { classifyOrphan },
      storage: {
        put: vi.fn(),
        get: vi.fn(),
        remove: vi.fn(),
        list: vi.fn(),
        listObserved: vi.fn().mockResolvedValue([object]),
        removeObserved,
      },
    });
    await expect(service.collect({}, scope)).resolves.toEqual({
      ok: true,
      value: { examined: 1, deleted: 1 },
    });
    expect(classifyOrphan).toHaveBeenCalledTimes(2);
    expect(removeObserved).toHaveBeenCalledWith(object);
  });

  it("never removes an authorized object", async () => {
    const removeObserved = vi.fn();
    const service = createWorkspaceContentOrphanGc({
      authority: {
        classifyOrphan: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            schema_version: "workspace-content-orphan-check-result@1.0.0",
            storage_key: object.key,
            blob_hash: `sha256:${digest}`,
            authorized: true,
            orphan_ttl_seconds: 86_400,
            observed_at: object.modified_at,
            checked_at: "2026-08-18T00:00:00.000Z",
          },
        }),
      },
      storage: {
        put: vi.fn(),
        get: vi.fn(),
        remove: vi.fn(),
        list: vi.fn(),
        listObserved: vi.fn().mockResolvedValue([object]),
        removeObserved,
      },
    });
    await expect(service.collect({}, scope)).resolves.toMatchObject({
      ok: true,
      value: { deleted: 0 },
    });
    expect(removeObserved).not.toHaveBeenCalled();
  });
});
