import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { StorageClient } from "./namespace.js";

function resolvedKey(root: string, key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/.test(key) || key.includes("..")) {
    throw new TypeError("STORAGE_KEY_INVALID");
  }
  const path = resolve(root, key);
  if (path !== root && !path.startsWith(`${root}${sep}`))
    throw new TypeError("STORAGE_KEY_INVALID");
  return path;
}

export type ObservedStorageObject = Readonly<{
  key: string;
  byte_size: number;
  modified_at: string;
}>;

export type ObservableStorageClient = StorageClient &
  Readonly<{
    listObserved(prefix: string): Promise<ObservedStorageObject[]>;
    removeObserved(object: ObservedStorageObject): Promise<boolean>;
  }>;

export function createFileSystemStorageClient(rootInput: string): ObservableStorageClient {
  const root = resolve(rootInput);
  if (root === "/" || root.length < 2) throw new TypeError("STORAGE_ROOT_INVALID");
  async function listKeys(prefix: string) {
    const prefixPath = resolvedKey(root, prefix);
    const pending = [prefixPath];
    const keys: string[] = [];
    while (pending.length > 0) {
      const directory = pending.pop();
      if (!directory) break;
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as { readonly code?: unknown }).code === "ENOENT") return [];
        throw error;
      }
      for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile() && !entry.name.includes(".tmp-")) keys.push(relative(root, path));
        if (keys.length + pending.length > 10_000) {
          throw new TypeError("STORAGE_LIST_LIMIT_EXCEEDED");
        }
      }
    }
    return keys.sort();
  }
  return Object.freeze({
    async put(key: string, value: Uint8Array) {
      const path = resolvedKey(root, key);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
      try {
        await link(temporary, path);
      } catch (error) {
        if ((error as { readonly code?: unknown }).code !== "EEXIST") throw error;
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async get(key: string) {
      try {
        return new Uint8Array(await readFile(resolvedKey(root, key)));
      } catch (error) {
        if ((error as { readonly code?: unknown }).code === "ENOENT") return null;
        throw error;
      }
    },
    async remove(key: string) {
      await rm(resolvedKey(root, key), { force: true });
    },
    list: listKeys,
    async listObserved(prefix: string) {
      const keys = await listKeys(prefix);
      return Promise.all(
        keys.map(async (key) => {
          const metadata = await stat(resolvedKey(root, key));
          return Object.freeze({
            key,
            byte_size: metadata.size,
            modified_at: metadata.mtime.toISOString(),
          });
        }),
      );
    },
    async removeObserved(object: ObservedStorageObject) {
      const path = resolvedKey(root, object.key);
      try {
        const metadata = await stat(path);
        if (
          metadata.size !== object.byte_size ||
          metadata.mtime.toISOString() !== object.modified_at
        ) {
          return false;
        }
        await rm(path, { force: true });
        return true;
      } catch (error) {
        if ((error as { readonly code?: unknown }).code === "ENOENT") return true;
        throw error;
      }
    },
  });
}
