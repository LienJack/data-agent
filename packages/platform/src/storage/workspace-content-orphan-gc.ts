import type {
  PortResult,
  WorkspaceContentOrphanCheckCommand,
  WorkspaceContentOrphanCheckResult,
} from "@data-agent/contracts";
import type {
  ObservableStorageClient,
  ObservedStorageObject,
} from "./file-system-storage-client.js";

type OrphanAuthority = Readonly<{
  classifyOrphan(
    capability: unknown,
    command: WorkspaceContentOrphanCheckCommand,
  ): Promise<PortResult<WorkspaceContentOrphanCheckResult>>;
}>;

const digestPattern = /\/([0-9a-f]{64})$/;

export function createWorkspaceContentOrphanGc(
  options: Readonly<{
    authority: OrphanAuthority;
    storage: ObservableStorageClient;
  }>,
) {
  return Object.freeze({
    async collect(
      capability: unknown,
      input: Readonly<{
        app_id: string;
        workspace_id: string;
        environment: string;
        limit?: number;
      }>,
    ): Promise<PortResult<Readonly<{ examined: number; deleted: number }>>> {
      const limit = input.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        return {
          ok: false,
          error: {
            code: "WORKSPACE_CONTENT_ORPHAN_LIMIT_INVALID",
            message: "Orphan GC limit 无效。",
            retryable: false,
          },
        };
      }
      const prefix = `workspace-content/v1/${input.app_id}/${input.workspace_id}/${input.environment}`;
      let observed: ObservedStorageObject[];
      try {
        observed = (await options.storage.listObserved(prefix)).slice(0, limit);
      } catch {
        return {
          ok: false,
          error: {
            code: "STORAGE_UNAVAILABLE",
            message: "Workspace 文件存储暂时不可用。",
            retryable: true,
          },
        };
      }
      let deleted = 0;
      for (const object of observed) {
        const digest = digestPattern.exec(object.key)?.[1];
        if (!digest) continue;
        const command = {
          schema_version: "workspace-content-orphan-check@1.0.0",
          workspace_id: input.workspace_id,
          storage_key: object.key,
          blob_hash: `sha256:${digest}`,
          observed_at: object.modified_at,
        } as const;
        const first = await options.authority.classifyOrphan(capability, command);
        if (!first.ok) return first;
        const ageMs =
          new Date(first.value.checked_at).getTime() - new Date(first.value.observed_at).getTime();
        if (first.value.authorized || ageMs < first.value.orphan_ttl_seconds * 1_000) continue;
        const second = await options.authority.classifyOrphan(capability, command);
        if (!second.ok) return second;
        if (second.value.authorized) continue;
        try {
          if (await options.storage.removeObserved(object)) deleted += 1;
        } catch {
          return {
            ok: false,
            error: {
              code: "STORAGE_UNAVAILABLE",
              message: "Workspace 文件存储暂时不可用。",
              retryable: true,
            },
          };
        }
      }
      return { ok: true, value: Object.freeze({ examined: observed.length, deleted }) };
    },
  });
}

export type WorkspaceContentOrphanGc = ReturnType<typeof createWorkspaceContentOrphanGc>;
