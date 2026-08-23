import { createHash } from "node:crypto";
import type { ContentHash } from "@data-agent/contracts";
import {
  type AppCapability,
  type BoundaryResult,
  type CapabilityAuthorizer,
  failure,
} from "../tenancy/capability.js";
import type { StorageClient } from "./namespace.js";

const contentHashPattern = /^sha256:([0-9a-f]{64})$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const environmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function hashBytes(value: Uint8Array): ContentHash {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function expectedKey(capability: AppCapability, contentHash: string): string | null {
  const match = contentHashPattern.exec(contentHash);
  const digest = match?.[1];
  return digest &&
    uuidPattern.test(capability.scope.app_id) &&
    uuidPattern.test(capability.scope.tenant_id) &&
    environmentPattern.test(capability.scope.environment)
    ? `workspace-content/v1/${capability.scope.app_id}/${capability.scope.tenant_id}/${capability.scope.environment}/${digest.slice(0, 2)}/${digest}`
    : null;
}

function keyMatches(capability: AppCapability, key: string, contentHash: string): boolean {
  return expectedKey(capability, contentHash) === key;
}

export type WorkspaceContentPutReceipt = Readonly<{
  created: boolean;
  key: string;
  byte_size: number;
  content_hash: ContentHash;
}>;

export function createWorkspaceContentNamespace(
  client: StorageClient,
  authorizer: CapabilityAuthorizer,
) {
  return Object.freeze({
    createKey(capabilityInput: unknown, contentHash: string): string {
      const capability = authorizer.requireRole(capabilityInput, ["OWNER", "ANALYST"]);
      if (!capability.ok) throw new TypeError(capability.error.code);
      const key = expectedKey(capability.value, contentHash);
      if (key === null) throw new TypeError("STORAGE_KEY_INVALID");
      return key;
    },

    async put(
      capabilityInput: unknown,
      key: string,
      value: Uint8Array,
      expectedHash: string,
    ): Promise<BoundaryResult<WorkspaceContentPutReceipt>> {
      const capability = await authorizer.revalidate(
        capabilityInput,
        ["OWNER", "ANALYST"],
        "WRITE",
      );
      if (!capability.ok) return capability;
      if (!keyMatches(capability.value, key, expectedHash)) {
        return failure("STORAGE_KEY_INVALID", "Workspace Content Key 不属于当前 Scope。", false);
      }
      if (hashBytes(value) !== expectedHash) {
        return failure(
          "WORKSPACE_FILE_BLOB_INTEGRITY_FAILED",
          "Workspace 文件内容与声明的服务端 Hash 不一致。",
        );
      }
      try {
        const existing = await client.get(key);
        if (existing !== null) {
          return hashBytes(existing) === expectedHash && existing.byteLength === value.byteLength
            ? {
                ok: true,
                value: {
                  created: false,
                  key,
                  byte_size: value.byteLength,
                  content_hash: expectedHash as ContentHash,
                },
              }
            : failure("WORKSPACE_FILE_BLOB_INTEGRITY_FAILED", "内容地址已存在但字节身份不一致。");
        }
        await client.put(key, value);
        const persisted = await client.get(key);
        if (
          persisted === null ||
          persisted.byteLength !== value.byteLength ||
          hashBytes(persisted) !== expectedHash
        ) {
          return failure(
            "WORKSPACE_FILE_BLOB_INTEGRITY_FAILED",
            "对象存储没有回显相同的内容身份。",
          );
        }
        return {
          ok: true,
          value: {
            created: true,
            key,
            byte_size: value.byteLength,
            content_hash: expectedHash as ContentHash,
          },
        };
      } catch {
        return failure("STORAGE_UNAVAILABLE", "Workspace 文件存储暂时不可用。", true);
      }
    },

    async get(
      capabilityInput: unknown,
      key: string,
      expectedHash: string,
      expectedByteSize: number,
    ): Promise<BoundaryResult<Uint8Array | null>> {
      const capability = await authorizer.revalidate(capabilityInput, [
        "OWNER",
        "ANALYST",
        "VIEWER",
      ]);
      if (!capability.ok) return capability;
      if (!keyMatches(capability.value, key, expectedHash)) {
        return failure("STORAGE_KEY_INVALID", "Workspace Content Key 不属于当前 Scope。", false);
      }
      try {
        const value = await client.get(key);
        if (value === null) return { ok: true, value: null };
        if (value.byteLength !== expectedByteSize || hashBytes(value) !== expectedHash) {
          return failure(
            "WORKSPACE_FILE_BLOB_INTEGRITY_FAILED",
            "Workspace 文件字节与 Authority 记录不一致。",
          );
        }
        return { ok: true, value };
      } catch {
        return failure("STORAGE_UNAVAILABLE", "Workspace 文件存储暂时不可用。", true);
      }
    },

    async remove(
      capabilityInput: unknown,
      key: string,
      expectedHash: string,
    ): Promise<BoundaryResult<void>> {
      const capability = await authorizer.revalidate(capabilityInput, ["OWNER"], "WRITE");
      if (!capability.ok) return capability;
      if (!keyMatches(capability.value, key, expectedHash)) {
        return failure("STORAGE_KEY_INVALID", "Workspace Content Key 不属于当前 Scope。", false);
      }
      try {
        await client.remove(key);
        return { ok: true, value: undefined };
      } catch {
        return failure("STORAGE_UNAVAILABLE", "Workspace 文件存储暂时不可用。", true);
      }
    },
  });
}
