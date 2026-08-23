import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileSystemStorageClient } from "../../src/storage/file-system-storage-client.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileSystemStorageClient", () => {
  it("publishes content atomically, preserves the first value, and lists bounded keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-content-"));
    roots.push(root);
    const client = createFileSystemStorageClient(root);
    await client.put("workspace-content/v1/a/aa/one", new Uint8Array([1, 2, 3]));
    await client.put("workspace-content/v1/a/aa/one", new Uint8Array([9]));
    await client.put("workspace-content/v1/a/bb/two", new Uint8Array([4]));
    expect(await client.get("workspace-content/v1/a/aa/one")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await client.list("workspace-content/v1/a")).toEqual([
      "workspace-content/v1/a/aa/one",
      "workspace-content/v1/a/bb/two",
    ]);
    const observed = await client.listObserved("workspace-content/v1/a");
    expect(observed).toEqual([
      expect.objectContaining({
        key: "workspace-content/v1/a/aa/one",
        byte_size: 3,
        modified_at: expect.stringMatching(/Z$/),
      }),
      expect.objectContaining({
        key: "workspace-content/v1/a/bb/two",
        byte_size: 1,
        modified_at: expect.stringMatching(/Z$/),
      }),
    ]);
    const first = observed[0];
    if (!first) throw new Error("observed storage fixture missing");
    expect(await client.removeObserved({ ...first, byte_size: 99 })).toBe(false);
    expect(await client.removeObserved(first)).toBe(true);
    expect(await client.get("workspace-content/v1/a/aa/one")).toBeNull();
    await client.remove("workspace-content/v1/a/aa/one");
    expect(await client.get("workspace-content/v1/a/aa/one")).toBeNull();
  });

  it("rejects traversal before touching the filesystem", async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-content-"));
    roots.push(root);
    const client = createFileSystemStorageClient(root);
    await expect(client.put("../escape", new Uint8Array([1]))).rejects.toThrow(
      "STORAGE_KEY_INVALID",
    );
  });
});
