import {
  type AppCapability,
  type BoundaryResult,
  type CapabilityAuthorizer,
  failure,
} from "../tenancy/capability.js";

const contentHash = /^sha256:([a-f0-9]{64})$/;
const storedDigest = /^sha256-([a-f0-9]{64})$/;
const artifactKind = /^[a-z][a-z0-9_-]{1,62}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StorageRunBinding = Readonly<{
  run_id: string;
  owner_principal_id: string;
}>;

export interface StorageClient {
  put(key: string, value: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

function expected(
  capability: AppCapability,
  run: StorageRunBinding,
  kind: string,
  hash: string,
): string | null {
  const match = contentHash.exec(hash);
  return artifactKind.test(kind) &&
    uuid.test(run.run_id) &&
    uuid.test(run.owner_principal_id) &&
    (capability.role === "OWNER" || run.owner_principal_id === capability.principal) &&
    match
    ? `${capability.scope.app_id}/${capability.scope.tenant_id}/${
        capability.scope.environment
      }/${run.owner_principal_id}/${run.run_id}/${kind}/sha256-${match[1]}`
    : null;
}

function validKey(capability: AppCapability, key: string): boolean {
  const parts = key.split("/");
  return (
    parts.length === 7 &&
    parts[0] === capability.scope.app_id &&
    parts[1] === capability.scope.tenant_id &&
    parts[2] === capability.scope.environment &&
    uuid.test(parts[3] ?? "") &&
    uuid.test(parts[4] ?? "") &&
    (capability.role === "OWNER" || parts[3] === capability.principal) &&
    artifactKind.test(parts[5] ?? "") &&
    storedDigest.test(parts[6] ?? "")
  );
}

export function createStorageNamespace(client: StorageClient, authorizer: CapabilityAuthorizer) {
  return {
    createKey(
      capabilityInput: unknown,
      run: StorageRunBinding,
      kind: string,
      hash: string,
    ): string {
      const capability = authorizer.requireRole(capabilityInput, ["OWNER", "ANALYST", "VIEWER"]);
      if (!capability.ok) throw new TypeError(capability.error.code);
      const key = expected(capability.value, run, kind, hash);
      if (!key) throw new TypeError("STORAGE_KEY_INVALID");
      return key;
    },

    async put(
      capabilityInput: unknown,
      key: string,
      value: Uint8Array,
    ): Promise<BoundaryResult<void>> {
      const capability = await authorizer.revalidate(
        capabilityInput,
        ["OWNER", "ANALYST"],
        "WRITE",
      );
      if (!capability.ok) return capability;
      if (!validKey(capability.value, key)) {
        return failure("STORAGE_KEY_INVALID", "Storage Key 不属于当前 App/Tenant Scope。");
      }
      try {
        await client.put(key, value);
        return { ok: true, value: undefined };
      } catch {
        return failure("STORAGE_UNAVAILABLE", "对象存储暂时不可用；底层错误已脱敏。", true);
      }
    },

    async get(capabilityInput: unknown, key: string): Promise<BoundaryResult<Uint8Array | null>> {
      const capability = await authorizer.revalidate(capabilityInput, [
        "OWNER",
        "ANALYST",
        "VIEWER",
      ]);
      if (!capability.ok) return capability;
      if (!validKey(capability.value, key)) {
        return failure("STORAGE_KEY_INVALID", "Storage Key 不属于当前 App/Tenant Scope。");
      }
      try {
        return { ok: true, value: await client.get(key) };
      } catch {
        return failure("STORAGE_UNAVAILABLE", "对象存储暂时不可用；底层错误已脱敏。", true);
      }
    },

    async remove(capabilityInput: unknown, key: string): Promise<BoundaryResult<void>> {
      const capability = await authorizer.revalidate(
        capabilityInput,
        ["OWNER", "ANALYST"],
        "WRITE",
      );
      if (!capability.ok) return capability;
      if (!validKey(capability.value, key)) {
        return failure("STORAGE_KEY_INVALID", "Storage Key 不属于当前 App/Tenant Scope。");
      }
      try {
        await client.remove(key);
        return { ok: true, value: undefined };
      } catch {
        return failure("STORAGE_UNAVAILABLE", "对象存储暂时不可用；底层错误已脱敏。", true);
      }
    },

    async list(
      capabilityInput: unknown,
      run: StorageRunBinding,
      kind: string,
    ): Promise<BoundaryResult<string[]>> {
      const capability = await authorizer.revalidate(capabilityInput, [
        "OWNER",
        "ANALYST",
        "VIEWER",
      ]);
      if (!capability.ok) return capability;
      if (!artifactKind.test(kind)) {
        return failure("STORAGE_KEY_INVALID", "Artifact Kind 非法。");
      }
      const keyPrefix = expected(capability.value, run, kind, `sha256:${"0".repeat(64)}`);
      if (!keyPrefix) {
        return failure("STORAGE_KEY_INVALID", "Run Binding 不属于当前 Principal。");
      }
      const prefix = keyPrefix.slice(0, -`sha256-${"0".repeat(64)}`.length);
      try {
        const keys = await client.list(prefix);
        return keys.every(
          (key) =>
            key.startsWith(prefix) &&
            validKey(capability.value, key) &&
            key.split("/")[3] === run.owner_principal_id &&
            key.split("/")[4] === run.run_id &&
            key.split("/")[5] === kind,
        )
          ? { ok: true, value: keys }
          : failure("STORAGE_CLIENT_SCOPE_BREACH", "底层 Storage 返回了越界对象。");
      } catch {
        return failure("STORAGE_UNAVAILABLE", "对象存储暂时不可用；底层错误已脱敏。", true);
      }
    },
  };
}
